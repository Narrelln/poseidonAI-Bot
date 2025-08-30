/* eslint-disable no-console */
/**
 * Learning Memory Routes (Mongo-backed, multi-window rails)
 *
 * Mount-agnostic: we register every route with two paths so it works whether you do:
 *   app.use('/api', learningMemoryRoutes)
 *   app.use('/api/learning-memory', learningMemoryRoutes)
 *
 * Endpoints (both forms supported):
 *  POST /learning-memory/tick                 { symbol, price, ts? }
 *  GET  /learning-memory/top50-bases
 *  POST /learning-memory/backfill             { symbols?: string[], autoFromTop50?: boolean }
 *  POST /learning-memory/reset                { symbol? } // dev helper
 *  GET  /learning-memory                      (summary for UI)
 *  GET  /learning-memory/:symbol/snapshot
 *  GET  /learning-memory/:symbol              (?raw=1 to include raw ticks)
 */

const express = require('express');
const axios = require('axios');
const LearningMemory = require('../models/LearningMemory');
const { backfillForSymbols } = require('../handlers/memoryBackfill');

const router = express.Router();

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

// ------------ config ------------
const WINDOWS = [
  { key: '12h',  ms: 12 * 60 * 60 * 1000 },
  { key: '24h',  ms: 24 * 60 * 60 * 1000 },
  { key: '36h',  ms: 36 * 60 * 60 * 1000 },
  { key: '48h',  ms: 48 * 60 * 60 * 1000 },
  { key: '7d',   ms: 7  * 24 * 60 * 60 * 1000 },
  { key: '30d',  ms: 30 * 24 * 60 * 60 * 1000 },
];
const MAX_WINDOW_MS = WINDOWS[WINDOWS.length - 1].ms; // 30d
const MAX_POINTS_PER_SYMBOL = 25000;

// SR detection tuning
const SR_PIVOT_LOOKBACK = 8;
const SR_SCAN_LIMIT = 1500;

// ------------ helpers ------------
function isFinitePos(n){ return Number.isFinite(n) && n > 0; }

function normalizeToSpot(sym = '') {
  // "BTC-USDTM" -> "BTCUSDT", "XBTUSDT"/"XBT" -> "BTCUSDT", bare bases -> "BASEUSDT"
  let s = String(sym || '').toUpperCase().trim();
  if (!s) return '';
  s = s.replace(/[-_]/g, '');
  if (s.endsWith('USDTM')) s = s.slice(0, -1);
  if (s === 'XBT' || s === 'XBTUSDT') s = 'BTCUSDT';
  if (!s.endsWith('USDT')) s = `${s}USDT`;
  s = s.replace(/USDTUSDT$/, 'USDT');
  return s;
}

