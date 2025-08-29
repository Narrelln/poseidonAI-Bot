// handlers/taClient.js
// Central TA client wrapper — always fetches via unified getTA
// Normalizes volumes, overlays KuCoin price/turnover, and now prefers 12h range
// (computed from KuCoin futures klines) with fallback to 24h ticker stats.

const axios = require('axios');
const { getTA } = require('./taHandler');

// KuCoin helpers for symbol normalization
let parseToKucoinContractSymbol, toKucoinApiSymbol;
try {
  ({ parseToKucoinContractSymbol, toKucoinApiSymbol } = require('../kucoinHelper'));
} catch (_) {
  // tiny fallback if helper is unavailable
  parseToKucoinContractSymbol = (s) => {
    if (!s) return '';
    let t = String(s).toUpperCase().replace(/[-_]/g, '');
    if (t.endsWith('USDTM')) t = t.slice(0, -5);
    else if (t.endsWith('USDT')) t = t.slice(0, -4);
    if (t === 'BTC') t = 'XBT';
    return `${t}-USDTM`;
  };
  toKucoinApiSymbol = (c) => String(c || '').replace(/-/g, '');
}

// --- Optional session bias (safe require) ---
let getSessionInfo, sessionBiasPoints;
try {
  ({ getSessionInfo, sessionBiasPoints } = require('./poseidonSession'));
} catch (_) {
  getSessionInfo = () => ({
    session: 'ASIA',
    hour: new Date().getUTCHours(),
    dow: new Date().getUTCDay()
  });
  sessionBiasPoints = () => 0;
}

// --- Whitelist (majors + memes) ---
const WHITELIST = new Set([
  // majors
  'BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC',
  // memes
  'SHIB','PEPE','TRUMP','FLOKI','BONK','WIF','AIDOGE','TSUKA','HARRY',
  'WOJAK','GROK','BODEN','MAGA','MYRO','DOGE'
]);

// --- Volume threshold (MIN only; NO upper cap) ---
const MIN_QUOTE_VOL = 50_000; // USDT

// KuCoin base URL
const KUCOIN_BASE = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';

/* ---------------- helpers ---------------- */
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
const clamp100 = (n) => Math.max(0, Math.min(100, n));

function baseFromSymbol(sym) {
  let s = String(sym || '').toUpperCase().replace(/[-_/]/g, '');
  if (s.endsWith('USDTM')) s = s.slice(0, -5);
  else if (s.endsWith('USDT')) s = s.slice(0, -4);
  if (s === 'XBT') s = 'BTC';
  return s || '';
}

/* --- Fibonacci helpers --- */
function computeFibLevels(low, high) {
  const L = Number(low), H = Number(high);
  if (!(Number.isFinite(L) && Number.isFinite(H) && H > L)) return null;
  const R = H - L;
  const mk = (r) => +(L + R * r).toFixed(6);
  return { L, H, R, F236: mk(0.236), F382: mk(0.382), F500: mk(0.5), F618: mk(0.618), F786: mk(0.786) };
}
function fibHeadroom(price, fib, dir /* 'long'|'short' */) {
  const p = Number(price);
  if (!fib || !Number.isFinite(p)) return null;
  const levels = [fib.F236, fib.F382, fib.F500, fib.F618, fib.F786, fib.H, fib.L].filter(Number.isFinite);
  if (dir === 'long') {
    const above = levels.filter(v => v > p).sort((a,b) => a - b);
    const next = above[0] ?? fib.H;
    return { next, headroomPct: ((next - p) / p) * 100 };
  } else {
    const below = levels.filter(v => v < p).sort((a,b) => b - a);
    const next = below[0] ?? fib.L;
    return { next, headroomPct: ((p - next) / p) * 100 };
  }
}

/* ---------------- KuCoin overlay fetchers ---------------- */

// Ticker (24h) — gives price, low/high 24h, turnover (quote volume)
async function fetchKucoinTicker(symbolLike) {
  const contract = parseToKucoinContractSymbol(symbolLike);
  const apiSym   = toKucoinApiSymbol(contract);
  try {
    const { data } = await axios.get(`${KUCOIN_BASE}/api/v1/ticker`, { params: { symbol: apiSym }, timeout: 7000 });
    const d = data?.data || {};
    return {
      price: toNum(d.price || d.lastTradePrice),
      high24h: toNum(d.highPrice),
      low24h:  toNum(d.lowPrice),
      turnover: toNum(d.turnover || d.turnoverOf24h || d.turnover24h)
    };
  } catch (_) {
    // fallback: mark price only
    try {
      const { data } = await axios.get(`${KUCOIN_BASE}/api/v1/mark-price/${contract}/current`, { timeout: 6000 });
      const price = toNum(data?.data?.value ?? data?.data?.markPrice);
      return { price, high24h: NaN, low24h: NaN, turnover: NaN };
    } catch {
      return { price: NaN, high24h: NaN, low24h: NaN, turnover: NaN };
    }
  }
}

