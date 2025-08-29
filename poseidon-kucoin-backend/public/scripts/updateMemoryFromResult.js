// === /handlers/updateMemoryFromResult.js ===

const { saveLearningMemory, getLearningMemory } = require('../public/scripts/learningMemory');

const memory = {};

function initStats() {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    lastResult: null,
    lastDelta: 0,
    lastConfidence: 0,
    currentStreak: 0,
    meta: {}
  };
}

function getMemory(symbol) {
  if (!memory[symbol]) {
    memory[symbol] = { LONG: initStats(), SHORT: initStats() };
  }
  return memory[symbol];
}

async function updateMemoryFromResult(symbol, side, result, percent, confidence, meta = {}) {
  if (!memory[symbol]) memory[symbol] = { LONG: initStats(), SHORT: initStats() };

  const m = memory[symbol][side];
  m.trades++;
  if (result === 'win') m.wins++;
  if (result === 'loss') m.losses++;
  m.lastResult = result;
  m.lastDelta = percent;
  m.lastConfidence = confidence;
  m.currentStreak += result === 'win' ? 1 : -1;
  m.meta = meta;

  try {
    const saved = await getLearningMemory(symbol);
    const updated = {
      ...saved,
      [side]: { ...m }
    };
    await saveLearningMemory(symbol, updated);
  } catch (err) {
    console.warn(`[Memory Sync] Failed for ${symbol}/${side}: ${err.message}`);
  }
}

module.exports = {
  updateMemoryFromResult,
  getMemory
};