/* eslint-disable no-console */
// handlers/memoryBackfill.js
// Full backfill: writes BOTH rails and sampled ticks into Mongo LearningMemory.

const axios = require('axios');
const LearningMemory = require('../models/LearningMemory');

// ---- source (Bybit v5 market klines) ----
const BYBIT = 'https://api.bybit.com';
const CATEGORY = 'linear'; // BTCUSDT, ADAUSDT, etc. in linear category

// ---- horizons (cover 30d with minimal calls) ----
const H = 3600_000;
const HORIZONS = [
  { key: '12h',  ms: 12*H,     interval: 5   },  // 5m
  { key: '24h',  ms: 24*H,     interval: 15  },  // 15m
  { key: '36h',  ms: 36*H,     interval: 30  },  // 30m
  { key: '48h',  ms: 48*H,     interval: 60  },  // 1h
  { key: '7d',   ms: 7*24*H,   interval: 240 },  // 4h
  { key: '30d',  ms: 30*24*H,  interval: 1440 }  // 1d
];

// ---- caps / rails helpers (mirror of routes file) ----
const MAX_WINDOW_MS = HORIZONS[HORIZONS.length - 1].ms; // 30d
const MAX_POINTS_PER_SYMBOL = 25_000;
const SR_PIVOT_LOOKBACK = 8;
const SR_SCAN_LIMIT = 1500;

function toSpot(sym) {
  // "BTC-USDTM"/"BTCUSDT"/"BTC" -> "BTCUSDT" (Bybit linear symbol)
  let s = String(sym || '').toUpperCase().replace(/[-_]/g, '');
  if (s.endsWith('USDTM')) s = s.slice(0, -1);
  if (s === 'XBT' || s === 'XBTUSDT') s = 'BTCUSDT';
  if (!s.endsWith('USDT')) s += 'USDT';
  return s.replace(/USDTUSDT$/, 'USDT');
}
function nowMs(){ return Date.now(); }

async function getKlines({ symbol, interval, start, end, limit = 1000 }) {
  const url = `${BYBIT}/v5/market/kline`;
  const params = {
    category: CATEGORY,
    symbol,
    interval: String(interval),            // 1,3,5,15,30,60,240,1440,10080,43200
    start: Math.max(0, Number(start||0)),
    end: Number(end || nowMs()),
    limit
  };
  const { data } = await axios.get(url, { params, timeout: 12_000 });
  const list = data?.result?.list || [];
  // normalize
  return list.map(r => ({
    t: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low:  Number(r[3]),
    close:Number(r[4]),
  })).filter(c => Number.isFinite(c.close));
}

function hiLo(candles) {
  if (!Array.isArray(candles) || candles.length === 0) return null;
  let hi = -Infinity, lo = Infinity;
  for (const c of candles) {
    if (!Number.isFinite(c.high) || !Number.isFinite(c.low)) continue;
    if (c.high > hi) hi = c.high;

    // ignore obvious bogus lows
    if (c.low > 0.0000001 && c.low < lo) lo = c.low;
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || lo === Infinity) return null;
  return { high: hi, low: lo };
}

// very light SR estimator using pivot highs/lows over a recent slice
// FIX: strict split — support from lows ≤ price, resistance from highs ≥ price (with epsilon guard)
function estimateNearestSR(ticks, price) {
  if (!(price > 0) || !ticks.length) return { nearestSupport: null, nearestResistance: null };
  const start = Math.max(0, ticks.length - SR_SCAN_LIMIT);
  const h = ticks.slice(start);
  const pivotsHigh = [], pivotsLow = [];
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
    if (lv <= price + eps) support = lv;           // last low at/below price
    else break;
  }

  let resistance = null;
  for (const lv of highs) {
    if (lv >= price - eps) { resistance = lv; break; } // first high at/above price
  }

  // avoid equalization via rounding drift
  if (Number.isFinite(support) && Number.isFinite(resistance) && Math.abs(support - resistance) <= eps) {
    if (support > price) support = null;
    if (resistance < price) resistance = null;
  }

  return { nearestSupport: support ?? null, nearestResistance: resistance ?? null };
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

function computeRailsFromTicks(ticks, now = Date.now()) {
  if (!ticks.length) return {};
  const lastPrice = ticks[ticks.length - 1].p;
  const rails = {};
  for (const hzn of HORIZONS) {
    const since = now - hzn.ms;
    const mm = rollingMinMax(ticks, since);
    rails[`ath_${hzn.key}`] = mm.high;
    rails[`atl_${hzn.key}`] = mm.low;
  }
  const { nearestSupport, nearestResistance } = estimateNearestSR(ticks, lastPrice);
  return {
    lastPrice,
    todayHigh: rails.ath_24h ?? null,
    todayLow : rails.atl_24h ?? null,

    // short keys
    ath12: rails.ath_12h ?? null, atl12: rails.atl_12h ?? null,
    ath24: rails.ath_24h ?? null, atl24: rails.atl_24h ?? null,
    ath36: rails.ath_36h ?? null, atl36: rails.atl_36h ?? null,
    ath48: rails.ath_48h ?? null, atl48: rails.atl_48h ?? null,
    ath7d: rails.ath_7d  ?? null, atl7d: rails.atl_7d  ?? null,
    ath30: rails.ath_30d ?? null, atl30: rails.atl_30d ?? null,

    // aliases
    ath12h: rails.ath_12h ?? null, atl12h: rails.atl_12h ?? null,
    ath24h: rails.ath_24h ?? null, atl24h: rails.atl_24h ?? null,
    ath36h: rails.ath_36h ?? null, atl36h: rails.atl_36h ?? null,
    ath48h: rails.ath_48h ?? null, atl48h: rails.atl_48h ?? null,
    ath30d: rails.ath_30d ?? null, atl30d: rails.atl_30d ?? null,

    // keep SR null if not found; no fallback to lastPrice here
    nearestSupport, nearestResistance,
  };
}

