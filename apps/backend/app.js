const express = require('express');
const { CORS_ORIGIN } = require('./config');
const { generateEncounterId } = require('./utils/id-generator');

const healthRoutes = require('./routes/health');
const encounterRoutes = require('./routes/encounters');
const adtRoutes = require('./routes/adt');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Source-System');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  req.sourceSystem = req.headers['x-source-system'] || 'unknown';
  next();
});

app.use(healthRoutes);
app.use('/api/encounters', adtRoutes);
app.use('/api/encounters', encounterRoutes);

app.get('/api/id', (req, res) => {
  res.json({ id: generateEncounterId(), message: 'Encounter ID generated successfully' });
});

module.exports = app;
