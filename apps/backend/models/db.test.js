'use strict';
const { sslConfig } = require('./db');

afterAll(() => require('./db').pool.end());

test('DB_SSL=false disables TLS for local databases only by explicit opt-out', () => {
  expect(sslConfig({DB_SSL:'false',DB_SSL_CA_FILE:'/ignored'})).toBe(false);
});

test('TLS verifies the server by default', () => {
  expect(sslConfig({})).toEqual({rejectUnauthorized:true});
});

test('DB_SSL_CA_FILE adds the RDS CA bundle without relaxing verification', () => {
  const readFile = jest.fn().mockReturnValue('-----BEGIN CERTIFICATE-----');
  expect(sslConfig({DB_SSL_CA_FILE:'/app/certs/rds-global-bundle.pem'}, readFile))
    .toEqual({rejectUnauthorized:true,ca:'-----BEGIN CERTIFICATE-----'});
  expect(readFile).toHaveBeenCalledWith('/app/certs/rds-global-bundle.pem','utf8');
});

test('a configured but missing CA file fails startup instead of connecting unverified', () => {
  expect(() => sslConfig({DB_SSL_CA_FILE:'/does/not/exist.pem'})).toThrow();
});