function rollingMinMax(ticks, sinceTs) {
  let lo = Infinity, hi = -Infinity;
  for (let i = ticks.length - 1; i >= 0; i--) {
    const { t, p } = ticks[i];
    if (t < sinceTs) break;
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  return {
    low:  (lo === Infinity ? null : lo),
    high: (hi === -Infinity ? null : hi),
  };
}

/**
 * FIX: SR separation logic
 * - Build lows/highs via simple pivot scan
 * - Support: max(low) where low <= price
 * - Resistance: min(high) where high >= price
 * Guarantees they don't collapse to the same value unless price is EXACTLY a level and
 * both lists contain that exact level (we still split by side).
 */
function estimateNearestSR(ticks, price) {
  if (!isFinitePos(price) || !ticks.length) return { nearestSupport: null, nearestResistance: null };
  const start = Math.max(0, ticks.length - SR_SCAN_LIMIT);
  const h = ticks.slice(start);

  const pivotsHigh = [];
  const pivotsLow  = [];
  const w = SR_PIVOT_LOOKBACK;

  for (let i = w; i < h.length - w; i++) {
    const p = h[i].p;
    let isHigh = true, isLow = true;
    for (let k = i - w; k <= i + w; k++) {
      if (h[k].p > p) isHigh = false;
      if (h[k].p < p) isLow  = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) pivotsHigh.push(p);
    if (isLow)  pivotsLow.push(p);
  }

  const eps = 1e-9;
  const lows  = pivotsLow .filter(Number.isFinite).sort((a,b)=>a-b);
  const highs = pivotsHigh.filter(Number.isFinite).sort((a,b)=>a-b);

  let support = null;
  for (const lv of lows) {
    if (lv <= price + eps) support = lv; // last low at/below price
    else break;
  }

  let resistance = null;
  for (const lv of highs) {
    if (lv >= price - eps) { resistance = lv; break; } // first high at/above price
  }

  // ensure strict split (avoid equalizing via rounding)
  if (Number.isFinite(support) && Number.isFinite(resistance) && Math.abs(support - resistance) <= eps) {
    // if they collide, prefer to null the side that violates the split most
    if (support > price) support = null;
    if (resistance < price) resistance = null;
  }

  return { nearestSupport: support ?? null, nearestResistance: resistance ?? null };
}

function computeRailsFromTicks(ticks, now = Date.now()) {
  if (!Array.isArray(ticks) || ticks.length === 0) return null;
  const lastPrice = ticks[ticks.length - 1].p;

  const railsMap = {};
  for (const w of WINDOWS) {
    const since = now - w.ms;
    const r = rollingMinMax(ticks, since);
    railsMap[`atl_${w.key}`] = r.low;
    railsMap[`ath_${w.key}`] = r.high;
  }

  const todayLow  = railsMap.atl_24h;
  const todayHigh = railsMap.ath_24h;

  const { nearestSupport, nearestResistance } = estimateNearestSR(ticks, lastPrice);

  return {
    lastPrice,
    todayHigh: todayHigh ?? null,
    todayLow:  todayLow  ?? null,

    // short keys
    ath12: railsMap.ath_12h ?? null,
    atl12: railsMap.atl_12h ?? null,
    ath24: railsMap.ath_24h ?? null,
    atl24: railsMap.atl_24h ?? null,
    ath36: railsMap.ath_36h ?? null,
    atl36: railsMap.atl_36h ?? null,
    ath48: railsMap.ath_48h ?? null,
    atl48: railsMap.atl_48h ?? null,
    ath7d: railsMap.ath_7d  ?? null,
    atl7d: railsMap.atl_7d  ?? null,
    ath30: railsMap.ath_30d ?? null,
    atl30: railsMap.atl_30d ?? null,

    // explicit unit aliases
    ath12h: railsMap.ath_12h ?? null,
    atl12h: railsMap.atl_12h ?? null,
    ath24h: railsMap.ath_24h ?? null,
    atl24h: railsMap.atl_24h ?? null,
    ath36h: railsMap.ath_36h ?? null,
    atl36h: railsMap.atl_36h ?? null,
    ath48h: railsMap.ath_48h ?? null,
    atl48h: railsMap.atl_48h ?? null,
    ath30d: railsMap.ath_30d ?? null,
    atl30d: railsMap.atl_30d ?? null,

    // FIX: no fallback to lastPrice here—keep nulls if not found
    nearestSupport,
    nearestResistance,

    avgConfidence: null,
    trapCount: 0,
  };
}

async function appendTickAndRebuild({ spotSymbol, price, ts = Date.now() }) {
  const doc = await LearningMemory.findOne({ symbol: spotSymbol })
    .select({ ticks: 1, rails: 1 })
    .lean(false);

  if (!doc) {
    const ticks = [{ t: ts, p: price }];
    const rails = computeRailsFromTicks(ticks, ts) || {};
    const created = await LearningMemory.create({
      symbol: spotSymbol,
      ticks,
      rails,
      updatedAt: new Date(ts),
    });
    return created;
  }

  const arr = doc.ticks || [];
  if (!arr.length || ts >= arr[arr.length - 1].t) {
    arr.push({ t: ts, p: price });
  } else {
    let i = arr.findIndex(x => x.t > ts);
    if (i === -1) i = arr.length;
    arr.splice(i, 0, { t: ts, p: price });
  }

  // prune
  const cutoff = ts - MAX_WINDOW_MS;
  let idx = 0;
  while (idx < arr.length && arr[idx].t < cutoff) idx++;
  if (idx > 0) arr.splice(0, idx);

  if (arr.length > MAX_POINTS_PER_SYMBOL) {
    const extra = arr.length - MAX_POINTS_PER_SYMBOL;
    arr.splice(0, extra);
  }

  const rails = computeRailsFromTicks(arr, ts) || {};
  rails.avgConfidence = doc.rails?.avgConfidence ?? rails.avgConfidence ?? null;
  rails.trapCount     = doc.rails?.trapCount     ?? rails.trapCount     ?? 0;

  doc.ticks = arr;
  doc.rails = rails;
  doc.updatedAt = new Date(ts);
  await doc.save();
  return doc;
}

// ---------- mount-agnostic helper ----------
function route(method, paths, ...handlers) {
  const arr = Array.isArray(paths) ? paths : [paths];
  for (const p of arr) router[method](p, ...handlers);
}

/* ==========================================================
   IMPORTANT: REGISTER SPECIFIC ROUTES **BEFORE** PARAM ROUTES
   ========================================================== */

// util: count ticks since a given timestamp (tolerant to field names)
// Used for "points" so it varies by recent activity, not fixed buffer size.
function countTicksSince(ticks, sinceMs) {
  if (!Array.isArray(ticks) || !Number.isFinite(sinceMs)) return 0;
  return ticks.reduce((acc, t) => {
    const ts =
      Number(t?.ts) ||
      Number(t?.time) ||
      Number(t?.timestamp) ||
      Number(t?.t) ||
      Number(t?.openTime) ||
      NaN;
    return acc + (Number.isFinite(ts) && ts >= sinceMs ? 1 : 0);
  }, 0);
}

// POST /learning-memory/tick
route('post', ['/learning-memory/tick', '/tick'], express.json(), async (req, res) => {
  try {
    const sym = req.body?.symbol;
    const price = Number(req.body?.price);
    const ts = req.body?.ts ? Number(req.body.ts) : Date.now();

    if (!sym || !isFinitePos(price)) {
      return res.status(400).json({ success: false, error: 'symbol and positive price required' });
    }

    const spot = normalizeToSpot(sym);
    const doc = await appendTickAndRebuild({ spotSymbol: spot, price, ts });

    // FIX: points should reflect recent activity, not ring-buffer size.
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const since = Date.now() - SIX_HOURS;
    const windowedPoints = countTicksSince(doc?.ticks, since);

    return res.json({
      success: true,
      symbol: doc?.symbol || spot,
      points: windowedPoints
    });
  } catch (e) {
    console.warn('[learning-memory] /tick error:', e.message);
    return res.status(500).json({ success: false, error: 'internal' });
  }
});

// GET /learning-memory/top50-bases
route('get', ['/learning-memory/top50-bases', '/top50-bases'], async (_req, res) => {
  try {
    const { data } = await axios.get(`${BASE}/api/scan-tokens`, { timeout: 8000 });
    const rows = Array.isArray(data?.top50) ? data.top50 : [];
    const bases = rows.map(r => String(r?.symbol || r?.base || ''))
      .map(s => s.toUpperCase().replace(/[-_]/g,'').replace(/USDTM?$/,''))
      .filter(Boolean);
    res.json({ success: true, bases: Array.from(new Set(bases)) });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'scan fetch failed' });
  }
});

