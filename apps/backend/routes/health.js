const { Router } = require('express');
const { Pool } = require('pg');
const { DATABASE_URL } = require('../config');

const router = Router();
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, max: 1 }) : null;

router.get('/health', async (req, res) => {
  let dbStatus = 'not configured';
  if (pool) {
    try {
      await pool.query('SELECT 1');
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }
  }

  const status = dbStatus === 'disconnected' ? 'degraded' : 'healthy';
  const code = status === 'healthy' ? 200 : 503;

  res.status(code).json({
    status,
    service: 'encounter-id-api',
    version: process.env.APP_VERSION || process.env.BUILD_NUMBER || '1.0.0',
    uptime: Math.floor(process.uptime()),
    database: dbStatus,
    memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
