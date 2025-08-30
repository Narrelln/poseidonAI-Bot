// /public/scripts/scannerCache.js  (patched, resilient to missing /api/learning-memory)
let cachedScannerData = { top50: [], lastUpdated: 0 };
let isRefreshing = false;

const QUIET_DEFAULT = false;
let QUIET_MODE =
  (typeof window !== 'undefined' && !!window.POSEIDON_QUIET) ||
  (typeof localStorage !== 'undefined' && localStorage.getItem('poseidon.quiet') === '1') ||
  QUIET_DEFAULT;

let lastLogAt = 0;
const LOG_COOLDOWN_MS = 20_000;

function logInfo(...args) {
  if (QUIET_MODE) return;
  const now = Date.now();
  if (now - lastLogAt < LOG_COOLDOWN_MS) return;
  lastLogAt = now;
  console.log(...args);
}

export function setQuietMode(on) {
  QUIET_MODE = !!on;
  try { localStorage.setItem('poseidon.quiet', QUIET_MODE ? '1' : '0'); } catch {}
}

if (typeof window !== 'undefined') {
  window.setPoseidonQuiet = setQuietMode;
}

function n(v) { const x = Number(v); return Number.isFinite(x) ? x : NaN; }

// ---------- symbol helpers ----------
function sanitizeToken(token) {
  const symRaw = String(token?.symbol || token || '').toUpperCase();
  const symbol = symRaw;
  const price = n(token?.price ?? token?.lastPrice);

  const volumeBase = n(token?.volume ?? token?.baseVolume ?? token?.turnoverBase);
  const qv24 = n(token?.quoteVolume24h);
  const qvProvider = n(token?.quoteVolume ?? token?.turnover);

  const qvComputed = (Number.isFinite(price) && Number.isFinite(volumeBase)) ? price * volumeBase : NaN;
  const quoteVolume = Number.isFinite(qv24) ? qv24
                     : Number.isFinite(qvProvider) ? qvProvider
                     : Number.isFinite(qvComputed) ? qvComputed
                     : NaN;

  if (!QUIET_MODE && Number.isFinite(qvProvider) && Number.isFinite(qvComputed)) {
    const diff = Math.abs(qvProvider - qvComputed);
    const rel = qvProvider !== 0 ? diff / Math.abs(qvProvider) : 0;
    if (rel > 0.25) {
      console.warn(
        `[ScannerCache] ⚠️ quoteVolume mismatch for ${symbol}: provider=${qvProvider} vs computed=${qvComputed} (price=${price}, volumeBase=${volumeBase})`
      );
    }
  }

  return { ...token, symbol, price, volumeBase, quoteVolume, quoteVolume24h: Number.isFinite(qv24) ? qv24 : undefined };
}

function signatureOf(list) {
  return JSON.stringify(
    list.map(t => [
      String(t.symbol || '').toUpperCase(),
      Math.round(((t.winRate ?? 0) + Number.EPSILON) * 1000) / 1000
    ])
  );
}

// dual key: futures BASE-USDTM and spot BASEUSDT
function keysForMemory(sym) {
  const u = String(sym || '').toUpperCase();
  const base = u.replace(/[-_]/g, '').replace(/USDTM?$/, '');
  return [`${base}-USDTM`, `${base}USDT`];
}

// ---------- memory fetch (resilient) ----------
async function fetchLearningMemory() {
  // 1) Try the base route (Mongo summary or LONG/SHORT map)
  try {
    const res = await fetch('/api/learning-memory', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      const rawMap = (json && (json.memory || json)) || {};
      // Normalize: if entries have LONG/SHORT, keep; if they have {points, updatedAt}, mark exists
      const norm = {};
      if (rawMap && typeof rawMap === 'object') {
        for (const [key, val] of Object.entries(rawMap)) {
          if (val && (val.LONG || val.SHORT)) {
            norm[key.toUpperCase()] = {
              LONG:  val.LONG  || { wins: 0, trades: 0 },
              SHORT: val.SHORT || { wins: 0, trades: 0 }
            };
          } else if (val && (typeof val.points !== 'undefined' || typeof val.updatedAt !== 'undefined')) {
            // summary shape -> mark existence
            norm[key.toUpperCase()] = { __exists: true };
          }
        }
      }
      return norm;
    }
  } catch (_) {
    // fall through to #2
  }

  // 2) Fallback: derive a neutral memory map from /api/scan-tokens
  try {
    const res = await fetch('/api/scan-tokens', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const top = Array.isArray(data?.top50) ? data.top50 : [];
      const map = {};
      for (const row of top) {
        const sym = String(row?.symbol || '').toUpperCase();
        if (!sym) continue;
        const base = sym.replace(/[-_]/g, '').replace(/USDTM?$/, '');
        const fut = `${base}-USDTM`;
        const spot = `${base}USDT`;
        map[fut] = { __exists: true };
        map[spot] = map[fut];
      }
      return map;
    }
  } catch (err) {
    if (!QUIET_MODE) console.warn('⚠️ Failed to fetch fallback memory via scan-tokens:', err?.message || err);
  }

  // 3) Nothing available
  return {};
}

function enrichAndRankWithMemory(top50, memory) {
  const enriched = top50.map(token => {
    const t = sanitizeToken(token);
    const [futKey, spotKey] = keysForMemory(t.symbol);

    const m = memory[futKey] || memory[spotKey] || {};
    let avgWinRate;

    if (m.LONG || m.SHORT) {
      const long = m.LONG || {};
      const short = m.SHORT || {};
      const longWR  = Number.isFinite(long.trades)  && long.trades  > 0 ? long.wins  / long.trades  : NaN;
      const shortWR = Number.isFinite(short.trades) && short.trades > 0 ? short.wins / short.trades : NaN;

      if (Number.isFinite(longWR) && Number.isFinite(shortWR)) {
        avgWinRate = (longWR + shortWR) / 2;
      } else if (Number.isFinite(longWR)) {
        avgWinRate = longWR;
      } else if (Number.isFinite(shortWR)) {
        avgWinRate = shortWR;
      } else {
        avgWinRate = 0.5; // no usable stats
      }
    } else if (m.__exists) {
      // We have *some* memory/snapshot for the symbol (summary shape) -> tiny bump
      avgWinRate = 0.55;
    } else {
      // No memory at all -> neutral
      avgWinRate = 0.5;
    }

    return { ...t, winRate: avgWinRate };
  });

  enriched.sort((a, b) => (b.winRate || 0) - (a.winRate || 0));
  return enriched;
}
// ---------- cache refresh ----------
export async function refreshScannerCache() {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    const res = await fetch('/api/scan-tokens', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const json = await res.json();

    const incoming = Array.isArray(json?.top50) ? json.top50 : [];
    if (!incoming.length) {
      if (!QUIET_MODE) console.warn('⚠️ Invalid scanner response. No top50 tokens to cache.');
      return;
    }

    const memory = await fetchLearningMemory();
    const ranked = enrichAndRankWithMemory(incoming, memory);

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