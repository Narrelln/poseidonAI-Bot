// handlers/learningMemory.js (SERVER)
// Source of truth for learning-memory storage (CommonJS).
// - Normalizes symbol keys (UPPERCASE, no hyphens) to match frontend
// - Safe load on boot, atomic writes on save
// - Rich updater stores token DNA (ATH/ATL + hits) and TA-derived stats
// Last Updated: 2025-08-11

const fs = require('fs');
const path = require('path');

const memoryPath = path.join(process.cwd(), 'data', 'learning-memory.json');
let memory = Object.create(null);

// ---------- utils ----------
function ensureFile() {
  const dir = path.dirname(memoryPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, '{}');
}
function normalizeSymbolKey(sym) {
  if (!sym) return '';
  // match frontend normalization: UPPERCASE and strip hyphens
  return String(sym).trim().toUpperCase().replace(/-/g, '');
}
function atomicWrite(stringified) {
  const tmp = memoryPath + '.tmp';
  fs.writeFileSync(tmp, stringified);
  fs.renameSync(tmp, memoryPath);
}
function writeDisk() {
  try {
    ensureFile();
    atomicWrite(JSON.stringify(memory, null, 2));
  } catch (err) {
    console.warn('⚠️ Failed to save learning memory:', err.message);
  }
}

// ---------- load/save ----------
function loadLearningMemory() {
  try {
    ensureFile();
    const raw = fs.readFileSync(memoryPath, 'utf-8') || '{}';
    const parsed = JSON.parse(raw);
    // normalize existing keys on load
    memory = Object.create(null);
    for (const [k, v] of Object.entries(parsed || {})) {
      memory[normalizeSymbolKey(k)] = v || {};
    }
    writeDisk(); // persist normalized keys (idempotent)
    console.log(`🧠 Learning memory loaded (${Object.keys(memory).length} keys)`);
  } catch (err) {
    console.warn('⚠️ Failed to load learning memory:', err.message);
    memory = Object.create(null);
  }
}
function saveMemoryToDisk() {
  writeDisk();
}

// ---------- CRUD ----------
function getFullMemory() {
  return memory;
}
function getLearningMemory(symbol) {
  return memory[normalizeSymbolKey(symbol)] || {};
}
function saveLearningMemory(symbol, data) {
  const key = normalizeSymbolKey(symbol);
  if (!key || !data || typeof data !== 'object') return;
  memory[key] = { ...(memory[key] || {}), ...data };
  writeDisk();
}
function overwriteMemory(newMemoryRaw) {
  const next = Object.create(null);
  for (const [k, v] of Object.entries(newMemoryRaw || {})) {
    next[normalizeSymbolKey(k)] = v || {};
  }
  memory = next;
  writeDisk();
}

/**
 * Rich updater: ingest a TA/decision `result` for `symbol` and update:
 *  - confidence history + avgConfidence
 *  - trapWarning, trapCount
 *  - momentum flags (rsiRising, macdRising)
 *  - watch metadata (reason, start time)
 *  - volatilityTag
 *  - token DNA (lastPrice, ATH/ATL + timestamps + hit counters)
 *
 * Expected fields (optional) in `result`:
 *  - confidence (number)
 *  - trapWarning (boolean)
 *  - rsiChange, macdChange (number deltas)
 *  - watchReason, watchStartTime (string/ISO)
 *  - volatilityTag (string)
 *  - price (number), ath/atl (number), athTime/atlTime (ISO)
 */
function updateMemoryFromResult(symbol, result) {
  if (
    !symbol ||
    typeof symbol !== 'string' ||
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result)
  ) {
    console.warn(`[Memory] Skipped update — invalid result for ${symbol}:`, result);
    return;
  }

  const key = normalizeSymbolKey(symbol);
  const prev = getLearningMemory(key);

  // --- trap stats ---
  const trapCount = (prev.trapCount || 0) + (result.trapWarning ? 1 : 0);

  // --- confidence history (keep last 10) ---
  const confidenceLog = (prev.confidenceLog || []).slice(-9);
  if (typeof result.confidence === 'number') confidenceLog.push(result.confidence);
  const avgConfidence = confidenceLog.length
    ? confidenceLog.reduce((a, b) => a + b, 0) / confidenceLog.length
    : null;

  // --- momentum + watch flags ---
  const momentum = {
    rsiRising: !!(result.rsiChange > 0),
    macdRising: !!(result.macdChange > 0),
  };
  const watchReason    = result.watchReason    ?? prev.watchReason    ?? null;
  const watchStartTime = result.watchStartTime ?? prev.watchStartTime ?? null;
  const volatilityTag  = result.volatilityTag  ?? prev.volatilityTag  ?? null;

  // --- token DNA: ATH/ATL + timestamps + hit counters ---
  const lastPrice = Number(result.price ?? prev.lastPrice ?? 0);

  let ath     = Number.isFinite(prev.ath) ? prev.ath : null;
  let atl     = Number.isFinite(prev.atl) ? prev.atl : null;
  let athTime = prev.athTime || null;
  let atlTime = prev.atlTime || null;
  let athHits = Number(prev.athHits || 0);
  let atlHits = Number(prev.atlHits || 0);

  // Prefer explicit ATH/ATL from TA result if present
  if (Number.isFinite(result.ath) && (ath === null || result.ath > ath)) {
    ath = result.ath;
    athTime = result.athTime || new Date().toISOString();
  }
  if (Number.isFinite(result.atl) && (atl === null || result.atl < atl)) {
    atl = result.atl;
    atlTime = result.atlTime || new Date().toISOString();
  }

  // If TA didn’t include extremes, extend using lastPrice
  if (Number.isFinite(lastPrice)) {
    if (ath === null || lastPrice > ath) { ath = lastPrice; athTime = new Date().toISOString(); }
    if (atl === null || lastPrice < atl) { atl = lastPrice; atlTime = new Date().toISOString(); }
  }

  // Count “touches” near extremes (±0.1%)
  if (Number.isFinite(lastPrice) && Number.isFinite(ath) && Math.abs(lastPrice - ath) / ath <= 0.001) athHits += 1;
  if (Number.isFinite(lastPrice) && Number.isFinite(atl) && Math.abs(lastPrice - atl) / Math.max(1e-9, atl) <= 0.001) atlHits += 1;

  const update = {
    // core scoring
    confidence: result.confidence ?? null,
    allocationPct: result.allocationPct ?? prev.allocationPct ?? null,
    trapWarning: !!result.trapWarning,
    trapCount,
    confidenceLog,
    avgConfidence,
    momentum,
    watchReason,
    watchStartTime,
    volatilityTag,

    // token DNA
    lastPrice: Number.isFinite(lastPrice) ? lastPrice : prev.lastPrice ?? null,
    ath, atl, athTime, atlTime,
    athHits, atlHits,

    lastUpdate: new Date().toISOString(),
  };

  saveLearningMemory(key, update);
}

module.exports = {
  loadLearningMemory,
  saveMemoryToDisk,
  getFullMemory,
  getLearningMemory,
  saveLearningMemory,
  overwriteMemory,
  updateMemoryFromResult,
};