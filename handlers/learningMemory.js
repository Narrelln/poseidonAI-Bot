// handlers/learningMemory.js (SERVER)
// Source of truth for learning-memory storage (CommonJS).
// - Normalizes symbol keys (UPPERCASE, no hyphens) to match frontend
// - Safe load on boot, atomic writes on save
// - Token DNA: daily (24h) highs/lows + rolling 30d extremes (ath30/atl30)
// - SR levels from last 30d (swing points + clustering)
// - Backward compatible with previous API
// - NEW: per-symbol trace log (for correlate-by-traceId observability)
// Last Updated: 2025-08-23

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
function todayUTC(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : NaN; }

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
    // run a light migration to ensure new structure fields exist
    for (const key of Object.keys(memory)) {
      memory[key] = migrateShape(memory[key]);
    }
    writeDisk(); // persist normalized/migrated keys (idempotent)
    console.log(`🧠 Learning memory loaded (${Object.keys(memory).length} keys)`);
  } catch (err) {
    console.warn('⚠️ Failed to load learning memory:', err.message);
    memory = Object.create(null);
  }
}
function saveMemoryToDisk() { writeDisk(); }

// ---------- base CRUD (backward-compatible) ----------
function getFullMemory() { return memory; }
function getLearningMemory(symbol) { return memory[normalizeSymbolKey(symbol)] || {}; }
function saveLearningMemory(symbol, data) {
  const key = normalizeSymbolKey(symbol);
  if (!key || !data || typeof data !== 'object') return;
  const merged = { ...(memory[key] || {}), ...data };
  memory[key] = migrateShape(merged);
  writeDisk();
}
function overwriteMemory(newMemoryRaw) {
  const next = Object.create(null);
  for (const [k, v] of Object.entries(newMemoryRaw || {})) {
    next[normalizeSymbolKey(k)] = migrateShape(v || {});
  }
  memory = next;
  writeDisk();
}

