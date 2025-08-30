/* eslint-disable no-console */
/**
 * handlers/partialTPManager.js
 *
 * Hybrid partials + smart reload + trailing, built for 1s cadence.
 *
 * Design
 *  - At every +50% ROI milestone, close 25% of ORIGINAL size (not remainder).
 *  - After each partial, arm a "reload" plan that can re-add exposure using
 *    *only banked PnL*, on a proper retest + reclaim (support-first).
 *  - After first partial, start a side-aware trailing stop on the remainder.
 *  - Idempotent: safe to call on every tick (1s).
 *
 * Public API
 *  setConfig(partial)               // tweak behavior
 *  registerExecutors(execs)         // wire exchange/emitters (see below)
 *  onOpen(positionInit)             // call right after an entry fills
 *  onTick(tickCtx)                  // call every second per position
 *  onExit(symbol)                   // call once when position is fully closed
 *  getState(symbol)                 // read-only snapshot for UI/debug
 *
 * Wire-in notes
 *  - We keep ZERO hard deps. Optional helpers may be injected via EXEC.*:
 *      EXEC.partialClose(symbol, qtyContracts)       // reduce-only
 *      EXEC.closeAll(symbol)                         // exit remainder
 *      EXEC.openAdd(params)                          // re-entry/add using profits
 *          -> { symbol, side: 'long'|'short', notionalUsd, leverage, tag? }
 *      EXEC.emitFeed({ kind, symbol, msg, ts })      // socket/feed bus
 *      EXEC.getRails(symbol)                         // optional -> { '12h':{atl,ath},'24h':{...} }
 *      EXEC.getTA(symbol)                            // optional -> TA object (price, fib, confidence,...)
 */

const S = new Map(); // symbolKey -> state

// ---------- Optional TP/SL Mongo feed persistor ----------
let pushTpFeed;
try {
  ({ pushTpFeed } = require('../tpSlMonitor')); // safe-optional
} catch (_) {
  pushTpFeed = undefined;
}

// ---------- Config (override via setConfig) ----------
let CFG = {
  // Partials
  milestoneStepRoi: 50,       // every +50% ROI
  takePerMilestoneFrac: 0.25, // close 25% of ORIGINAL size each milestone
  maxMilestones: 8,           // 8 * 50% = 400% cap (safety)

  // Trailing (arms after first partial)
  trailDropPct: 25,           // give back 25% from peak

  // Re-entry using banked PnL
  reentryEnabled: true,
  reentryBudgetFrac: 1.00,    // use 100% of realized PnL from each partial
  reentryExpiryMs: 2 * 60 * 60 * 1000, // 2h validity
  reclaimBps: 25,             // need ~0.25% reclaim through support to confirm bounce
  fallbackToFib: true,        // if rails missing, use TA fib (0.382/0.5)

  // Safety
  minExitConfidence: 60,      // if reversal + confidence low, allow exit on trail breach
  emitThrottleMs: 2500,       // rate-limit FE socket feed messages
};

function setConfig(partial = {}) { CFG = { ...CFG, ...partial }; }

// ---------- Exchange / environment executors ----------
let EXEC = {
  partialClose: async () => {},                   // async (symbol, qtyContracts)
  closeAll:     async () => {},                   // async (symbol)
  openAdd:      async () => {},                   // async ({symbol, side, notionalUsd, leverage, tag})
  emitFeed:     () => {},                         // ({kind, symbol, msg, ts})
  getRails:     async () => null,                 // async (symbol) -> { '12h':{atl,ath}, ... }
  getTA:        async () => null,                 // async (symbol) -> { price, confidence, fib:{levels:{}}, ... }
};
function registerExecutors(e = {}) { EXEC = { ...EXEC, ...(e || {}) }; }

// ---------- Utils ----------
const now = () => Date.now();
const fmt = (n, d = 6) => (Number.isFinite(+n) ? (+n).toFixed(d) : '--');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const bps = (p, b) => p * (1 + b / 10000);
const keyOf = (s) => String(s || '').trim().toUpperCase().replace(/[-_]/g, '');

function roundQty(qty, lotSize = 1, minSize = 0) {
  if (!(qty > 0)) return 0;
  const stepped = lotSize > 0 ? Math.floor(qty / lotSize) * lotSize : qty;
  const rounded = Number(stepped.toFixed(10));
  return Math.max(minSize || 0, rounded);
}