// Simple in-memory 12h cache to avoid hammering the klines endpoint
const _range12hCache = new Map(); // symbol -> { at, low, high }
const RANGE12H_TTL_MS = 60_000;

// 12h range from KuCoin klines (15m candles over last 12h)
async function fetchKucoinRange12h(symbolLike) {
  const contract = parseToKucoinContractSymbol(symbolLike);
  const apiSym   = toKucoinApiSymbol(contract);

  const key = `12h:${apiSym}`;
  const now = Date.now();
  const cached = _range12hCache.get(key);
  if (cached && (now - cached.at) < RANGE12H_TTL_MS) return { low: cached.low, high: cached.high };

  const toSec   = Math.floor(now / 1000);
  const fromSec = toSec - 12 * 60 * 60; // 12h back
  const granularity = 15;

  try {
    const url = `${KUCOIN_BASE}/api/v1/kline/query`;
    const params = { symbol: apiSym, granularity, from: fromSec, to: toSec };
    const { data } = await axios.get(url, { params, timeout: 9000 });
    const rows = Array.isArray(data?.data) ? data.data : [];

    let lo = +Infinity, hi = -Infinity;
    for (const r of rows) {
      const high = toNum(r[3]);
      const low  = toNum(r[4]);
      if (Number.isFinite(high)) hi = Math.max(hi, high);
      if (Number.isFinite(low))  lo = Math.min(lo, low);
    }

    if (hi === -Infinity || lo === +Infinity) throw new Error('no-12h-data');
    _range12hCache.set(key, { at: now, low: lo, high: hi });
    return { low: lo, high: hi };
  } catch {
    return { low: NaN, high: NaN };
  }
}

/* ---------------- NEW: generic candle fetcher ---------------- */
/**
 * fetchCandles(baseOrContract, interval='1d', limit=60)
 * Returns normalized candle array: [{ t, o, h, l, c, v, turnover }]
 * interval -> KuCoin granularity map: 1m,3m,5m,15m,30m,1h,2h,4h,8h,1d
 */
const GRAN_MAP = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '2h': 120, '4h': 240, '8h': 480, '1d': 1440
};

async function fetchCandles(symbolLike, interval = '1d', limit = 60) {
  const gran = GRAN_MAP[interval] || 1440;
  const contract = parseToKucoinContractSymbol(symbolLike);
  const apiSym   = toKucoinApiSymbol(contract);
  const nowSec = Math.floor(Date.now() / 1000);
  const spanSec = gran * 60 * Math.max(1, Number(limit) || 60);
  const fromSec = nowSec - spanSec;
  const url = `${KUCOIN_BASE}/api/v1/kline/query`;
  const params = { symbol: apiSym, granularity: gran, from: fromSec, to: nowSec };

  try {
    const { data } = await axios.get(url, { params, timeout: 9000 });
    const rows = Array.isArray(data?.data) ? data.data : [];
    const out = rows.map(r => ({
      t: Number(r[0]) || 0,
      o: toNum(r[1]),
      c: toNum(r[2]),
      h: toNum(r[3]),
      l: toNum(r[4]),
      v: toNum(r[5]),
      turnover: toNum(r[6])
    })).filter(c => Number.isFinite(c.o) && Number.isFinite(c.h) && Number.isFinite(c.l));
    return out.slice(-limit);
  } catch {
    return [];
  }
}

