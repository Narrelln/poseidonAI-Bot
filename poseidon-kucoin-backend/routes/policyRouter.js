/* backend/routes/policyRoutes.js */
const express = require('express');
const router = express.Router();
const { getPolicy } = require('../config/policyLoader');

router.get('/policy', (_req, res) => {
  try {
    const p = getPolicy();
    res.json({ ok: true, version: p.version || 1, updatedAt: p.updatedAt || null, policy: p });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;