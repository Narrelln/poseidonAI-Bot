/* routes/patternRoutes.js */
const express = require('express');
const { runOnce } = require('../jobs/patternCron');
const { getPatternProfile } = require('../handlers/patternStats');

function registerPatternRoutes(app) {
  const router = express.Router();

  // GET /api/pattern/profile?symbol=ADA-USDTM&days=7
  router.get('/pattern/profile', async (req, res) => {
    try {
      const { symbol, days = 7 } = req.query;
      if (!symbol) return res.status(400).json({ ok: false, error: 'symbol_required' });
      const p = await getPatternProfile(symbol, { days: Number(days) || 7 });
      return res.json({ ok: true, symbol, days: Number(days) || 7, profile: p });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'error' });
    }
  });

  // POST /api/pattern/refresh  { when?: ISO, dry?: boolean }
  router.post('/pattern/refresh', async (req, res) => {
    try {
      const { when, dry } = req.body || {};
      if (dry !== undefined) process.env.PATTERN_DRY_RUN = String(!!dry);
      const r = await runOnce({ when: when ? new Date(when) : new Date() });
      return res.json({ ok: true, run: r, dry: String(process.env.PATTERN_DRY_RUN) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'error' });
    }
  });

  app.use('/api', router);
}

module.exports = { registerPatternRoutes };