// unified socket + mongo feed
function pushFeed(st, state, text, extra = {}) {
  // FE socket (throttled elsewhere for spammy updates)
  EXEC.emitFeed?.({ kind: 'tp', symbol: st.symbol, msg: text, ts: now() });

  // Mongo persistor (one row per notable change)
  if (typeof pushTpFeed === 'function') {
    try {
      pushTpFeed({
        contract: st.symbol,   // AAA-USDTM
        state,                 // OPENED | TRAIL_ARMED | TRAIL_PEAK | TP1_TAKEN | ...
        text,                  // human-readable
        roi: Number.isFinite(extra.roi) ? Number(extra.roi) : undefined,
        peak: Number.isFinite(extra.peakRoi) ? Number(extra.peakRoi) : undefined
      });
    } catch (_) { /* non-blocking */ }
  }
}

function emitOnce(st, msg) {
  const t = now();
  const gap = t - (st.lastEmitAt || 0);
  if (gap >= CFG.emitThrottleMs) {
    EXEC.emitFeed?.({ kind: 'tp', symbol: st.symbol, msg, ts: t });
    st.lastEmitAt = t;
  }
}

// ---------- Core state ----------
/**
 * onOpen({ symbol, side, entryPrice, size, lotSize, minSize, leverage, initialMargin, multiplier })
 */
function onOpen(p = {}) {
  const symbol = keyOf(p.symbol);
  if (!symbol || !(p.entryPrice > 0) || !(p.size > 0)) return;
  const side = String(p.side || 'long').toLowerCase().includes('short') ? 'short' : 'long';

  S.set(symbol, {
    symbol,
    side,                                 // 'long'|'short'
    entryPrice: Number(p.entryPrice),
    sizeOrig: Number(p.size),             // ORIGINAL size (contracts)
    sizeLive: Number(p.size),
    lotSize: Number(p.lotSize || 1),
    minSize: Number(p.minSize || 0),
    leverage: Number(p.leverage || 10),
    multiplier: Number(p.multiplier || 1), // 🔸 NEW: contract multiplier awareness
    initialMargin: p.initialMargin != null ? Number(p.initialMargin) : null,

    // runtime
    peakPrice: Number(p.entryPrice),
    peakRoi: 0,
    milestonesHit: new Set(),            // {50,100,150,...}
    trailStop: null,
    armed: false,                        // trail armed?
    exited: false,

    // realized PnL (USDT) from partials
    realizedUsd: 0,

    // re-entry plan
    re: { armed: false, triggerPx: null, expiresAt: 0, budgetUsd: 0, tag: null },

    lastEmitAt: 0,
    note: 'tracking'
  });

  pushFeed(S.get(symbol), 'OPENED', `🟢 Tracking started • ${side.toUpperCase()} • qty ${p.size} @ ${fmt(p.entryPrice)}`, { roi: 0, peakRoi: 0 });
}

function onExit(symbol) {
  const k = keyOf(symbol);
  if (!k) return;
  const st = S.get(k);
  if (st && !st.exited) {
    st.exited = true;
    st.sizeLive = 0;
    st.re = { armed: false, triggerPx: null, expiresAt: 0, budgetUsd: 0, tag: null };
    pushFeed(st, 'CLOSED', '✅ Position exited', { roi: st.peakRoi, peakRoi: st.peakRoi });
  }
  S.delete(k);
}

function getState(symbol) {
  const st = S.get(keyOf(symbol));
  return st ? JSON.parse(JSON.stringify(st)) : null;
}

// ---------- Helpers: ROI / trail / support ----------
function roiFrom(st, price) {
  // PnL = (±)(price - entry) * sizeLive * multiplier
  const mult = Number(st.multiplier || 1);
  const pnl = st.side === 'long'
    ? (price - st.entryPrice) * st.sizeLive * mult
    : (st.entryPrice - price) * st.sizeLive * mult;

  const baseMargin = st.initialMargin != null
    ? st.initialMargin
    : Math.max(1e-9, (st.entryPrice * st.sizeOrig * mult) / (st.leverage || 10)); // robust fallback

  return (pnl / baseMargin) * 100;
}

function updateTrail(st, price) {
  const madeNewPeak =
    (st.side === 'long'  && price > st.peakPrice) ||
    (st.side === 'short' && price < st.peakPrice);

  if (madeNewPeak) {
    st.peakPrice = price;
    const k = clamp(CFG.trailDropPct / 100, 0, 1);
    st.trailStop = (st.side === 'long') ? price * (1 - k) : price * (1 + k);
    emitOnce(st, `🚀 New peak • trail to ${fmt(st.trailStop)}`);
    // Persist peak as a feed row (not throttled)
    pushFeed(st, 'TRAIL_PEAK', `🚀 New peak • trail to ${fmt(st.trailStop)}`, { peakRoi: st.peakRoi });
  }
}

