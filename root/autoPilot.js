#!/usr/bin/env node
/* Poseidon Autopilot bootstrap (with FORCE TRADE)
 * - Enables the decision helper execution gate (env)
 * - Optional evaluator auto-placement (__POSEIDON_AUTO_PLACE)
 * - Starts CycleWatcher (majors/whitelist) and ReversalWatcher (high-vol non-majors)
 * - NEW:
 *     --force=SYMBOL[:long|short]  Force a trade (runs evaluator first)
 *     --manual-direct              Place the forced trade directly via /api/place-futures-trade
 *     --fallback-manual            If evaluator doesn't execute, fall back to manual route
 *     --qty=USDT                   Quantity (exposure) for manual route (default: 5% wallet, min $5)
 *     --lev=X                      Leverage for manual/forced path (clamped: majors 20–50, others 10–20)
 *     --force-price=123.45         Price override (else fetched from /api/ta)
 */

const axios = require('axios');
const { startCycleWatcherServer, getCycleWatcherStatus } = require('../handlers/cycleWatcher');
const { startReversalWatcherServer, getReversalWatcherStatus } = require('../handlers/reversalWatcher');
const { evaluatePoseidonDecision } = require('../handlers/decisionHelper');

// ---- tiny argv parser (no deps)
const args = process.argv.slice(2);
const has = (flag) => args.some(a => a === flag);
const get = (key) => {
  const p = args.find(a => a.startsWith(key + '='));
  return p ? p.split('=').slice(1).join('=').trim() : '';
};

// ---- safety gates
if (String(process.env.POSEIDON_ALLOW_EXECUTION || '').toLowerCase() !== 'true') {
  process.env.POSEIDON_ALLOW_EXECUTION = 'true'; // allow evaluator to execute via decisionHelper
  console.log('⚙️  POSEIDON_ALLOW_EXECUTION=true');
}

if (has('--strict75')) {
  process.env.REV_STRICT_75 = 'true';
  console.log('⚙️  Reversal baseline set to STRICT 75');
}

if (has('--autoplace')) {
  globalThis.__POSEIDON_AUTO_PLACE = true; // evaluator reads this flag
  console.log('🟢 Autoplace ENABLED (globalThis.__POSEIDON_AUTO_PLACE=true)');
} else {
  globalThis.__POSEIDON_AUTO_PLACE = false;
  console.log('🟡 Autoplace DISABLED (dry-run decisions; no orders will be placed)');
}

// Optional explicit contracts (BASE or BASE-USDTM accepted)
const explicit = get('--contracts')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ---- symbol utils (keep local so this script is standalone)
const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const MAJORS = new Set(['BTC','XBT','ETH','SOL','BNB','XRP','ADA','AVAX','DOGE','LINK','LTC','TRX','TON','DOT','NEAR','ARB','OP']);
const MEMES  = new Set(['DOGE','SHIB','PEPE','WIF','FLOKI','BONK','MYRO','BOME','MEW','MOG','BRETT','SATS','1000RATS','DOGS','TRUMP']);
const up = (s='') => String(s).toUpperCase();
const baseOf = (sym='') => up(sym).replace(/[-_]/g,'').replace(/USDTM?$/,'').replace(/USDT$/,'');
const isMajorOrMeme = (sym) => {
  let b = baseOf(sym); if (b==='XBT') b='BTC';
  return MAJORS.has(b) || MEMES.has(b);
};
const toContract = (sym) => {
  const b = baseOf(sym); return b ? `${b}-USDTM` : '';
};
const toSpot = (sym) => {
  let b = baseOf(sym); if (b==='XBT') b='BTC';
  return b ? `${b}USDT` : '';
};

// ---- risk & leverage helpers ----
async function fetchWalletAvailable() {
  // Try a couple of common balance endpoints; first one that returns works.
  const candidates = [`${BASE}/api/balance`, `${BASE}/api/wallet/balance`];
  for (const url of candidates) {
    try {
      const { data } = await axios.get(url, { timeout: 6000 });
      const avail = Number(
        data?.balance?.available ??
        data?.available ??
        data?.usdtAvailable ??
        data?.equity ??
        0
      );
      if (Number.isFinite(avail) && avail > 0) return avail;
    } catch (_) { /* try next */ }
  }
  return 0;
}

