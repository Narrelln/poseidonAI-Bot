// routes/tpStatusRoute.js
const express = require('express');
const router = express.Router();

const { getTpSnapshots } = require('../tpSlMonitor');

/**
 * GET /api/health/tpsl
 * Returns latest TP/SL feed snapshot for UI or monitoring tools
 */
router.get('/tp-snapshots', (req, res) => {
  const { feed } = getTpSnapshots();
  const recent = feed.slice(-20); // limit to last 20
  const tracked = feed.filter(row => ['PURSUIT', 'TRAILING'].includes(row.state)).length;

  res.json({
    success: true,
    tracked,
    recent
  });});

module.exports = router;