/* ---------------- confidence with session bias ---------------- */
function calculateConfidence(input = {}) {
  let score = 50; // neutral base

  const sig  = String(input.signal || '').toLowerCase();
  const macd = String(input.macdSignal || '').toLowerCase();
  const bb   = String(input.bbSignal || '').toLowerCase();
  const rsi  = toNum(input.rsi);
  const volSpike = !!input.volumeSpike;
  const trap = !!input.trapWarning;
  const price = toNum(input.price);

  if (sig === 'bullish') score += 10;
  if (sig === 'bearish') score -= 10;
  if (macd === 'buy')  score += 6;
  if (macd === 'sell') score -= 6;
  if (bb === 'upper') score += 3;
  if (bb === 'lower') score -= 3;

  if (Number.isFinite(rsi)) {
    if (rsi >= 55 && rsi <= 68) score += 6;
    if (rsi < 35) score -= 6;
    if (rsi > 75) score -= 4;
  }

  if (volSpike) score += 4;
  if (trap)     score -= 12;

  const low12  = toNum(input?.range12h?.low);
  const high12 = toNum(input?.range12h?.high);
  const low24  = toNum(input?.range24h?.low ?? input.low24h ?? input.low);
  const high24 = toNum(input?.range24h?.high ?? input.high24h ?? input.high);

  const prefer12h = Number.isFinite(low12) && Number.isFinite(high12) && high12 > low12;
  const fib = prefer12h ? computeFibLevels(low12, high12)
                        : computeFibLevels(low24, high24);

  const dir = (sig === 'bullish' || macd === 'buy') ? 'long'
            : (sig === 'bearish' || macd === 'sell') ? 'short'
            : 'long';

  let headroomPct = 0;
  if (fib && Number.isFinite(price)) {
    const hr = fibHeadroom(price, fib, dir);
    if (hr) {
      headroomPct = Number(hr.headroomPct) || 0;

      if (headroomPct >= 8)      score += 10;
      else if (headroomPct >= 5) score += 7;
      else if (headroomPct >= 3) score += 4;
      else if (headroomPct >= 1) score += 1;
      else                       score -= 10;

      if (prefer12h) {
        if (dir === 'long'  && Number.isFinite(low12)  && (price - low12)  / low12  <= 0.02) score += 5;
        if (dir === 'short' && Number.isFinite(high12) && (high12 - price) / high12 <= 0.02) score += 5;
      } else {
        if (dir === 'long'  && Number.isFinite(low24)  && (price - low24)  / low24  <= 0.02) score += 5;
        if (dir === 'short' && Number.isFinite(high24) && (high24 - price) / high24 <= 0.02) score += 5;
      }

      if (dir === 'long'  && fib.F618 && price >= fib.F618) score -= 5;
      if (dir === 'short' && fib.F382 && price <= fib.F382) score -= 5;
    }
  }

  try {
    const { session, dow } = getSessionInfo(new Date());
    score += sessionBiasPoints({
      session, dow, dir, volumeSpike: volSpike, rsi, price,
      range24h: input.range24h, range12h: input.range12h, headroomPct
    }) || 0;
  } catch (_) {}

  score = clamp100(score);
  if (score >= 70 && (sig === 'neutral' || (!volSpike && !Number.isFinite(rsi)))) {
    score = Math.max(65, score - 5);
  }
  return Math.round(score);
}

/* ---------------- main fetch (with 12h-first overlay) ---------------- */
async function fetchTA(symbol) {
  try {
    const raw = await getTA(symbol);
    if (!raw || raw.success === false) return null;

    let price = toNum(raw.price) || toNum(raw.markPrice);
    const volumeBase = toNum(raw.volumeBase ?? raw.volume ?? raw.baseVolume);
    let quoteVolume = toNum(raw.quoteVolume);
    if (!Number.isFinite(quoteVolume)) {
      if (Number.isFinite(price) && Number.isFinite(volumeBase)) quoteVolume = price * volumeBase;
    }

    const k24 = await fetchKucoinTicker(symbol || raw.symbol);
    if (!Number.isFinite(price) && Number.isFinite(k24.price)) price = k24.price;
    if (!Number.isFinite(quoteVolume) && Number.isFinite(k24.turnover)) quoteVolume = k24.turnover;

    const k12 = await fetchKucoinRange12h(symbol || raw.symbol);
    const range12h = (Number.isFinite(k12.low) && Number.isFinite(k12.high) && k12.high > k12.low)
      ? { low: k12.low, high: k12.high }
      : undefined;

    let range24h = raw.range24h && (Number.isFinite(toNum(raw.range24h.low)) || Number.isFinite(toNum(raw.range24h.high)))
      ? { low: toNum(raw.range24h.low), high: toNum(raw.range24h.high) }
      : undefined;

    if (!range24h) {
      const h24 = toNum(k24.high24h);
      const l24 = toNum(k24.low24h);
      if (Number.isFinite(h24) || Number.isFinite(l24)) {
        range24h = { high: h24, low: l24 };
      }
    }

    const base = baseFromSymbol(symbol || raw.symbol);
    const isWhitelisted = WHITELIST.has(base);
    const valid =
      Number.isFinite(quoteVolume) &&
      quoteVolume > 0 &&
      (isWhitelisted || quoteVolume >= MIN_QUOTE_VOL);

    const normalized = {
      ...raw,
      symbol: raw.symbol || symbol,
      price: Number.isFinite(price) ? price : undefined,
      volumeBase: Number.isFinite(volumeBase) ? volumeBase : undefined,
      quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : undefined,
      quoteVolume24h: Number.isFinite(quoteVolume) ? quoteVolume : undefined,
      range12h,
      range24h,
      range7D:  raw.range7D  || undefined,
      range30D: raw.range30D || undefined,
      signal: raw.signal ?? 'neutral',
      rsi: toNum(raw.rsi),
      macdSignal: raw.macdSignal || raw.macd || 'neutral',
      bbSignal: raw.bbSignal || 'neutral',
      trapWarning: !!raw.trapWarning,
      volumeSpike: !!raw.volumeSpike
    };

    const confidence = calculateConfidence(normalized);

    return {
      ...normalized,
      valid,
      confidence,
      _volumeGate: { isWhitelisted, min: MIN_QUOTE_VOL }
    };
  } catch (err) {
    console.error('[taClient] fetchTA error:', err.message);
    return null;
  }
}

const analyzeSymbol = fetchTA;

module.exports = { fetchTA, analyzeSymbol, calculateConfidence, fetchCandles };