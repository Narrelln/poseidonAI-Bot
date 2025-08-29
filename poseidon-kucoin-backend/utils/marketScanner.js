// === utils/marketScanner.js ===

const { getTA } = require('../handlers/taHandler');
const { fetchKuCoinFuturesSymbols, fetchFuturesPrice } = require('../handlers/futuresApi');
const { toKuCoinContractSymbol } = require('../handlers/futuresApi');

const MIN_VOLUME = 100000;

function normalizeSymbol(symbol = '') {
  return symbol.replace(/[-_]/g, '').toUpperCase();
}

async function analyzeSymbol(rawSymbol) {
  const symbol = toKuCoinContractSymbol(rawSymbol);
  try {
    const ta = await getTA(symbol);
    if (!ta || ta.success === false || !ta.signal || !['bullish', 'bearish'].includes(ta.signal)) return null;

    const { price, failed } = await fetchFuturesPrice(symbol);
    if (failed || !price || price <= 0) return null;

    return {
      symbol,
      signal: ta.signal,
      confidence: ta.confidence || 0,
      price,
      volume: ta.volume || 0,
      bbSignal: ta.bb?.breakout ? 'Breakout' : 'None',
      rsi: ta.rsi,
      trapWarning: ta.trapWarning,
      macdSignal: ta.macd?.signal,
      range24h: ta.range24h,
      range7D: ta.range7D,
      range30D: ta.range30D
    };
  } catch (err) {
    console.warn(`[MarketScanner] Failed for ${symbol}:`, err.message);
    return null;
  }
}

async function fetchValidKuCoinContracts() {
  try {
    const contracts = await fetchKuCoinFuturesSymbols();
    return contracts.filter(c => {
      const vol = parseFloat(c.volume || 0);
      return c.symbol && !/TEST|ALT/i.test(c.symbol) && vol >= MIN_VOLUME;
    });
  } catch (err) {
    console.error('[MarketScanner] fetchValidKuCoinContracts error:', err.message);
    return [];
  }
}

module.exports = {
  analyzeSymbol,
  fetchValidKuCoinContracts
};