// ---------- shape & migration ----------
function migrateShape(prevRaw) {
  const prev = prevRaw || {};
  const nowIso = new Date().toISOString();
  const today = todayUTC();

  // seed dna & windows
  const dna = prev.dna || {};
  const windows = prev.windows || {};
  const sr = prev.sr || {};

  // daily (UTC day bucket)
  const daily = {
    day: typeof (dna.day || windows.day) === 'string' ? (dna.day || windows.day) : today,
    todayHigh: num(dna.todayHigh ?? windows.todayHigh ?? prev.todayHigh ?? prev.ath) || null,
    todayLow:  num(dna.todayLow  ?? windows.todayLow  ?? prev.todayLow  ?? prev.atl) || null,
  };

  // 30d deque of { day, high, low }
  const deque = Array.isArray(windows.deque) ? windows.deque.slice(-30) : [];
  const cleaned = deque.filter(x =>
    x && typeof x.day === 'string' &&
    Number.isFinite(num(x.high)) &&
    Number.isFinite(num(x.low))
  ).slice(-30);

  // recompute ath30/atl30 from cleaned deque
  let ath30 = null, atl30 = null;
  for (const d of cleaned) {
    if (Number.isFinite(num(d.high))) ath30 = (ath30==null) ? num(d.high) : Math.max(ath30, num(d.high));
    // FIX: remove mistaken assignment inside Math.min; compute proper rolling min for atl30
    if (Number.isFinite(num(d.low)))  atl30 = (atl30==null) ? num(d.low)  : Math.min(atl30, num(d.low));
  }
  // additional pass (kept from your original) to ensure atl30 if previous loop had no valid lows
  if (atl30 == null) {
    for (const d of cleaned) {
      if (Number.isFinite(num(d.low))) atl30 = (atl30==null) ? num(d.low) : Math.min(atl30, num(d.low));
    }
  }

  // fallbacks from legacy (single ATH/ATL) if 30d not set
  const legacyATH = Number.isFinite(num(prev.ath)) ? num(prev.ath) : null;
  const legacyATL = Number.isFinite(num(prev.atl)) ? num(prev.atl) : null;
  if (ath30 == null && legacyATH != null) ath30 = legacyATH;
  if (atl30 == null && legacyATL != null) atl30 = legacyATL;

  // hit counters
  const athHits = Number(prev.athHits || 0);
  const atlHits = Number(prev.atlHits || 0);

  // levels (nearest + clustered)
  const levels = Array.isArray(sr.levels) ? sr.levels : [];
  const nearestSupport = Number.isFinite(num(sr.nearestSupport)) ? num(sr.nearestSupport) : null;
  const nearestResistance = Number.isFinite(num(sr.nearestResistance)) ? num(sr.nearestResistance) : null;

  // keep legacy fields (confidence, trap, etc.)
  const confidenceLog = Array.isArray(prev.confidenceLog) ? prev.confidenceLog.slice(-10) : [];
  const avgConfidence = confidenceLog.length
    ? confidenceLog.reduce((a,b)=>a+b,0)/confidenceLog.length
    : (Number.isFinite(num(prev.avgConfidence)) ? num(prev.avgConfidence) : null);

  // NEW: traces array (cap 20), normalize if present
  const traces = Array.isArray(prev.traces)
    ? prev.traces.slice(-20).map(t => ({
        traceId: String(t.traceId || '').slice(0,64) || null,
        source: t.source || null,
        phase: t.phase || null,
        side: t.side || null,
        confidence: Number.isFinite(num(t.confidence)) ? num(t.confidence) : null,
        price: Number.isFinite(num(t.price)) ? num(t.price) : null,
        time: t.time || nowIso
      }))
    : [];

  return {
    // core scoring (existing fields)
    confidence: Number.isFinite(num(prev.confidence)) ? num(prev.confidence) : prev.confidence ?? null,
    allocationPct: prev.allocationPct ?? null,
    trapWarning: !!prev.trapWarning,
    trapCount: Number(prev.trapCount || 0),
    confidenceLog,
    avgConfidence,
    momentum: prev.momentum || { rsiRising: false, macdRising: false },
    watchReason: prev.watchReason ?? null,
    watchStartTime: prev.watchStartTime ?? null,
    volatilityTag: prev.volatilityTag ?? null,

    // token DNA + windows
    lastPrice: Number.isFinite(num(prev.lastPrice)) ? num(prev.lastPrice) : null,
    dna: {
      day: daily.day,
      todayHigh: daily.todayHigh,
      todayLow: daily.todayLow,
      athHits,
      atlHits
    },
    windows: {
      deque: cleaned, // up to 30 entries [{day, high, low}]
      ath30,
      atl30
    },

    // SR section
    sr: {
      levels,
      nearestSupport,
      nearestResistance
    },

    // legacy mirrors (don’t break callers that read flat ath/atl)
    ath: Number.isFinite(num(prev.ath)) ? num(prev.ath) : (ath30 ?? null),
    atl: Number.isFinite(num(prev.atl)) ? num(prev.atl) : (atl30 ?? null),
    athTime: prev.athTime ?? null,
    atlTime: prev.atlTime ?? null,

    // NEW: traces
    traces,

    lastUpdate: prev.lastUpdate || nowIso
  };
}

// ---------- SR extraction (lightweight) ----------
function computeLevelsFromDeque(deque) {
  const highs = deque.map(d => num(d.high)).filter(Number.isFinite);
  const lows  = deque.map(d => num(d.low)).filter(Number.isFinite);
  const candidates = [...highs, ...lows].sort((a,b)=>a-b);
  if (!candidates.length) return [];

  const band = 0.005; // 0.5%
  const clusters = [];
  for (const p of candidates) {
    let placed = false;
    for (const c of clusters) {
      if (Math.abs(p - c.price)/c.price <= band) {
        c.sum += p; c.count += 1; c.price = c.sum / c.count;
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ price: p, sum: p, count: 1 });
  }
  return clusters
    .map(c => ({ price: +c.price.toFixed(8), hitCount: c.count }))
    .sort((a,b) => b.hitCount - a.hitCount);
}

// ---------- nearest SR from clustered levels (strict split around price) ----------
function nearestLevels(levels, price) {
  if (!Array.isArray(levels) || !levels.length || !Number.isFinite(price)) {
    return { support: null, resistance: null };
  }
  const eps = 1e-9;

  // Sort unique numeric levels by price
  const arr = levels
    .map(l => num(l.price))
    .filter(Number.isFinite)
    .sort((a,b) => a - b);

  let support = null;
  let resistance = null;

  // last level <= price (+eps) becomes support; first level > price (+eps) becomes resistance
  for (const p of arr) {
    if (p <= price + eps) support = p;
    if (p >  price + eps) { resistance = p; break; }
  }

  // guarantee resistance is strictly above price; never equal to support
  if (resistance !== null && resistance <= price + eps) resistance = null;

  return { support, resistance };
}