// POST /learning-memory/backfill
route('post', ['/learning-memory/backfill', '/backfill'], express.json(), async (req, res) => {
  try {
    let list = Array.isArray(req.body?.symbols) ? req.body.symbols.slice() : [];
    const auto = req.body?.autoFromTop50 !== false; // default true
    if (list.length === 0 && auto) {
      const { data } = await axios.get(`${BASE}/api/learning-memory/top50-bases`, { timeout: 8000 });
      list = (data?.bases || []).map(b => `${b}-USDTM`);
    }
    if (list.length === 0) {
      return res.json({ success: true, ok: true, count: 0, results: [], note: 'no symbols' });
    }
    const out = await backfillForSymbols(list);
    res.json({ success: true, ...out });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'backfill error' });
  }
});

// POST /learning-memory/reset
route('post', ['/learning-memory/reset', '/reset'], express.json(), async (req, res) => {
  try {
    const sym = req.body?.symbol;
    if (sym) {
      const spot = normalizeToSpot(sym);
      await LearningMemory.deleteOne({ symbol: spot });
      return res.json({ success: true, reset: spot });
    }
    await LearningMemory.deleteMany({});
    return res.json({ success: true, reset: 'all' });
  } catch (e) {
    console.warn('[learning-memory] /reset error:', e.message);
    return res.status(500).json({ success: false, error: 'internal' });
  }
});

