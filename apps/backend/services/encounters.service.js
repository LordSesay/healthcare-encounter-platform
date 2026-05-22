const repo = require('../models/encounters.repository');
const { generateEncounterId } = require('../utils/id-generator');

const STATUS_FLOW = ['created', 'checked-in', 'in-progress', 'completed', 'discharged'];
const VALID_PRIORITIES = ['low', 'normal', 'urgent', 'critical'];

const ADT_EVENT_MAP = {
  ADT_A01: { action: 'admit', status: 'checked-in' },
  ADT_A02: { action: 'transfer', status: 'in-progress' },
  ADT_A03: { action: 'discharge', status: 'discharged' },
  ADT_A04: { action: 'register', status: 'created' },
  ADT_A08: { action: 'update', status: null }
};

async function getStats() {
  return repo.getStats();
}

async function createEncounter({ clinicId, patientReference, visitType, department, priority, provider, notes }) {
  const encounter = await repo.createEncounter({
    encounterId: generateEncounterId(),
    clinicId,
    patientReference,
    visitType,
    department: department || 'general',
    priority: VALID_PRIORITIES.includes(priority) ? priority : 'normal',
    provider: provider || null,
    notes: notes || null,
    status: 'created'
  });

  encounter.statusHistory = await repo.getStatusHistory(encounter.encounterId);
  return encounter;
}

async function listEncounters(filters) {
  return repo.listEncounters(filters);
}

async function getEncounterById(encounterId) {
  const encounter = await repo.getEncounterById(encounterId);
  if (!encounter) return null;

  encounter.statusHistory = await repo.getStatusHistory(encounterId);
  return encounter;
}

async function advanceStatus(encounterId) {
  const encounter = await repo.getEncounterById(encounterId);
  if (!encounter) return { error: 'Encounter not found', status: 404 };

  const currentIdx = STATUS_FLOW.indexOf(encounter.status);
  if (currentIdx === -1 || currentIdx === STATUS_FLOW.length - 1) {
    return { error: 'Encounter already at final status', status: 400 };
  }

  const nextStatus = STATUS_FLOW[currentIdx + 1];
  const updated = await repo.updateStatus(encounterId, nextStatus, encounter.status);
  updated.statusHistory = await repo.getStatusHistory(encounterId);
  return { data: updated };
}

async function updateEncounter(encounterId, updates) {
  const encounter = await repo.getEncounterById(encounterId);
  if (!encounter) return null;

  return repo.updateEncounter(encounterId, updates);
}

async function deleteEncounter(encounterId) {
  return repo.deleteEncounter(encounterId);
}

// ADT operations
async function createFromAdt({ event_type, event_id, source_system, patient, visit }) {
  const eventConfig = ADT_EVENT_MAP[event_type];
  if (!eventConfig) {
    throw new Error(`Unsupported ADT event type: ${event_type}`);
  }

  // Resolve existing encounter by event_id or by MRN + CSN
  const existing = await repo.findByEventId(event_id)
    || (visit.epic_csn && await repo.resolveEncounter({ mrn: patient.mrn, csn: visit.epic_csn }));

  // For transfer/discharge/update — advance existing encounter
  if (event_type === 'ADT_A02' || event_type === 'ADT_A03' || event_type === 'ADT_A08') {
    if (!existing) {
      throw new Error(`Cannot ${eventConfig.action}: no existing encounter found for patient ${patient.mrn}`);
    }
    if (eventConfig.status) {
      await repo.updateStatus(existing.encounterId, eventConfig.status, existing.status);
    }
    return {
      duplicate: false,
      data: { message: `Encounter ${eventConfig.action} processed`, encounter_id: existing.encounterId, status: eventConfig.status || existing.status, action: eventConfig.action }
    };
  }

  // For admit/register — return existing or create new
  if (existing) {
    return {
      duplicate: true,
      data: { message: 'Encounter already exists. Returning existing ID.', encounter_id: existing.encounterId, status: existing.status, idempotent: true }
    };
  }

  const encounter = await repo.createEncounter({
    encounterId: generateEncounterId(),
    clinicId: visit.facility_id || 'clinic-default',
    patientReference: patient.mrn,
    visitType: visit.visit_type || 'urgent_care',
    department: visit.department || 'emergency',
    priority: visit.priority || 'normal',
    provider: visit.attending_provider || null,
    notes: null,
    status: eventConfig.status,
    sourceSystem: source_system,
    externalVisitReference: visit.epic_csn || event_id
  });

  return {
    duplicate: false,
    data: { message: `Encounter ${eventConfig.action} processed`, encounter_id: encounter.encounterId, status: eventConfig.status, action: eventConfig.action }
  };
}

async function resolveEncounter({ mrn, csn, facility_id }) {
  const encounter = await repo.resolveEncounter({ mrn, csn, facility_id });
  return encounter;
}

async function listAdtEncounters({ status, facility_id, mrn }) {
  const filters = {};
  if (status) filters.status = status;
  if (mrn) filters.search = mrn;

  const result = await repo.listEncounters(filters);
  return result.encounters;
}

async function getAdtEncounter(id) {
  return repo.getEncounterById(id);
}

async function updateAdtStatus(id, status) {
  const encounter = await repo.getEncounterById(id);
  if (!encounter) return null;

  await repo.updateStatus(id, status, encounter.status);
  return { message: 'Status updated', encounter_id: id, new_status: status };
}

module.exports = {
  getStats,
  createEncounter,
  listEncounters,
  getEncounterById,
  advanceStatus,
  updateEncounter,
  deleteEncounter,
  createFromAdt,
  resolveEncounter,
  listAdtEncounters,
  getAdtEncounter,
  updateAdtStatus,
  STATUS_FLOW,
  ADT_EVENT_MAP,
  VALID_PRIORITIES
};