// merge & dedup ticks by timestamp, keep chronological and window/size caps
function mergeTicks(existing = [], incoming = [], now = Date.now()) {
  const map = new Map();
  for (const x of existing) map.set(x.t, x.p);
  for (const x of incoming) map.set(x.t, x.p);
  const merged = Array.from(map.entries()).map(([t, p]) => ({ t: Number(t), p: Number(p) }));
  merged.sort((a,b) => a.t - b.t);

  // prune by time window
  const cutoff = now - MAX_WINDOW_MS;
  let i = 0;
  while (i < merged.length && merged[i].t < cutoff) i++;
  if (i > 0) merged.splice(0, i);

  // hard cap
  if (merged.length > MAX_POINTS_PER_SYMBOL) {
    merged.splice(0, merged.length - MAX_POINTS_PER_SYMBOL);
  }
  return merged;
}

async function buildSamples(symbolSpot) {
  const end = nowMs();
  const samples = [];
  for (const hzn of HORIZONS) {
    const start = end - hzn.ms - 5*60_000; // tiny buffer
    try {
      const candles = await getKlines({ symbol: symbolSpot, interval: hzn.interval, start, end });
      // sample each candle close as a tick
      for (const c of candles) samples.push({ t: c.t, p: c.close });
    } catch (e) {
      console.warn(`[Backfill] klines failed ${symbolSpot} ${hzn.key}:`, e?.message || e);
    }
  }
  // dedup here too (different horizons will overlap)
  const uniqMap = new Map();
  for (const s of samples) uniqMap.set(s.t, s.p);
  return Array.from(uniqMap.entries()).map(([t,p]) => ({ t:Number(t), p:Number(p) }));
}

async function upsertDocWithTicks(spotSymbol, ticks, railsNowTs = Date.now()) {
  const doc = await LearningMemory.findOne({ symbol: spotSymbol })
    .select({ ticks: 1, rails: 1 })
    .lean(false);

  if (!doc) {
    const rails = computeRailsFromTicks(ticks, railsNowTs);
    return await LearningMemory.create({
      symbol: spotSymbol,
      ticks,
      rails,
      updatedAt: new Date(railsNowTs)
    });
  }

  const merged = mergeTicks(doc.ticks || [], ticks, railsNowTs);
  const rails = computeRailsFromTicks(merged, railsNowTs);
  // preserve meta fields
  rails.avgConfidence = doc.rails?.avgConfidence ?? null;
  rails.trapCount     = doc.rails?.trapCount ?? 0;

  doc.ticks = merged;
  doc.rails = rails;
  doc.updatedAt = new Date(railsNowTs);
  await doc.save();
  return doc;
}

// FIX: helper to count ticks in a recent window so "points" reflects activity (not buffer size)
function countTicksSince(ticks, sinceMs) {
  if (!Array.isArray(ticks) || !Number.isFinite(sinceMs)) return 0;
  let n = 0;
  for (let i = ticks.length - 1; i >= 0; i--) {
    const ts = Number(ticks[i]?.t);
    if (!Number.isFinite(ts)) continue;
    if (ts < sinceMs) break; // ticks are sorted ascending; we iter from end, so can break early
    n++;
  }
  return n;
}

/**
 * Backfill rails + ticks for a list of symbols (contract-ish or base).
 * Returns { ok, count, results } with per-symbol details.
 */
async function backfillForSymbols(symbols = []) {
  const results = [];
  const SIX_HOURS = 6 * 60 * 60 * 1000; // FIX: consistent points window (same as routes)
  const now = nowMs();

  for (const anySym of symbols) {
    const spot = toSpot(anySym);
    try {
      const ticks = await buildSamples(spot);
      const doc = await upsertDocWithTicks(spot, ticks, now);

      // FIX: points = recent activity (6h), not total buffer length
      const points = countTicksSince(doc.ticks || [], now - SIX_HOURS);

      results.push({
        symbol: spot,
        ok: true,
        points,
        railsKeys: Object.keys(doc.rails || {})
      });
      console.log(`[Backfill] ${spot} ticks=${ticks.length} → stored=${doc.ticks.length} (points6h=${points})`);
    } catch (e) {
      console.warn(`[Backfill] ${spot} failed:`, e?.message || e);
      results.push({ symbol: spot, ok: false, error: String(e?.message || e) });
    }
  }
  return { ok: true, count: results.length, results };
}

module.exports = {
  backfillForSymbols,
  toSpot,
};