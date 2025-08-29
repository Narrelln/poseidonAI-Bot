// handlers/taHandler.js
const axios = require('axios');

function normalizeSymbol(sym) {
  // Input can be BTC, BTCUSDT, BTC-USDTM, etc. → BTCUSDT
  let s = String(sym || '').toUpperCase().replace(/[-_]/g, '');
  if (s.endsWith('USDTM')) s = s.slice(0, -1);
  if (!s.endsWith('USDT')) s += 'USDT';
  return s;
}

function calculateConfidence(macdSignal, bbSignal, volumeSpike) {
  let score = 0;
  if (macdSignal === 'bullish' || macdSignal === 'bearish') score += 30;
  if (bbSignal === 'breakout') score += 30;
  if (volumeSpike) score += 40;
  return Math.min(score, 100);
}

async function getTA(symbol) {
  try {
    const normalized = normalizeSymbol(symbol);
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${normalized}&interval=15&limit=100`;
    const candlesRes = await axios.get(url, { timeout: 12_000 });
    const candles = candlesRes.data?.result?.list || [];

    if (!candles || candles.length < 50) {
      return { success: false, error: 'Insufficient candles' };
    }

    const closes  = candles.map(c => parseFloat(c[4]));
    const highArr = candles.map(c => parseFloat(c[2]));
    const lowArr  = candles.map(c => parseFloat(c[3]));
    const vols    = candles.map(c => parseFloat(c[5]));

    const lastClose = closes[closes.length - 1];

    // MACD
    const ema = (arr, period) => {
      const k = 2 / (period + 1);
      const out = [arr.slice(0, period).reduce((a, b) => a + b) / period];
      for (let i = period; i < arr.length; i++) {
        out.push((arr[i] - out[out.length - 1]) * k + out[out.length - 1]);
      }
      return out;
    };
    const macdLine   = ema(closes, 12).map((v, i) => v - (ema(closes, 26)[i] || 0));
    const signalLine = ema(macdLine, 9);
    const lastMACD   = macdLine[macdLine.length - 1];
    const lastSignal = signalLine[signalLine.length - 1];
    const macdSignal = lastMACD > lastSignal ? 'bullish' : 'bearish';

    // Bollinger
    const period = 20;
    const slice  = closes.slice(-period);
    const avg    = slice.reduce((a, b) => a + b, 0) / period;
    const std    = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / period);
    const upper  = avg + 2 * std;
    const lower  = avg - 2 * std;
    const bbSignal = lastClose > upper || lastClose < lower ? 'breakout' : 'neutral';

    // RSI(14)
    let gains = 0, losses = 0;
    for (let i = closes.length - 15; i < closes.length - 1; i++) {
      const diff = closes[i + 1] - closes[i];
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    const rs = gains / (losses || 1);
    const rsi = 100 - 100 / (1 + rs);

    // Volume spike
    const avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const lastVolBase = vols[vols.length - 1]; // base units
    const volumeSpike = lastVolBase > 1.5 * avgVol;

    // Trap wick (very simple)
    const last = candles[candles.length - 1];
    const high = parseFloat(last[2]);
    const low  = parseFloat(last[3]);
    const body = Math.abs(parseFloat(last[1]) - parseFloat(last[4]));
    const wick = high - low;
    const trapWarning = wick > 2 * body;

    // Ranges
    const range24h = { high: Math.max(...highArr), low: Math.min(...lowArr) };
    const range7D  = range24h;
    const range30D = range24h;

    // Price/volumes
    const price = Number(lastClose);
    const volumeBase = Number(lastVolBase);
    const quoteVolume = Number(price * volumeBase);

    // Simple combined signal
    const signal = (macdSignal === 'bullish' && bbSignal === 'breakout') ? 'bullish'
                 : (macdSignal === 'bearish' && bbSignal === 'breakout') ? 'bearish'
                 : 'neutral';

    const confidence = calculateConfidence(macdSignal, bbSignal, volumeSpike);

    return {
      success: true,
      symbol: normalized.replace(/USDT$/, '') + '-USDTM', // futures style for downstream
      signal,
      confidence,
      macdSignal,
      bbSignal,
      rsi: Number(rsi.toFixed(2)),
      price,
      // volumes (both)
      volumeBase,     // base units for the last candle
      quoteVolume,    // USDT, used for gating
      trapWarning,
      volumeSpike,
      range24h,
      range7D,
      range30D
    };

  } catch (err) {
    return { success: false, error: err.message || 'TA failed' };
  }
}

module.exports = { getTA };