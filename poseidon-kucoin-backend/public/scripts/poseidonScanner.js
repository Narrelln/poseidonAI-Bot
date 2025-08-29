// === /public/scripts/poseidonScanner.js ===
// Passive-by-default scanner: maintains a stable active list with 12h stickiness,
// single-flight refresh, backoff on failures, low-log noise, and your exact volume rule.
// - Keeps tokens with quoteVolume ∈ [100k, 20m] USDT (unless whitelisted major/meme)
// - Categorizes by price movement since first seen this session; falls back to %
// - Majors/memes always included (even if outside the band)
// - ✨ Dispatch to analyzer is DISABLED by default (guarded by SCANNER_DECISIONS)
//
// DevTools knobs:
//   window.POSEIDON_SCAN_MS = 5000
//   window.toggleScannerDebug()
//   window.scannerDump()
//   window.clearScannerSticky()
//   window.setScannerDecisions(true|false)   // <— enable/disable dispatch loop at runtime
//
// Persisted keys:
//   LS_STICKY  : 'poseidon_sticky_set_v1' (12h TTL per symbol)
//   LS_REF_PX  : 'poseidon_ref_prices_v1' (first-seen session price)
//   LS_DECISIONS : 'poseidon_scanner_decisions' (optional on/off persistence)

import { setActiveSymbols } from './sessionStatsModule.js';
import { initFuturesPositionTracker } from './futuresPositionTracker.js';
import { analyzeAndTrigger } from './futuresSignalModule.js';
import { getCachedScannerData } from './scannerCache.js';
import { toKuCoinContractSymbol } from './futuresApiClient.js';
import { logSignalToFeed, logToLiveFeed } from './liveFeedRenderer.js';

// ---------- Config ----------
const VOLUME_MIN = 100_000;
const VOLUME_MAX = 20_000_000;

const STICKY_HOURS = 12;
const STICKY_MS    = STICKY_HOURS * 60 * 60 * 1000;

const SCAN_DEFAULT_MS = 5000; // can be overridden by window.POSEIDON_SCAN_MS
const SCAN_MIN_MS     = 2000; // hard lower bound

// Whitelist buckets
const WHITELIST = {
  top  : ['XBT','BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC'],
  memes: ['SHIB','PEPE','TRUMP','FLOKI','BONK','WIF','AIDOGE','TSUKA','HARRY','WOJAK','GROK','BODEN','MAGA','MYRO','DOGE']
};

// ---------- State ----------
let DEBUG_MODE = true;
let activeSymbols = [];
let scannerTimerId = null;
let scannerStarted = false;

// decisions gate (default OFF; persisted in localStorage so your choice sticks)
// If you prefer session-only, remove LS_DECISIONS usage below.
const LS_DECISIONS = 'poseidon_scanner_decisions';
function loadDecisionsFlag(){
  try { return String(localStorage.getItem(LS_DECISIONS) ?? 'false').toLowerCase() === 'true'; }
  catch { return false; }
}
function saveDecisionsFlag(v){
  try { localStorage.setItem(LS_DECISIONS, v ? 'true' : 'false'); } catch {}
}
let SCANNER_DECISIONS = loadDecisionsFlag();   // 🔒 OFF by default

// single-flight + backoff
let _inFlight = false;
let _failCount = 0;

// sticky set + first-seen price refs (persisted)
const LS_STICKY = 'poseidon_sticky_set_v1';
const LS_REF_PX = 'poseidon_ref_prices_v1';
let stickySet = loadSticky();
let refPrices = loadRefPrices();

// bursty log control
let _prevTopLen = null;
let _prevActLen = null;
const INFO_BURST_MS = 15000;
let _lastInfoBurst = 0;

// public stats
const __scannerStats = {
  lastRunAt: 0,
  lastOkAt : 0,
  lastErr  : '',
  cycleMs  : () => Math.max(SCAN_MIN_MS, Number(window.POSEIDON_SCAN_MS) || SCAN_DEFAULT_MS),
  totalRuns: 0,
  okRuns   : 0,
  errRuns  : 0,
};
window.__scannerStats = __scannerStats;

