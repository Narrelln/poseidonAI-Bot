/* eslint-disable no-console */

const MAX_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// In-mem tape: SYMBOL -> [{ t, p }] (t ascending)
const TAPE = new Map();

// Guard per-symbol max samples to keep memory bounded
const MAX_SAMPLES_PER_SYMBOL = 12_000;

// Default horizons used by cycle watcher confidence
const DEFAULT_HORIZONS = ['12h','24h','36h','48h','7d','14d','30d'];

// ---------- utils ----------
function norm(sym = '') {
  // Keep consistency with the rest of the app: UPPER + no hyphens, use BTC not XBT for spot form
  let s = String(sym).trim().toUpperCase().replace(/-/g, '');
  if (s.endsWith('USDTM')) s = s.slice(0, -1); // BTCUSDTM -> BTCUSDT
  if (!s.endsWith('USDT')) s = s + 'USDT';
  if (s === 'XBTUSDT') s = 'BTCUSDT';
  return s;
}
function toMs(h) {
  if (typeof h !== 'string') return 0;
  if (h.endsWith('h')) return Number(h.slice(0, -1)) * 60 * 60 * 1000;
  if (h.endsWith('d')) return Number(h.slice(0, -1)) * 24 * 60 * 60 * 1000;
  return 0;
}

// ---------- write path ----------
function pushTick(symbol, price, now = Date.now()) {
  if (!(price > 0)) return;
  const key = norm(symbol);
  const arr = TAPE.get(key) || [];
  arr.push({ t: now, p: Number(price) });

  // prune old (>30d) from the head
  const cutoff = now - MAX_DAYS_MS;
  while (arr.length && arr[0].t < cutoff) arr.shift();

  // cap length
  if (arr.length > MAX_SAMPLES_PER_SYMBOL) {
    arr.splice(0, arr.length - MAX_SAMPLES_PER_SYMBOL);
  }

  TAPE.set(key, arr);
}

/**
 * Optional: bulk seed ticks (e.g., from klines downsample)
 * ticks: [{ t: timestamp_ms, p: price_number }, ...] — not required sorted; we will sort/merge.
 */
function seedTicks(symbol, ticks = []) {
  const key = norm(symbol);
  if (!Array.isArray(ticks) || !ticks.length) return;

  // Keep only valid numeric ticks
  const cleaned = ticks
    .map(x => ({ t: Number(x.t ?? x.openTime ?? x.time ?? x[0]), p: Number(x.p ?? x.close ?? x.price ?? x[4]) }))
    .filter(x => Number.isFinite(x.t) && x.t > 0 && Number.isFinite(x.p) && x.p > 0)
    .sort((a,b) => a.t - b.t);

  const base = TAPE.get(key) || [];
  const merged = [...base, ...cleaned].sort((a,b) => a.t - b.t);

  // Deduplicate on time (keep last for same timestamp)
  const uniq = [];
  for (let i = 0; i < merged.length; i++) {
    const cur = merged[i];
    if (!uniq.length || uniq[uniq.length - 1].t !== cur.t) uniq.push(cur);
    else uniq[uniq.length - 1] = cur;
  }

  // Prune to window + cap
  const now = Date.now();
  const cutoff = now - MAX_DAYS_MS;
  const kept = uniq.filter(x => x.t >= cutoff);
  const start = Math.max(0, kept.length - MAX_SAMPLES_PER_SYMBOL);
  TAPE.set(key, kept.slice(start));
}

// ---------- read path ----------
/**
 * O(N_horizon) backward scan. We iterate from the end until cutoff.
 */
function computeExtrema(symbol, horizons = DEFAULT_HORIZONS, now = Date.now()) {
  const key = norm(symbol);
  const arr = TAPE.get(key) || [];
  const out = {};
  if (!arr.length) {
    for (const h of horizons) out[h] = { atl: null, ath: null, n: 0 };
    return out;
  }

  for (const h of horizons) {
    const win = toMs(h);
    const cutoff = now - win;
    let lo = +Infinity;
    let hi = -Infinity;
    let n = 0;

    // Walk backward until we cross cutoff
    for (let i = arr.length - 1; i >= 0; i--) {
      const { t, p } = arr[i];
      if (t < cutoff) break;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
      n++;
    }

    out[h] = {
      atl: Number.isFinite(lo) ? lo : null,
      ath: Number.isFinite(hi) ? hi : null,
      n
    };
  }
  return out;
}

function getSnapshot(symbol, now = Date.now()) {
  return {
    now,
    rails: computeExtrema(symbol, DEFAULT_HORIZONS, now)
  };
}

/**
 * Optional: debug helper — dump rails for every symbol we’re tracking.
 */
function getSnapshotAll(now = Date.now(), horizons = DEFAULT_HORIZONS) {
  const obj = {};
  for (const key of TAPE.keys()) {
    obj[key] = { now, rails: computeExtrema(key, horizons, now) };
  }
  return obj;
}

/**
 * NEW: Hydrate the in-memory tape from Mongo LearningMemory for a list of symbols.
 * If `symbols` is falsy or empty, hydrates ALL docs (bounded slice).
 */
async function hydrateFromDb(symbols = null) {
  try {
    const LearningMemory = require('../models/LearningMemory');
    const q = symbols && symbols.length
      ? { symbol: { $in: symbols.map(norm) } }
      : {};

    // last 5k ticks per symbol is plenty to compute 12h–30d rails
    const docs = await LearningMemory.find(q)
      .select({ symbol: 1, ticks: { $slice: -5000 }, rails: 1 })
      .lean();

    let seeded = 0;
    for (const d of docs) {
      if (Array.isArray(d.ticks) && d.ticks.length) {
        seedTicks(d.symbol, d.ticks);
        seeded++;
        continue;
      }
      // Fallback: if no ticks but lastPrice exists, seed a single point so snapshot isn’t empty
      const last = Number(d?.rails?.lastPrice);
      if (last > 0) {
        seedTicks(d.symbol, [{ t: Date.now(), p: last }]);
        seeded++;
      }
    }
    if (seeded) console.log(`🌱 extremaRails: hydrated tape for ${seeded} symbol(s) from Mongo`);
    return { ok: true, seeded };
  } catch (e) {
    console.warn('⚠️ hydrateFromDb failed:', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

module.exports = {
  pushTick,
  computeExtrema,
  getSnapshot,
  // optional helpers
  seedTicks,
  getSnapshotAll,
  DEFAULT_HORIZONS,
  hydrateFromDb,       // ✅ NEW EXPORT
};