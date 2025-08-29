/* eslint-disable no-console */
const express = require('express');
const router = express.Router();

const {
  startReversalWatcherServer,
  stopReversalWatcher,
  getReversalWatcherStatus,
} = require('../handlers/reversalWatcher');

// POST /api/reversal-watcher/start
// If body.contracts is [] or missing → auto-picks high-vol NON-majors
router.post('/reversal-watcher/start', async (req, res) => {
  try {
    const contracts = Array.isArray(req.body?.contracts) ? req.body.contracts : [];
    const status = await startReversalWatcherServer(contracts);
    console.log(`[reversal-watcher] ✅ started (watching=${status.watching}, running=${status.running})`);
    return res.json({ ok: true, ...status });
  } catch (e) {
    console.error('[reversal-watcher] start error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Failed to start reversal watcher' });
  }
});

// POST /api/reversal-watcher/stop
router.post('/reversal-watcher/stop', async (_req, res) => {
  try {
    const status = await stopReversalWatcher();
    console.log('[reversal-watcher] ⏹ stopped');
    return res.json({ ok: true, ...status });
  } catch (e) {
    console.error('[reversal-watcher] stop error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Failed to stop reversal watcher' });
  }
});

// GET /api/reversal-watcher/status
router.get('/reversal-watcher/status', (_req, res) => {
  try {
    const status = getReversalWatcherStatus();
    return res.json({ ok: true, ...status });
  } catch (e) {
    console.error('[reversal-watcher] status error:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Failed to get status' });
  }
});

module.exports = router;