// /public/scripts/taFrontend.js
// Hunter-style confidence: Fibonacci headroom + Time-of-day/session bias + Category aware
// Exports: fetchTA, calculateConfidence, _fib, POSEIDON_SESSION

import { toKuCoinContractSymbol } from './futuresApiClient.js';

/* =========================
 * Categories (editable)
 * ========================= */
export const MAJORS = ['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC'];
export const MEMES  = ['SHIB','PEPE','TRUMP','FLOKI','BONK','WIF','MYRO']; // extend freely

function baseFromInput(input) {
  const raw = (input?.symbol || input?.base || '').toUpperCase();
  if (!raw) return '';
  return raw.replace(/[-_]/g,'').replace(/USDTM?$/,'');
}
export function classifyCategory(input = {}) {
  const b = baseFromInput(input);
  if (!b) return 'regular';
  if (MAJORS.includes(b)) return 'major';
  if (MEMES.includes(b))  return 'meme';
  if (input.isMover === true) return 'mover'; // caller can flag “Top 50 mover”
  return 'regular';
}

/* =========================
 * TA fetch (unchanged API shape + symbol added)
 * ========================= */
export async function fetchTA(symbol) {
  try {
    const normalized = toKuCoinContractSymbol(symbol);
    const res = await fetch(`/api/ta/${normalized}`);
    if (!res.ok) throw new Error(`TA fetch failed: ${res.status}`);
    const data = await res.json();

    return {
      symbol: normalized,                                  // <-- added for category detection
      signal: data.signal ?? 'neutral',
      rsi: Number.isFinite(+data.rsi) ? +data.rsi : 0,
      trapWarning: !!data.trapWarning,
      volumeSpike: !!data.volumeSpike,
      macdSignal: data.macdSignal || 'neutral',
      bbSignal: data.bbSignal || 'neutral',
      price: Number.isFinite(+data.price) ? +data.price : 0,
      quoteVolume: Number.isFinite(+data.quoteVolume) ? +data.quoteVolume : 0,
      range24h: data.range24h || { high: 0, low: 0 },
      range7D:  data.range7D  || { high: 0, low: 0 },
      range30D: data.range30D || { high: 0, low: 0 }
    };
  } catch (err) {
    console.error('TA fetch error:', err.message);
    return null;
  }
}

/* =========================
 * Fibonacci helpers
 * ========================= */
const clamp100 = (n) => Math.max(0, Math.min(100, n));

export function computeFibLevels(low, high) {
  const L = Number(low), H = Number(high);
  if (!(Number.isFinite(L) && Number.isFinite(H) && H > L)) return null;
  const R = H - L;
  const mk = (r) => +(L + R * r).toFixed(6);
  return {
    L, H, R,
    F236: mk(0.236),
    F382: mk(0.382),
    F500: mk(0.5),
    F618: mk(0.618),
    F786: mk(0.786),
  };
}

// Returns { next, headroomPct, side: 'resistance'|'support' }
export function fibHeadroom(price, fib, dir /* 'long' | 'short' */) {
  const p = Number(price);
  if (!fib || !Number.isFinite(p)) return null;

  const levels = [fib.F236, fib.F382, fib.F500, fib.F618, fib.F786, fib.H, fib.L].filter(Number.isFinite);

  if (dir === 'long') {
    const above = levels.filter(v => v > p).sort((a,b) => a - b);
    const next = above[0] ?? fib.H;
    const headroomPct = ((next - p) / p) * 100;
    return { next, headroomPct, side: 'resistance' };
  } else {
    const below = levels.filter(v => v < p).sort((a,b) => b - a);
    const next = below[0] ?? fib.L;
    const headroomPct = ((p - next) / p) * 100;
    return { next, headroomPct, side: 'support' };
  }
}

/* =========================
 * Time-of-day / session bias (CONFIGURABLE)
 * ========================= */

