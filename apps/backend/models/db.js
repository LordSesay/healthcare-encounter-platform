const { Pool } = require('pg');
const { DATABASE_URL } = require('../config');

const sslConfig = process.env.DB_SSL === 'false'
  ? false
  : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error:', err.message);
});

module.exports = { pool };
