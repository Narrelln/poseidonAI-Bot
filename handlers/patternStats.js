// handlers/patternStats.js
/* 
 * Poseidon - Pattern Statistics Helper (DB+Live Adapter)
 * ------------------------------------------------------
 * Supports BOTH:
 *  - legacy collection MONGO_PATTERN_STATS (default: 'patternStats') with rich fields
 *  - cron collection   MONGO_PATTERN_COLL  (default: 'pattern_profile') with { emPct, realizedPct }
 *
 * Output (unchanged):
 *  { emPct, realizedVsEM, consistency01, morningMovePct, middayPullbackPct, afternoonReboundPct }
 */

const { MongoClient } = require('mongodb');
const axios = require('axios');

/* ---- Env / DB ---- */
const uri  = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbNm = process.env.MONGO_DB || 'poseidon';
const LEGACY_COLL = process.env.MONGO_PATTERN_STATS || 'patternStats';
const CRON_COLL   = process.env.MONGO_PATTERN_COLL  || 'pattern_profile';

/* ---- Local API base for candles ---- */
const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

/* ---- DB singletons (race-safe) ---- */
let mongoClient;               // keep client for reuse/close
let legacyCol, cronCol;        // cached collections
let connectingPromise = null;  // in-flight connect guard

async function getCols()   {

if (legacyCol && cronCol) return { legacyCol, cronCol };  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
   const client = new MongoClient(uri, { maxPoolSize: 5 });
    await client.connect();
    mongoClient = client;

    const db = client.db(dbNm);
    legacyCol = db.collection(LEGACY_COLL);
   cronCol   = db.collection(CRON_COLL);

    try { await legacyCol.createIndex({ symbol: 1, date: -1 }); } catch {}
    try { await cronCol.createIndex({ symbol: 1, day: -1 }); } catch {}
   return { legacyCol, cronCol };
  })();

  try {    return await connectingPromise;
  } finally {
   connectingPromise = null;
 }}


/* ---- utils ---- */
const up = (s) => String(s || '').toUpperCase();
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (a) => a.length ? a.reduce((x,y)=>x+y,0)/a.length : NaN;
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s,x)=>s+(x-m)*(x-m),0) / (arr.length-1);
  return Math.sqrt(v);
}
function median(arr) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x,y)=>x-y);
  const i = Math.floor(a.length/2);
  return a.length % 2 ? a[i] : (a[i-1]+a[i])/2;
}
function toSpot(any) {
  let s = up(any).replace(/[-_]/g,'');
  if (s.endsWith('USDTM')) s = s.slice(0,-1); // USDTM -> USDT
  if (!s.endsWith('USDT')) s += 'USDT';
  // normalize BTC/XBT to KuCoin spot ticker casing if needed (API route usually accepts either)
  return s;
}
function startOfTodayUTC() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0,0,0,0);
}

/* ---- Candle helpers (no hard dep on taClient) ---- */
async function fetchCandles(symbolOrContract, tf = '1h', limit = 36) {
  // Expects your /api/candles/:symbol route (already used by your cron file)
  const spot = toSpot(symbolOrContract);
  const url = `${BASE}/api/candles/${spot}?tf=${encodeURIComponent(tf)}&limit=${Math.max(10, limit)}`;
  try {
    const { data } = await axios.get(url, { timeout: 9000 });
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.candles) ? data.candles : []);
    return rows
      .map(r => ({
        t: +r.t || +r.ts || +r.time || 0,
        o: toNum(r.o ?? r.open),
        h: toNum(r.h ?? r.high),
        l: toNum(r.l ?? r.low),
        c: toNum(r.c ?? r.close),
        v: toNum(r.v ?? r.volume)
      }))
      .filter(r => Number.isFinite(r.t) && r.t > 0)
      .sort((a,b)=>a.t-b.t);
  } catch (e) {
    console.warn('[patternStats] fetchCandles failed:', e?.message || e);
    return [];
  }
}

