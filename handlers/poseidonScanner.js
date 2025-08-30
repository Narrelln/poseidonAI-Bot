// === handlers/poseidonScanner.js ===
// Server-side consumer of the frozen scanner set (40 movers + 10 memes).
// - No local universe building; we only process what newScanTokens exposes.
// - Meme entries ALWAYS pass (server already gated them by 25m–1.5b or whitelist).
// - Movers pass as delivered (server already enforced 100k–20m).
// - Per-symbol debounce to avoid noisy re-eval.
// - Keeps activeSymbols for other modules. Decisions are DISABLED by default; CycleWatcher owns entries.

// eslint-disable-next-line no-console

const { setActiveSymbols } = require('../handlers/sessionStatsModule.js');
const { initFuturesPositionTracker } = require('../handlers/futuresPositionTracker.js');
const { getCachedScannerData } = require('../routes/newScanTokens'); // in-memory cache provider
const { toKuCoinContractSymbol } = require('../handlers/futuresApi.js');

// Evaluate decisions on the server (guarded by SCANNER_DECISIONS)
const { evaluatePoseidonDecision } = require('../handlers/evaluatePoseidonDecision.js');

// Optional feed logger (safe if missing, path differs per project)
let logSignalToFeed = () => {};
try {
  ({ logSignalToFeed } = require('../handlers/liveFeedRenderer'));
} catch (_) {
  try { ({ logSignalToFeed } = require('./liveFeedRenderer')); } catch {}
}

// Optional per-token profile (may flag .whitelisted)
let getPattern = () => ({});
try {
  ({ getPattern } = require('./data/tokenPatternMemory.js'));
} catch {}

// ------------------ state / knobs ------------------
let activeSymbols = [];
let scannerStarted = false;
let DEBUG = false;

// NEW: hard gate — scanner must NOT send decisions by default
const SCANNER_DECISIONS = String(process.env.SCANNER_DECISIONS || 'false') === 'true';

const REANALYZE_COOLDOWN_MS = 15_000; // 15s debounce per symbol
const lastAnalysis = new Map();       // key: BASE -> { price, qv, ts }

function up(s){ return String(s || '').toUpperCase(); }
function baseOfContract(contract=''){
  const m = up(contract).match(/^([A-Z0-9]+)-USDTM$/);
  return m ? m[1] : up(contract).replace(/[-_]/g,'').replace(/USDTM?$/,'');
}
function pickQuoteVolume(row){
  // prefer canonical fields emitted by newScanTokens
  const qv24 = Number(row?.quoteVolume24h);
  if (Number.isFinite(qv24)) return qv24;
  const qv = Number(row?.quoteVolume ?? row?.turnover ?? row?.volume);
  return Number.isFinite(qv) ? qv : NaN;
}
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function canonBase(key){
  // Use BTC as canonical for XBT/BTC joins
  let b = up(key).replace(/[-_]/g,'').replace(/USDTM?$/,'');
  if (b === 'XBT') b = 'BTC';
  return b;
}

function toggleScannerDebug(){ DEBUG = !DEBUG; console.log(`🪛 poseidonScanner DEBUG=${DEBUG?'ON':'OFF'}`); }
global.toggleScannerDebug = toggleScannerDebug;

