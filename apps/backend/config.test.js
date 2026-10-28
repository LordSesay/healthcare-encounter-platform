'use strict';
// Production must fail closed rather than fall back to dev credentials or wildcard CORS.

const ORIGINAL_ENV = process.env;

function loadConfig(env) {
  process.env = { ...ORIGINAL_ENV, NODE_ENV: undefined, DATABASE_URL: undefined, CORS_ORIGIN: undefined, ...env };
  let config;
  jest.isolateModules(() => { config = require('./config'); });
  return config;
}

afterEach(() => { process.env = ORIGINAL_ENV; });

const PROD = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/encounters', CORS_ORIGIN: 'https://app.example.com' };

test('production requires DATABASE_URL', () => {
  expect(() => loadConfig({ ...PROD, DATABASE_URL: undefined })).toThrow('DATABASE_URL is required in production');
});

test('production requires CORS_ORIGIN', () => {
  expect(() => loadConfig({ ...PROD, CORS_ORIGIN: undefined })).toThrow('CORS_ORIGIN is required in production');
});

test('production rejects wildcard CORS_ORIGIN', () => {
  expect(() => loadConfig({ ...PROD, CORS_ORIGIN: '*' })).toThrow('explicit origin');
});

test('production uses provided settings', () => {
  const config = loadConfig(PROD);
  expect(config.DATABASE_URL).toBe(PROD.DATABASE_URL);
  expect(config.CORS_ORIGIN).toBe(PROD.CORS_ORIGIN);
});

test('local development keeps working defaults without wildcard CORS', () => {
  const config = loadConfig({});
  expect(config.DATABASE_URL).toMatch(/@localhost:5432\/encounters$/);
  expect(config.CORS_ORIGIN).toBe('http://localhost:3000');
});
