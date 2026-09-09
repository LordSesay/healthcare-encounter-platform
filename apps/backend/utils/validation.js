const fail = (message, status = 409) => Object.assign(new Error(message), { status });

function text(value, name, max = 150) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw fail(`Invalid ${name}`, 400);
  }
  return value;
}

// Validate the same namespace fields for ADT and direct creation. Unscoped
// direct encounters remain supported, but supplied fields must always be valid.
function identity(values, { allowUnscoped = false } = {}) {
  const result = {};
  for (const [key, max] of Object.entries({ facility: 100, mrn: 150, source: 100, visit: 150, authority: 150 })) {
    const required = !allowUnscoped || key === 'facility' || key === 'mrn' || values.visit !== undefined;
    if (required || values[key] !== undefined) result[key] = text(values[key], key, max);
  }
  return result;
}

function assertMutable(row) {
  if (row.status === 'voided') throw fail('Encounter is voided');
}

// RFC 3339 application profile: calendar-valid dates, explicit offsets, and
// millisecond precision. Reject leap seconds and sub-millisecond values instead
// of silently rounding them in JavaScript Date and changing ordering/hash identity.
function timestamp(value, name = 'occurred_at') {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?([Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  const invalid = () => fail(`${name} must be a valid RFC 3339 timestamp (years 0001-9999, no leap seconds, at most 3 fractional digits)`, 400);
  if (!match || match[0] !== value) throw invalid();
  const [, y, m, d, h, min, sec, fraction = '', zone, sign, oh = '0', om = '0'] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      Number(h) > 23 || Number(min) > 59 || Number(sec) > 59 || Number(oh) > 23 || Number(om) > 59) throw invalid();
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(Number(h), Number(min), Number(sec), Number(fraction.padEnd(3, '0')));
  const offset = /^[Zz]$/.test(zone) ? 0 : (Number(oh) * 60 + Number(om)) * (sign === '-' ? -1 : 1);
  const utc = new Date(local.getTime() - offset * 60000);
  if (utc.getUTCFullYear() < 1 || utc.getUTCFullYear() > 9999) throw invalid();
  return utc.toISOString();
}

module.exports = { fail, text, identity, assertMutable, timestamp };
