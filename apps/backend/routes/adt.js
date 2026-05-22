const { Router } = require('express');
const service = require('../services/encounters.service');

const router = Router();

// Resolve endpoint — downstream systems look up encounter by external identifiers
router.get('/resolve', async (req, res) => {
  const { mrn, csn, facility_id } = req.query;

  if (!mrn && !csn) {
    return res.status(400).json({ error: 'At least one of mrn or csn is required' });
  }

  try {
    const encounter = await service.resolveEncounter({ mrn, csn, facility_id });
    if (!encounter) return res.status(404).json({ error: 'No encounter found for given identifiers' });
    res.json({ encounter_id: encounter.encounterId, status: encounter.status, patient_reference: encounter.patientReference, facility: encounter.clinicId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve encounter', detail: err.message });
  }
});

router.get('/adt', async (req, res) => {
  try {
    const results = await service.listAdtEncounters(req.query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list ADT encounters', detail: err.message });
  }
});

router.get('/adt/:id', async (req, res) => {
  try {
    const encounter = await service.getAdtEncounter(req.params.id);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    res.json(encounter);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get encounter', detail: err.message });
  }
});

router.patch('/adt/:id/status', async (req, res) => {
  const { status } = req.body;

  if (!service.STATUS_FLOW.includes(status)) {
    return res.status(400).json({ error: 'Invalid status', valid_statuses: service.STATUS_FLOW });
  }

  try {
    const result = await service.updateAdtStatus(req.params.id, status);
    if (!result) return res.status(404).json({ error: 'Encounter not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update status', detail: err.message });
  }
});

// ADT event ingestion — supports A01, A02, A03, A04, A08
router.post('/from-adt', async (req, res) => {
  const { event_type, event_id, patient, visit } = req.body;

  if (!service.ADT_EVENT_MAP[event_type]) {
    return res.status(400).json({ error: 'Unsupported ADT event type', supported_events: Object.keys(service.ADT_EVENT_MAP) });
  }
  if (!event_id || !patient?.mrn) {
    return res.status(400).json({ error: 'Missing required fields: event_id, patient.mrn' });
  }

  try {
    const result = await service.createFromAdt(req.body);
    const statusCode = result.duplicate ? 200 : 201;
    res.status(statusCode).json(result.data);
  } catch (err) {
    const status = err.message.includes('no existing encounter') ? 404 : 500;
    res.status(status).json({ error: 'Failed to process ADT event', detail: err.message });
  }
});

module.exports = router;