// GET /learning-memory  (Mongo-backed summary for FE existence-check)
route('get', ['/learning-memory', '/'], async (_req, res) => {
  try {
    // FIX: points = recent-window count (6h), not raw ticks.length
    const docs = await LearningMemory.find({}, { symbol: 1, ticks: 1, updatedAt: 1 }).lean();
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const since = Date.now() - SIX_HOURS;

    const summary = {};
    for (const d of docs) {
      summary[d.symbol] = {
        points: countTicksSince(d.ticks, since),
        updatedAt: d.updatedAt
      };
    }
    res.json({ success: true, memory: summary });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'internal' });
  }
});

/* ======== PARAM ROUTES COME AFTER SPECIFIC ONES ======== */

// GET /learning-memory/:symbol/snapshot
route('get', ['/learning-memory/:symbol/snapshot', '/:symbol/snapshot'], async (req, res) => {
  try {
    const spot = normalizeToSpot(req.params.symbol);

    // Pull ticks + rails so we can recompute if needed
    const doc = await LearningMemory.findOne({ symbol: spot })
      .select({ ticks: 1, rails: 1, updatedAt: 1 })
      .lean();

    if (!doc) return res.json({ success: true, snapshot: null });

    // Helper: detect “bogus” lows (e.g., the 0.42 floor)
    const looksBogusLow = (v, ref) => {
      if (!Number.isFinite(v) || v <= 0) return true;
      // If we know a reference price, treat lows < 40% of ref as bogus
      if (Number.isFinite(ref) && ref > 0 && v < ref * 0.4) return true;
      return false;
    };

    const lastTickPrice = Array.isArray(doc.ticks) && doc.ticks.length
      ? doc.ticks[doc.ticks.length - 1].p
      : null;

    // Recompute if we have ticks, or if any stored low looks bogus
    let needRecompute = Array.isArray(doc.ticks) && doc.ticks.length > 0;

    if (!needRecompute && doc.rails) {
      const r = doc.rails;
      const ref = Number.isFinite(lastTickPrice) ? lastTickPrice : r.lastPrice;
      const atlCandidates = [r.atl12, r.atl24, r.atl36, r.atl48, r.atl7d, r.atl30,
                             r.atl12h, r.atl24h, r.atl36h, r.atl48h, r.atl30d];
      if (atlCandidates.some(x => looksBogusLow(x, ref))) needRecompute = true;
    }

    let railsOut = doc.rails || null;

    if (needRecompute) {
      // 1) Rebuild from ticks (your 30d/size cap is enforced on write)
      railsOut = computeRailsFromTicks(doc.ticks, Date.now()) || {};

      // 2) Preserve meta
      if (doc.rails) {
        railsOut.avgConfidence   = doc.rails.avgConfidence ?? railsOut.avgConfidence ?? null;
        railsOut.trapCount       = doc.rails.trapCount ?? railsOut.trapCount ?? 0;
        railsOut.nearestSupport  = railsOut.nearestSupport ?? doc.rails.nearestSupport ?? null;
        railsOut.nearestResistance = railsOut.nearestResistance ?? doc.rails.nearestResistance ?? null;
      }

      // 3) Repair any still-bogus lows
      const ref = Number.isFinite(lastTickPrice) ? lastTickPrice : railsOut.lastPrice;
      const safeMin = Number.isFinite(ref) ? ref * 0.6 : null;
      const fixLow = (v) => (looksBogusLow(v, ref) ? (Number.isFinite(railsOut.todayLow) ? railsOut.todayLow : safeMin) : v);

      railsOut.atl12  = fixLow(railsOut.atl12);
      railsOut.atl24  = fixLow(railsOut.atl24);
      railsOut.atl36  = fixLow(railsOut.atl36);
      railsOut.atl48  = fixLow(railsOut.atl48);
      railsOut.atl7d  = fixLow(railsOut.atl7d);
      railsOut.atl30  = fixLow(railsOut.atl30);
      railsOut.atl12h = fixLow(railsOut.atl12h);
      railsOut.atl24h = fixLow(railsOut.atl24h);
      railsOut.atl36h = fixLow(railsOut.atl36h);
      railsOut.atl48h = fixLow(railsOut.atl48h);
      railsOut.atl30d = fixLow(railsOut.atl30d);

      // 4) Persist repaired rails
      await LearningMemory.updateOne(
        { symbol: spot },
        { $set: { rails: railsOut, updatedAt: new Date() } }
      );
    }

    if (!railsOut) return res.json({ success: true, snapshot: null });

    const r = railsOut;
    const snapshot = {
      lastPrice: r.lastPrice ?? null,
      todayHigh: r.todayHigh ?? null,
      todayLow:  r.todayLow  ?? null,

      ath12: r.ath12 ?? r.ath12h ?? null,
      atl12: r.atl12 ?? r.atl12h ?? null,
      ath24: r.ath24 ?? r.ath24h ?? null,
      atl24: r.atl24 ?? r.atl24h ?? null,
      ath36: r.ath36 ?? r.ath36h ?? null,
      atl36: r.atl36 ?? r.atl36h ?? null,
      ath48: r.ath48 ?? r.ath48h ?? null,
      atl48: r.atl48 ?? r.atl48h ?? null,
      ath7d: r.ath7d ?? null,
      atl7d: r.atl7d ?? null,
      ath30: r.ath30 ?? r.ath30d ?? null,
      atl30: r.atl30 ?? r.atl30d ?? null,

      ath12h: r.ath12h ?? r.ath12 ?? null,
      atl12h: r.atl12h ?? r.atl12 ?? null,
      ath24h: r.ath24h ?? r.ath24 ?? null,
      atl24h: r.atl24h ?? r.atl24 ?? null,
      ath36h: r.ath36h ?? r.ath36 ?? null,
      atl36h: r.atl36h ?? r.atl36 ?? null,
      ath48h: r.ath48h ?? r.ath48 ?? null,
      atl48h: r.atl48h ?? r.atl48 ?? null,
      ath30d: r.ath30d ?? r.ath30 ?? null,
      atl30d: r.atl30d ?? r.atl30 ?? null,

      // FIX: keep SR null if not found; no fallback to lastPrice
      nearestSupport: Number.isFinite(r.nearestSupport) ? r.nearestSupport : null,
      nearestResistance: Number.isFinite(r.nearestResistance) ? r.nearestResistance : null,

      avgConfidence: r.avgConfidence ?? null,
      trapCount: r.trapCount ?? 0,

      updatedAt: new Date().toISOString(),
    };

    return res.json({ success: true, snapshot });
  } catch (e) {
    console.warn('[learning-memory] /:symbol/snapshot error:', e.message);
    return res.status(500).json({ success: false, error: 'internal' });
  }
});

module.exports = router;