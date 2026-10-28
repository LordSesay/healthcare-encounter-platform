const fs = require('fs');
const { Pool } = require('pg');
const { DATABASE_URL } = require('../config');

// TLS always verifies the server. RDS certificates chain to Amazon RDS CAs,
// which are not in Node's default trust store, so deployments pass the bundle.
function sslConfig(env = process.env, readFile = fs.readFileSync) {
  if (env.DB_SSL === 'false') return false;
  if (env.DB_SSL_CA_FILE) return { rejectUnauthorized: true, ca: readFile(env.DB_SSL_CA_FILE, 'utf8') };
  return { rejectUnauthorized: true };
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig(),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error:', err.message);
});

module.exports = { pool, sslConfig };
