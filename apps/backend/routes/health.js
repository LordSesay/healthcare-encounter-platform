const { Router } = require('express');
const { pool } = require('../models/db');

const router = Router();

router.get('/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  const healthy = dbStatus === 'connected';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    service: 'encounter-id-api',
    version: process.env.APP_VERSION || process.env.BUILD_NUMBER || '1.0.0',
    uptime: Math.floor(process.uptime()),
    database: dbStatus,
    memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