// ——— Config (safe defaults) ———
const SESSION_CONFIG = {
  utcOffsetHours: 0, // 0 = UTC; set to +1, -5, etc., if you want local-leaning session windows
  windows: {
    ASIA:   [0, 7],    // 00:00–07:59
    EUROPE: [8, 12],   // 08:00–12:59
    US:     [13, 20],  // 13:00–20:59
    LATE:   [21, 23],  // 21:00–23:59
  },
  weights: {
    weekendDamp: -2,
    US:     { momentum: +3, nearATHShort: +2 },
    EUROPE: { momentum: +1 },
    ASIA:   { meanRevLongATL: +3, overheatedTrim: -2 },
    LATE:   { riskOff: -3, runwayBack: +2 }
  }
};

// Live-tunable from DevTools: POSEIDON_SESSION.setWindows / setWeights / setUTCOffset / inspect
export const POSEIDON_SESSION = {
  setWindows(next) { Object.assign(SESSION_CONFIG.windows, next || {}); },
  setWeights(next) {
    if (!next) return;
    if (typeof next.weekendDamp === 'number') SESSION_CONFIG.weights.weekendDamp = next.weekendDamp;
    ['US','EUROPE','ASIA','LATE'].forEach(k => { if (next[k]) Object.assign(SESSION_CONFIG.weights[k], next[k]); });
  },
  setUTCOffset(hours = 0) { if (Number.isFinite(+hours)) SESSION_CONFIG.utcOffsetHours = +hours; },
  inspect() {
    const now = new Date();
    const s = getSessionInfo(now);
    return { nowUTC: now.toISOString(), ...s, config: JSON.parse(JSON.stringify(SESSION_CONFIG)) };
  }
};

function hourWithOffset(date) {
  const h = date.getUTCHours();
  const off = SESSION_CONFIG.utcOffsetHours || 0;
  let out = (h + off) % 24;
  if (out < 0) out += 24;
  return out;
}
function inWindow(h, [start, end]) {
  if (start <= end) return h >= start && h <= end;
  return (h >= start && h <= 23) || (h >= 0 && h <= end); // wrap-around
}
function getSessionInfo(date = new Date()) {
  const hour = hourWithOffset(date);
  const dow = date.getUTCDay(); // 0=Sun ... 6=Sat
  const W = SESSION_CONFIG.windows;
  let session = 'ASIA';
  if (inWindow(hour, W.EUROPE)) session = 'EUROPE';
  else if (inWindow(hour, W.US)) session = 'US';
  else if (inWindow(hour, W.LATE)) session = 'LATE';
  else if (inWindow(hour, W.ASIA)) session = 'ASIA';
  return { session, hour, dow };
}
function nearATL(price, range, pct = 0.02) {
  const p = Number(price), L = Number(range?.low);
  return Number.isFinite(p) && Number.isFinite(L) && L > 0 && (p - L) / L <= pct;
}
function nearATH(price, range, pct = 0.02) {
  const p = Number(price), H = Number(range?.high);
  return Number.isFinite(p) && Number.isFinite(H) && H > 0 && (H - p) / H <= pct;
}
function sessionBiasPoints({ session, dow, dir, volumeSpike, rsi, price, range24h, headroomPct }) {
  const W = SESSION_CONFIG.weights;
  let pts = 0;
  if (dow === 0 || dow === 6) pts += W.weekendDamp || 0;

  if (session === 'US') {
    if (volumeSpike) pts += (W.US.momentum || 0);
    if (dir === 'short' && nearATH(price, range24h, 0.012)) pts += (W.US.nearATHShort || 0);
  } else if (session === 'ASIA') {
    if (dir === 'long' && nearATL(price, range24h, 0.015) && rsi <= 45) pts += (W.ASIA.meanRevLongATL || 0);
    if (volumeSpike && rsi >= 72) pts += (W.ASIA.overheatedTrim || 0);
  } else if (session === 'EUROPE') {
    if (volumeSpike) pts += (W.EUROPE.momentum || 0);
  } else if (session === 'LATE') {
    pts += (W.LATE.riskOff || 0);
    if (headroomPct >= 6) pts += (W.LATE.runwayBack || 0);
  }
  return pts;
}