async function computeSupportPx(st, ta) {
  // Prefer rails 12h ATL/ATH for support; fallback to TA fib 0.382/0.5
  try {
    const rails = await EXEC.getRails?.(st.symbol);
    if (rails && rails['12h']) {
      const r = rails['12h'];
      if (st.side === 'long' && Number.isFinite(r.atl)) return r.atl;
      if (st.side === 'short' && Number.isFinite(r.ath)) return r.ath;
    }
  } catch {}

  if (CFG.fallbackToFib && ta?.fib?.levels) {
    const lv = ta.fib.levels;
    // For longs, use 0.382/0.5 as "retest"; for shorts, mirror via 0.618/0.5
    if (st.side === 'long') {
      return Number.isFinite(lv['0.382']) ? lv['0.382'] : (Number.isFinite(lv['0.5']) ? lv['0.5'] : null);
    }
    if (st.side === 'short') {
      return Number.isFinite(lv['0.618']) ? lv['0.618'] : (Number.isFinite(lv['0.5']) ? lv['0.5'] : null);
    }
  }
  return null;
}

// ---------- Re-entry planner ----------
async function armReentry(st, price) {
  if (!CFG.reentryEnabled) return;

  let ta = null;
  try { ta = await EXEC.getTA?.(st.symbol); } catch {}
  const support = await computeSupportPx(st, ta);
  if (!Number.isFinite(support) || !(price > 0)) return;

  const reclaim = st.side === 'long'
    ? bps(support, CFG.reclaimBps)     // need price to reclaim support upward
    : bps(support, -CFG.reclaimBps);   // reclaim downward (for shorts)

  const budgetUsd = Math.max(0, st.realizedUsd * CFG.reentryBudgetFrac);
  if (budgetUsd < 5) return; // ignore dust

  st.re = {
    armed: true,
    triggerPx: reclaim,
    expiresAt: now() + CFG.reentryExpiryMs,
    budgetUsd,
    tag: `retest:${fmt(support)}→reclaim:${fmt(reclaim)}`
  };
  pushFeed(st, 'RELOAD_ARMED', `🧩 Reload armed • ${st.re.tag} • budget ≈ $${budgetUsd.toFixed(2)}`);
}

async function maybeFireReentry(st, price) {
  if (!st.re.armed) return;
  if (now() > st.re.expiresAt) {
    st.re = { armed: false, triggerPx: null, expiresAt: 0, budgetUsd: 0, tag: null };
    pushFeed(st, 'RELOAD_EXPIRED', '⌛ Reload expired');
    return;
  }

  const crossed =
    (st.side === 'long'  && price >= st.re.triggerPx) ||
    (st.side === 'short' && price <= st.re.triggerPx);

  if (!crossed) return;

  const notional = st.re.budgetUsd;
  if (!(notional > 0)) return;

  try {
    await EXEC.openAdd?.({
      symbol: st.symbol,
      side: st.side,
      notionalUsd: notional,
      leverage: st.leverage,
      tag: st.re.tag
    });
    pushFeed(st, 'RELOAD_EXEC', `🔁 Reload executed • ~$${notional.toFixed(2)} • ${st.re.tag}`);
  } catch (e) {
    pushFeed(st, 'RELOAD_ERROR', `⚠️ Reload failed: ${e?.message || e}`);
  } finally {
    st.re = { armed: false, triggerPx: null, expiresAt: 0, budgetUsd: 0, tag: null };
  }
}