// ---------- daily/30d roll maintenance ----------
function ensureDayRolled(rec, ts = Date.now()) {
  const day = todayUTC(ts);
  if (!rec.dna) rec.dna = { day, todayHigh: null, todayLow: null, athHits: 0, atlHits: 0 };
  if (!rec.windows) rec.windows = { deque: [], ath30: null, atl30: null };

  if (rec.dna.day !== day) {
    if (Number.isFinite(num(rec.dna.todayHigh)) || Number.isFinite(num(rec.dna.todayLow))) {
      const prevDay = rec.dna.day;
      const prevHigh = Number.isFinite(num(rec.dna.todayHigh)) ? num(rec.dna.todayHigh) : null;
      const prevLow  = Number.isFinite(num(rec.dna.todayLow))  ? num(rec.dna.todayLow)  : null;

      const idx = rec.windows.deque.findIndex(d => d.day === prevDay);
      const entry = { day: prevDay, high: prevHigh ?? prevLow, low: prevLow ?? prevHigh };
      if (idx >= 0) rec.windows.deque[idx] = entry;
      else rec.windows.deque.push(entry);

      if (rec.windows.deque.length > 30) rec.windows.deque = rec.windows.deque.slice(-30);
    }

    rec.dna.day = day;
    rec.dna.todayHigh = null;
    rec.dna.todayLow = null;

    let aH = null, aL = null;
    for (const d of rec.windows.deque) {
      if (Number.isFinite(num(d.high))) aH = (aH==null) ? num(d.high) : Math.max(aH, num(d.high));
      if (Number.isFinite(num(d.low)))  aL = (aL==null) ? num(d.low)  : Math.min(aL, num(d.low));
    }
    rec.windows.ath30 = aH;
    rec.windows.atl30 = aL;
  }
}

function bumpHitsNearExtremes(rec, price) {
  if (!Number.isFinite(price)) return;
  if (Number.isFinite(num(rec.ath)) && Math.abs(price - num(rec.ath))/Math.max(1e-9, num(rec.ath)) <= 0.001) {
    rec.dna.athHits = (rec.dna.athHits || 0) + 1;
  }
  if (Number.isFinite(num(rec.atl)) && Math.abs(price - num(rec.atl))/Math.max(1e-9, num(rec.atl)) <= 0.001) {
    rec.dna.atlHits = (rec.dna.atlHits || 0) + 1;
  }
  if (Number.isFinite(num(rec.windows?.ath30)) && Math.abs(price - num(rec.windows.ath30))/Math.max(1e-9, num(rec.windows.ath30)) <= 0.001) {
    rec.dna.athHits = (rec.dna.athHits || 0) + 1;
  }
  if (Number.isFinite(num(rec.windows?.atl30)) && Math.abs(price - num(rec.windows.atl30))/Math.max(1e-9, num(rec.windows.atl30)) <= 0.001) {
    rec.dna.atlHits = (rec.dna.atlHits || 0) + 1;
  }
}

// ---------- public: streaming tick updater ----------
function updateWithTick(symbol, price, ts = Date.now()) {
  const key = normalizeSymbolKey(symbol);
  if (!key || !Number.isFinite(num(price))) return;

  const rec = migrateShape(memory[key] || {});
  ensureDayRolled(rec, ts);

  const p = num(price);

  if (!Number.isFinite(num(rec.dna.todayHigh)) || p > num(rec.dna.todayHigh)) {
    rec.dna.todayHigh = p;
    rec.athTime = new Date(ts).toISOString();
  }
  if (!Number.isFinite(num(rec.dna.todayLow)) || p < num(rec.dna.todayLow)) {
    rec.dna.todayLow = p;
    rec.atlTime = new Date(ts).toISOString();
  }

  if (!Number.isFinite(num(rec.ath)) || p > num(rec.ath)) rec.ath = p;
  if (!Number.isFinite(num(rec.atl)) || p < num(rec.atl)) rec.atl = p;

  let aH = rec.windows.ath30, aL = rec.windows.atl30;
  if (Number.isFinite(num(rec.dna.todayHigh))) {
    aH = (aH==null) ? num(rec.dna.todayHigh) : Math.max(aH, num(rec.dna.todayHigh));
  }
  if (Number.isFinite(num(rec.dna.todayLow))) {
    aL = (aL==null) ? num(rec.dna.todayLow) : Math.min(aL, num(rec.dna.todayLow));
  }
  rec.windows.ath30 = aH;
  rec.windows.atl30 = aL;

  const tempDeque = rec.windows.deque.slice();
  const todayEntry = {
    day: rec.dna.day,
    high: Number.isFinite(num(rec.dna.todayHigh)) ? num(rec.dna.todayHigh) : null,
    low:  Number.isFinite(num(rec.dna.todayLow))  ? num(rec.dna.todayLow)  : null,
  };
  if (todayEntry.high != null || todayEntry.low != null) {
    const i = tempDeque.findIndex(d => d.day === rec.dna.day);
    if (i>=0) tempDeque[i] = todayEntry; else tempDeque.push(todayEntry);
  }
  const levels = computeLevelsFromDeque(tempDeque);
  const { support, resistance } = nearestLevels(levels, p);
  rec.sr.levels = levels;
  rec.sr.nearestSupport = support;
  rec.sr.nearestResistance = resistance;

  rec.lastPrice = p;
  bumpHitsNearExtremes(rec, p);
  rec.lastUpdate = new Date(ts).toISOString();

  memory[key] = rec;
  writeDisk();
}

