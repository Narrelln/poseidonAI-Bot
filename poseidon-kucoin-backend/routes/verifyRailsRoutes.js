// routes/verifyRailsRoute.js
/* Verify extremaRails ⇄ Mongo LearningMemory wiring (HTTP).
   GET /api/verify-rails/:symbol  -> snapshot + DB meta
*/
const express = require('express');
const router = express.Router();

const LearningMemory = require('../models/LearningMemory');
const { getSnapshot, hydrateFromDb, seedTicks } = require('../handlers/extremaRails');

function toSpot(sym = '') {
  // Accept BTC, BTCUSDT, BTC-USDTM, BTCUSDTM → BTCUSDT
  let s = String(sym).toUpperCase().replace(/[-_]/g, '');
  if (s.endsWith('USDTM')) s = s.slice(0, -1);
  if (!s.endsWith('USDT')) s += 'USDT';
  return s.replace(/USDTUSDT$/, 'USDT');
}

router.get('/verify-rails/:symbol', async (req, res) => {
  const spot = toSpot(req.params.symbol || 'BTCUSDT');
  try {
    // hydrate tape from DB ticks (if present)
    await hydrateFromDb([spot]);

    // if there were no ticks but rails has a lastPrice, seed one tick so snapshot isn’t empty
    const doc = await LearningMemory.findOne({ symbol: spot }).lean();
    if ((!doc?.ticks || doc.ticks.length === 0) && doc?.rails?.lastPrice > 0) {
      seedTicks(spot, [{ t: Date.now(), p: Number(doc.rails.lastPrice) }]);
    }

    // current in-memory rails snapshot
    const snap = getSnapshot(spot);

    res.json({
      ok: true,
      symbol: spot,
      snapshot: snap?.rails || {},
      db: doc
        ? {
            ticks: doc.ticks?.length || 0,
            updatedAt: doc.updatedAt,
            railsKeys: Object.keys(doc.rails || {}),
            sample: (() => {
              const r = doc.rails || {};
              return {
                atl12h: r.atl12h, ath12h: r.ath12h,
                atl24h: r.atl24h, ath24h: r.ath24h,
                nearestSupport: r.nearestSupport,
                nearestResistance: r.nearestResistance,
              };
            })(),
          }
        : { ticks: 0, updatedAt: null, railsKeys: [], sample: {} },
    });
  } catch (e) {
    console.error('[verify-rails] error:', e?.message || e);
    res.status(500).json({ ok: false, error: String(e?.message || 'internal_error') });
  }
});

module.exports = router;