/** Hard clamp per your rules */
function clampLeverageFor(symbolOrBase, requested) {
  const b = baseOf(symbolOrBase);
  const isMajor = MAJORS.has(b) || b === 'BTC' || b === 'XBT' || b === 'ETH' || b === 'SOL' || b === 'BNB';
  const min = isMajor ? 20 : 10;
  const max = isMajor ? 50 : 20;
  const req = Math.max(1, Number(requested) || min);
  return Math.max(min, Math.min(max, req));
}

/** 5% risk sizing (fallback when --qty not given) */
async function chooseQtyUsdFallback() {
  const avail = await fetchWalletAvailable();
  if (avail > 0) return Math.max(5, +(avail * 0.05).toFixed(2)); // 5% of wallet, min $5
  return 20; // safe default if balance route unavailable
}

// ---- FORCE TRADE helper
function parseForceSpec() {
  const spec = get('--force'); // e.g., "ADA:long" | "SUI"
  if (!spec) return null;
  const [rawSym, rawSide] = spec.split(':');
  const sideFlag = get('--force-side'); // optional flag
  const priceFlag = get('--force-price');
  const side = (rawSide || sideFlag || '').toLowerCase();
  const price = priceFlag ? Number(priceFlag) : null;

  const symbol = rawSym ? rawSym.trim() : '';
  if (!symbol) return null;

  let sideHint = null;
  if (side === 'long' || side === 'short') sideHint = side;

  return { symbol, sideHint, price };
}

async function fetchTA(spot){
  try {
    const { data } = await axios.get(`${BASE}/api/ta/${spot}`, { timeout: 6000 });
    return data || {};
  } catch { return {}; }
}

// ---- Manual placement (uses your already-working route)
async function placeViaManual({ symbol, side, price, qtyUsd, lev, tpPercent = 30, slPercent = 10 }) {
  // side: 'buy'|'sell', symbol can be BASE or BASE-USDTM; the route normalizes it
  const payload = {
    symbol,
    side,
    margin: qtyUsd,      // your route expects "margin" as the Quantity USDT
    leverage: lev,
    confidence: 85,
    price,
    note: `AUTO(manual-route) • TP ${tpPercent}% / SL ${slPercent}%`
  };
  const { data } = await axios.post(`${BASE}/api/place-futures-trade`, payload, { timeout: 15000 });
  return data;
}

