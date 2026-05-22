const { pool } = require('./db');

async function getOrCreateClinic(clinicRef) {
  const { rows } = await pool.query(
    `INSERT INTO clinics (external_clinic_ref, clinic_name)
     VALUES ($1, $1)
     ON CONFLICT (external_clinic_ref) DO UPDATE SET updated_at = NOW()
     RETURNING clinic_id`,
    [clinicRef]
  );
  return rows[0].clinic_id;
}

async function createEncounter({ encounterId, clinicId, patientReference, visitType, department, priority, provider, notes, status, sourceSystem }) {
  const clinicUuid = await getOrCreateClinic(clinicId);

  const { rows } = await pool.query(
    `INSERT INTO encounters (encounter_id, clinic_id, patient_reference, visit_type, department, priority, provider_reference, notes, status, source_system)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [encounterId, clinicUuid, patientReference, visitType, department, priority, provider, notes, status, sourceSystem || null]
  );

  await pool.query(
    `INSERT INTO encounter_status_history (encounter_id, previous_status, new_status, changed_by)
     VALUES ($1, NULL, $2, $3)`,
    [encounterId, status, 'system']
  );

  return mapRow(rows[0]);
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

async function listEncounters({ status, department, priority, search, limit }) {
  let conditions = [];
  let params = [];
  let idx = 1;

  if (status) { conditions.push(`e.status = $${idx++}`); params.push(status); }
  if (department) { conditions.push(`e.department = $${idx++}`); params.push(department); }
  if (priority) { conditions.push(`e.priority = $${idx++}`); params.push(priority); }
  if (search) {
    conditions.push(`(e.encounter_id ILIKE $${idx} OR e.patient_reference ILIKE $${idx} OR c.external_clinic_ref ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const cap = Math.min(parseInt(limit) || 50, 100);
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
  const { rows } = await pool.query(
    `UPDATE encounters SET status = $1, updated_at = NOW() WHERE encounter_id = $2 RETURNING *`,
    [newStatus, encounterId]
  );

  await pool.query(
    `INSERT INTO encounter_status_history (encounter_id, previous_status, new_status, changed_by)
     VALUES ($1, $2, $3, $4)`,
    [encounterId, previousStatus, newStatus, 'system']
  );

  const encounter = await getEncounterById(encounterId);
  return encounter;
}

async function updateEncounter(encounterId, { notes, provider, priority }) {
  let sets = ['updated_at = NOW()'];
  let params = [];
  let idx = 1;

  if (notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(notes); }
  if (provider !== undefined) { sets.push(`provider_reference = $${idx++}`); params.push(provider); }
  if (priority) { sets.push(`priority = $${idx++}`); params.push(priority); }

  params.push(encounterId);

  await pool.query(
    `UPDATE encounters SET ${sets.join(', ')} WHERE encounter_id = $${idx}`,
    params
  );

  return getEncounterById(encounterId);
}

async function deleteEncounter(encounterId) {
  const encounter = await getEncounterById(encounterId);
  if (!encounter) return null;

  await pool.query(
    `UPDATE encounters SET status = 'voided', updated_at = NOW() WHERE encounter_id = $1`,
    [encounterId]
  );

  await pool.query(
    `INSERT INTO encounter_status_history (encounter_id, previous_status, new_status, changed_by, change_reason)
     VALUES ($1, $2, 'voided', 'system', 'Encounter voided by user')`,
    [encounterId, encounter.status]
  );

  return encounter;
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
    reason: r.change_reason
  }));
}

async function findByEventId(eventId) {
  const { rows } = await pool.query(
    `SELECT e.*, c.external_clinic_ref as clinic_ref
     FROM encounters e
     JOIN clinics c ON e.clinic_id = c.clinic_id
     WHERE e.external_visit_reference = $1`,
    [eventId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

async function resolveEncounter({ mrn, csn, facility_id }) {
  let conditions = [];
  let params = [];
  let idx = 1;

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
     LIMIT 1`,
    params
  );
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
  findByEventId,
  resolveEncounter,
  getOrCreateClinic
};