/* ---- Live intraday overlay (UTC sessions) ---- */
async function computeIntradaySlices(symbol) {
  try {
    const candles = await fetchCandles(symbol, '1h', 36);
    if (!candles.length) return null;

    const t0 = startOfTodayUTC();
    const today = candles.filter(k => k.t >= t0);
    if (!today.length) return null;

    const open = toNum(today[0].o);
    if (!(open > 0)) return null;

    const hi = Math.max(...today.map(k => k.h).filter(Number.isFinite));
    const lo = Math.min(...today.map(k => k.l).filter(Number.isFinite));
    const realizedPct = Number.isFinite(hi) && Number.isFinite(lo) ? ((hi - lo)/open)*100 : NaN;

    const slice = (h0,h1) => today.filter(c => {
      const d = new Date(c.t); const h = d.getUTCHours();
      return h >= h0 && h < h1;
    });

    const s1 = slice(0,8), s2 = slice(8,16), s3 = slice(16,24);

    let morningMovePct = 0, middayPullbackPct = 0, afternoonReboundPct = 0;

    if (s1.length) {
      const s1Hi = Math.max(...s1.map(c => c.h).filter(Number.isFinite));
      morningMovePct = ((s1Hi - open)/open)*100;
    }

    if (s1.length || s2.length) {
      const first16 = [...s1, ...s2];
      const min16 = Math.min(...first16.map(c => c.l).filter(Number.isFinite));
      const s1HiAbs = Math.max(...(s1.length ? s1.map(c => c.h).filter(Number.isFinite) : [open]));
      middayPullbackPct = ((min16 - s1HiAbs)/open)*100; // negative if pullback
    }

    {
      const minFirst16 = Math.min(...[...s1,...s2].map(c=>c.l).filter(Number.isFinite));
      const maxLast8   = Math.max(...(s3.length ? s3.map(c=>c.h).filter(Number.isFinite) : [open]));
      afternoonReboundPct = ((maxLast8 - (Number.isFinite(minFirst16)?minFirst16:open))/open)*100;
    }

    return {
      realizedPct: Number.isFinite(realizedPct) ? realizedPct : NaN,
      morningMovePct: Number.isFinite(morningMovePct) ? morningMovePct : 0,
      middayPullbackPct: Number.isFinite(middayPullbackPct) ? middayPullbackPct : 0,
      afternoonReboundPct: Number.isFinite(afternoonReboundPct) ? afternoonReboundPct : 0
    };
  } catch {
    return null;
  }
}

