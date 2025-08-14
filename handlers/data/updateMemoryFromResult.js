// handlers/updateMemoryFromResult.js

const axios = require('axios');

let memory = {};

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

const fs = require('fs');
const path = require('path');
const MEMORY_PATH = path.join(__dirname, '..', 'utils', 'data', 'poseidonMemory.json');

function getMemory(symbol) {
  if (!memory[symbol]) {
    // Attempt to load from disk
    try {
      const fileData = fs.readFileSync(MEMORY_PATH, 'utf8');
      const diskMemory = JSON.parse(fileData);
      if (diskMemory[symbol]) {
        memory[symbol] = diskMemory[symbol];
        console.log(`📥 Loaded ${symbol} from disk memory`);
      }
    } catch (e) {
      console.warn(`⚠️ Could not load ${symbol} from disk:`, e.message);
    }
  }

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

  console.log(`💾 Syncing memory for ${symbol} (${side}) → ${result} @ ${percent.toFixed(2)}%`);

  try {
    const res = await axios.post('http://localhost:3000/api/memory', {
      [symbol]: { [side]: m }
    });

    if (res?.data?.success) {
      console.log(`✅ Memory synced for ${symbol}`);
    } else {
      console.warn(`⚠️ Memory sync response invalid:`, res.data);
    }
  } catch (err) {
    console.warn(`❌ Memory sync failed for ${symbol}:`, err.message);
  }
}

module.exports = {
  updateMemoryFromResult,
  getMemory
};