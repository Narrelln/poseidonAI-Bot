/**
 * handlers/taHandler.js  (patched & upgraded)
 *
 * Purpose:
 *   Unified TA endpoint backed by Bybit market data.
 *   - Normalizes XBT -> BTC for Bybit
 *   - 15m core TA (MACD, BB, RSI, ATR, trap-wick, volume spike)
 *   - 1h lightweight trend regime (EMA50/EMA200) when available
 *   - Fib swing detection from recent pivots (+ context & overextension flags)
 *   - Quote volume prefers 24h turnover (Bybit turnover24h)
 *   - Backward-compat fields for consumers expecting breakout/bullish enums
 *
 * Returns (key fields):
 *   {
 *     success, symbol, price,
 *     signal: 'bullish'|'bearish'|'neutral',
 *     macdSignal: 'buy'|'sell'|'neutral',
 *     macdSignalCompat: 'bullish'|'bearish'|'neutral',
 *     bbSignal: 'upper'|'lower'|'neutral',
 *     bbSignalCompat: 'breakout'|'neutral',
 *     rsi, atr14, bbWidth, macdState: { line, signal, hist, cross },
 *     volumeBase, quoteVolume, quoteVolume24h, priceChangePct,
 *     volumeSpike, trapWarning,
 *     range24h, range7D, range30D,
 *     swing, fib, fibContext, overextended,
 *     trend_1h: 'up'|'down'|'flat'|undefined
 *   }
 */

const axios = require('axios');

// ---------- helpers ----------
function bybitBaseAlias(base) {
  const b = String(base || '').toUpperCase();
  return b === 'XBT' ? 'BTC' : b;
}