// ------------------ core refresh ------------------
async function refreshSymbols(){
  try {
    const cache = await getCachedScannerData(true);
    if (!cache || cache.success === false) return;

    // We trust the server’s selection and categories.
    const incoming = Array.isArray(cache.top50) ? cache.top50 : [];
    const seen = new Set();

    const rows = incoming.map(item => {
      // item fields are produced by routes/newScanTokens.js
      const srcSymbol = up(item?.symbol || item?.base || '');
      const contract  = toKuCoinContractSymbol(srcSymbol); // normalize to "BASE-USDTM"
      const base      = baseOfContract(contract);

      const price = num(item?.price);
      const qv    = pickQuoteVolume(item);
      const change = num(item?.priceChgPct ?? item?.change);
      const category = String(item?.category || '').toLowerCase(); // "gainer" | "loser" | "" | "meme" (if you added it upstream)

      // Upstream may not set "meme" literal in category; we infer from list membership when present.
      const isMeme = category === 'meme' || Boolean(item?.isMeme);

      // Profiles can mark tokens as whitelisted for any extra local rule (kept for future use)
      let prof = {};
      try { prof = getPattern(contract) || {}; } catch {}
      const profileWhitelisted = !!prof.whitelisted;

      return {
        base, contract, price, quoteVolume: qv, change: Number.isFinite(change)?+change.toFixed(2):0,
        confidence: Number(item?.confidence) || 0,
        category, isMeme, profileWhitelisted
      };
    })
    .filter(r => {
      if (!r.contract || !r.base) return false;
      if (seen.has(r.contract)) return false;
      seen.add(r.contract);
      // Minimal sanity only; DO NOT reapply volume bands here.
      if (!(r.price > 0) || !(r.quoteVolume > 0)) return false;
      return true;
    });

    // Expose to the rest of the app
    activeSymbols = rows.map(r => ({
      symbol: r.contract,
      price: r.price,
      volume: r.quoteVolume,
      confidence: r.confidence,
      category: r.category,
      isMeme: r.isMeme
    }));
    setActiveSymbols(activeSymbols);

    // Make sure trackers are initialized (idempotent)
    for (const s of activeSymbols) {
      try { initFuturesPositionTracker(s.symbol); } catch {}
    }

    // Fan out to the decision engine (DISABLED unless SCANNER_DECISIONS=true)
    const now = Date.now();

    if (SCANNER_DECISIONS) {
      for (const tok of rows) {
        const k = canonBase(tok.contract);
        const prev = lastAnalysis.get(k);
        if (prev && (now - prev.ts < REANALYZE_COOLDOWN_MS)) {
          const pd = Math.abs(tok.price - prev.price) / Math.max(prev.price, 1e-9);
          const vd = Math.abs(tok.quoteVolume - prev.qv) / Math.max(prev.qv, 1e-9);
          if (pd < 0.01 && vd < 0.01) continue; // <1% both → skip
        }

        try {
          await evaluatePoseidonDecision(tok.contract, {
            manual: false,
            price: tok.price,
            quoteVolume: tok.quoteVolume,
            changePct: tok.change,
            confidence: tok.confidence,
            category: tok.category,
            isMeme: tok.isMeme,
            whitelisted: tok.profileWhitelisted || tok.isMeme // memes/whitelist pass downstream guards
          });

          lastAnalysis.set(k, { price: tok.price, qv: tok.quoteVolume, ts: now });

          if (tok.confidence >= 70) {
            logSignalToFeed({
              symbol: tok.contract,
              confidence: tok.confidence,
              signal: 'candidate',
              volume: tok.quoteVolume,
              price: tok.price,
              tag: tok.isMeme ? 'meme' : 'mover'
            });
          }
        } catch (e) {
          if (DEBUG) console.warn(`decision error ${tok.contract}:`, e?.message || e);
        }
      }
    }

    if (DEBUG) console.log(`[Scanner] processed=${rows.length} active=${activeSymbols.length}`);
  } catch (err) {
    if (DEBUG) console.warn('[Scanner] refreshSymbols error:', err?.message || err);
  }
}

// ------------------ lifecycle / API ------------------
function getActiveSymbols(){ return activeSymbols; }

function startScanner(){
  if (scannerStarted) return;
  scannerStarted = true;

  // Initialize engine only if we explicitly allow scanner decisions
  if (SCANNER_DECISIONS) {
    try {
      const { initFuturesDecisionEngine } = require('./futuresDecisionEngine');
      if (typeof initFuturesDecisionEngine === 'function') initFuturesDecisionEngine();
    } catch {}
  }

  // First pull + interval (leave at 60s; server is locked for 7 days)
  refreshSymbols().catch(()=>{});
  globalThis.__POSEIDON_SCANNER_TIMER__ = setInterval(() => {
    refreshSymbols().catch(()=>{});
  }, 60_000);

  console.log('🚀 PoseidonScanner (server consumer) started @60s');
}

module.exports = {
  refreshSymbols,
  getActiveSymbols,
  startScanner,
  toggleScannerDebug
};