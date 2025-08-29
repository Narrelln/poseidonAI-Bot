// handlers/data/updateMemoryFromResult.js
// Local, atomic, disk-backed trade outcome memory (per symbol & side).
// API: getMemory(symbol), updateMemoryFromResult(symbol, side, result, percent, confidence, meta)

const fs = require('fs');
const path = require('path');

const MEMORY_PATH = path.join(process.cwd(), 'data', 'poseidonMemory.json');

// ---------- utils ----------
function ensureFile() {
  const dir = path.dirname(MEMORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(MEMORY_PATH)) fs.writeFileSync(MEMORY_PATH, '{}');
}
function atomicWrite(obj) {
  try {
    ensureFile();
    const tmp = MEMORY_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, MEMORY_PATH);
  } catch (e) {
    console.warn('⚠️ poseidonMemory save failed:', e.message);
  }
}
function loadDisk() {
  try {
    ensureFile();
    const raw = fs.readFileSync(MEMORY_PATH, 'utf8') || '{}';
    return JSON.parse(raw);
  } catch (e) {
    console.warn('⚠️ poseidonMemory load failed:', e.message);
    return {};
  }
}
function normalizeKey(sym) {
  return String(sym || '').trim().toUpperCase().replace(/-/g, '');
}
function normSide(side) {
  const s = String(side || '').toUpperCase();
  if (s === 'BUY' || s === 'LONG') return 'LONG';
  if (s === 'SELL' || s === 'SHORT') return 'SHORT';
  return 'LONG';
}
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

// ---------- state ----------
let memory = loadDisk();

// ---------- API ----------
function getMemory(symbol) {
  const key = normalizeKey(symbol);
  if (!memory[key]) {
    memory[key] = { LONG: initStats(), SHORT: initStats() };
    atomicWrite(memory);
  }
  return memory[key];
}

async function updateMemoryFromResult(symbol, side, result, percent, confidence, meta = {}) {
  const key = normalizeKey(symbol);
  const s = normSide(side);
  if (!memory[key]) memory[key] = { LONG: initStats(), SHORT: initStats() };

  const m = memory[key][s];

  m.trades += 1;
  if (result === 'win') m.wins += 1;
  if (result === 'loss') m.losses += 1;
  m.lastResult = result;
  m.lastDelta = Number(percent) || 0;
  m.lastConfidence = Number(confidence) || 0;
  m.currentStreak += result === 'win' ? 1 : -1;
  m.meta = meta || {};

  console.log(`💾 Memory: ${key} [${s}] → ${result} @ ${(Number(percent) || 0).toFixed(2)}% (C:${m.lastConfidence})`);
  atomicWrite(memory);
}

module.exports = {
  getMemory,
  updateMemoryFromResult,
};