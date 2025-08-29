// utils/rsiReversal.js

const { RSI } = require('technicalindicators');
const axios = require('axios');

async function fetchCloses(symbol, limit = 50) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - limit * 60;

  const url = `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${symbol}&granularity=1&from=${Math.floor(from)}&to=${Math.floor(now)}`;
  const res = await axios.get(url);
  const data = res.data?.data;

  if (!Array.isArray(data)) throw new Error(`Failed to fetch closes for ${symbol}`);
  return data.map(row => parseFloat(row[2])); // close price
}

async function detectRSIReversal(symbol) {
  const closes = await fetchCloses(symbol);
  const rsiValues = RSI.calculate({ values: closes, period: 14 });

  const last = rsiValues[rsiValues.length - 1];
  const prev = rsiValues[rsiValues.length - 2];
  if (!last || !prev) return { signal: 'neutral', rsi: null };

  if (prev < 30 && last >= 30) {
    return { signal: 'bullish-reversal', rsi: last };
  } else if (prev > 70 && last <= 70) {
    return { signal: 'bearish-reversal', rsi: last };
  }

  return { signal: 'neutral', rsi: last };
}

module.exports = { detectRSIReversal };