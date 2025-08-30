// handlers/data/tokenPatternMemory.js
// DB-backed + cache-first token behavior profiles
// - getPattern(symbol) is sync (returns cached/derived immediately)
// - background read-through fetch hydrates cache without blocking callers
// - merge order: DB → overrides → defaults
//
// Fields respected downstream (examples):
//   needsVolume (USDT), requiresHighRSI (bool), fastTP (bool), whitelisted (bool)
//   tags: string[], notes: string
//   NEW: classTag ('MAJOR'|'MEME'|'NON_MAJOR'|'UNKNOWN'), volatilityTag (string), lastVolScore (number)
//
// Last Updated: 2025-08-23

const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGO_DB || 'poseidon';
const collectionName = process.env.MONGO_TOKEN_PATTERNS || 'tokenPatterns';

// ---------- normalization helpers ----------
function up(s) { return String(s || '').toUpperCase(); }
function normKey(sym) {
  // "BTC", "BTCUSDT", "BTC-USDTM" -> "BTCUSDTM" (contract-style, no hyphen)
  let s = up(sym).replace(/[-_]/g, '');
  if (s.endsWith('USDTM')) return s;         // already futures
  if (s.endsWith('USDT')) return s + 'M';    // spot -> futures
  // bare base -> assume USDTM
  return s + 'USDTM';
}
function baseOf(sym) {
  return up(sym).replace(/[-_]/g, '').replace(/USDTM?$/, '');
}

// ---------- Mongo wiring (singleton) ----------
let mongoClient;
let collection;

async function connectDB() {
  if (collection) return collection;
  mongoClient = new MongoClient(uri, { maxPoolSize: 5 });
  await mongoClient.connect();
  const db = mongoClient.db(dbName);
  collection = db.collection(collectionName);

  // minimal index (not unique to allow symbol variants, we normalize in code)
  try { await collection.createIndex({ symbol: 1 }, { name: 'symbol_idx' }); } catch {}
  return collection;
}

// ---------- in-memory cache ----------
const cache = new Map(); // key = "BTCUSDTM" (no hyphen), value = profile obj
const lastFetchAt = new Map();

const CACHE_TTL_MS = 5 * 60 * 1000; // soft TTL for background refreshes

const DEFAULT_PROFILE = {
  needsVolume: 100_000,
  requiresHighRSI: false,
  fastTP: false,
  whitelisted: false,
  tags: [],
  // NEW fields (safe defaults)
  classTag: 'UNKNOWN',        // 'MAJOR' | 'MEME' | 'NON_MAJOR' | 'UNKNOWN'
  volatilityTag: null,        // free-form label, e.g. 'HIGH_24H'
  lastVolScore: null          // optional numeric score used by classifier
};

// Static overrides (quick opinions)
const overrides = {
  TRUMPUSDTM: { fastTP: true, whitelisted: true, classTag: 'MEME' },
  DOGEUSDTM:  { needsVolume: 5_000_000, requiresHighRSI: true, whitelisted: true, classTag: 'MEME' },
  PEPEUSDTM:  { needsVolume: 3_000_000, whitelisted: true, classTag: 'MEME' },
  AIDOGEUSDTM:{ needsVolume: 2_000_000, fastTP: true, classTag: 'MEME' },
  GROKUSDTM:  { requiresHighRSI: true },

  // A few majors for convenience (non-exhaustive; DB can override)
  BTCUSDTM:   { whitelisted: true, classTag: 'MAJOR' },
  XBTUSDTM:   { whitelisted: true, classTag: 'MAJOR' },
  ETHUSDTM:   { whitelisted: true, classTag: 'MAJOR' },
  SOLUSDTM:   { whitelisted: true, classTag: 'MAJOR' },
  BNBUSDTM:   { whitelisted: true, classTag: 'MAJOR' },
};

// ---------- merge util ----------
function mergeProfiles(dbRow, override, fallback = DEFAULT_PROFILE) {
  // dbRow is what you store in Mongo: { symbol, needsVolume, requiresHighRSI, fastTP, whitelisted, ... }
  // New keys (classTag, volatilityTag, lastVolScore) merge the same way.
  return {
    ...fallback,
    ...(override || {}),
    ...(dbRow || {}),
  };
}

// ---------- async fetcher (non-blocking) ----------
async function hydrateFromDB(key) {
  try {
    const col = await connectDB();
    // we accept either normalized key w/o hyphen or with hyphen in DB; match generously
    const regex = new RegExp(`^${baseOf(key)}(-)?USDTM$`, 'i');
    const row = await col.findOne({ symbol: { $regex: regex } });
    const merged = mergeProfiles(row, overrides[key]);
    cache.set(key, merged);
    lastFetchAt.set(key, Date.now());
    return merged;
  } catch (e) {
    // keep whatever is in cache/fallback
    const merged = cache.get(key) || mergeProfiles(null, overrides[key]);
    cache.set(key, merged);
    return merged;
  }
}

// ---------- public API ----------

/**
 * Sync profile getter (cache-first). If cache is cold, returns
 * overrides+defaults immediately and kicks off a background fetch.
 */
function getPattern(symbol) {
  const key = normKey(symbol);
  const now = Date.now();
  const cached = cache.get(key);

  if (cached) {
    // soft refresh if stale
    if ((now - (lastFetchAt.get(key) || 0)) > CACHE_TTL_MS) {
      hydrateFromDB(key); // fire-and-forget
    }
    return cached;
  }

  // no cache: return override+defaults immediately, prime cache async
  const immediate = mergeProfiles(null, overrides[key]);
  cache.set(key, immediate);
  lastFetchAt.set(key, 0); // mark as stale
  hydrateFromDB(key); // fire-and-forget
  return immediate;
}

