// handlers/trendPhaseDetector.js — Patched (self-contained, CJS)
// - No longer depends on getMACD/getBB exports
// - Computes MACD histogram + Bollinger breakout from recent candles
// - Normalizes symbols the same way as taHandler

const axios = require('axios');

// ---------- symbol helpers (match taHandler) ----------
function normalizeSymbol(sym) {
  // Input can be BTC, BTCUSDT, BTC-USDTM → BTCUSDT
  let s = String(sym || '').toUpperCase().replace(/[-_]/g, '');
  if (s.endsWith('USDTM')) s = s.slice(0, -1); // strip trailing M
  if (!s.endsWith('USDT')) s += 'USDT';
  return s;
}

// ---------- tiny TA helpers ----------
function ema(arr, period) {
  if (!Array.isArray(arr) || arr.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  // seed with SMA
  let sma = 0;
  for (let i = 0; i < period; i++) sma += arr[i];
  sma /= period;
  out.push(sma);
  for (let i = period; i < arr.length; i++) {
    const prev = out[out.length - 1];
    out.push((arr[i] - prev) * k + prev);
  }
  return out;
}

function macdHistogram(closes) {
  // classic 12/26/9
  if (!Array.isArray(closes) || closes.length < 35) return 0;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const len = Math.min(ema12.length, ema26.length);
  const macdLine = [];
  for (let i = 0; i < len; i++) macdLine.push(ema12[i] - ema26[i]);
  const signal = ema(macdLine, 9);
  const L = Math.min(macdLine.length, signal.length);
  if (L === 0) return 0;
  return macdLine[L - 1] - signal[L - 1]; // histogram
}

function bollinger(closes, period = 20, stdMul = 2) {
  if (!Array.isArray(closes) || closes.length < period) {
    return { upper: NaN, lower: NaN, mid: NaN, breakout: false };
  }
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = mid + stdMul * std;
  const lower = mid - stdMul * std;
  const last = closes[closes.length - 1];
  const breakout = last > upper || last < lower;
  return { upper, lower, mid, breakout, last };
}

// ---------- kline fetch (Bybit linear, same as taHandler) ----------
async function fetchCandles(spotSymbol, interval = '15', limit = 100) {
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${spotSymbol}&interval=${interval}&limit=${limit}`;
  const { data } = await axios.get(url, { timeout: 12_000 });
  const list = data?.result?.list || [];
  // Bybit returns newest→oldest sometimes; ensure chronological ascending
  const rows = Array.isArray(list) ? [...list].reverse() : [];
  // map to numbers
  const closes = rows.map(c => +c[4]);
  const opens  = rows.map(c => +c[1]);
  return { rows, closes, opens };
}

// ---------- main detector ----------
async function detectTrendPhase(symbol) {
  try {
    const spot = normalizeSymbol(symbol); // e.g., BTCUSDT
    const { closes, rows } = await fetchCandles(spot, '15', 100);

    if (!closes || closes.length < 50) {
      return { phase: 'unknown', reason: 'Insufficient candles' };
    }

    const lastClose = closes[closes.length - 1];
    const close1hAgo = closes[closes.length - 5] ?? closes[closes.length - 2]; // 4×15m ≈ 1h
    const prevClose  = closes[closes.length - 2];

    const change1h = ((lastClose - close1hAgo) / close1hAgo) * 100;
    const velocity = ((lastClose - prevClose) / prevClose) * 100;

    const hist = macdHistogram(closes);
    const bb = bollinger(closes, 20, 2);

    let phase = 'neutral';
    const reasons = [];

    // Heuristics tuned to your earlier definitions
    // Peak: large 1h move, velocity cooling, MACD hist rolling over, or upper band rejection
    if (change1h > 30 && velocity < 3 && hist < 0) {
      phase = 'peak';
      reasons.push('>30% in 1h but slowing', 'MACD histogram turning down');
    } else if (change1h > 12 && hist > 0) {
      // Pumping: strong recent momentum & positive MACD breadth
      phase = 'pumping';
      reasons.push('Uptrend with positive MACD breadth');
    } else if (hist < 0 && velocity < 0 && change1h > 15) {
      // Reversal: deceleration with negative breadth after a big climb
      phase = 'reversal';
      reasons.push('MACD down, price decelerating after strong rise');
    }

    // Bollinger confirmation nudges
    if (bb.breakout && phase === 'neutral') {
      if (lastClose > bb.upper) {
        phase = 'pumping';
        reasons.push('Bollinger breakout (upper)');
      } else if (lastClose < bb.lower) {
        phase = 'reversal';
        reasons.push('Bollinger breakdown (lower)');
      }
    }

    return {
      phase,
      velocity: Number.isFinite(velocity) ? velocity.toFixed(2) : '0.00',
      change1h: Number.isFinite(change1h) ? change1h.toFixed(2) : '0.00',
      macdHistogram: Number.isFinite(hist) ? hist.toFixed(6) : '0.000000',
      bb: { upper: bb.upper, lower: bb.lower, mid: bb.mid, breakout: !!bb.breakout },
      reasons
    };
  } catch (err) {
    return { phase: 'error', reason: err.message };
  }
}

module.exports = { detectTrendPhase };