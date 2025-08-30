// routes/tpStatusRoute.js
const express = require('express');
const router = express.Router();

const { getTpSnapshots } = require('../tpSlMonitor');

/**
 * GET /api/tp-snapshots
 * Returns latest TP/SL feed snapshot for UI or monitoring tools.
 * Optional query:
 *   - limit (number): number of most-recent lines to return (default 20, max 100)
 *   - full=1: return up to 100 lines regardless of 'limit' (still capped)
 */
router.get('/tp-snapshots', (req, res) => {
  res.set('Cache-Control', 'no-store');

  const { feed } = getTpSnapshots();

  const maxCap = 100;
  const full = String(req.query.full || '') === '1';
  const limitParam = Number(req.query.limit);
  const limit = full
    ? maxCap
    : (Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, maxCap)
        : 20);

  const recent = feed.slice(-limit);
  const tracked = feed.filter(row => row && (row.state === 'PURSUIT' || row.state === 'TRAILING')).length;

  res.json({
    success: true,
    tracked,
    count: recent.length,
    feed: recent
  });
});

module.exports = router;