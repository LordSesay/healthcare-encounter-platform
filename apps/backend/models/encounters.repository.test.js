const { normalize, validateTransition } = require('./adt.repository');
const envelope = () => ({ event_type:'ADT_A01', event_id:'message-1', source_system:'ehr', occurred_at:'2026-01-01T10:00:00Z', patient:{mrn:'123',assigning_authority:'hospital'}, visit:{visit_id:'visit-1',facility_id:'north'} });
test('message identity cannot substitute for visit identity', () => {
  const e = envelope(); delete e.visit.visit_id;
  expect(() => normalize(e)).toThrow('visit.visit_id');
});
test('requires patient authority and a timezone', () => {
  const e = envelope(); delete e.patient.assigning_authority;
  expect(() => normalize(e)).toThrow('assigning_authority');
  e.patient.assigning_authority = 'hospital'; e.occurred_at = '2026-01-01';
  expect(() => normalize(e)).toThrow('timestamp');
});
test('rejects unsupported transitions and missing transfer location', () => {
  expect(() => validateTransition('discharged','checked-in')).toThrow('transition');
  expect(() => validateTransition('created','discharged')).toThrow('transition');
  expect(() => normalize({...envelope(),event_type:'ADT_A02'})).toThrow('location');
});
test('normalizes aliases and ordering of metadata for retry comparison', () => {
  const e = envelope(); const a = normalize(e);
  e.visit.epic_csn = e.visit.visit_id; delete e.visit.visit_id;
  expect(normalize(e)).toEqual(a);
});
