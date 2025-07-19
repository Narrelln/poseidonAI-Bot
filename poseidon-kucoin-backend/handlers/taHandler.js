const axios = require('axios');
const { MACD, BollingerBands, RSI } = require('technicalindicators');
const { parseToKucoinContractSymbol } = require('../kucoinHelper'); // ⬅️ Make sure this helper is present

// Fetch KuCoin closes
async function fetchKucoinCloses(symbol, limit = 100) {
  symbol = parseToKucoinContractSymbol(symbol);
  const now = Math.floor(Date.now() / 1000);
  const from = now - limit * 60;
  const res = await axios.get(
    `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${symbol}&granularity=1&from=${from}&to=${now}`
  );
  if (res.data.code !== "200000" || !Array.isArray(res.data.data)) throw new Error('No data from KuCoin');
  return res.data.data.map(row => parseFloat(row[2])); // close prices
}

// Fetch full candles for volume fade detection
async function fetchKucoinKlines(symbol, limit = 60) {
  symbol = parseToKucoinContractSymbol(symbol);
  const now = Math.floor(Date.now() / 1000);
  const from = now - limit * 60;
  const res = await axios.get(
    `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${symbol}&granularity=1&from=${from}&to=${now}`
  );
  if (res.data.code !== "200000" || !Array.isArray(res.data.data)) throw new Error('No klines');
  return res.data.data;
}

// MACD
async function getMACD(symbol) {
  const closes = await fetchKucoinCloses(symbol, 100);
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const last = macd[macd.length - 1];
  if (!last) return null;
  return {
    value: last.MACD,
    signal: last.signal,
    histogram: last.histogram,
    direction: last.MACD > last.signal ? 'bullish' : 'bearish'
  };
}

// Bollinger Bands
async function getBB(symbol) {
  const closes = await fetchKucoinCloses(symbol, 40);
  const bb = BollingerBands.calculate({
    period: 20,
    values: closes,
    stdDev: 2
  });
  const last = bb[bb.length - 1];
  if (!last) return null;
  return {
    upper: last.upper,
    middle: last.middle,
    lower: last.lower,
    breakout: closes[closes.length - 1] > last.upper
  };
}

// RSI
async function getRSI(symbol) {
  const closes = await fetchKucoinCloses(symbol, 50);
  const rsi = RSI.calculate({ values: closes, period: 14 });
  const last = rsi[rsi.length - 1];
  return parseFloat(last?.toFixed(2)) || null;
}

// Volume Fade
async function detectVolumeFade(symbol) {
  const klines = await fetchKucoinKlines(symbol, 60);
  if (klines.length < 10) return false;

  const recentVolumes = klines.slice(-10).map(k => parseFloat(k[5]));
  const earlierVolumes = klines.slice(0, 10).map(k => parseFloat(k[5]));

  const avgRecent = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  const avgEarlier = earlierVolumes.reduce((a, b) => a + b, 0) / earlierVolumes.length;

  return avgRecent < avgEarlier * 0.7;
}

// Combined TA fetcher
async function getTA(symbol) {
  try {
    const [macd, bb, rsi, volumeFade] = await Promise.all([
      getMACD(symbol),
      getBB(symbol),
      getRSI(symbol),
      detectVolumeFade(symbol)
    ]);
    return { macd, bb, rsi, volumeFade };
  } catch (err) {
    console.warn(`TA fetch failed for ${symbol}:`, err.message);
    return null;
  }
}

module.exports = {
  getMACD,
  getBB,
  getRSI,
  detectVolumeFade,
  getTA
};