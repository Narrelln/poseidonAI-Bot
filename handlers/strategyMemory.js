// handlers/strategyMemory.js — Poseidon Strategy Bias Memory (Backend-Compatible, normalized keys)

const { updateMemoryFromResult, getMemory } = require('./data/updateMemoryFromResult');

// In-process bias tracker (fast read), keyed by normalized symbol
const memoryMap = new Map(); // symbolKey => { longWins, shortWins, longLosses, shortLosses }

function normKey(sym) {
  return String(sym || '').trim().toUpperCase().replace(/-/g, '');
}
function normSide(side) {
  const s = String(side || '').toUpperCase();
  if (s === 'BUY') return 'LONG';
  if (s === 'SELL') return 'SHORT';
  return s;
}

// === Record Trade Outcome ===
// result: 'win' | 'loss'
// percent: ROI% or price-move% (number)
// confidence: 0..100 (number)
// meta: any extra context (object)
function recordTradeResult(symbol, direction, result, percent = 0, confidence = 0, meta = {}) {
  const key = normKey(symbol);
  const side = normSide(direction);

  if (!key || (side !== 'LONG' && side !== 'SHORT')) {
    console.warn(`[strategyMemory] Skip record — bad input`, { symbol, direction, result });
    return;
  }

  if (!memoryMap.has(key)) {
    memoryMap.set(key, { longWins: 0, shortWins: 0, longLosses: 0, shortLosses: 0 });
  }
  const mem = memoryMap.get(key);

  if (side === 'LONG') {
    if (result === 'win') mem.longWins += 1;
    else if (result === 'loss') mem.longLosses += 1;
  } else {
    if (result === 'win') mem.shortWins += 1;
    else if (result === 'loss') mem.shortLosses += 1;
  }

  memoryMap.set(key, mem);

  // ✅ Persist to deep memory layer (keeps your neural/deep panel in sync)
  try {
    // updateMemoryFromResult(symbol, side, result, percent, confidence, meta)
    updateMemoryFromResult(key, side, result, Number(percent) || 0, Number(confidence) || 0, meta);
  } catch (err) {
    console.warn(`⚠️ Memory update failed for ${key}:`, err.message);
  }
}

// === Get Bias Based on Memory ===
// Returns 'LONG' | 'SHORT' | null (if no clear bias)
function getPreferredDirection(symbol) {
  const key = normKey(symbol);
  const mem = memoryMap.get(key);
  if (!mem) return null;

  const longScore  = mem.longWins  - mem.longLosses;
  const shortScore = mem.shortWins - mem.shortLosses;

  if (longScore > shortScore && longScore > 1) return 'LONG';
  if (shortScore > longScore && shortScore > 1) return 'SHORT';
  return null;
}

// === Optional: View Memory (Debugging)
function debugMemory() {
  memoryMap.forEach((value, key) => {
    console.log(`📚 ${key}:`, value);
  });
}

// === Export Memory (for saving or snapshot)
function exportMemory() {
  const obj = {};
  memoryMap.forEach((value, key) => { obj[key] = value; });
  return JSON.stringify(obj, null, 2);
}

// === Import Memory (for restore)
function importMemory(json) {
  try {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    for (const key in obj) {
      memoryMap.set(normKey(key), obj[key]);
    }
    console.log('🧠 Memory successfully imported.');
  } catch (err) {
    console.error('❌ Failed to import memory:', err.message);
  }
}

module.exports = {
  recordTradeResult,
  getPreferredDirection,
  debugMemory,
  exportMemory,
  importMemory
};