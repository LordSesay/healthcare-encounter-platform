// A separate SELECT gets a fresh READ COMMITTED snapshot if another transaction
// won the INSERT. Existing clinics are read without a row UPDATE lock.
async function getOrCreateClinic(clinicRef, db) {
  const existing = await db.query('SELECT clinic_id FROM clinics WHERE external_clinic_ref=$1', [clinicRef]);
  if (existing.rowCount) return existing.rows[0].clinic_id;
  const inserted = await db.query(`INSERT INTO clinics(external_clinic_ref, clinic_name)
    VALUES($1,$1) ON CONFLICT(external_clinic_ref) DO NOTHING RETURNING clinic_id`, [clinicRef]);
  if (inserted.rowCount) return inserted.rows[0].clinic_id;
  const found = await db.query('SELECT clinic_id FROM clinics WHERE external_clinic_ref=$1', [clinicRef]);
  if (!found.rowCount) throw new Error('Clinic disappeared during creation');
  return found.rows[0].clinic_id;
}
module.exports = { getOrCreateClinic };
