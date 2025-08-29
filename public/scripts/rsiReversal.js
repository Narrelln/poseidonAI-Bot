// rsiReversal.js — Poseidon Frontend Module (Browser-Safe)

// import { RSI } from 'https://cdn.jsdelivr.net/npm/technicalindicators@3.1.0/dist/browser.esm.js';

// Fetch recent closes for RSI calculation
async function fetchCloses(symbol, limit = 50) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - limit * 60;

  const url = `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${symbol}&granularity=1&from=${from}&to=${now}`;
  const res = await fetch(url);
  const json = await res.json();

  if (!Array.isArray(json.data)) {
    throw new Error(`Failed to fetch closes for ${symbol}`);
  }

  return json.data.map(row => parseFloat(row[2])); // use close price
}

// Detect RSI Reversal using last two RSI values
export async function detectRSIReversal(symbol) {
  const closes = await fetchCloses(symbol);
  const rsiValues = RSI.calculate({ values: closes, period: 14 });

  const last = rsiValues[rsiValues.length - 1];
  const prev = rsiValues[rsiValues.length - 2];
  if (!last || !prev) return null;

  if (prev < 30 && last >= 30) {
    return { signal: 'bullish-reversal', rsi: last };
  } else if (prev > 70 && last <= 70) {
    return { signal: 'bearish-reversal', rsi: last };
  }

  return { signal: 'neutral', rsi: last };
}