// ---------- Helpers ----------
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : NaN; };
const num = (v, d=0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };

function normalizePct(p) {
  let x = Number(p);
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 1 && Math.abs(x) > 0.0001) x *= 100; // allow 0.023 -> 2.3%
  return x;
}
function baseOf(sym){
  return String(sym || '')
    .toUpperCase()
    .replace(/[-_]/g,'')
    .replace(/USDTM?$/,'');
}
function isWhitelistedBase(b){
  return WHITELIST.top.includes(b) || WHITELIST.memes.includes(b);
}
function volumeOf(row){
  // quote volume priority: 24h -> quoteVolume -> turnover -> volume*price
  const price = n(row?.price ?? row?.lastPrice);
  const qv = n(row?.quoteVolume24h ?? row?.quoteVolume ?? row?.turnover);
  if (Number.isFinite(qv)) return qv;
  const baseVol = n(row?.volumeBase ?? row?.volume ?? row?.baseVolume);
  if (Number.isFinite(price) && Number.isFinite(baseVol)) return price * baseVol;
  return NaN;
}
function pctChangeOf(row){
  return normalizePct(row?.priceChgPct ?? row?.change ?? 0);
}

// ---------- Sticky Set (persisted) ----------
function loadSticky(){
  try {
    const raw = localStorage.getItem(LS_STICKY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw);
    const m = new Map(arr);
    pruneSticky(m);
    return m;
  } catch { return new Map(); }
}
function saveSticky(){
  try { localStorage.setItem(LS_STICKY, JSON.stringify(Array.from(stickySet.entries()))); } catch {}
}
function pruneSticky(m=stickySet){
  const now = Date.now();
  for (const [b, meta] of m) {
    if (!meta || !Number.isFinite(meta.until) || meta.until <= now) m.delete(b);
  }
}
function refreshSticky(bases){
  const now = Date.now();
  const until = now + STICKY_MS;
  pruneSticky();
  for (const b of bases) stickySet.set(b, { until });
  saveSticky();
}
function isSticky(base){ pruneSticky(); return stickySet.has(base); }
window.clearScannerSticky = () => { stickySet = new Map(); saveSticky(); console.log('[Scanner] sticky set cleared'); };

// ---------- Reference Prices (session-first) ----------
function loadRefPrices(){
  try { return JSON.parse(localStorage.getItem(LS_REF_PX) || '{}') || {}; } catch { return {}; }
}
function saveRefPrices(){
  try { localStorage.setItem(LS_REF_PX, JSON.stringify(refPrices)); } catch {}
}
function ensureRefPrice(base, price){
  if (!Number.isFinite(price)) return;
  if (!(base in refPrices)) { refPrices[base] = price; saveRefPrices(); }
}
function clearOldRefPrice(base){ delete refPrices[base]; saveRefPrices(); }

// Direction by price movement since first seen in *this* session; fallback to %.
function categorizeByPriceMove(base, currentPrice, pctFallback){
  const p = Number(currentPrice);
  if (Number.isFinite(p)) {
    const ref = Number(refPrices[base]);
    if (Number.isFinite(ref) && ref > 0) {
      const delta = p - ref;
      if (Math.abs(delta) > 1e-12) return delta > 0 ? 'gainer' : 'loser';
      return ''; // essentially flat
    }
  }
  // fallback to % change if no ref
  const cp = Number(pctFallback);
  if (!Number.isFinite(cp) || cp === 0) return '';
  return cp > 0 ? 'gainer' : 'loser';
}

