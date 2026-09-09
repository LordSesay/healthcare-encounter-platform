const { createHash } = require('crypto');
const { pool } = require('./db');
const { generateEncounterId } = require('../utils/id-generator');
const { fail, text, identity, assertMutable, timestamp } = require('../utils/validation');
const { getOrCreateClinic } = require('./clinics.repository');
const transitions = {
  created: ['checked-in', 'voided'],
  'checked-in': ['in-progress', 'discharged', 'voided'],
  'in-progress': ['completed', 'discharged', 'voided'],
  completed: ['discharged', 'voided'], discharged: ['voided'], voided: []
};
function validateTransition(from, to) {
  if (from !== to && !transitions[from]?.includes(to)) throw fail('Invalid lifecycle transition');
}
async function transaction(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}
function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Invalid envelope', 400);
  const p = input.patient || {}, v = input.visit || {};
  const event = {
    type: text(input.event_type, 'event_type', 20),
    message: text(input.event_id, 'event_id'),
    source: text(input.source_system, 'source_system', 100),
    facility: text(v.facility_id, 'visit.facility_id', 100),
    visit: text(v.visit_id !== undefined ? v.visit_id : v.epic_csn, 'visit.visit_id'),
    mrn: text(p.mrn, 'patient.mrn'),
    authority: text(p.assigning_authority, 'patient.assigning_authority'),
    occurred: input.occurred_at,
    fields: {}
  };
  if (!['ADT_A01','ADT_A02','ADT_A03','ADT_A04','ADT_A08'].includes(event.type)) throw fail('Unsupported event type', 400);
  if (v.visit_id !== undefined && v.epic_csn !== undefined && v.visit_id !== v.epic_csn) throw fail('Conflicting visit identifiers', 400);
  identity(event);
  event.occurred = timestamp(event.occurred);
  for (const [key, max] of Object.entries({visit_type:100, department:100, priority:50, attending_provider:150, location:150, notes:10000})) {
    if (v[key] !== undefined) event.fields[key] = text(v[key], `visit.${key}`, max);
  }
  if (v.priority && !['low','normal','urgent','critical'].includes(v.priority)) throw fail('Invalid priority', 400);
  if (event.type === 'ADT_A02' && !event.fields.location) throw fail('A02 requires visit.location', 400);
  return event;
}
async function processEvent(input) {
  const e = normalize(input);
  const hash = createHash('sha256').update(JSON.stringify(e)).digest('hex');
  const result = await transaction(async c => {
    const inserted = await c.query(`INSERT INTO adt_events(source_system,facility_id,message_id,visit_id,event_type,occurred_at,payload_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING inbox_id`,
    [e.source,e.facility,e.message,e.visit,e.type,e.occurred,hash]);
    if (!inserted.rowCount) {
      const { rows: [prior] } = await c.query('SELECT * FROM adt_events WHERE source_system=$1 AND facility_id=$2 AND message_id=$3', [e.source,e.facility,e.message]);
      if (prior.payload_hash !== hash) throw fail('Message ID reused with different content');
      return { ...prior.response, duplicate: true };
    }
    const inbox = inserted.rows[0].inbox_id;
    // Serialize all events for one visit, including concurrent first admissions.
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([e.source,e.facility,e.visit])]);
    await c.query('SAVEPOINT event_work');
    try {
      const clinicId = await getOrCreateClinic(e.facility, c);
      let { rows: [row] } = await c.query('SELECT * FROM encounters WHERE source_system=$1 AND clinic_id=$2 AND external_visit_reference=$3 FOR UPDATE', [e.source,clinicId,e.visit]);
      const target = {ADT_A01:'checked-in',ADT_A04:'created',ADT_A02:'in-progress',ADT_A03:'discharged'}[e.type];
      const previous = row?.status || null;
      if (!row) {
        if (!['ADT_A01','ADT_A04'].includes(e.type)) throw fail('No existing encounter for event', 404);
        const id = generateEncounterId();
        const created = await c.query(`INSERT INTO encounters(encounter_id,clinic_id,patient_reference,patient_assigning_authority,external_visit_reference,source_system,visit_type,department,priority,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [id,clinicId,e.mrn,e.authority,e.visit,e.source,e.fields.visit_type || 'urgent_care',e.fields.department || 'emergency',e.fields.priority || 'normal',target]);
        row = created.rows[0];
      } else {
        if (row.patient_reference !== e.mrn || row.patient_assigning_authority !== e.authority) throw fail('Patient identity mismatch; reconciliation required');
        if (row.last_event_at && new Date(e.occurred) <= new Date(row.last_event_at)) throw fail('Out-of-order or equal-time event; reconciliation required');
        assertMutable(row);
        if (target) validateTransition(row.status, target);
      }
      const fields = e.fields;
      const { rows: [updated] } = await c.query(`UPDATE encounters SET status=$2, last_event_at=$3, updated_at=NOW(),
        discharged_at=CASE WHEN $10::text='ADT_A03' THEN $3::timestamptz ELSE discharged_at END,
        location=COALESCE($4,location), department=COALESCE($5,department), provider_reference=COALESCE($6,provider_reference),
        priority=COALESCE($7,priority), notes=COALESCE($8,notes), visit_type=COALESCE($9,visit_type)
        WHERE encounter_id=$1 RETURNING *`, [row.encounter_id,target || row.status,e.occurred,fields.location,fields.department,fields.attending_provider,fields.priority,fields.notes,fields.visit_type,e.type]);
      // Every accepted message has provenance in the inbox; status history only records transitions.
      if (previous !== updated.status) await c.query(`INSERT INTO encounter_status_history(encounter_id,previous_status,new_status,changed_by,inbox_id)
        VALUES($1,$2,$3,$4,$5)`, [row.encounter_id,previous,updated.status,e.source,inbox]);
      const response = { duplicate:false, data:{encounter_id:row.encounter_id,status:updated.status,action:e.type} };
      await c.query("UPDATE adt_events SET outcome='processed',encounter_id=$2,response=$3 WHERE inbox_id=$1", [inbox,row.encounter_id,response]);
      return response;
    } catch (error) {
      if (!error.status) throw error;
      await c.query('ROLLBACK TO SAVEPOINT event_work');
      const response = { error:error.message, status:error.status };
      await c.query("UPDATE adt_events SET outcome='rejected',response=$2 WHERE inbox_id=$1", [inbox,response]);
      return response;
    }
  });
  if (result.error) throw fail(result.error,result.status);
  return result;
}
async function changeStatus(id, next, expected) {
  return transaction(async c => {
    const { rows: [row] } = await c.query('SELECT * FROM encounters WHERE encounter_id=$1 FOR UPDATE', [id]);
    if (!row) return null;
    if (expected && row.status !== expected) throw fail('Encounter changed; reload before retrying');
    if (next !== 'voided') assertMutable(row);
    validateTransition(row.status,next);
    if (row.status !== next) {
      await c.query("UPDATE encounters SET status=$2,updated_at=NOW(),discharged_at=CASE WHEN $2::varchar='discharged' THEN COALESCE(discharged_at,NOW()) ELSE discharged_at END WHERE encounter_id=$1", [id,next]);
      await c.query('INSERT INTO encounter_status_history(encounter_id,previous_status,new_status,changed_by) VALUES($1,$2,$3,$4)', [id,row.status,next,'direct-api']);
    }
    return { ...row, status:next };
  });
}
module.exports = { processEvent, changeStatus, transaction, normalize, validateTransition };