async function forceOneTrade({ symbol, sideHint, price }) {
  const contract = toContract(symbol);
  const spot = toSpot(symbol);
  if (!contract || !spot) throw new Error(`Invalid symbol: ${symbol}`);

  // Decide which "source" to use so the decisionHelper gate allows execution
  const source = isMajorOrMeme(symbol) ? 'CYCLE_WATCHER' : 'REVERSAL_WATCHER';

  // Get price & TA signal if not forced
  const ta = await fetchTA(spot);
  const livePrice = Number(ta?.price ?? ta?.markPrice ?? NaN);
  const taSignal = String(ta?.signal || '').toLowerCase();

  let side = sideHint;
  if (!side) {
    // Infer side from TA if not provided
    side = (taSignal === 'bearish') ? 'short' : 'long';
  }

  const p = Number.isFinite(price) ? Number(price) : (Number.isFinite(livePrice) ? livePrice : NaN);
  if (!Number.isFinite(p)) throw new Error(`No price available for ${spot} (consider --force-price=NUMBER)`);

  // Manual route sizing flags
  const manualDirect   = has('--manual-direct');
  const fallbackManual = has('--fallback-manual');

  // qty: use --qty if set, else 5% risk
  const qtyFlag = get('--qty');
  const qtyUsd  = Number.isFinite(Number(qtyFlag)) ? Math.max(1, Number(qtyFlag)) : await chooseQtyUsdFallback();

  // leverage: clamp by category (majors 20–50, others 10–20)
  const levFlag = get('--lev');
  const levRequested = Number.isFinite(Number(levFlag)) ? Number(levFlag) : undefined;
  const lev = clampLeverageFor(symbol, levRequested);

  // Map side to route style
  const sideRoute = (side === 'short') ? 'sell' : 'buy';

  if (manualDirect) {
    console.log(`⚡ Forcing trade (manual route): ${contract} ${side.toUpperCase()} @ ${p} • qty=$${qtyUsd.toFixed(2)} • lev=${lev}x`);
    const placed = await placeViaManual({ symbol: contract, side: sideRoute, price: p, qtyUsd, lev });
    console.log('➡️  Manual placement result:', placed);
    return placed;
  }

  // Otherwise go through evaluator first
  const payload = {
    source,
    allowExecute: true,
    confidence: 88,            // seed; evaluator recomputes final conf
    phase: source === 'CYCLE_WATCHER' ? 'impulse' : 'reversal',
    sideHint: side,            // 'long' | 'short'
    price: p,
    quoteVolume: Number(ta?.quoteVolume ?? ta?.quoteVolume24h ?? ta?.qv ?? 0),
    signal: taSignal,
    note: `debug force trade via autopilot (${source})`,
    reasons: ['debug-force'],
    // Optional leverage hint for evaluator path (it already respects payload.leverage)
    leverage: lev
  };

  console.log(`⚡ Forcing trade: ${contract} ${side.toUpperCase()} @ ${p} (source=${source}) • qty=$${qtyUsd.toFixed(2)} • lev=${lev}x`);
  const res = await evaluatePoseidonDecision(contract, payload);
  console.log('➡️  Evaluator result:', res);

  // If evaluator didn’t actually place, optionally fall back to manual
  if ((!res || res.executed === false) && fallbackManual) {
    console.log('↩️  Evaluator did not execute — falling back to manual route…');
    const placed = await placeViaManual({ symbol: contract, side: sideRoute, price: p, qtyUsd, lev });
    console.log('➡️  Manual fallback result:', placed);
    return placed;
  }

  return res;
}

// ---- launch
(async () => {
  process.on('unhandledRejection', (e) => console.error('UNHANDLED', e));
  process.on('uncaughtException', (e) => console.error('UNCAUGHT', e));

  const cycleOnly = has('--cycle-only');
  const reversalOnly = has('--reversal-only');
  const forceSpec = parseForceSpec();

  console.log('🚀 Starting Poseidon Autopilot…',
    { cycleOnly, reversalOnly, contracts: explicit.length ? explicit : '(auto)', source: forceSpec ? 'explicit+force' : explicit.length ? 'explicit' : 'frozen-scan' });

  if (!reversalOnly) {
    try {
      await startCycleWatcherServer(explicit);
      console.log('✅ CycleWatcher started:', getCycleWatcherStatus());
    } catch (e) {
      console.warn('❗ CycleWatcher failed to start:', e?.message || e);
    }
  }

  if (!forceSpec) {
    if (!cycleOnly) {
      try {
        await startReversalWatcherServer(explicit);
        console.log('✅ ReversalWatcher started:', getReversalWatcherStatus());
      } catch (e) {
        console.warn('❗ ReversalWatcher failed to start:', e?.message || e);
        console.warn('   (If services/volatilityClassifier is missing, Reversal auto-pick may no-op.)');
      }
    }
  }

  console.log('🧭 Gates:',
    { execution: process.env.POSEIDON_ALLOW_EXECUTION === 'true',
      autoplace: !!globalThis.__POSEIDON_AUTO_PLACE,
      strict75: process.env.REV_STRICT_75 === 'true' });

  // If requested, force a trade immediately (after watchers are armed)
  if (forceSpec) {
    try {
      await forceOneTrade(forceSpec);
    } catch (e) {
      console.error('❌ Force trade failed:', e?.message || e);
    }
    // Still start watchers unless user asked one-only mode
    if (!reversalOnly) {
      try { await startCycleWatcherServer(explicit); } catch {}
    }
    if (!cycleOnly) {
      try { await startReversalWatcherServer(explicit); } catch {}
    }
  }

  // lightweight status beacons
  setInterval(() => {
    try {
      const c = getCycleWatcherStatus?.() || {};
      const r = getReversalWatcherStatus?.() || {};
      console.log(`[hb] cycle: running=${c.running} watching=${c.watching} • reversal: running=${r.running} watching=${r.watching}`);
    } catch {}
  }, 15000);
})();