// handlers/strategyMemory.js — Poseidon Strategy Bias Memory (Backend-Compatible)

const { updateMemoryFromResult, getMemory } = require('./data/updateMemoryFromResult');

const memoryMap = new Map(); // symbol => memory object

// === Record Trade Outcome ===
function recordTradeResult(symbol, direction, result, percent = 0, confidence = 0, meta = {}) {
  if (!memoryMap.has(symbol)) {
    memoryMap.set(symbol, {
      longWins: 0,
      shortWins: 0,
      longLosses: 0,
      shortLosses: 0,
    });
  }

  const mem = memoryMap.get(symbol);
  if (direction === 'LONG') {
    if (result === 'win') mem.longWins++;
    else mem.longLosses++;
  } else if (direction === 'SHORT') {
    if (result === 'win') mem.shortWins++;
    else mem.shortLosses++;
  }

  memoryMap.set(symbol, mem);

  // ✅ Update persistent memory (deep memory panel / neural memory)
  try {
    updateMemoryFromResult(symbol, direction, result, percent, confidence, meta);
  } catch (err) {
    console.warn(`⚠️ Memory update failed for ${symbol}:`, err.message);
  }
}

// === Get Bias Based on Memory ===
function getPreferredDirection(symbol) {
  const mem = memoryMap.get(symbol);
  if (!mem) return null;

  const longScore = mem.longWins - mem.longLosses;
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
  memoryMap.forEach((value, key) => {
    obj[key] = value;
  });
  return JSON.stringify(obj, null, 2);
}

// === Import Memory (for restore)
function importMemory(json) {
  try {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    for (const key in obj) {
      memoryMap.set(key, obj[key]);
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