// Normalize any input to Bybit symbol: e.g. "xbtusdtm" -> "BTCUSDT"
function normalizeSymbol(sym) {
  let s = String(sym || '').toUpperCase().replace(/[-_]/g, '');
  // strip trailing M from USDTM
  if (s.endsWith('USDTM')) s = s.slice(0, -1);
  // if it's just BASE, append USDT
  if (!s.endsWith('USDT')) s += 'USDT';
  // apply Bybit base alias (XBT -> BTC)
  const base = bybitBaseAlias(s.replace(/USDT$/, ''));
  return `${base}USDT`;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function sma(arr, p) {
  if (!Array.isArray(arr) || arr.length < p) return [];
  const out = new Array(arr.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= p) sum -= arr[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}
function ema(arr, p) {
  if (!Array.isArray(arr) || arr.length < p) return [];
  const k = 2 / (p + 1);
  const out = new Array(arr.length).fill(NaN);
  // seed with SMA(p)
  const seed = sma(arr, p);
  let prev = seed[p - 1];
  out[p - 1] = prev;
  for (let i = p; i < arr.length; i++) {
    const v = arr[i];
    prev = (v - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}
function lastFinite(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (Number.isFinite(arr[i])) return arr[i];
  return undefined;
}
function prevFinitePair(a, b) {
  // returns [prevA, prevB] where both are finite and come from same idx back from end
  for (let i = a.length - 2; i >= 0; i--) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) return [a[i], b[i]];
  }
  return [undefined, undefined];
}
function pct(a, b) {
  const A = toNumber(a), B = toNumber(b);
  return B === 0 ? NaN : ((A - B) / B) * 100;
}
function macdCrossType(curDelta, prevDelta) {
  if (!Number.isFinite(curDelta) || !Number.isFinite(prevDelta)) return null;
  if (prevDelta <= 0 && curDelta > 0) return 'bull';
  if (prevDelta >= 0 && curDelta < 0) return 'bear';
  return null;
}
function localMinIdx(arr, i, w) {
  const p = arr[i];
  for (let k = Math.max(0, i - w); k <= Math.min(arr.length - 1, i + w); k++) {
    if (arr[k] < p) return false;
  }
  return true;
}
function localMaxIdx(arr, i, w) {
  const p = arr[i];
  for (let k = Math.max(0, i - w); k <= Math.min(arr.length - 1, i + w); k++) {
    if (arr[k] > p) return false;
  }
  return true;
}
function calculateConfidence(macdSignal, bbSignal, volumeSpike) {
  // very simple scorer; matches 'buy'|'sell' + 'upper'|'lower'|'neutral'
  let score = 0;
  if (macdSignal === 'buy' || macdSignal === 'sell') score += 30;
  if (bbSignal === 'upper' || bbSignal === 'lower') score += 30;
  if (volumeSpike) score += 40;
  return Math.min(score, 100);
}

// ---------- core ----------
async function getTA(symbol) {
  const normalized = normalizeSymbol(symbol);

  const kline15Url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${normalized}&interval=15&limit=100`;
  const kline1hUrl = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${normalized}&interval=60&limit=120`;
  const tickerUrl  = `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${normalized}`;

  try {
    const [k15, k1h, tk] = await Promise.allSettled([
      axios.get(kline15Url, { timeout: 12000 }),
      axios.get(kline1hUrl, { timeout: 12000 }),
      axios.get(tickerUrl,  { timeout: 10000 })
    ]);

    const candles15 = k15.status === 'fulfilled'
      ? (k15.value.data?.result?.list || [])
      : [];
    if (!candles15 || candles15.length < 50) {
      return { success: false, error: 'Insufficient candles' };
    }

    // Bybit kline format: [startTime, open, high, low, close, volume, turnover]
    const toNum = (x) => toNumber(x);
    const opens   = candles15.map(c => toNum(c[1]));
    const highs   = candles15.map(c => toNum(c[2]));
    const lows    = candles15.map(c => toNum(c[3]));
    const closes  = candles15.map(c => toNum(c[4]));
    const vols    = candles15.map(c => toNum(c[5]));
    const lastClose = lastFinite(closes);

    // ===== MACD (12/26/9) =====
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const macdLine = closes.map((_, i) =>
      Number.isFinite(ema12[i]) && Number.isFinite(ema26[i]) ? (ema12[i] - ema26[i]) : NaN
    );
    // Build a compact array of finite MACD values for signal EMA
    const macdFinite = macdLine.filter(Number.isFinite);
    const macdSignalArr = ema(macdFinite, 9);
    const lastMACD = macdFinite[macdFinite.length - 1];
    const lastSignal = macdSignalArr[macdSignalArr.length - 1];
    const macdSignal =
      Number.isFinite(lastMACD) && Number.isFinite(lastSignal)
        ? (lastMACD > lastSignal ? 'buy' : 'sell')
        : 'neutral';
    const prevMACD = macdFinite[macdFinite.length - 2];
    const prevSignal = macdSignalArr[macdSignalArr.length - 2];
    const curDelta = Number.isFinite(lastMACD) && Number.isFinite(lastSignal) ? (lastMACD - lastSignal) : NaN;
    const prevDelta = Number.isFinite(prevMACD) && Number.isFinite(prevSignal) ? (prevMACD - prevSignal) : NaN;
    const macdHist = Number.isFinite(curDelta) ? curDelta : undefined;
    const macdCross = macdCrossType(curDelta, prevDelta);

    // ===== Bollinger Bands (20, 2σ) & width =====
    let bbSignal = 'neutral';
    let bbWidth = undefined;
    if (closes.length >= 20) {
      const p = 20;
      const slice = closes.slice(-p);
      const ma = slice.reduce((a, b) => a + b, 0) / p;
      const sd = Math.sqrt(slice.reduce((a, b) => a + (b - ma) * (b - ma), 0) / p);
      const upper = ma + 2 * sd;
      const lower = ma - 2 * sd;
      if (Number.isFinite(lastClose)) {
        if (lastClose > upper) bbSignal = 'upper';
        else if (lastClose < lower) bbSignal = 'lower';
      }
      // normalized width
      bbWidth = Number.isFinite(ma) && ma !== 0 ? ((upper - lower) / ma) : undefined;
    }

    // ===== RSI(14) (simple) =====
    let gains = 0, losses = 0;
    for (let i = closes.length - 15; i < closes.length - 1; i++) {
      const diff = closes[i + 1] - closes[i];
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    const rs = gains / (losses || 1);
    const rsi = 100 - 100 / (1 + rs);

    // ===== ATR(14) (EMA over True Range) =====
    const TR = highs.map((h, i) => {
      const l = lows[i];
      const pc = i === 0 ? closes[0] : closes[i - 1];
      return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    });
    const atrArr = ema(TR, 14);
    const atr14 = lastFinite(atrArr);

    // ===== Volume spike (15m vs recent avg) =====
    const lastVolBase = vols[vols.length - 1];
    const lookbackV = Math.min(20, vols.length);
    const avgVol = lookbackV > 0 ? vols.slice(-lookbackV).reduce((a, b) => a + b, 0) / lookbackV : NaN;
    const volumeSpike = Number.isFinite(lastVolBase) && Number.isFinite(avgVol) && lastVolBase > 1.5 * avgVol;

    // ===== Trap wick (very simple) =====
    const lastCandle = candles15[candles15.length - 1];
    const high = toNum(lastCandle[2]);
    const low  = toNum(lastCandle[3]);
    const body = Math.abs(toNum(lastCandle[1]) - toNum(lastCandle[4]));
    const wick = Number.isFinite(high) && Number.isFinite(low) ? (high - low) : NaN;
    const trapWarning = Number.isFinite(body) && Number.isFinite(wick) && wick > 2 * (body || 1);

    // ===== Coarse ranges from the 100×15m window =====
    const rangeHigh = Math.max(...highs.filter(Number.isFinite));
    const rangeLow  = Math.min(...lows.filter(Number.isFinite));
    const range24h = { high: rangeHigh, low: rangeLow };
    const range7D  = range24h;
    const range30D = range24h;

    // ===== Price / base volume =====
    const price = Number(lastClose);
    const volumeBase = Number(lastVolBase);

    // ===== Robust 24h stats from tickers =====
    let quoteVolume24h = undefined;
    let priceChangePct = undefined;
    if (tk.status === 'fulfilled') {
      const row = (tk.value.data?.result?.list || [])[0];
      if (row) {
        const qv24 = Number(row.turnover24h);
        if (Number.isFinite(qv24)) quoteVolume24h = qv24;

        const pcp = Number(row.price24hPcnt);
        if (Number.isFinite(pcp)) priceChangePct = pcp * 100;
      }
    }
    // Prefer 24h turnover; else approximate with last-candle price*volume
    const quoteVolume = Number.isFinite(quoteVolume24h)
      ? quoteVolume24h
      : (Number.isFinite(price) && Number.isFinite(volumeBase) ? price * volumeBase : undefined);

    // ===== Simple combined TA-facing "direction" =====
    const signal =
      (macdSignal === 'buy'  && bbSignal !== 'lower') ? 'bullish' :
      (macdSignal === 'sell' && bbSignal !== 'upper') ? 'bearish' :
      'neutral';

    const confidence = calculateConfidence(macdSignal, bbSignal, volumeSpike);

    // ===== Fib swing detection (recent pivots) =====
    // Find the most recent pivot (max or min) and the opposite prior pivot to define swing
    let swing = null;
    const W = 5; // pivot lookback
    for (let i = closes.length - 3; i >= 5; i--) {
      if (localMaxIdx(highs, i, W)) {
        // find nearest low before that high
        for (let j = i - 1; j >= 5; j--) {
          if (localMinIdx(lows, j, W)) {
            swing = { direction: 'down', high: { price: highs[i] }, low: { price: lows[j] } };
            break;
          }
        }
      } else if (localMinIdx(lows, i, W)) {
        // find nearest high before that low
        for (let j = i - 1; j >= 5; j--) {
          if (localMaxIdx(highs, j, W)) {
            swing = { direction: 'up', high: { price: highs[j] }, low: { price: lows[i] } };
            break;
          }
        }
      }
      if (swing) break;
    }

    let fib = null, fibContext = null, overextended = false;
    if (swing && Number.isFinite(price)) {
      const from = swing.direction === 'up' ? swing.low.price  : swing.high.price;
      const to   = swing.direction === 'up' ? swing.high.price : swing.low.price;
      if (Number.isFinite(from) && Number.isFinite(to) && from !== to) {
        const R = to - from;
        const lvl = r => swing.direction === 'up' ? from + R * r : from - R * r;
        fib = {
          from, to, direction: swing.direction,
          levels: {
            '0.236': lvl(0.236), '0.382': lvl(0.382), '0.5': lvl(0.5),
            '0.618': lvl(0.618), '0.786': lvl(0.786), '1.0': lvl(1.0),
            '1.272': swing.direction === 'up' ? to + R * 0.272 : to - R * 0.272,
            '1.618': swing.direction === 'up' ? to + R * 0.618 : to - R * 0.618
          }
        };
        if (swing.direction === 'up') {
          fibContext = price > fib.levels['1.0'] ? 'extension' : 'pullback';
          overextended = price >= fib.levels['1.272'];
        } else {
          fibContext = price < fib.levels['1.0'] ? 'extension' : 'pullback';
          overextended = price <= fib.levels['1.272'];
        }
      }
    }

    // ===== 1h trend regime (EMA50 vs EMA200 + EMA50 slope) =====
    let trend_1h = undefined;
    if (k1h.status === 'fulfilled') {
      const list1h = k1h.value.data?.result?.list || [];
      if (Array.isArray(list1h) && list1h.length >= 60) {
        const closes1h = list1h.map(c => toNum(c[4]));
        const ema50 = ema(closes1h, 50);
        const ema200 = ema(closes1h, 200);
        const e50 = lastFinite(ema50);
        const e50Prev = ema50[ema50.length - 2];
        const e200 = lastFinite(ema200);
        const slope50 = Number.isFinite(e50) && Number.isFinite(e50Prev) ? e50 - e50Prev : 0;
        if (Number.isFinite(e50) && Number.isFinite(e200)) {
          if (e50 > e200 && slope50 > 0) trend_1h = 'up';
          else if (e50 < e200 && slope50 < 0) trend_1h = 'down';
          else trend_1h = 'flat';
        }
      }
    }

    // ----- compatibility enums for existing consumers -----
    const macdSignalCompat =
      macdSignal === 'buy' ? 'bullish' : macdSignal === 'sell' ? 'bearish' : 'neutral';
    const bbSignalCompat = (bbSignal === 'upper' || bbSignal === 'lower') ? 'breakout' : 'neutral';

    // ----- final payload -----
    return {
      success: true,
      // return a futures-looking symbol for downstream display
      symbol: normalized.replace(/USDT$/, '') + '-USDTM',

      // direction & enums
      signal,                         // 'bullish' | 'bearish' | 'neutral'
      confidence,
      macdSignal,                     // 'buy'|'sell'|'neutral'
      macdSignalCompat,               // 'bullish'|'bearish'|'neutral'
      bbSignal,                       // 'upper'|'lower'|'neutral'
      bbSignalCompat,                 // 'breakout'|'neutral'

      // prices & indicators
      rsi: Number.isFinite(rsi) ? Number(rsi.toFixed(2)) : undefined,
      price,
      atr14: Number.isFinite(atr14) ? Number(atr14.toFixed(6)) : undefined,
      bbWidth: Number.isFinite(bbWidth) ? Number(bbWidth.toFixed(6)) : undefined,
      macdState: {
        line: Number.isFinite(lastMACD) ? lastMACD : undefined,
        signal: Number.isFinite(lastSignal) ? lastSignal : undefined,
        hist: Number.isFinite(macdHist) ? macdHist : undefined,
        cross: macdCross // 'bull' | 'bear' | null
      },

      // volumes
      volumeBase: Number.isFinite(volumeBase) ? volumeBase : undefined, // last candle base units
      quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : undefined, // prefers 24h turnover
      quoteVolume24h: Number.isFinite(quoteVolume24h) ? quoteVolume24h : undefined,

      // 24h change (%)
      priceChangePct: Number.isFinite(priceChangePct) ? priceChangePct : undefined,

      // states
      trapWarning: !!trapWarning,
      volumeSpike: !!volumeSpike,

      // coarse ranges (from 15m window)
      range24h,
      range7D,
      range30D,

      // fib/swing
      swing: swing ? {
        high: { price: swing.high.price },
        low:  { price: swing.low.price },
        direction: swing.direction
      } : null,
      fib,
      fibContext,
      overextended,

      // higher-TF regime
      trend_1h
    };

  } catch (err) {
    return { success: false, error: err.message || 'TA failed' };
  }
}

module.exports = { getTA };