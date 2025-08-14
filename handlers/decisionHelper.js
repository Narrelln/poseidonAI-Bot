// handlers/decisionHelper.js

const { makeTradeDecision } = require('./evaluatePoseidonDecision.js');
const { getActiveSymbols } = require('./poseidonScanner.js');
const { recordTradeResult } = require('./data/tokenPatternMemory');
const { fetchTA } = require('./taClient'); // ✅ Imported TA wrapper

// Symbol-level decision wrapper
async function evaluatePoseidonDecision(symbol, signal) {
  const result = await makeTradeDecision(symbol, signal);

  // If a valid trade just closed, record it
  if (result && result.success && result.outcome) {
    const { outcome, delta, tradeType, durationMs } = result;

    // Build memory record
    await recordTradeResult(symbol, {
      result: outcome === 'win' ? 'win' : 'loss',
      gain: parseFloat(delta),
      duration: durationMs || 0,
      type: tradeType || (delta >= 0 ? 'long' : 'short'),
      confidence: signal?.confidence || 0,
      time: Date.now()
    });
  }

  return result;
}

// ✅ Patched: Use TA client for price
async function getLatestPrice(symbol) {
  try {
    const ta = await fetchTA(symbol);
    return ta?.price || null;
  } catch (err) {
    console.warn(`[Price] Failed to fetch price for ${symbol}:`, err.message);
    return null;
  }
}

// Return active symbol list
function listActiveSymbols() {
  return getActiveSymbols();
}

module.exports = {
  evaluatePoseidonDecision,
  getLatestPrice,
  listActiveSymbols
};