// ---------- public: batch ingest from klines ----------
function upsertFromKlines(symbol, klines = []) {
  const key = normalizeSymbolKey(symbol);
  if (!key || !Array.isArray(klines) || klines.length === 0) return;

  const rec = migrateShape(memory[key] || {});
  const mapByDay = new Map();

  for (const k of klines) {
    const ts = Number(k.openTime ?? k.t ?? k[0]);
    const hi = num(k.high ?? k.h ?? k[2]);
    const lo = num(k.low  ?? k.l ?? k[3]);
    if (!Number.isFinite(ts)) continue;
    const day = todayUTC(ts);
    const cur = mapByDay.get(day) || { high: null, low: null };
    if (Number.isFinite(hi)) cur.high = (cur.high==null) ? hi : Math.max(cur.high, hi);
    if (Number.isFinite(lo)) cur.low  = (cur.low==null)  ? lo : Math.min(cur.low, lo);
    mapByDay.set(day, cur);
  }

  const entries = Array.from(mapByDay.entries())
    .map(([day, {high, low}]) => ({ day, high, low }))
    .sort((a,b) => a.day.localeCompare(b.day))
    .slice(-30);

  const byDay = new Map((rec.windows.deque || []).map(d => [d.day, d]));
  for (const e of entries) byDay.set(e.day, e);
  let deque = Array.from(byDay.values()).sort((a,b)=> a.day.localeCompare(b.day)).slice(-30);

  const tday = todayUTC();
  const todayIdx = entries.findIndex(e => e.day === tday);
  if (todayIdx >= 0) {
    rec.dna.day = tday;
    rec.dna.todayHigh = entries[todayIdx].high ?? rec.dna.todayHigh ?? null;
    rec.dna.todayLow  = entries[todayIdx].low  ?? rec.dna.todayLow  ?? null;
  }

  rec.windows.deque = deque;

  let aH = null, aL = null;
  for (const d of deque) {
    if (Number.isFinite(num(d.high))) aH = (aH==null) ? num(d.high) : Math.max(aH, num(d.high));
    if (Number.isFinite(num(d.low)))  aL = (aL==null) ? num(d.low)  : Math.min(aL, num(d.low));
  }
  rec.windows.ath30 = aH;
  rec.windows.atl30 = aL;

  const levels = computeLevelsFromDeque(deque);
  rec.sr.levels = levels;
  if (Number.isFinite(num(rec.lastPrice))) {
    const near = nearestLevels(levels, num(rec.lastPrice));
    rec.sr.nearestSupport = near.support;
    rec.sr.nearestResistance = near.resistance;
  }

  rec.lastUpdate = new Date().toISOString();
  memory[key] = rec;
  writeDisk();
}

// ---------- compact snapshot for decision engines ----------
function getDecisionSnapshot(symbol) {
  const key = normalizeSymbolKey(symbol);
  const rec = memory[key];
  if (!rec) return null;

  return {
    lastPrice: Number.isFinite(num(rec.lastPrice)) ? num(rec.lastPrice) : null,
    // 24h guide
    todayHigh: Number.isFinite(num(rec.dna?.todayHigh)) ? num(rec.dna.todayHigh) : null,
    todayLow:  Number.isFinite(num(rec.dna?.todayLow))  ? num(rec.dna.todayLow)  : null,
    // 30d rails
    ath30: Number.isFinite(num(rec.windows?.ath30)) ? num(rec.windows.ath30) : null,
    atl30: Number.isFinite(num(rec.windows?.atl30)) ? num(rec.windows.atl30) : null,
    // nearest SR (from clustered levels)
    nearestSupport: Number.isFinite(num(rec.sr?.nearestSupport)) ? num(rec.sr.nearestSupport) : null,
    nearestResistance: Number.isFinite(num(rec.sr?.nearestResistance)) ? num(rec.sr.nearestResistance) : null,
    // confidence flavor
    avgConfidence: Number.isFinite(num(rec.avgConfidence)) ? num(rec.avgConfidence) : null,
    trapCount: Number(rec.trapCount || 0),
    updatedAt: rec.lastUpdate || null
  };
}

