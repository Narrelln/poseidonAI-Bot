import { toKuCoinContractSymbol } from './futuresApiClient.js';

/**
 * Fetches complete technical analysis from backend for a given symbol
 * @param {string} symbol – The user input (e.g. DOGE, BTCUSDT)
 * @returns {Promise<object|null>}
 */
export async function fetchTA(symbol) {
  try {
    const normalized = toKuCoinContractSymbol(symbol);
    const res = await fetch(`/api/ta/${encodeURIComponent(normalized)}`);
    if (!res.ok) throw new Error(`TA fetch failed: ${res.status}`);
    const data = await res.json();

    if (data.nodata) return null;

    return {
      signal: data.signal || 'neutral',
      confidence: data.confidence || 0,
      macdSignal: data.macdSignal || '--',
      bbSignal: data.bbSignal || '--',
      rsi: data.rsi || '--',
      price: data.price || 0,
      volume: data.volume || 0,
      trapWarning: !!data.trapWarning,
      volumeSpike: !!data.volumeSpike,
      range24h: data.range24h || { high: 0, low: 0 },
      range7D: data.range7D || { high: 0, low: 0 },
      range30D: data.range30D || { high: 0, low: 0 }
    };
  } catch (err) {
    console.error(`TA fetch error for ${symbol}:`, err.message);
    return null;
  }
}

/**
 * Legacy export for compatibility
 */
export const analyzeSymbol = fetchTA;
window.analyzeSymbol = fetchTA;