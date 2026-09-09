const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate(db = pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Old migrations seed naive timestamp columns; keep those writes in UTC
    // until the additive instant conversion has completed.
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SELECT pg_advisory_xact_lock(78231001)");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const dir = path.join(__dirname, 'migrations');
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file]);
      if (applied.rowCount) continue;
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
if (require.main === module) migrate().catch(error => {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
module.exports = { migrate };
