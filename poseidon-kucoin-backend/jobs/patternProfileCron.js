/* eslint-disable no-console */
/**
 * jobs/patternProfileCron.js
 *
 * Nightly job: compute and store daily Expected Move (EM) and realized range
 * for tracked symbols. The evaluator consumes these in handlers/data/patternProfile.js.
 *
 * How it works
 *  - Reads active/known symbols (Top50 scan + whitelist fallback)
 *  - Pulls D1 candles for "yesterday"
 *  - Stores: { symbol, day, emPct, realizedPct, parts? }
 *
 * Env:
 *  PATTERN_CRON_HOUR=2         // 24h clock, default 2 AM local
 *  PATTERN_SYMBOLS=ADA,BTC,... // optional comma list; else use /api/scan-tokens + WL
 */

const { MongoClient } = require('mongodb');
const axios = require('axios');

// ---- Config ----
const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const uri  = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbNm = process.env.MONGO_DB || 'poseidon';
const coll = process.env.MONGO_PATTERN_COLL || 'pattern_profile';
const CRON_HOUR = Number(process.env.PATTERN_CRON_HOUR || 2);

let client, collection;
async function getColl() {
  if (collection) return collection;
  client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  collection = client.db(dbNm).collection(coll);
  try {
    await collection.createIndex({ symbol: 1, day: -1 }, { name: 'sym_day_idx' });
  } catch {}
  return collection;
}

// --- utils ---
const up = (s) => String(s || '').toUpperCase();
function toContract(any) {
  let s = up(any).replace(/[-_]/g, '');
  if (s.endsWith('USDTM')) return s;
  if (s.endsWith('USDT')) return s + 'M';
  return s + 'USDTM';
}
function toSpot(any) { return up(toContract(any)).replace(/USDTM$/, 'USDT'); }

function yyyymmdd(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function emFromDaily({ high, low }) {
  const H = +high, L = +low;
  if (!(H > 0) || !(L > 0) || H <= L) return null;
  const mid = (H + L) / 2;
  return ((H - L) / mid) * 100; // %
}

// Fetch D1 candles for N days (expects your TA route to expose it; otherwise you can POST candles to backfill route)
async function fetchDailyCandles(spot, days = 7) {
  // Try a common shape: /api/candles/:symbol?tf=1d&limit=N
  const url = `${BASE}/api/candles/${spot}?tf=1d&limit=${Math.max(3, days)}`;
  try {
    const { data } = await axios.get(url, { timeout: 9000 });
    // Expected shape: [{t, o, h, l, c, v}, ...] newest last or first — we’ll sort by t
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.candles) ? data.candles : []);
    return rows
      .map(r => ({ t: +r.t || +r.time || +r.ts || 0, h: +r.h || +r.high, l: +r.l || +r.low }))
      .filter(r => Number.isFinite(r.t) && r.t > 0 && r.h > 0 && r.l > 0)
      .sort((a,b) => a.t - b.t);
  } catch (e) {
    console.warn('[patternCron] fetchDailyCandles failed for', spot, e?.message || e);
    return [];
  }
}

async function listSymbols() {
  // 1) PATTERN_SYMBOLS override
  const envList = String(process.env.PATTERN_SYMBOLS || '')
    .split(',')
    .map(s => s.trim()).filter(Boolean);
  if (envList.length) return envList.map(toContract);

  // 2) Try your scanner frozen set
  try {
    const { data } = await axios.get(`${BASE}/api/scan-tokens`, { timeout: 6000 });
    const rows = Array.isArray(data?.top50) ? data.top50 : [];
    const bases = rows.map(r => up(r?.symbol || r?.base || r)).filter(Boolean);
    if (bases.length) return [...new Set(bases.map(b => toContract(b)))];
  } catch {}

  // 3) Fallback: a minimal major set
  return ['BTC-USDTM','ETH-USDTM','SOL-USDTM','BNB-USDTM','XRP-USDTM','ADA-USDTM'];
}

async function computeAndStoreDay(symbolContract, dayTs) {
  const fut = toContract(symbolContract);
  const spot = toSpot(symbolContract);

  const dayStr = yyyymmdd(dayTs);
  const d0 = new Date(dayStr + 'T00:00:00Z').getTime();
  const d1 = d0 + 24*3600*1000 - 1;

  const d1Candles = await fetchDailyCandles(spot, 14);
  // Find the candle that lives on this day (UTC)
  const onDay = d1Candles.find(k => k.t >= d0 && k.t <= d1) || d1Candles[d1Candles.length - 1];
  if (!onDay) return false;

  const emPct = emFromDaily({ high: onDay.h, low: onDay.l }) ?? 1.2;
  // For realizedPct we’ll store the same (daily realized == EM for that candle),
  // If you want realized “so far today”, schedule this job near end-of-day.
  const realizedPct = emPct;

  const doc = {
    symbol: fut,
    day: dayStr,
    emPct: Number(emPct),
    realizedPct: Number(realizedPct),
    // parts: here you could compute day-part stats if you have intraday candles
    updatedAt: new Date()
  };

  const c = await getColl();
  await c.updateOne({ symbol: fut, day: dayStr }, { $set: doc }, { upsert: true });
  return true;
}

let timer = null;

function startPatternProfileCron({ io } = {}) {
  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(CRON_HOUR, 5, 0, 0);     // HH:05 local time for safety
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    timer = setTimeout(runOnce, delay);
    console.log(`[patternCron] next run at ${next.toString()}`);
  }

  async function runOnce() {
    try {
      console.log('[patternCron] running…');
      const syms = await listSymbols();
      const dayTs = Date.now() - 60 * 1000; // now; candle lib uses prior day anyway
      let ok = 0;
      for (const s of syms) {
        try {
          const done = await computeAndStoreDay(s, dayTs);
          if (done) ok++;
        } catch (e) {
          console.warn('[patternCron] fail', s, e?.message || e);
        }
      }
      console.log(`[patternCron] stored ${ok}/${syms.length} daily rows`);
      io?.emit?.('feed', { ts: Date.now(), type: 'system', level: 'info', symbol: 'SYSTEM', msg: `patternCron stored ${ok}/${syms.length}` });
    } finally {
      scheduleNext();
    }
  }

  scheduleNext(); // arm first
  return { stop: () => (timer && clearTimeout(timer)) };
}

module.exports = { startPatternProfileCron };