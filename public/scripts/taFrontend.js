import { toKuCoinContractSymbol } from './futuresApiClient.js';

export async function fetchTA(symbol) {
  try {
    const normalized = toKuCoinContractSymbol(symbol);
    const res = await fetch(`/api/ta/${normalized}`);
    if (!res.ok) throw new Error(`TA fetch failed: ${res.status}`);
    const data = await res.json();

    return {
      signal: data.signal ?? 'neutral',
      rsi: data.rsi ?? '--',
      trapWarning: !!data.trapWarning,
      volumeSpike: !!data.volumeSpike,
      macdSignal: data.macdSignal || 'neutral',
      bbSignal: data.bbSignal || 'neutral',
      price: data.price || 0,
      volume: data.volume || 0,
      range24h: data.range24h || { high: 0, low: 0 },
      range7D: data.range7D || { high: 0, low: 0 },
      range30D: data.range30D || { high: 0, low: 0 }
    };
  } catch (err) {
    return null;
  }
}

export function calculateConfidence(
  macd,
  bb,
  volumeSpike,
  rsi = 0,
  trapWarning = false,
  price = 0,
  ranges = {}
) {
  let score = 0;

  // === Base Technical Score ===
  if (macd === 'Buy') score += 0.3;
  if (bb === 'Breakout') score += 0.3;
  if (volumeSpike) score += 0.2;

  // === RSI Adjustment ===
  if (rsi >= 55 && rsi <= 80) score += 0.1;
  if (rsi > 80 || rsi < 35) score -= 0.1;

  // === Trap Candle Penalty ===
  if (trapWarning) score -= 0.15;

  // === ATL / ATH Proximity Prioritized Logic ===
  const { range24h, range7D, range30D } = ranges || {};

  const nearATL = (range) => price > 0 && range?.low && price <= range.low * 1.01;
  const nearATH = (range) => price > 0 && range?.high && price >= range.high * 0.99;

  // Prioritized ATL bonus
  if (nearATL(range24h)) {
    score += 0.15;
  } else if (nearATL(range7D)) {
    score += 0.10;
  } else if (nearATL(range30D)) {
    score += 0.05;
  }

  // Prioritized ATH penalty
  if (nearATH(range24h)) {
    score -= 0.1;
  } else if (nearATH(range7D)) {
    score -= 0.07;
  } else if (nearATH(range30D)) {
    score -= 0.05;
  }

  return Math.min(100, Math.max(0, Math.round(score * 100)));
}