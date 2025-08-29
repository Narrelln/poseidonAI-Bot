/* eslint-disable no-console */
/**
 * handlers/data/patternProfile.js
 *
 * Intraday "pattern profile" used by the evaluator to:
 *  - estimate Expected Move (EM) based on recent daily ranges,
 *  - compare today's realized vs EM (realizedVsEM),
 *  - produce a crude "consistency" score in [0..1],
 *  - optionally expose morning/midday/afternoon typical moves (if stored).
 *
 * This module is intentionally resilient:
 *  - If Mongo is unavailable or there is no history, it falls back to TA live
 *    data and safe defaults so your system never blocks.
 *
 * Exports:
 *   getPatternProfile(contractOrSymbol, { days = 7 }?)
 *
 * Shape returned:
 *   {
 *     emPct,                 // % expected move for a typical day (e.g. 1.2 == 1.2%)
 *     realizedVsEM,          // today's realized move / EM  (1 == on target, >1 over-extended)
 *     consistency01,         // 0..1 (how steady last N days were vs their own EM)
 *     morningMovePct,        // optional day-part heuristics (safe defaults if none)
 *     middayPullbackPct,
 *     afternoonReboundPct
 *   }
 */

const { MongoClient } = require('mongodb');
const path = require('path');

// We’ll reuse your TA client to avoid re-implementing price fetches.
let analyzeSymbol;
try {
  ({ analyzeSymbol } = require('../handlers/taClient')); // when required from server root
} catch {
  try { ({ analyzeSymbol } = require('../taClient')); } catch {}
}

// --- normalize helpers (same spirit as tokenPatternMemory) ---
function up(s) { return String(s || '').toUpperCase(); }
function toContract(any) {
  let s = up(any).replace(/[-_]/g, '');
  if (s.endsWith('USDTM')) return s;
  if (s.endsWith('USDT')) return s + 'M';
  return s + 'USDTM';
}
function toSpot(any) {
  return up(toContract(any)).replace('-','').replace(/USDTM$/, 'USDT');
}
function baseOf(sym) {
  return up(sym).replace(/[-_]/g, '').replace(/USDTM?$/, '');
}

// --- Mongo (optional / best-effort) ---
const uri  = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbNm = process.env.MONGO_DB || 'poseidon';
const coll = process.env.MONGO_PATTERN_COLL || 'pattern_profile';

let client, collection;
async function connect() {
  if (collection) return collection;
  client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  collection = client.db(dbNm).collection(coll);
  try {
    await collection.createIndex({ symbol: 1, day: -1 }, { name: 'sym_day_idx' });
  } catch {}
  return collection;
}

// --- math helpers ---
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const pct = (x) => Number.isFinite(+x) ? +x : NaN;

// Daily move % using high/low and a mid ref (avoids needing open/close)
function dailyMovePct({ high, low }) {
  const H = Number(high), L = Number(low);
  if (!(H > 0) || !(L > 0) || H <= L) return NaN;
  const mid = (H + L) / 2;
  return ((H - L) / mid) * 100; // % of mid
}

// --- fallbacks for day-part heuristics (kept simple) ---
function defaultDayParts() {
  return {
    morningMovePct: 0.4,
    middayPullbackPct: -0.6,
    afternoonReboundPct: 0.5
  };
}

// Try to read last N days of stored stats (if you later add a cron that writes them)
async function getHistoryFromDb(spot, days) {
  try {
    const c = await connect();
    // We store symbol normalized as FUTURES (BTCUSDTM) for consistency
    const fut = toContract(spot);
    const cur = c.find({ symbol: fut }).sort({ day: -1 }).limit(Math.max(3, days));
    const rows = await cur.toArray();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// Compute a cheap “consistency” in [0..1] from historical EM vs realized spread
function consistencyFromRows(rows) {
  if (!rows.length) return 0.5;
  const ems = rows.map(r => Number(r.emPct)).filter(Number.isFinite);
  const reals = rows.map(r => Number(r.realizedPct)).filter(Number.isFinite);
  if (!ems.length || !reals.length) return 0.5;

  const diffs = reals.map((rv, i) => {
    const em = ems[Math.min(i, ems.length - 1)] || ems[0];
    if (!Number.isFinite(em) || em <= 0) return 0;
    return Math.abs((rv - em) / em); // relative miss vs EM
  });

  // lower avg miss => higher consistency
  const avgMiss = diffs.reduce((a,b)=>a+b,0) / diffs.length;
  return clamp01(1 - Math.min(1, avgMiss)); // simple invert
}

// --- main API ---
async function getPatternProfile(symbolOrContract, { days = 7 } = {}) {
  const contract = toContract(symbolOrContract);
  const spot = toSpot(symbolOrContract);

  // 1) Try DB history (best) to get EM average & parts
  const rows = await getHistoryFromDb(spot, days);
  let emAvg = NaN;
  if (rows.length) {
    const ems = rows.map(r => Number(r.emPct)).filter(Number.isFinite);
    if (ems.length) emAvg = ems.reduce((a,b)=>a+b,0) / ems.length;
  }

  let parts = defaultDayParts();
  if (rows[0]?.parts && typeof rows[0].parts === 'object') {
    parts = { ...parts, ...rows[0].parts };
  }

  // 2) Compute TODAY’s realized range from live TA
  let todayRealized = NaN;
  try {
    if (typeof analyzeSymbol === 'function') {
      const ta = await analyzeSymbol(spot);
      const lo = pct(ta?.range24h?.low);
      const hi = pct(ta?.range24h?.high);
      const mv = dailyMovePct({ high: hi, low: lo });
      if (Number.isFinite(mv)) todayRealized = mv;
      // If EM not known, use rolling 7d avg of 24h move if present on TA
      if (!Number.isFinite(emAvg)) {
        const emHint = pct(ta?.expMovePct || ta?.expectedMovePct);
        if (Number.isFinite(emHint) && emHint > 0) emAvg = emHint;
      }
    }
  } catch (e) {
    // silent fallback
  }

  // 3) Robust fallbacks
  if (!Number.isFinite(emAvg) || emAvg <= 0) emAvg = 1.2;     // 1.2% default EM
  if (!Number.isFinite(todayRealized) || todayRealized < 0) todayRealized = 0;

  // realizedVsEM = todayRealized / emAvg  (1 == on target; >1 = stretched)
  const realizedVsEM = emAvg > 0 ? (todayRealized / emAvg) : 1;

  // crude consistency from DB; if no rows, neutral 0.5
  const consistency01 = rows.length ? consistencyFromRows(rows) : 0.5;

  return {
    emPct: Number(emAvg),                       // expected move (avg %)
    realizedVsEM: Number(realizedVsEM),         // ratio (unitless)
    consistency01: Number(consistency01),       // 0..1
    morningMovePct: Number(parts.morningMovePct),
    middayPullbackPct: Number(parts.middayPullbackPct),
    afternoonReboundPct: Number(parts.afternoonReboundPct)
  };
}

module.exports = { getPatternProfile };