// ---------- Logging ----------
function burstInfo(topLen, actLen){
  if (!DEBUG_MODE) return;
  const now = Date.now();
  if (now - _lastInfoBurst >= INFO_BURST_MS) {
    console.log(`[Scanner] top=${topLen} | active=${actLen} | sticky=${stickySet.size} | decisions=${SCANNER_DECISIONS?'ON':'OFF'}`);
    _lastInfoBurst = now;
  }
}
window.toggleScannerDebug = () => {
  DEBUG_MODE = !DEBUG_MODE;
  console.log(`🪛 DEBUG_MODE: ${DEBUG_MODE ? 'ON' : 'OFF'}`);
};
window.scannerDump = () => ({
  sticky: Array.from(stickySet.entries()),
  refPrices: { ...refPrices },
  activeSymbols: activeSymbols.slice(),
  decisions: SCANNER_DECISIONS,
  stats: { ...__scannerStats },
});
window.setScannerDecisions = (on) => {
  SCANNER_DECISIONS = !!on;
  saveDecisionsFlag(SCANNER_DECISIONS);
  console.log(`🧭 SCANNER_DECISIONS = ${SCANNER_DECISIONS ? 'ENABLED' : 'DISABLED'}`);
};

// ---------- Core Refresh ----------
async function refreshSymbols(){
  if (_inFlight) return;                // single-flight
  _inFlight = true;
  __scannerStats.lastRunAt = Date.now();
  __scannerStats.totalRuns++;

  try {
    const response = await getCachedScannerData(true);
    if (!response || response.success === false) throw new Error('scanner response invalid');

    const top = Array.isArray(response.top50) ? response.top50 : [];
    if (_prevTopLen !== top.length) {
      DEBUG_MODE && console.log(`[Scanner] received: ${top.length} symbols`);
      _prevTopLen = top.length;
    }

    // Normalize, filter by your volume rule (unless whitelisted), tag category
    const seen = new Set();
    const accepted = [];

    for (const row of top) {
      const base = baseOf(row?.symbol || row?.base || '');
      if (!base) continue;
      if (seen.has(base)) continue;

      const price = n(row?.price ?? row?.lastPrice);
      const qVol  = n(volumeOf(row));
      const cpct  = n(pctChangeOf(row));

      // First-seen price for session
      if (Number.isFinite(price)) ensureRefPrice(base, price);

      // Whitelisted flow: always keep
      if (isWhitelistedBase(base)) {
        seen.add(base);
        accepted.push({
          base,
          price,
          quoteVolume: qVol,
          changePct: Number.isFinite(cpct) ? +cpct.toFixed(2) : 0
        });
        continue;
      }

      // Non-whitelist must respect the 100k..20m band
      if (!Number.isFinite(qVol) || qVol < VOLUME_MIN || qVol > VOLUME_MAX) continue;
      if (!Number.isFinite(price) || price <= 0) continue;

      seen.add(base);
      accepted.push({
        base,
        price,
        quoteVolume: qVol,
        changePct: Number.isFinite(cpct) ? +cpct.toFixed(2) : 0
      });
    }

    // Refresh sticky TTL for currently accepted bases
    refreshSticky(accepted.map(a => a.base));

    // If a sticky base didn't appear this cycle, synthesize a placeholder row
    for (const base of stickyKeys()) {
      if (!accepted.some(a => a.base === base)) {
        accepted.push({ base, price: n(refPrices[base]), quoteVolume: NaN, changePct: 0, synthesized: true });
      }
    }

    if (!accepted.length) {
      DEBUG_MODE && console.warn('[Scanner] no tokens accepted after filtering');
      activeSymbols = [];
      window.top50List = [];
      setActiveSymbols(activeSymbols);
      _inFlight = false;
      _failCount = 0;
      __scannerStats.okRuns++; __scannerStats.lastOkAt = Date.now();
      return;
    }

    // Categorize and build enriched (direction by price move; fallback to %)
    const enriched = accepted.map(a => {
      const category = categorizeByPriceMove(a.base, a.price, a.changePct);
      return {
        ...a,
        category,
        isMover: category === 'gainer' || category === 'loser'
      };
    });

    // Build active list for the app (futures normalized)
    activeSymbols = enriched.map(e => ({
      symbol: toKuCoinContractSymbol(e.base),
      price: num(e.price, 0),
      quoteVolume: num(e.quoteVolume, 0),
      confidence: e.confidence || 0,
      category: e.category || '',
      isMover: !!e.isMover
    }));

    window.top50List = enriched.slice(); // for any UI panels that read it
    setActiveSymbols(activeSymbols);
    activeSymbols.forEach(initFuturesPositionTracker);

    if (_prevActLen !== activeSymbols.length) {
      DEBUG_MODE && console.log(`[Scanner] active ready: ${activeSymbols.length} (sticky=${stickySet.size})`);
      _prevActLen = activeSymbols.length;
    }
    burstInfo(_prevTopLen ?? top.length, _prevActLen ?? activeSymbols.length);

    // ============================
    // Dispatch loop (GATED)
    // ============================
    if (!SCANNER_DECISIONS) {
      DEBUG_MODE && console.log('[Scanner] dispatch is DISABLED (SCANNER_DECISIONS=false)');
    } else {
      for (const tok of enriched) {
        const price = n(tok.price);
        const qv    = n(tok.quoteVolume);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qv) || qv <= 0) continue;

        const sym = toKuCoinContractSymbol(tok.base);
        try {
          const result = await analyzeAndTrigger(sym, {
            price,
            quoteVolume: qv,
            change: tok.changePct,
            category: tok.category || '',
            isMover: !!tok.isMover
          });
          if (!result || result.signal === 'neutral') continue;

          if (!result.category) {
            result.category = tok.category || '';
            result.isMover  = !!tok.isMover;
          }

          const conf = Number(result.confidence) || 0;
          const alreadyOpen = result.openPosition === true;

          if (conf >= 70 && !alreadyOpen) {
            result.allocation = conf >= 85 ? 0.25 : 0.10;
            logSignalToFeed({ ...result, category: result.category, isMover: !!result.isMover });
            DEBUG_MODE && console.log(`[Signal] ${sym} | ${conf}% | ${result.signal} | ${result.category || 'uncat'}`);
          } else if (DEBUG_MODE) {
            console.log(`[Signal] skipped: ${sym} | conf=${conf} open=${alreadyOpen} | ${tok.category || 'uncat'}`);
          }
        } catch (err) {
          DEBUG_MODE && console.warn(`[Signal] error for ${sym}:`, err?.message || err);
        }
      }
    }

    // success bookkeeping
    _failCount = 0;
    __scannerStats.okRuns++; __scannerStats.lastOkAt = Date.now();
  } catch (err) {
    __scannerStats.errRuns++;
    __scannerStats.lastErr = String(err?.message || err);
    // gentle backoff on transient failures
    _failCount = Math.min(_failCount + 1, 6); // cap
    DEBUG_MODE && console.warn(`[Scanner] refresh failed (#${_failCount}):`, err?.message || err);
    logToLiveFeed?.({ symbol: 'SYSTEM', message: `Scanner error: ${err?.message || err}`, type: 'error' });
  } finally {
    _inFlight = false;
  }
}

// sticky helpers
function* stickyKeys(){ pruneSticky(); for (const [b] of stickySet) yield b; }

// ---------- Public API ----------
function getActiveSymbols(){ return [...activeSymbols]; }

function startScanner(){
  if (scannerStarted) return;
  scannerStarted = true;

  if (scannerTimerId) clearInterval(scannerTimerId);

  const cycle = __scannerStats.cycleMs();
  const safeCycle = Math.max(SCAN_MIN_MS, cycle);
  scannerTimerId = setInterval(refreshSymbols, safeCycle);

  DEBUG_MODE && console.log(`[Scanner] started @ ${safeCycle}ms interval (sticky=${STICKY_HOURS}h, decisions=${SCANNER_DECISIONS?'ON':'OFF'})`);
  refreshSymbols();
}

// Expose helpers for DevTools
window.setActiveSymbols = setActiveSymbols;
window.getActiveSymbols = getActiveSymbols;
window.refreshSymbols   = refreshSymbols;
window.startScanner     = startScanner;
window.toggleScannerDebug = window.toggleScannerDebug || (() => {});
window.scannerDump        = window.scannerDump || (() => ({}));

// ---- explicit named exports ----
export { refreshSymbols, getActiveSymbols, startScanner };