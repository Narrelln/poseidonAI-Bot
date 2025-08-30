// routes/strategyHealthRoutes.js
/* eslint-disable no-console */
const express = require('express');
const router = express.Router();

// Cycle watcher status (exported by handlers/cycleWatcher.js)
let cycleStatus = null;
try {
  ({ getCycleWatcherStatus: cycleStatus } = require('../handlers/cycleWatcher'));
} catch (_) {}

// Scanner cache (your Bybit→KuCoin scanner)
let getScannerCache = null;
try {
  // whichever file you mounted in server: newScanTokens OR scanTokensRoutes
  ({ getCachedScannerData: getScannerCache } = require('./newScanTokens'));
} catch (_) {
  try { ({ getCachedScannerData: getScannerCache } = require('./scanTokensRoutes')); } catch {}
}

// Signal audit quick counts (optional)
let SignalAudit = null;
try { SignalAudit = require('../models/SignalAudit'); } catch {}

router.get('/strategy-health', async (_req, res) => {
  // Cycle
  let cycle = { running: false, lastTickMs: 0, tradeCount: 0, watching: 0 };
  try { if (typeof cycleStatus === 'function') cycle = cycleStatus(); } catch {}

  // Scanner
  let scanner = { lastUpdated: 0, top50: 0, moonshots: 0 };
  try {
    if (typeof getScannerCache === 'function') {
      const c = getScannerCache();
      scanner.lastUpdated = Number(c?.lastUpdated) || 0;
      scanner.top50 = Array.isArray(c?.top50) ? c.top50.length : 0;
      scanner.moonshots = Array.isArray(c?.moonshots) ? c.moonshots.length : 0;
    }
  } catch {}

  // Audit counts (last 30m)
  let audit = { last30m: { total: 0, analysis: 0, decision: 0, skipped: 0 } };
  try {
    if (SignalAudit) {
      const since = Date.now() - 30 * 60 * 1000;
      const [total, analysis, decision, skipped] = await Promise.all([
        SignalAudit.countDocuments({ at: { $gte: since } }),
        SignalAudit.countDocuments({ at: { $gte: since }, event: 'analysis' }),
        SignalAudit.countDocuments({ at: { $gte: since }, event: 'decision' }),
        SignalAudit.countDocuments({ at: { $gte: since }, event: 'skipped' }),
      ]);
      audit.last30m = { total, analysis, decision, skipped };
    }
  } catch (e) {
    console.warn('[strategy-health] audit query failed:', e?.message || e);
  }

  // FE flags we often care about (reported as seen by server env; FE may override)
  const env = {
    AUTOTRADE_ENABLED: process.env.POSEIDON_AUTOTRADE_ENABLED ?? '(FE flag)',
    PAPER: process.env.POSEIDON_PAPER ?? '(FE flag)',
  };

  res.json({
    ok: true,
    time: new Date().toISOString(),
    cycleWatcher: cycle,
    scanner,
    audit,
    env
  });
});

module.exports = router;