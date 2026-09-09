const { timestamp, identity } = require('./validation');
const { cleanupDatabase } = require('../test-support/database');

test.each([
  '2026-02-30T10:00:00Z', '2025-02-29T10:00:00Z', '1900-02-29T10:00:00Z',
  '2026-04-31T10:00:00Z', '2026-00-01T10:00:00Z', '2026-13-01T10:00:00Z',
  '2026-01-00T10:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T10:60:00Z',
  '2026-01-01T10:00:60Z', 'January 1, 2026 10:00:00Z', '2026-01-01 10:00:00Z',
  '2026-01-01T10:00:00', '2026-01-01T10:00:00+24:00', '2026-01-01T10:00:00+01:60',
  '2026-01-01T10:00:00+0100', '2026-01-01T10:00:00.1234Z', '2026-01-01T10:00:00.Z',
  '2026-01-01T10:00:00Z\n', '0000-01-01T10:00:00Z', null, 123
])('rejects malformed or unrepresentable timestamp %p', value => {
  expect(() => timestamp(value)).toThrow(expect.objectContaining({ status: 400 }));
});
test.each([
  ['2024-02-29T10:00:00Z', '2024-02-29T10:00:00.000Z'],
  ['2000-02-29t10:00:00z', '2000-02-29T10:00:00.000Z'],
  ['2026-01-01T05:00:00.12-05:00', '2026-01-01T10:00:00.120Z'],
  ['2026-01-01T15:30:00.123+05:30', '2026-01-01T10:00:00.123Z'],
  ['2026-01-01T00:00:00+01:00', '2025-12-31T23:00:00.000Z'],
  ['2026-01-01T10:00:00-00:00', '2026-01-01T10:00:00.000Z'],
  ['0001-01-01T10:00:00Z', '0001-01-01T10:00:00.000Z']
])('canonicalizes valid timestamp %s', (value, expected) => expect(timestamp(value)).toBe(expected));

test('identities are case-sensitive and not silently trimmed', () => {
  const input = { facility:'North', mrn:'Patient', source:'EHR', visit:'Visit', authority:'Authority' };
  expect(identity(input)).toEqual(input);
});
test('cleanup closes the pool even when schema deletion fails', async () => {
  const error = new Error('database unavailable during cleanup');
  const pool = { query:jest.fn().mockRejectedValue(error), end:jest.fn().mockResolvedValue() };
  await expect(cleanupDatabase(pool, 'adt_test_' + 'a'.repeat(32))).rejects.toBe(error);
  expect(pool.end).toHaveBeenCalledTimes(1);
});