/* =========================
 * Main Confidence (category-aware)
 * ========================= */
export function calculateConfidence(input = {}) {
  let score = 50; // neutral base

  const sig = String(input.signal || '').toLowerCase();
  const macd = String(input.macdSignal || '').toLowerCase();
  const bb   = String(input.bbSignal || '').toLowerCase();
  const rsi  = Number(input.rsi);
  const volSpike = !!input.volumeSpike;
  const trap = !!input.trapWarning;
  const price = Number(input.price);

  // --- Technical scaffolding ---
  if (sig === 'bullish') score += 10;
  if (sig === 'bearish') score -= 10;

  if (macd === 'buy')  score += 6;
  if (macd === 'sell') score -= 6;

  if (bb === 'upper') score += 3;
  if (bb === 'lower') score -= 3;

  if (Number.isFinite(rsi)) {
    if (rsi >= 55 && rsi <= 68) score += 6;
    if (rsi < 35) score -= 6;
    if (rsi > 75) score -= 4; // overheated
  }

  if (volSpike) score += 4;
  if (trap)     score -= 12;

  // --- Fibonacci headroom (hunter logic) ---
  const low24  = Number(input?.range24h?.low  ?? input.low24h  ?? input.low);
  const high24 = Number(input?.range24h?.high ?? input.high24h ?? input.high);
  const fib = computeFibLevels(low24, high24);

  // Direction heuristics
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

      // Context nudges
      if (dir === 'long'  && low24  > 0 && (price - low24)  / low24  <= 0.02) score += 5; // near ATL bounce
      if (dir === 'short' && high24 > 0 && (high24 - price) / high24 <= 0.02) score += 5; // near ATH fade

      // Late chase trims
      if (dir === 'long'  && price >= fib.F618) score -= 5;
      if (dir === 'short' && price <= fib.F382) score -= 5;
    }
  }

  // --- Time-of-day/session bias (NOW BAKED IN) ---
  const { session, dow } = getSessionInfo();
  score += sessionBiasPoints({
    session, dow, dir, volumeSpike: volSpike, rsi, price,
    range24h: input.range24h, headroomPct
  });

  // --- Category-aware shaping (no whitelist penalty) ---
  const category = input.category || classifyCategory(input); // 'major' | 'meme' | 'mover' | 'regular'
  if (category === 'mover') {
    score += 5;                 // hot list target
    if (volSpike) score += 3;
  } else if (category === 'meme') {
    if (volSpike) score += 2;   // upside when momentum shows
    score = Math.min(score, 90); // gentle cap
  } else if (category === 'major') {
    // keep steady; no dampener
    score += 0;
  }
  // regular: unchanged

  // Final shaping
  score = clamp100(score);

  // Don’t let “neutral but thin” hit 70+ without momentum/headroom
  if (score >= 70 && (sig === 'neutral' || (!volSpike && !Number.isFinite(rsi)))) {
    score = Math.max(65, score - 5);
  }

  return Math.round(score);
}

// Optional test helpers
export const _fib = { computeFibLevels, fibHeadroom };

// ------- attach helpers for DevTools convenience -------
POSEIDON_SESSION.getSessionInfo = getSessionInfo;
POSEIDON_SESSION.sessionBiasPoints = sessionBiasPoints;

if (typeof window !== 'undefined') {
  window.POSEIDON_SESSION = POSEIDON_SESSION;
  window.calculateConfidence = calculateConfidence;
  window.POSEIDON_CATEGORIES = { MAJORS, MEMES, classifyCategory };
}

// Also export helpers for module imports
export { getSessionInfo, sessionBiasPoints };