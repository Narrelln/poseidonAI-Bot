// routes/cycleWatcherRoutes.js
/* eslint-disable no-console */
const express = require('express');
const router = express.Router();

const {
  startCycleWatcherServer,
  stopCycleWatcher,
  getCycleWatcherStatus
} = require('../handlers/cycleWatcher');

// POST /api/cycle-watcher/start
// - If body.contracts is [] or missing → auto-picks majors/memes from /api/scan-tokens
router.post('/cycle-watcher/start', async (req, res) => {
  try {
    const contracts = Array.isArray(req.body?.contracts) ? req.body.contracts : [];
    const status = await startCycleWatcherServer(contracts);
    console.log(`[cycle-watcher] ✅ started (watching=${status.watching}, running=${status.running})`);
    return res.json({ ok: true, ...status });
  } catch (e) {
    console.error('[cycle-watcher] start error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Failed to start cycle watcher' });
  }
});

// POST /api/cycle-watcher/stop
router.post('/cycle-watcher/stop', async (_req, res) => {
  try {
    const status = await stopCycleWatcher();
    console.log('[cycle-watcher] ⏹ stopped');
    return res.json({ ok: true, ...status });
  } catch (e) {
    console.error('[cycle-watcher] stop error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Failed to stop cycle watcher' });
  }
});

// GET /api/cycle-watcher/status
router.get('/cycle-watcher/status', (_req, res) => {
  try {
    const status = getCycleWatcherStatus();
    return res.json({ ok: true, ...status });
  } catch (e) {
    console.error('[cycle-watcher] status error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Failed to get status' });
  }
});

// GET /api/cycle-watcher/watchlist
// Returns the exact array of contracts the Cycle watcher is polling.
router.get('/cycle-watcher/watchlist', (_req, res) => {
  try {
    // Prefer a dedicated getter if exported; otherwise fall back to a soft export
    const mod = require('../handlers/cycleWatcher');
    const list = (typeof mod.getCycleWatchlist === 'function')
      ? mod.getCycleWatchlist()
      : (Array.isArray(mod.__WATCHING) ? mod.__WATCHING : []);
    return res.json({ ok: true, count: list.length, watching: list });
  } catch (e) {
    console.error('[cycle-watcher] watchlist error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Failed to get watchlist' });
  }
});

module.exports = router;