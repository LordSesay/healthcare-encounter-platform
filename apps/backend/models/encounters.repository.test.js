jest.mock('./db', () => ({
  pool: {
    query: jest.fn()
  }
}));

const { pool } = require('./db');
const repo = require('./encounters.repository');

describe('encounters repository', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  test('persists external visit reference when creating an encounter', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ clinic_id: 'clinic-uuid' }] })
      .mockResolvedValueOnce({
        rows: [{
          encounter_id: 'ENC-123',
          clinic_ref: 'facility-1',
          patient_reference: 'MRN-123',
          external_visit_reference: 'CSN-456',
          visit_type: 'urgent_care',
          department: 'emergency',
          priority: 'normal',
          provider_reference: null,
          status: 'checked-in',
          notes: null,
          source_system: 'mirth',
          created_at: new Date('2026-01-01T00:00:00Z'),
          updated_at: new Date('2026-01-01T00:00:00Z'),
          discharged_at: null
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    await repo.createEncounter({
      encounterId: 'ENC-123',
      clinicId: 'facility-1',
      patientReference: 'MRN-123',
      externalVisitReference: 'CSN-456',
      visitType: 'urgent_care',
      department: 'emergency',
      priority: 'normal',
      provider: null,
      notes: null,
      status: 'checked-in',
      sourceSystem: 'mirth'
    });

    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[0]).toContain('external_visit_reference');
    expect(insertCall[1][3]).toBe('CSN-456');
  });
});