/**
 * Rich updater: ingest a TA/decision `result` for `symbol` and update:
 *  - confidence history + avgConfidence
 *  - trapWarning, trapCount
 *  - momentum flags (rsiRising, macdRising)
 *  - watch metadata (reason, start time)
 *  - volatilityTag
 *  - token DNA (lastPrice, todayHigh/todayLow, 30d ath/atl via deque)
 *  - NEW: append trace entry when result.traceId exists
 *
 * Expected fields (optional) in `result`:
 *  - confidence (number)
 *  - trapWarning (boolean)
 *  - rsiChange, macdChange (number deltas)
 *  - watchReason, watchStartTime (string/ISO)
 *  - volatilityTag (string)
 *  - price (number), ath/atl (number), athTime/atlTime (ISO)
 *  - NEW: traceId (string), source ('REVERSAL_WATCHER'|'CYCLE_WATCHER'|...), phase, side
 */
function updateMemoryFromResult(symbol, result) {
  if (!symbol || typeof symbol !== 'string' || !result || typeof result !== 'object' || Array.isArray(result)) {
    console.warn(`[Memory] Skipped update — invalid result for ${symbol}:`, result);
    return;
  }
  const key = normalizeSymbolKey(symbol);
  const rec0 = migrateShape(memory[key] || {});
  const rec = rec0; // mutate then persist

  const lastPrice = num(result.price ?? rec.lastPrice);
  const ts = Date.now();
  ensureDayRolled(rec, ts);

  // --- trap stats ---
  rec.trapWarning = !!result.trapWarning;
  rec.trapCount = Number(rec.trapCount || 0) + (result.trapWarning ? 1 : 0);

  // --- confidence history (keep last 10) ---
  const log = Array.isArray(rec.confidenceLog) ? rec.confidenceLog.slice(-9) : [];
  if (typeof result.confidence === 'number') log.push(result.confidence);
  rec.confidenceLog = log;
  rec.avgConfidence = log.length ? log.reduce((a,b)=>a+b,0) / log.length : rec.avgConfidence ?? null;
  rec.confidence = typeof result.confidence === 'number' ? result.confidence : (rec.confidence ?? null);

  // --- momentum + watch flags ---
  rec.momentum = {
    rsiRising: !!(result.rsiChange > 0),
    macdRising: !!(result.macdChange > 0),
  };
  rec.watchReason    = result.watchReason    ?? rec.watchReason ?? null;
  rec.watchStartTime = result.watchStartTime ?? rec.watchStartTime ?? null;
  rec.volatilityTag  = result.volatilityTag  ?? rec.volatilityTag ?? null;

  // --- price & daily highs/lows ---
  if (Number.isFinite(lastPrice)) {
    if (!Number.isFinite(num(rec.dna.todayHigh)) || lastPrice > num(rec.dna.todayHigh)) {
      rec.dna.todayHigh = lastPrice;
      rec.athTime = result.athTime || new Date(ts).toISOString();
    }
    if (!Number.isFinite(num(rec.dna.todayLow)) || lastPrice < num(rec.dna.todayLow)) {
      rec.dna.todayLow = lastPrice;
      rec.atlTime = result.atlTime || new Date(ts).toISOString();
    }
    if (!Number.isFinite(num(rec.ath)) || lastPrice > num(rec.ath)) rec.ath = lastPrice;
    if (!Number.isFinite(num(rec.atl)) || lastPrice < num(rec.atl)) rec.atl = lastPrice;
    rec.lastPrice = lastPrice;
  }

  // Explicit ATH/ATL overrides
  if (Number.isFinite(num(result.ath)) && (!Number.isFinite(num(rec.ath)) || num(result.ath) > num(rec.ath))) {
    rec.ath = num(result.ath);
    rec.athTime = result.athTime || new Date(ts).toISOString();
  }
  if (Number.isFinite(num(result.atl)) && (!Number.isFinite(num(rec.atl)) || num(result.atl) < num(rec.atl))) {
    rec.atl = num(result.atl);
    rec.atlTime = result.atlTime || new Date(ts).toISOString();
  }

  // 30d recompute with temp-including today
  const tempDeque = rec.windows.deque.slice();
  const todayEntry = {
    day: rec.dna.day,
    high: Number.isFinite(num(rec.dna.todayHigh)) ? num(rec.dna.todayHigh) : null,
    low:  Number.isFinite(num(rec.dna.todayLow))  ? num(rec.dna.todayLow)  : null,
  };
  const i = tempDeque.findIndex(d => d.day === rec.dna.day);
  if (i>=0) tempDeque[i] = todayEntry; else tempDeque.push(todayEntry);
  const trimmed = tempDeque.filter(d => d && (d.high!=null || d.low!=null)).slice(-30);
  let aH = null, aL = null;
  for (const d of trimmed) {
    if (Number.isFinite(num(d.high))) aH = (aH==null) ? num(d.high) : Math.max(aH, num(d.high));
    if (Number.isFinite(num(d.low)))  aL = (aL==null) ? num(d.low)  : Math.min(aL, num(d.low));
  }
  rec.windows.ath30 = aH;
  rec.windows.atl30 = aL;

  // SR levels + nearest
  const levels = computeLevelsFromDeque(trimmed);
  rec.sr.levels = levels;
  if (Number.isFinite(num(rec.lastPrice))) {
    const { support, resistance } = nearestLevels(levels, num(rec.lastPrice));
    rec.sr.nearestSupport = support;
    rec.sr.nearestResistance = resistance;
  }

  // touches
  if (Number.isFinite(num(rec.lastPrice))) bumpHitsNearExtremes(rec, num(rec.lastPrice));

  // --- NEW: trace capture ---
  if (result.traceId) {
    const entry = {
      traceId: String(result.traceId).slice(0,64),
      source: result.source || null,
      phase: result.phase || null,
      side: result.side || (typeof result.sideHint === 'string' ? result.sideHint.toUpperCase() : null),
      confidence: Number.isFinite(num(result.confidence)) ? num(result.confidence) : null,
      price: Number.isFinite(num(lastPrice)) ? lastPrice : null,
      time: new Date(ts).toISOString()
    };
    // de-dup by traceId
    const prev = Array.isArray(rec.traces) ? rec.traces.filter(t => t && t.traceId !== entry.traceId) : [];
    rec.traces = [...prev, entry].slice(-20);
  }

  rec.lastUpdate = new Date(ts).toISOString();

  memory[key] = rec;
  writeDisk();
}

