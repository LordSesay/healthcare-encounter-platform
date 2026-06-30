// Constants only; data now lives in PostgreSQL.
const STATUS_FLOW = ['created', 'checked-in', 'in-progress', 'completed', 'discharged'];
const VALID_VISIT_TYPES = ['routine_checkup', 'follow_up', 'urgent_care', 'emergency', 'specialist_referral', 'lab_work'];
const VALID_DEPARTMENTS = ['general', 'outpatient', 'inpatient', 'emergency', 'radiology', 'laboratory', 'cardiology', 'pediatrics'];
const VALID_PRIORITIES = ['low', 'normal', 'urgent', 'critical'];

module.exports = {
  STATUS_FLOW,
  VALID_VISIT_TYPES,
  VALID_DEPARTMENTS,
  VALID_PRIORITIES
};
