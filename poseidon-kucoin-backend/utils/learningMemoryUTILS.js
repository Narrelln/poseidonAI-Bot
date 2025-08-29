/**
 * File #LM-01: utils/learningMemory.js
 *
 * Purpose:
 *   Durable read/write helper for Poseidon "learning-memory" store.
 *
 * What it fixes:
 *   1) CommonJS module format (aligns with server require()).
 *   2) Ensures data directory & file exist on first run.
 *   3) Safe JSON parsing (empty/corrupt file -> {}).
 *   4) Debounced, atomic-ish writes to reduce churn.
 *   5) Symbol keys normalized to UPPERCASE + trimmed.
 *
 * API:
 *   - loadLearningMemory(): void      // load from disk into memory
 *   - saveMemoryToDisk(): void        // force write memory -> disk
 *   - getFullMemory(): object
 *   - getLearningMemory(symbol): object
 *   - saveLearningMemory(symbol, data): void  // upsert/merge
 *
 * Last Updated: 2025-08-11
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'learning-memory.json');

let memory = {};
let writeTimer = null;
const WRITE_DELAY_MS = 200; // debounce a bit for bursts

// --- [1] FS helpers ---------------------------------------------------------
function ensureStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(MEMORY_FILE)) {
      fs.writeFileSync(MEMORY_FILE, '{}', 'utf-8');
    }
  } catch (err) {
    console.warn('⚠️ learningMemory.ensureStore failed:', err.message);
  }
}

function safeParseJSON(str) {
  if (!str || !str.trim()) return {};
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// --- [2] Key normalization ---------------------------------------------------
function normalizeKey(symbol) {
  if (!symbol) return '';
  return String(symbol).trim().toUpperCase();
}

// --- [3] Public functions ----------------------------------------------------
function loadLearningMemory() {
  ensureStore();
  try {
    const raw = fs.readFileSync(MEMORY_FILE, 'utf-8');
    memory = safeParseJSON(raw);
  } catch (err) {
    console.warn('⚠️ Failed to load learning memory:', err.message);
    memory = {};
  }
}

function flushWrite() {
  try {
    // Write to tmp then rename to be a bit safer
    const tmp = MEMORY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(memory, null, 2), 'utf-8');
    fs.renameSync(tmp, MEMORY_FILE);
  } catch (err) {
    console.warn('⚠️ Failed to save learning memory:', err.message);
  }
}

function saveMemoryToDisk() {
  // Debounce to avoid hammering the disk during bursts
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    flushWrite();
    writeTimer = null;
  }, WRITE_DELAY_MS);
}

function getFullMemory() {
  return memory;
}

function getLearningMemory(symbol) {
  const key = normalizeKey(symbol);
  return key ? (memory[key] || {}) : {};
}

function saveLearningMemory(symbol, data) {
  if (!symbol) return;
  const key = normalizeKey(symbol);
  const payload = data && typeof data === 'object' ? data : {};

  if (!memory[key] || typeof memory[key] !== 'object') {
    memory[key] = {};
  }
  // shallow merge
  memory[key] = { ...memory[key], ...payload, _updatedAt: new Date().toISOString() };
  saveMemoryToDisk();
}

// --- [4] Eager load on import ------------------------------------------------
loadLearningMemory();

// --- [5] Exports -------------------------------------------------------------
module.exports = {
  // IO
  loadLearningMemory,
  saveMemoryToDisk,

  // Accessors
  getFullMemory,
  getLearningMemory,
  saveLearningMemory,

  // (Optional) exports for debugging
  __MEMORY_FILE: MEMORY_FILE,
  __DATA_DIR: DATA_DIR
};