/**
 * Force refresh certain symbols (e.g., active list from scanner)
 */
async function primePatterns(symbols = []) {
  const uniq = [...new Set(symbols.map(normKey))];
  await Promise.all(uniq.map(hydrateFromDB));
  return uniq.length;
}

/**
 * Flag/unflag whitelist quickly (persists to DB and cache).
 */
async function setWhitelist(symbol, on = true) {
  const key = normKey(symbol);
  const col = await connectDB();
  await col.updateOne(
    { symbol: key },
    { $set: { symbol: key, whitelisted: !!on, lastUpdated: new Date() } },
    { upsert: true }
  );
  // update cache immediately
  const current = cache.get(key) || mergeProfiles(null, overrides[key]);
  cache.set(key, { ...current, whitelisted: !!on });
  lastFetchAt.set(key, Date.now());
  return cache.get(key);
}

/**
 * NEW: Set classTag (e.g., 'MAJOR' | 'MEME' | 'NON_MAJOR' | 'UNKNOWN')
 */
async function setClassTag(symbol, tag = 'UNKNOWN') {
  const key = normKey(symbol);
  const col = await connectDB();
  await col.updateOne(
    { symbol: key },
    { $set: { symbol: key, classTag: String(tag || 'UNKNOWN').toUpperCase(), lastUpdated: new Date() } },
    { upsert: true }
  );
  const current = cache.get(key) || mergeProfiles(null, overrides[key]);
  cache.set(key, { ...current, classTag: String(tag || 'UNKNOWN').toUpperCase() });
  lastFetchAt.set(key, Date.now());
  return cache.get(key);
}

/**
 * NEW: Set volatility info (tag + optional score from your classifier)
 * Example: setVolatility('JASMY', { tag: 'HIGH_24H', score: 11.2 })
 */
async function setVolatility(symbol, { tag = null, score = null } = {}) {
  const key = normKey(symbol);
  const col = await connectDB();
  const update = {
    $set: {
      symbol: key,
      volatilityTag: tag,
      lastVolScore: (Number.isFinite(Number(score)) ? Number(score) : null),
      lastUpdated: new Date()
    }
  };
  await col.updateOne({ symbol: key }, update, { upsert: true });
  const current = cache.get(key) || mergeProfiles(null, overrides[key]);
  cache.set(key, { ...current, volatilityTag: tag, lastVolScore: (Number.isFinite(Number(score)) ? Number(score) : null) });
  lastFetchAt.set(key, Date.now());
  return cache.get(key);
}

/**
 * NEW: Convenience getter to check current whitelist quickly.
 */
function isWhitelisted(symbol) {
  const key = normKey(symbol);
  const prof = cache.get(key) || mergeProfiles(null, overrides[key]);
  return !!prof.whitelisted;
}

/**
 * Keep your existing analytics functions, but make them robust and normalized.
 */
async function recordTradeResult(symbol, result = {}) {
  const key = normKey(symbol);
  const col = await connectDB();

  const inc = {};
  if (result.result === 'win') inc.wins = 1;
  if (result.result === 'loss') inc.losses = 1;

  await col.updateOne(
    { symbol: key },
    {
      $push: {
        tradeHistory: {
          date: new Date(),
          result: result.result || 'win',
          gain: Number(result.gain) || 0,
          duration: Number(result.duration) || 0
        }
      },
      ...(Object.keys(inc).length ? { $inc: inc } : {}),
      $set: { lastUpdated: new Date() }
    },
    { upsert: true }
  );

  // gentle cache refresh
  hydrateFromDB(key);
}

async function updateTokenBehavior(symbol, taSnapshot = {}) {
  const key = normKey(symbol);
  const col = await connectDB();

  const active = Array.isArray(taSnapshot.activeIndicators) ? taSnapshot.activeIndicators : [];
  await col.updateOne(
    { symbol: key },
    {
      ...(active.length ? { $addToSet: { idealTACombo: { $each: active } } } : {}),
      $inc: {
        fakeoutCount: taSnapshot.fakeout ? 1 : 0,
        stableBuildupCount: taSnapshot.stable ? 1 : 0
      },
      $set: { lastUpdated: new Date() }
    },
    { upsert: true }
  );

  hydrateFromDB(key);
}

/**
 * Adjust confidence based on historical profile signals (defensive math).
 */
async function adjustConfidenceByProfile(symbol, baseConfidence) {
  const key = normKey(symbol);
  // prefer cached; hydrate if needed
  const profile = cache.get(key) || await hydrateFromDB(key);
  let conf = Number(baseConfidence) || 0;

  const wins = Number(profile?.wins || 0);
  const losses = Number(profile?.losses || 0);
  const denom = wins + losses || 1;

  // basic heuristics (tune to taste)
  if (wins > 10 && wins / denom >= 0.66) conf += 5;
  if (Number(profile?.fakeoutCount || 0) >= 5) conf -= 6;
  if (Number(profile?.avgPumpAfterConf70 || 0) >= 100) conf += 5;

  return Math.max(0, Math.min(100, conf));
}

module.exports = {
  // sync profile accessor (used widely across the app)
  getPattern,

  // background/cache ops
  primePatterns,
  setWhitelist,

  // NEW helpers
  isWhitelisted,
  setClassTag,
  setVolatility,

  // analytics & behavior trackers (kept)
  recordTradeResult,
  updateTokenBehavior,
  adjustConfidenceByProfile,

  // export norms to keep other modules consistent
  normKey,
  baseOf,
};