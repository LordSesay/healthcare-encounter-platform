// Production fails closed: a missing setting stops startup instead of silently
// falling back to local-dev credentials or a wildcard CORS origin.
const isProduction = process.env.NODE_ENV === 'production';

function setting(name, localDefault) {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) throw new Error(`${name} is required in production`);
  return localDefault;
}

const CORS_ORIGIN = setting('CORS_ORIGIN', 'http://localhost:3000');
if (CORS_ORIGIN === '*' && isProduction) {
  throw new Error('CORS_ORIGIN must be an explicit origin in production, not *');
}

module.exports = {
  PORT: process.env.PORT || 8080,
  CORS_ORIGIN,
  DATABASE_URL: setting('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/encounters')
};
