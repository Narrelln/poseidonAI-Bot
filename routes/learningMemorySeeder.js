// routes/learningMemorySeeder.js
/* eslint-disable no-console */
const express = require('express');
const router = express.Router();

const {
  startLearningMemorySeeder,
  stopLearningMemorySeeder,
  seedLearningMemoryOnce,
  getLearningMemorySeederStatus
} = require('../handlers/learningMemorySeeder');

// POST /api/learning-memory/seed-current/start   { intervalMs?: number }
router.post('/learning-memory/seed-current/start', (req, res) => {
  try {
    const { intervalMs } = req.body || {};
    const status = startLearningMemorySeeder({ intervalMs });
    res.json({ success: true, status });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'start failed' });
  }
});

// POST /api/learning-memory/seed-current/stop
router.post('/learning-memory/seed-current/stop', (_req, res) => {
  try {
    const status = stopLearningMemorySeeder();
    res.json({ success: true, status });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'stop failed' });
  }
});

// POST /api/learning-memory/seed-current/once
router.post('/learning-memory/seed-current/once', async (_req, res) => {
  try {
    const r = await seedLearningMemoryOnce();
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'seed failed' });
  }
});

// GET /api/learning-memory/seed-current/status
router.get('/learning-memory/seed-current/status', (_req, res) => {
  try {
    const status = getLearningMemorySeederStatus();
    res.json({ success: true, status });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'status failed' });
  }
});

module.exports = { router };