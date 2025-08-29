// strategyMemory.js

// Stubbed: updateMemoryFromResult does nothing in browser
function updateMemoryFromResult(symbol, direction, result) {
  // No-op in browser
}

const memoryMap = new Map(); // { symbol: { longWins, shortWins, longLosses, shortLosses } }

// === Record Trade Outcome ===
export function recordTradeResult(symbol, direction, result) {
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

  // === PATCH: update the deep learning panel memory too
  updateMemoryFromResult(symbol, direction, result);
}

// === Get Bias Based on Memory ===
export function getPreferredDirection(symbol) {
  const mem = memoryMap.get(symbol);
  if (!mem) return null;

  const longScore = mem.longWins - mem.longLosses;
  const shortScore = mem.shortWins - mem.shortLosses;

  if (longScore > shortScore && longScore > 1) return 'LONG';
  if (shortScore > longScore && shortScore > 1) return 'SHORT';

  return null; // No clear bias yet
}

// === Optional: View Current Memory (Debugging)
export function debugMemory() {
  memoryMap.forEach((value, key) => {
    console.log(`📚 ${key}:`, value);
  });
}

// === Export memory as JSON (for local save)
export function exportMemory() {
  const obj = {};
  memoryMap.forEach((value, key) => {
    obj[key] = value;
  });
  return JSON.stringify(obj, null, 2);
}

// === Import memory from JSON (manual restore)
export function importMemory(json) {
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