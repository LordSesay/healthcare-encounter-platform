const { Router } = require('express');
const service = require('../services/encounters.service');

const VALID_VISIT_TYPES = ['routine_checkup', 'follow_up', 'urgent_care', 'emergency', 'specialist_referral', 'lab_work'];
const VALID_DEPARTMENTS = ['general', 'outpatient', 'inpatient', 'emergency', 'radiology', 'laboratory', 'cardiology', 'pediatrics'];

const router = Router();

router.get('/stats', async (req, res) => {
  try {
    const { stats, byDepartment, byPriority } = await service.getStats();
    res.json({ message: 'Encounter stats retrieved successfully', stats, byStatus: stats, byDepartment, byPriority });
  } catch (err) {
    res.status(err.status || (err.code === '23505' ? 409 : 500)).json({ error: 'Failed to retrieve stats', detail: err.status ? err.message : undefined });
  }
});

router.get('/options', (req, res) => {
  res.json({ visitTypes: VALID_VISIT_TYPES, departments: VALID_DEPARTMENTS, priorities: service.VALID_PRIORITIES, statuses: service.STATUS_FLOW });
});

router.post('/', async (req, res) => {
  const { clinicId, patientReference, visitType } = req.body;

  if (!clinicId || !patientReference || !visitType) {
    return res.status(400).json({ error: 'clinicId, patientReference, and visitType are required' });
  }

  try {
    const encounter = await service.createEncounter(req.body);
    res.status(201).json(encounter);
  } catch (err) {
    res.status(err.status || (err.code === '23505' ? 409 : 500)).json({ error: 'Failed to create encounter', detail: err.status ? err.message : undefined });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await service.listEncounters(req.query);
    res.json(result);
  } catch (err) {
    res.status(err.status || (err.code === '23505' ? 409 : 500)).json({ error: 'Failed to list encounters', detail: err.status ? err.message : undefined });
  }
});

router.get('/:encounterId', async (req, res) => {
  try {
    const encounter = await service.getEncounterById(req.params.encounterId);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    res.json(encounter);
  } catch (err) {
    res.status(err.status || (err.code === '23505' ? 409 : 500)).json({ error: 'Failed to get encounter', detail: err.status ? err.message : undefined });
  }
});

router.patch('/:encounterId/status', async (req, res) => {
  try {
    const result = await service.advanceStatus(req.params.encounterId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result.data);
  } catch (err) {
    res.status(err.status || (err.code === '23505' ? 409 : 500)).json({ error: 'Failed to advance status', detail: err.status ? err.message : undefined });
  }
});

router.patch('/:encounterId', async (req, res) => {
  try {
    const encounter = await service.updateEncounter(req.params.encounterId, req.body);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    res.json(encounter);
  } catch (err) {
    res.status(err.status || (err.code === '23505' ? 409 : 500)).json({ error: 'Failed to update encounter', detail: err.status ? err.message : undefined });
  }
});

router.delete('/:encounterId', async (req, res) => {
  try {
    const removed = await service.deleteEncounter(req.params.encounterId);
    if (!removed) return res.status(404).json({ error: 'Encounter not found' });
    res.json({ message: 'Encounter voided', encounterId: removed.encounterId });
  } catch (err) {
    res.status(err.status || (err.code === '23505' ? 409 : 500)).json({ error: 'Failed to delete encounter', detail: err.status ? err.message : undefined });
  }
});

module.exports = router;