// ---------- Trace utilities (NEW) ----------
/**
 * recordDecisionTrace(symbol, { traceId, source, phase, side, confidence, price, time? })
 * Allows callers (e.g., decisionHelper) to log a trace without full result payload.
 */
function recordDecisionTrace(symbol, meta = {}) {
  const key = normalizeSymbolKey(symbol);
  if (!key || !meta || !meta.traceId) return;
  const rec = migrateShape(memory[key] || {});
  const tsIso = meta.time || new Date().toISOString();
  const entry = {
    traceId: String(meta.traceId).slice(0,64),
    source: meta.source || null,
    phase: meta.phase || null,
    side: meta.side || null,
    confidence: Number.isFinite(num(meta.confidence)) ? num(meta.confidence) : null,
    price: Number.isFinite(num(meta.price)) ? num(meta.price) : null,
    time: tsIso
  };
  const prev = Array.isArray(rec.traces) ? rec.traces.filter(t => t && t.traceId !== entry.traceId) : [];
  rec.traces = [...prev, entry].slice(-20);
  rec.lastUpdate = tsIso;
  memory[key] = rec;
  writeDisk();
}

/**
 * getRecentTraces(symbol, n=10)
 */
function getRecentTraces(symbol, n = 10) {
  const key = normalizeSymbolKey(symbol);
  const rec = memory[key];
  if (!rec || !Array.isArray(rec.traces)) return [];
  const k = Math.max(1, Math.min(20, Number(n) || 10));
  return rec.traces.slice(-k);
}

module.exports = {
  // lifecycle
  loadLearningMemory,
  saveMemoryToDisk,
  // CRUD
  getFullMemory,
  getLearningMemory,
  saveLearningMemory,
  overwriteMemory,
  // rich updaters
  updateMemoryFromResult,
  updateWithTick,
  upsertFromKlines,
  // consumers
  getDecisionSnapshot,
  // NEW trace helpers
  recordDecisionTrace,
  getRecentTraces,
};