const { pool } = require('./db');

const { identity, assertMutable } = require('../utils/validation');
const clinics = require('./clinics.repository');
const getOrCreateClinic = (ref, db = pool) => clinics.getOrCreateClinic(ref, db);

async function createEncounter({
  encounterId,
  clinicId,
  patientReference,
  externalVisitReference,
  visitType,
  department,
  priority,
  provider,
  notes,
  status,
  sourceSystem, patientAssigningAuthority
}) {
  identity({ facility: clinicId, mrn: patientReference, visit: externalVisitReference, source: sourceSystem, authority: patientAssigningAuthority }, { allowUnscoped: true });
  return require('./adt.repository').transaction(async db => {
  const clinicUuid = await getOrCreateClinic(clinicId, db);

  const { rows } = await db.query(
    `INSERT INTO encounters (encounter_id, clinic_id, patient_reference, external_visit_reference, visit_type, department, priority, provider_reference, notes, status, source_system, patient_assigning_authority)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [encounterId, clinicUuid, patientReference, externalVisitReference || null, visitType, department, priority, provider, notes, status, sourceSystem || null, patientAssigningAuthority || null]
  );

  await db.query(
    `INSERT INTO encounter_status_history (encounter_id, previous_status, new_status, changed_by)
     VALUES ($1, NULL, $2, $3)`,
    [encounterId, status, 'system']
  );

  return mapRow({ ...rows[0], clinic_ref: clinicId });
  });
}

async function getEncounterById(encounterId) {
  const { rows } = await pool.query(
    `SELECT e.*, c.external_clinic_ref as clinic_ref
     FROM encounters e
     JOIN clinics c ON e.clinic_id = c.clinic_id
     WHERE e.encounter_id = $1`,
    [encounterId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

async function listEncounters({ status, department, priority, search, limit, facility_id }) {
  let conditions = [];
  let params = [];
  let idx = 1;

  if (facility_id) { conditions.push(`c.external_clinic_ref = $${idx++}`); params.push(facility_id); }
  if (status) { conditions.push(`e.status = $${idx++}`); params.push(status); }
  if (department) { conditions.push(`e.department = $${idx++}`); params.push(department); }
  if (priority) { conditions.push(`e.priority = $${idx++}`); params.push(priority); }
  if (search) {
    conditions.push(`(e.encounter_id ILIKE $${idx} OR e.patient_reference ILIKE $${idx} OR c.external_clinic_ref ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const cap = Math.max(1, Math.min(parseInt(limit) || 50, 100));
  params.push(cap);

  const { rows } = await pool.query(
    `SELECT e.*, c.external_clinic_ref as clinic_ref
     FROM encounters e
     JOIN clinics c ON e.clinic_id = c.clinic_id
     ${where}
     ORDER BY e.created_at DESC
     LIMIT $${idx}`,
    params
  );

  return { count: rows.length, encounters: rows.map(mapRow) };
}

async function updateStatus(encounterId, newStatus, previousStatus) {
  const row = await require('./adt.repository').changeStatus(encounterId, newStatus, previousStatus);
  return row ? getEncounterById(encounterId) : null;
}

async function updateEncounter(encounterId, { notes, provider, priority }) {
  return require('./adt.repository').transaction(async db => {
    const { rows: [row] } = await db.query('SELECT * FROM encounters WHERE encounter_id=$1 FOR UPDATE', [encounterId]);
    if (!row) return null;
    assertMutable(row);
    const sets = ['updated_at = NOW()'];
    const params = [];
    for (const [column, value] of Object.entries({ notes, provider_reference: provider, priority })) {
      if (value !== undefined) {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      }
    }
    params.push(encounterId);
    const { rows: [updated] } = await db.query(
      `UPDATE encounters SET ${sets.join(', ')} WHERE encounter_id=$${params.length} RETURNING *`, params);
    const { rows: [clinic] } = await db.query('SELECT external_clinic_ref FROM clinics WHERE clinic_id=$1', [row.clinic_id]);
    return mapRow({ ...updated, clinic_ref: clinic.external_clinic_ref });
  });
}

async function deleteEncounter(encounterId) {
  return updateStatus(encounterId, 'voided');
}

async function getStats() {
  const statusResult = await pool.query(
    `SELECT status, COUNT(*)::int as count FROM encounters GROUP BY status`
  );
  const deptResult = await pool.query(
    `SELECT department, COUNT(*)::int as count FROM encounters GROUP BY department`
  );
  const priorityResult = await pool.query(
    `SELECT priority, COUNT(*)::int as count FROM encounters GROUP BY priority`
  );
  const totalResult = await pool.query(
    `SELECT COUNT(*)::int as total FROM encounters`
  );

  const stats = { total: totalResult.rows[0].total };
  statusResult.rows.forEach(r => { stats[r.status] = r.count; });

  const byDepartment = {};
  deptResult.rows.forEach(r => { byDepartment[r.department] = r.count; });

  const byPriority = {};
  priorityResult.rows.forEach(r => { byPriority[r.priority] = r.count; });

  return { stats, byDepartment, byPriority };
}

async function getStatusHistory(encounterId) {
  const { rows } = await pool.query(
    `SELECT * FROM encounter_status_history WHERE encounter_id = $1 ORDER BY changed_at ASC`,
    [encounterId]
  );
  return rows.map(r => ({
    status: r.new_status,
    previousStatus: r.previous_status,
    timestamp: r.changed_at,
    changedBy: r.changed_by,
    reason: r.change_reason,
    inboxId: r.inbox_id
  }));
}

async function resolveEncounter({ mrn, csn, facility_id, source_system, assigning_authority }) {
  let conditions = [];
  let params = [];
  let idx = 1;

  if (source_system) { conditions.push(`e.source_system = $${idx++}`); params.push(source_system); }
  if (assigning_authority) { conditions.push(`e.patient_assigning_authority = $${idx++}`); params.push(assigning_authority); }
  if (mrn) { conditions.push(`e.patient_reference = $${idx++}`); params.push(mrn); }
  if (csn) { conditions.push(`e.external_visit_reference = $${idx++}`); params.push(csn); }
  if (facility_id) { conditions.push(`c.external_clinic_ref = $${idx++}`); params.push(facility_id); }

  if (!conditions.length) return null;

  const { rows } = await pool.query(
    `SELECT e.*, c.external_clinic_ref as clinic_ref
     FROM encounters e
     JOIN clinics c ON e.clinic_id = c.clinic_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY e.created_at DESC
     LIMIT 2`,
    params
  );
  if (rows.length > 1) throw Object.assign(new Error('Ambiguous encounter identifiers; provide source, facility and visit identity'), { status: 409 });
  return rows[0] ? mapRow(rows[0]) : null;
}

function mapRow(row) {
  return {
    encounterId: row.encounter_id,
    clinicId: row.clinic_ref || row.external_clinic_ref,
    patientReference: row.patient_reference,
    externalVisitReference: row.external_visit_reference,
    visitType: row.visit_type,
    department: row.department,
    priority: row.priority,
    provider: row.provider_reference,
    status: row.status,
    notes: row.notes,
    sourceSystem: row.source_system,
    patientAssigningAuthority: row.patient_assigning_authority,
    location: row.location,
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dischargedAt: row.discharged_at
  };
}

module.exports = {
  createEncounter,
  getEncounterById,
  listEncounters,
  updateStatus,
  updateEncounter,
  deleteEncounter,
  getStats,
  getStatusHistory,
  resolveEncounter,
  getOrCreateClinic
};