// ---------- Partials ----------
async function tryPartials(st, price, roi) {
  // Determine which milestones are due (50%,100%,150%,...)
  const step = Math.max(1, Math.floor(CFG.milestoneStepRoi));
  const hit = [];
  for (let k = 1; k <= CFG.maxMilestones; k++) {
    const lvl = k * step;
    if (roi >= lvl && !st.milestonesHit.has(lvl)) hit.push(lvl);
  }
  if (!hit.length) return false;

  // Process *only one* milestone per tick to avoid burst
  const lvl = Math.min(...hit);
  const qtyRaw = st.sizeOrig * CFG.takePerMilestoneFrac;
  const qty = roundQty(qtyRaw, st.lotSize, st.minSize);
  if (!(qty > 0) || qty >= st.sizeLive) {
    st.milestonesHit.add(lvl);
    return false;
  }

  // Realized PnL from this partial (approx): ΔP * qty * multiplier
  const mult = Number(st.multiplier || 1);
  const pnl = (st.side === 'long')
    ? (price - st.entryPrice) * qty * mult
    : (st.entryPrice - price) * qty * mult;

  try {
    await EXEC.partialClose(st.symbol, qty);
    st.sizeLive = Number((st.sizeLive - qty).toFixed(10));
    st.milestonesHit.add(lvl);
    st.realizedUsd += Math.max(0, pnl);

    const msg = `🎯 TP ${lvl}% • closed ${qty} • realized +$${Math.max(0, pnl).toFixed(2)} • live ${st.sizeLive}`;
    emitOnce(st, msg);
    pushFeed(st, `TP${lvl}_TAKEN`, msg, { roi, peakRoi: st.peakRoi });

    // Arm trailing after the very first partial
    if (!st.armed) {
      st.armed = true;
      const k = clamp(CFG.trailDropPct / 100, 0, 1);
      st.trailStop = (st.side === 'long') ? price * (1 - k) : price * (1 + k);
      emitOnce(st, `🧭 Trailing armed @ ${fmt(st.trailStop)} (${CFG.trailDropPct}% drop)`);
      pushFeed(st, 'TRAIL_ARMED', `🧭 Trailing armed @ ${fmt(st.trailStop)} (${CFG.trailDropPct}% drop)`, { roi, peakRoi: st.peakRoi });
    }

    // Arm re-entry using realized profits from this (and prior) partials
    await armReentry(st, price);

    return true;
  } catch (e) {
    const em = `⚠️ Partial ${lvl}% failed: ${e?.message || e}`;
    emitOnce(st, em);
    pushFeed(st, 'TP_ERROR', em, { roi, peakRoi: st.peakRoi });
    return false;
  }
}

// ---------- Exit logic ----------
async function maybeExit(st, price, roi, trendPhase, confidence) {
  if (!st.armed || st.sizeLive <= 0) return false;

  const hitTrail =
    (st.side === 'long'  && price <= st.trailStop) ||
    (st.side === 'short' && price >= st.trailStop);

  const reversalExit = ['reversal', 'peak'].includes(trendPhase || '') && (Number(confidence) < CFG.minExitConfidence);

  if (!hitTrail && !reversalExit) return false;

  try {
    await EXEC.closeAll(st.symbol);
    st.exited = true;
    st.sizeLive = 0;
    st.re = { armed: false, triggerPx: null, expiresAt: 0, budgetUsd: 0, tag: null };

    if (hitTrail) {
      pushFeed(st, 'EXIT_TRAIL', `✅ Exit: trail hit @ ${fmt(price)} (ROI ${roi.toFixed(2)}%)`, { roi, peakRoi: st.peakRoi });
    } else {
      pushFeed(st, 'EXIT_REVERSAL', `✅ Exit: reversal (conf ${Number(confidence) || 0}%)`, { roi, peakRoi: st.peakRoi });
    }
    return true;
  } catch (e) {
    const em = `⚠️ Exit failed: ${e?.message || e}`;
    emitOnce(st, em);
    pushFeed(st, 'EXIT_ERROR', em, { roi, peakRoi: st.peakRoi });
    return false;
  }
}

// ---------- Tick loop (call every second) ----------
/**
 * onTick({
 *   symbol, currentPrice, trendPhase, confidence
 * })
 */
async function onTick(p = {}) {
  const symbol = keyOf(p.symbol);
  const st = S.get(symbol);
  if (!st || st.exited) return { action: 'none' };
  const price = Number(p.currentPrice);
  if (!(price > 0)) return { action: 'none', reason: 'bad-price' };

  // Update ROI + peaks
  const roi = roiFrom(st, price);
  st.peakRoi = Math.max(st.peakRoi, roi);
  updateTrail(st, price);

  // 1) Try partials (at most one per tick)
  const didPartial = await tryPartials(st, price, roi);
  if (didPartial) return { action: 'partial', roi, trailStop: st.trailStop, sizeLive: st.sizeLive };

  // 2) Try exit (trail or reversal)
  const didExit = await maybeExit(st, price, roi, p.trendPhase || 'uptrend', Number(p.confidence) || 0);
  if (didExit) return { action: 'exit_all', roi };

  // 3) Try re-entry if armed
  await maybeFireReentry(st, price);

  st.note = `ROI ${roi.toFixed(2)}% • peakROI ${st.peakRoi.toFixed(2)}% • live ${st.sizeLive}`;
  return { action: 'none', roi, trailStop: st.trailStop, sizeLive: st.sizeLive };
}

module.exports = {
  setConfig,                    // real
  setTPConfig: setConfig,       // alias
  registerExecutors,
  onOpen,
  initTPTracker: onOpen,        // alias
  onTick,
  updateTPStatus: onTick,       // alias
  onExit,
  getState
};