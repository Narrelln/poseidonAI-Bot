// === /public/scripts/scannerCache.js ===
// Scanner cache with learning-memory prioritization
// + QUIET mode & throttled logging (no spam)
// + Skips "refreshed" logs if payload didn't change meaningfully

let cachedScannerData = {
  top50: [],
  lastUpdated: 0
};

let isRefreshing = false;

// ---- Quiet / Log control ----------------------------------------------------
const QUIET_DEFAULT = false; // set true if you want silence by default
let QUIET_MODE =
  (typeof window !== 'undefined' && !!window.POSEIDON_QUIET) ||
  (typeof localStorage !== 'undefined' && localStorage.getItem('poseidon.quiet') === '1') ||
  QUIET_DEFAULT;

let lastLogAt = 0;
const LOG_COOLDOWN_MS = 20_000; // at most one "refreshed" log every 20s

function logInfo(...args) {
  if (QUIET_MODE) return;
  const now = Date.now();
  if (now - lastLogAt < LOG_COOLDOWN_MS) return;
  lastLogAt = now;
  console.log(...args);
}

export function setQuietMode(on) {
  QUIET_MODE = !!on;
  try {
    localStorage.setItem('poseidon.quiet', QUIET_MODE ? '1' : '0');
  } catch {}
}

if (typeof window !== 'undefined') {
  window.setPoseidonQuiet = setQuietMode; // handy toggle from console
}

// ---- Helpers ----------------------------------------------------------------
async function fetchLearningMemory() {
  try {
    const res = await fetch('/api/learning-memory');
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const json = await res.json();
    return json || {};
  } catch (err) {
    if (!QUIET_MODE) console.warn('⚠️ Failed to fetch learning memory:', err.message);
    return {};
  }
}

// Shallow signature used to detect "no-change" payloads (keeps logs quiet)
function signatureOf(list) {
  // capture symbol + rounded winRate only (order matters)
  return JSON.stringify(
    list.map(t => [
      String(t.symbol || '').toUpperCase(),
      Math.round(((t.winRate ?? 0) + Number.EPSILON) * 1000) / 1000
    ])
  );
}

function enrichAndRankWithMemory(top50, memory) {
  const enriched = top50.map(token => {
    const sym = String(token.symbol || '').toUpperCase();
    const mem = memory[sym] || {};
    const long = mem.LONG || {};
    const short = mem.SHORT || {};

    const longWR = long.trades ? long.wins / long.trades : 0;
    const shortWR = short.trades ? short.wins / short.trades : 0;
    const avgWinRate = ((longWR + shortWR) / 2) || 0;

    return { ...token, winRate: avgWinRate };
  });

  enriched.sort((a, b) => (b.winRate || 0) - (a.winRate || 0));
  return enriched;
}

// ---- Public API -------------------------------------------------------------
export async function refreshScannerCache() {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    const res = await fetch('/api/scan-tokens');
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const json = await res.json();

    const incoming = Array.isArray(json?.top50) ? json.top50 : [];
    if (!incoming.length) {
      if (!QUIET_MODE) console.warn('⚠️ Invalid scanner response. No top50 tokens to cache.');
      return;
    }

    const memory = await fetchLearningMemory();
    const ranked = enrichAndRankWithMemory(incoming, memory);

    // Skip update/log if nothing meaningful changed
    const oldSig = signatureOf(cachedScannerData.top50);
    const newSig = signatureOf(ranked);
    const changed = oldSig !== newSig;

    cachedScannerData = {
      top50: ranked,
      lastUpdated: Date.now()
    };

    if (changed) {
      logInfo(`🔁 Scanner cache refreshed & ranked: ${ranked.length} tokens`);
    }
  } catch (err) {
    if (!QUIET_MODE) console.error('❌ Failed to refresh scanner cache:', err.message);
  } finally {
    isRefreshing = false;
  }
}

export async function getCachedScannerData(force = false) {
  const isStale = Date.now() - cachedScannerData.lastUpdated > 30_000;
  if (force || isStale || !cachedScannerData.top50.length) {
    await refreshScannerCache();
  }
  return cachedScannerData;
}

export function setCachedScannerData(data) {
  cachedScannerData = {
    top50: Array.isArray(data?.top50) ? data.top50 : [],
    lastUpdated: Number(data?.lastUpdated) || Date.now()
  };
}

export function getActiveSymbols() {
  return [...cachedScannerData.top50];
}