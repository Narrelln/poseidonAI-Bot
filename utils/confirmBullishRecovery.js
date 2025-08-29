// utils/confirmBullishRecovery.js

const { MACD, BollingerBands, RSI } = require('technicalindicators');
const axios = require('axios');

async function fetchCandles(symbol, limit = 100) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - limit * 60;

  const url = `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${symbol}&granularity=1&from=${Math.floor(from)}&to=${Math.floor(now)}`;
  console.log(`[Recovery] Fetching candles for ${symbol}:`, url);

  try {
    const res = await axios.get(url);
    const data = res.data?.data;
    if (!Array.isArray(data)) return [];

    return data.map(c => ({
      open: parseFloat(c[1]),
      close: parseFloat(c[2]),
      high: parseFloat(c[3]),
      low: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    })).reverse();
  } catch (err) {
    console.error(`[Recovery] Candle fetch failed for ${symbol}:`, err.message);
    return [];
  }
}

async function confirmBullishRecovery(symbol) {
  const candles = await fetchCandles(symbol);
  if (candles.length < 30) return false;

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const rsi = RSI.calculate({ values: closes, period: 14 }).slice(-1)[0];
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  }).slice(-1)[0];
  const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 }).slice(-1)[0];

  if (!rsi || !macd || !bb) return false;

  const recentVol = volumes.slice(-5);
  const avgVol = recentVol.reduce((a, b) => a + b, 0) / recentVol.length;
  const latestVol = volumes[volumes.length - 1];
  const volumeSpike = latestVol > avgVol * 1.6;

  const bullishMACD = macd.MACD > macd.signal;
  const closeAboveMid = closes[closes.length - 1] > bb.middle;

  return rsi > 35 && bullishMACD && volumeSpike && closeAboveMid;
}

module.exports = { confirmBullishRecovery };