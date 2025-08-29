// === /public/scripts/poseidonScanner.js ===
// Purpose:
//   Build the active symbol list for Poseidon. Keep majors/top coins, normal-range tokens,
//   and ONLY low-volume tokens that look like potential moonshots.
//
// Key points:
// - Uses quoteVolume (USDT) for gating.
// - Majors/top whitelist always included.
// - Normal tokens must be within [VOLUME_MIN, VOLUME_MAX].
// - Low-volume tokens included ONLY if isMoonshot(...) returns true.
// - Passes quoteVolume forward and logs clearly.
// - Spam-silencer: "Received top50" & "Active symbols ready" only log when counts change.
//
// Last updated: 2025-08-12

import { setActiveSymbols } from './sessionStatsModule.js';
import { initFuturesPositionTracker } from './futuresPositionTracker.js';
import { analyzeAndTrigger } from './futuresSignalModule.js';
import { getCachedScannerData } from './scannerCache.js';
import { toKuCoinContractSymbol } from './futuresApiClient.js';
import { logSignalToFeed, logToLiveFeed } from './liveFeedRenderer.js';

// ---- Volume gates (quoteVolume, i.e., in USDT) ----
const VOLUME_MIN = 100_000;       // normal lower bound
const VOLUME_MAX = 20_000_000;    // normal upper cap
const LOW_VOL_FLOOR = 50_000;     // absolute floor to consider moonshots (filters dead pairs)