/* ---- Main: getPatternProfile ---- */
async function getPatternProfile(symbol, { days = 7 } = {}) {
    // 1) Try rich legacy rows first
    try {
      const { legacyCol } = await getCols();
      const since = new Date(Date.now() - days*24*3600*1000);
      const rows = await legacyCol.find({ symbol, date: { $gte: since } }).sort({ date: 1 }).toArray();


    if (rows.length) {
    
      const ems = rows.map(r => Number(r.emPct) || 0).filter(x => x > 0);
      const avgEm = ems.length ? ems.reduce((a,b)=>a+b,0)/ems.length : NaN;
      const today = rows[rows.length - 1] || {};
      const intradayLive = await computeIntradaySlices(symbol); // live overlay

      const emPct = Number.isFinite(avgEm) && avgEm > 0 ? avgEm : 1.2;
      const realizedVsEM = Number.isFinite(intradayLive?.realizedPct)
        ? (intradayLive.realizedPct / emPct)
        : Number(today.realizedVsEM || 1);

      return {
        emPct,
        realizedVsEM: Number.isFinite(realizedVsEM) ? realizedVsEM : 1,
        consistency01: clamp01(Number(today.consistency01) || (ems.length>=3 ? clamp01(1/(1+(stddev(ems)/(mean(ems)||1)))) : 0.5)),
        morningMovePct: intradayLive?.morningMovePct ?? Number(today.morningMovePct || 0),
        middayPullbackPct: intradayLive?.middayPullbackPct ?? Number(today.middayPullbackPct || 0),
        afternoonReboundPct: intradayLive?.afternoonReboundPct ?? Number(today.afternoonReboundPct || 0),
      };
    }
  } catch (e) {
    console.warn('[patternStats] legacy fetch error:', e?.message || e);
  }

  // 2) Fallback: use cron collection pattern_profile (your nightly writer)
let cronDocs = [];
try {
  const { cronCol } = await getCols();
  cronDocs = await cronCol.find({ symbol }).sort({ day: 1 }).toArray();
} catch (e) {
  console.warn('[patternStats] cron fetch error:', e?.message || e);
}

  if (cronDocs.length) {
    const recent = cronDocs.slice(-Math.max(3, Math.min(days, 30)));
    const ems = recent.map(r => Number(r.emPct) || 0).filter(x => x > 0);
    const avgEm = ems.length ? median(ems) : NaN; // median tolerates outliers across days
    const latest = cronDocs[cronDocs.length - 1];

    // Live overlay for intraday + realized today (if trading day not closed)
    const intradayLive = await computeIntradaySlices(symbol);

    const emPct = Number.isFinite(avgEm) && avgEm > 0 ? avgEm : 1.2;

    // Prefer live realized today; else use latest realizedPct from cron
    let realizedVsEM = 1;
    if (Number.isFinite(intradayLive?.realizedPct)) {
      realizedVsEM = intradayLive.realizedPct / emPct;
    } else if (Number.isFinite(latest?.realizedPct)) {
      realizedVsEM = Number(latest.realizedPct) / emPct;
    }

    const consistency01 = ems.length >= 3
      ? clamp01(1 / (1 + (stddev(ems) / (mean(ems) || 1))))
      : 0.5;

    return {
      emPct,
      realizedVsEM: Number.isFinite(realizedVsEM) ? realizedVsEM : 1,
      consistency01,
      morningMovePct: intradayLive?.morningMovePct ?? 0,
      middayPullbackPct: intradayLive?.middayPullbackPct ?? 0,
      afternoonReboundPct: intradayLive?.afternoonReboundPct ?? 0,
    };
  }

  // 3) No DB rows at all → compute from live candles only (best-effort)
  try {
    const dailies = await fetchCandles(symbol, '1d', Math.max(10, days+2));
    const completed = dailies.filter(k => k.t < startOfTodayUTC());
    const lastN = completed.slice(-days);
    const ems = lastN.map(k => {
      const O = toNum(k.o), H = toNum(k.h), L = toNum(k.l);
      return (O > 0 && H > 0 && L > 0) ? ((H - L)/O)*100 : NaN;
    }).filter(x => Number.isFinite(x) && x > 0);

    const emPct = Number.isFinite(median(ems)) ? median(ems) : 1.2;
    const intradayLive = await computeIntradaySlices(symbol);
    const realizedVsEM = Number.isFinite(intradayLive?.realizedPct) ? (intradayLive.realizedPct / emPct) : 1;
    const consistency01 = ems.length >= 3 ? clamp01(1 / (1 + (stddev(ems) / (mean(ems) || 1)))) : 0.5;

    return {
      emPct,
      realizedVsEM,
      consistency01,
      morningMovePct: intradayLive?.morningMovePct ?? 0,
      middayPullbackPct: intradayLive?.middayPullbackPct ?? 0,
      afternoonReboundPct: intradayLive?.afternoonReboundPct ?? 0,
    };
  } catch (e) {
    console.warn('[patternStats] live-only compute failed:', e?.message || e);
  }

  // 4) Hard fallback
  return {
    emPct: 1.2, realizedVsEM: 1, consistency01: 0.5,
    morningMovePct: 0.4, middayPullbackPct: -0.6, afternoonReboundPct: 0.5
  };
}

module.exports = { getPatternProfile };