// ---- Whitelist buckets ----
const WHITELIST = {
  top: ["XBT", "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "AVAX", "DOGE", "LINK", "LTC"],
  memes: ["SHIB", "PEPE", "TRUMP", "FLOKI", "BONK", "WIF", "AIDOGE", "TSUKA", "HARRY", "WOJAK", "GROK", "BODEN", "MAGA", "MYRO"]
};

let activeSymbols = [];
let scannerStarted = false;

let DEBUG_MODE = true;
window.toggleScannerDebug = () => {
  DEBUG_MODE = !DEBUG_MODE;
  console.log(`🪛 DEBUG_MODE is now ${DEBUG_MODE ? 'ON' : 'OFF'}`);
};

// —— Spam silencer helpers (log only when counts change) ——
let _prevTop50Len = null;
let _prevActiveLen = null;
// Optional burst summary (disabled by default):
const INFO_BURST_WINDOW = 15000;
let _lastInfoBurst = 0;
function burstInfo(top50Len, activeLen) {
  if (!DEBUG_MODE) return;
  const now = Date.now();
  if (now - _lastInfoBurst >= INFO_BURST_WINDOW) {
    console.log(`[Scanner] top50=${top50Len} | active=${activeLen} (last ${Math.round(INFO_BURST_WINDOW/1000)}s)`);
    _lastInfoBurst = now;
  }
}
// ———————————————————————————————————————————————————————

// ---- helpers ----
function isWhitelisted(symbol) {
  const s = String(symbol || '').toUpperCase();
  return [...WHITELIST.top, ...WHITELIST.memes].some(w => s.startsWith(w));
}

function absNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * A "moonshot" low-volume token is one that:
 *  - has quoteVolume between LOW_VOL_FLOOR and VOLUME_MIN (below normal min, but not dead)
 *  - AND shows a strong short-term % move (priceChgPct)
 */
function isMoonshot(token, opts = {}) {
  const qv = num(token.quoteVolume);
  const pct = absNum(token.priceChgPct ?? token.change);
  const minChgPct = opts.minChgPct ?? 12; // ≥12% absolute move

  return (
    qv >= LOW_VOL_FLOOR &&
    qv < VOLUME_MIN &&
    pct >= minChgPct
  );
}

export async function refreshSymbols() {
  try {
    const response = await getCachedScannerData(true);
    if (!response || response.success === false) {
      if (DEBUG_MODE) console.warn('[Scanner] Invalid or unsuccessful scanner response');
      return;
    }

    const combined = response.top50 || [];

    // --- TEMP test hook: push one synthetic symbol for a single cycle ---
    if (window.__autoTestSymbol) {
      const base = String(window.__autoTestSymbol)
        .toUpperCase()
        .replace(/[-_]/g,'')
        .replace(/USDTM?$/,'');
      combined.unshift({
        symbol: base,            // e.g. 'MYRO'
        price: window.__autoTestPrice ?? 0.05,
        quoteVolume: window.__autoTestQVol ?? 600000,  // in USDT
        priceChgPct: window.__autoTestDelta ?? 18
      });
      // clear so it only runs for one cycle
      delete window.__autoTestSymbol;
      delete window.__autoTestPrice;
      delete window.__autoTestQVol;
      delete window.__autoTestDelta;
    }
    
    if (_prevTop50Len !== combined.length) {
      if (DEBUG_MODE) console.log(`[Scanner] Received top50 tokens: ${combined.length}`);
      _prevTop50Len = combined.length;
    }

    const seen = new Set();

    const enrichedSymbols = combined.filter(item => {
      const rawSym = item.symbol;
      const symbol = rawSym?.toUpperCase();
      const price = num(item.price, NaN);
      const quoteVolume = num(item.quoteVolume, NaN);
      const change = num(item.priceChgPct ?? item.change, NaN);

      // basic symbol validation
      if (!symbol) return false;
      if (/ALTCOIN|TEST|ZEUS|TROLL|MIXIE|WEN|DOOD|DADDY|PORT|GOR|NOBODY/i.test(symbol)) return false;
      if (seen.has(symbol)) return false;

      // keep majors/top regardless of quoteVolume
      if (isWhitelisted(symbol)) {
        seen.add(symbol);
        item.symbol = symbol;
        item.price = Number.isFinite(price) ? price : 0;
        item.quoteVolume = Number.isFinite(quoteVolume) ? quoteVolume : 0;
        item.change = Number.isFinite(change) ? +change.toFixed(2) : 0;
        return true;
      }

      // normal-range tokens
      const withinRange = Number.isFinite(quoteVolume) && quoteVolume >= VOLUME_MIN && quoteVolume <= VOLUME_MAX;
      if (withinRange) {
        seen.add(symbol);
        item.symbol = symbol;
        item.price = Number.isFinite(price) ? price : 0;
        item.quoteVolume = Number.isFinite(quoteVolume) ? quoteVolume : 0;
        item.change = Number.isFinite(change) ? +change.toFixed(2) : 0;
        return true;
      }

      // low-volume: only include if moonshot
      const isCandidate = Number.isFinite(quoteVolume) && quoteVolume > 0 && Number.isFinite(price) && price > 0;
      if (isCandidate && isMoonshot({ quoteVolume, priceChgPct: change })) {
        if (DEBUG_MODE) console.log(`[Scanner] 🌙 Moonshot candidate: ${symbol} | qVol=${quoteVolume.toFixed(0)} | Δ=${change}%`);
        seen.add(symbol);
        item.symbol = symbol;
        item.price = Number.isFinite(price) ? price : 0;
        item.quoteVolume = Number.isFinite(quoteVolume) ? quoteVolume : 0;
        item.change = Number.isFinite(change) ? +change.toFixed(2) : 0;
        return true;
      }

      // else reject
      if (DEBUG_MODE) {
        console.warn(`[Scanner] Skipping ${symbol} — not whitelisted and not normal range or moonshot`, {
          quoteVolume, change
        });
      }
      return false;
    });

    if (!enrichedSymbols.length) {
      if (DEBUG_MODE) {
        console.warn('[Scanner] No valid tokens after filtering top50');
        logToLiveFeed({ symbol: 'SYSTEM', message: 'No valid tokens to analyze', type: 'warning' });
      }
      activeSymbols = [];
      window.top50List = [];
      setActiveSymbols(activeSymbols);
      return;
    }

    // Build active list in futures format and keep quoteVolume
    activeSymbols = enrichedSymbols.map(e => ({
      symbol: toKuCoinContractSymbol(e.symbol),
      price: num(e.price, 0),
      quoteVolume: num(e.quoteVolume, 0),
      confidence: e.confidence || 0,
    }));

    window.top50List = enrichedSymbols;
    setActiveSymbols(activeSymbols);
    activeSymbols.forEach(initFuturesPositionTracker);

    if (_prevActiveLen !== activeSymbols.length) {
      if (DEBUG_MODE) console.log(`[Scanner] Active symbols ready: ${activeSymbols.length}`);
      _prevActiveLen = activeSymbols.length;
    }
    // Optional burst summary every 15s:
    burstInfo(_prevTop50Len ?? combined.length, _prevActiveLen ?? activeSymbols.length);

    // Kick TA/decision pipeline
    for (const token of enrichedSymbols) {
      const price = num(token.price, NaN);
      const quoteVolume = num(token.quoteVolume, NaN);

      const invalidPriceOrVolume =
        !Number.isFinite(price) || price <= 0 ||
        !Number.isFinite(quoteVolume) || quoteVolume <= 0;

      if (invalidPriceOrVolume) {
        if (DEBUG_MODE) {
          console.warn(
            `[Scanner] Skipping ${token.symbol} — invalid price or volume:`,
            { price, quoteVolume }
          );
        }
        continue;
      }

      const normalizedSymbol = toKuCoinContractSymbol(token.symbol);

      try {
        const result = await analyzeAndTrigger(normalizedSymbol, {
          price,
          quoteVolume,           // ← pass quote volume forward
          change: token.change
        });

        if (!result || result.signal === 'neutral') continue;

        const confidence = result.confidence || 0;
        const alreadyOpen = result.openPosition === true;

        if (confidence >= 70 && !alreadyOpen) {
          const allocation = confidence >= 85 ? 0.25 : 0.10;
          result.allocation = allocation;
          logSignalToFeed(result);
          if (DEBUG_MODE) console.log(`[Signal] ${normalizedSymbol} | ${confidence}% | ${result.signal}`);
        } else if (DEBUG_MODE) {
          console.log(`[Signal] Skipped: ${normalizedSymbol} | confidence=${confidence}, open=${alreadyOpen}`);
        }

      } catch (err) {
        if (DEBUG_MODE) console.warn(`[Signal] Error for ${normalizedSymbol}:`, err.message);
      }
    }

  } catch (err) {
    if (DEBUG_MODE) console.warn('[Scanner] refreshSymbols() error:', err.message);
  }
}

export function getActiveSymbols() {
  return activeSymbols;
}

export function startScanner() {
  if (scannerStarted) return;
  scannerStarted = true;

  setInterval(refreshSymbols, 5000);
  refreshSymbols();
}

// Expose a few helpers for quick debugging from the console
window.setActiveSymbols = setActiveSymbols;
window.getActiveSymbols = getActiveSymbols;
window.refreshSymbols = refreshSymbols;
window.startScanner = startScanner;
window.toggleScannerDebug = toggleScannerDebug;