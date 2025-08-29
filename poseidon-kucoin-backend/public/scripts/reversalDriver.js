// /public/scripts/reversalDriver.js
// pro‑grade: cooldown + guards + majors bypass + status pill + pro entry note
/* eslint-disable no-console */

import { pushSample, readyLong, readyShort, consume } from './reversalWatcher.js';
import { fetchTA } from './taClient.js';
import { placeTrade } from './executorClient.js';
import { buildEntryReasons } from './strategyReasons.js';

// Safe StrategyStatus shim (UI-optional)
import { StrategyStatus as RawStrategyStatus } from './strategyStatus.js';
const StrategyStatus = {
  mount: (...a) => (RawStrategyStatus && typeof RawStrategyStatus.mount === 'function')
    ? RawStrategyStatus.mount(...a)
    : void 0,
  setReversalOn: (on) => (RawStrategyStatus && typeof RawStrategyStatus.setReversalOn === 'function')
    ? RawStrategyStatus.setReversalOn(on)
    : void 0,
  reportReversalTick: () => (RawStrategyStatus && typeof RawStrategyStatus.reportReversalTick === 'function')
    ? RawStrategyStatus.reportReversalTick()
    : void 0,
  bumpReversalTrades: (n = 1) => (RawStrategyStatus && typeof RawStrategyStatus.bumpReversalTrades === 'function')
    ? RawStrategyStatus.bumpReversalTrades(n)
    : void 0,
};

// Optional preview API (if you have it wired on FE)
let previewOrderApi = null;
try {
  const mod = await import('./orderPreviewClient.js');
  previewOrderApi = mod?.previewOrder || null;
} catch { /* optional */ }

// ---------- Config (keep in sync with backend routes/TA gates) ----------
const MIN_QV = 100_000;           // lower bound (USDT)
const MAX_QV = 20_000_000;        // upper cap (USDT)
const ENTER_COOLDOWN_MS = 15_000; // per-symbol throttle for entries
const LOOP_MS = 5_000;            // sampling/decision cadence
const DEFAULT_LEVERAGE = 5;
const DEFAULT_NOTIONAL = 50;      // USDT allocation if preview not used

// Pro‑note defaults
const TP_PERCENTS_DEFAULT = [1.0, 2.25, 3.3];
const SL_PERCENT_DEFAULT  = 8.0;

// Majors bypass for upper cap (still require >= MIN_QV)
const MAJORS = new Set(['BTC','ETH','SOL','XRP','BNB','ADA','AVAX','DOGE','LINK','LTC']);

// ---------- State ----------
const WATCH = new Set();
const lastEnterAt = new Map();
let timerId = null;

// ---------- Strip status (for StrategyStatus) ----------
const _revStatus = {
  running: false,
  lastTickMs: 0,
  tradeCount: 0,
};
export function getReversalStatus() {
  return { ..._revStatus };
}

// ---------- Helpers ----------
function baseOf(sym = '') {
  return String(sym).toUpperCase().replace(/[-_]/g, '').replace(/USDTM?$/, '');
}
function isInCooldown(sym) {
  const t = lastEnterAt.get(sym) || 0;
  return Date.now() - t < ENTER_COOLDOWN_MS;
}
function markEntered(sym) { lastEnterAt.set(sym, Date.now()); }
function withinVolumeBand(qv, sym) {
  if (!(qv > 0)) return false;
  if (qv < MIN_QV) return false;
  const base = baseOf(sym);
  if (MAJORS.has(base)) return true;
  return qv <= MAX_QV;
}
function sideFromWatcher(sym) {
  if (readyLong(sym))  return 'BUY';
  if (readyShort(sym)) return 'SELL';
  return null;
}
function logOnce(key, msg, level = 'log', dedupeMs = 10_000) {
  const cacheKey = `__revlog__${key}`;
  const now = Date.now();
  const last = window[cacheKey] || 0;
  if (now - last < dedupeMs) return;
  window[cacheKey] = now;
  console[level](`[REVERSAL] ${msg}`);
}
function fmtNum(n, dp = 0) {
  const x = Number(n); if (!Number.isFinite(x)) return '—';
  return x.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp });
}
function fmtPrice(p) {
  const x = Number(p); if (!Number.isFinite(x)) return '0.000000';
  const dp = x >= 1 ? 2 : (x >= 0.1 ? 4 : 6);
  return x.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function computeTpPrices({ side, entry, tpPercents }) {
  const long = side === 'BUY';
  return tpPercents.map(p => long ? entry * (1 + p/100) : entry * (1 - p/100));
}
function computeSlPrice({ side, entry, slPercent }) {
  const long = side === 'BUY';
  return long ? entry * (1 - slPercent/100) : entry * (1 + slPercent/100);
}

// Build a polished entry note
function buildProEntryNote({
  symbol, side, price, leverage,
  tpPercents = TP_PERCENTS_DEFAULT,
  slPercent = SL_PERCENT_DEFAULT,
  context = {}
}) {
  const entry = Number(price) || 0;
  const tps   = computeTpPrices({ side, entry, tpPercents });
  const sl    = computeSlPrice({ side, entry, slPercent });
  const roi = (pct) => (pct * (Number(leverage) || 1)).toFixed(2);
  const tpPlan = tps.map((p, i) => {
    const pct = tpPercents[i];
    return `TP${i+1} ${fmtPrice(p)} (${pct.toFixed(2)}% ≈ ${roi(pct)}% @ ${leverage}x)`;
  }).join(' · ');

  const parts = [];
  parts.push(`🤖 ${String(symbol).toUpperCase()} — ${side} @ ${fmtPrice(entry)}`);
  const whyBits = [];
  if (context.reasons?.length) {
    whyBits.push(context.reasons.join(' • '));
  } else {
    if (context.taSignal) whyBits.push(`${context.taSignal} signal`);
    if (context.phase)    whyBits.push(`trend phase: ${context.phase}`);
    if (Number.isFinite(context.qv)) whyBits.push(`turnover ~ ${fmtNum(context.qv / 1e6, 1)}M USDT`);
  }
  if (whyBits.length) parts.push(`| Why: ${whyBits.join('; ')}`);
  parts.push(`| Leverage: ${leverage}x`);
  parts.push(`| Plan: ${tpPlan}`);
  parts.push(`| SL: ${fmtPrice(sl)} (${slPercent.toFixed(2)}%)`);
  return parts.join(' ');
}

// ---------- Public API ----------
export function addSymbols(symbols = []) { symbols.forEach(s => WATCH.add(String(s))); }
export function removeSymbols(symbols = []) { symbols.forEach(s => WATCH.delete(String(s))); }
export function clearReversalWatch() { WATCH.clear(); }

export function startReversalWatcher(symbols = []) {
  addSymbols(symbols);

  // status on
  _revStatus.running = true;
  _revStatus.lastTickMs = Date.now();
  _revStatus.tradeCount = _revStatus.tradeCount || 0;

  // mount & turn on status pill
  StrategyStatus.mount();
  StrategyStatus.setReversalOn(true);

  if (timerId) { clearInterval(timerId); timerId = null; }
  timerId = setInterval(loopOnce, LOOP_MS);
  console.log(`🚀 ReversalWatcher started — ${WATCH.size} symbols, loop=${LOOP_MS}ms`);
}

export function stopReversalWatcher() {
  if (timerId) { clearInterval(timerId); timerId = null; console.log('⏹️ ReversalWatcher stopped'); }
  _revStatus.running = false;
  StrategyStatus.setReversalOn(false);
}

// ---------- Core Loop ----------
async function loopOnce() {
    // ✅ Always heartbeat at the very start so the pill stays fresh,
    // even if TA fetch fails or there are no symbols right now.
    StrategyStatus.reportReversalTick();
  
    if (WATCH.size === 0) return;
  
    for (const sym of WATCH) {
      let desiredSide = null;
      let leverage = DEFAULT_LEVERAGE;
      let notionalUsd = DEFAULT_NOTIONAL;
      let reasons = [];
      let lastPrice = NaN;
      let lastQV = NaN;
  
      try {
        // 1) TA fetch (frontend taClient normalizes to Bybit spot symbol internally)
        const ta = await fetchTA(sym);
        if (!ta?.ok || !(Number(ta.price) > 0)) {
          // still alive; just skip this symbol
          continue;
        }
        lastPrice = Number(ta.price);
        lastQV = Number(ta.quoteVolume || 0);
  
        // (we already heartbeated above)
  
        // 2) Stream sample into watcher
        pushSample(sym, { price: lastPrice });
  
        // 3) If a setup is ready, consume it once per confirmation
        desiredSide = sideFromWatcher(sym);
        if (!desiredSide) continue;
        if (!consume(sym)) continue; // consume the one-shot confirm state
  
        // 4) Cooldown + volume band (majors bypass upper cap)
        if (isInCooldown(sym)) {
          logOnce(`${sym}:cooldown`, `${sym} cooldown active — skipping`, 'debug');
          continue;
        }
        if (!withinVolumeBand(lastQV, sym)) {
          logOnce(`${sym}:qv`, `${sym} volume out of band (qv=${Math.round(lastQV)}) — skipping`, 'debug');
          continue;
        }
  
        // 5) Sizing (optional preview)
        if (typeof previewOrderApi === 'function') {
          try {
            const prev = await previewOrderApi(sym, { notionalUsd: DEFAULT_NOTIONAL, leverage: DEFAULT_LEVERAGE });
            if (prev?.ok) {
              leverage = Number(prev.leverage) || DEFAULT_LEVERAGE;
              notionalUsd = Number(prev.notionalUsd) || DEFAULT_NOTIONAL;
            }
          } catch { /* keep defaults */ }
        }
  
        // Reasons & pro note
        reasons = buildEntryReasons({
          phase: null,
          confidence: Number(ta.confidence ?? 0),
          quoteVolume: lastQV,
          minQV: MIN_QV,
          maxQV: MAX_QV,
          manual: false
        });
  
        const proNote = buildProEntryNote({
          symbol: sym,
          side: desiredSide,
          price: lastPrice,
          leverage,
          tpPercents: TP_PERCENTS_DEFAULT,
          slPercent: SL_PERCENT_DEFAULT,
          context: { reasons, qv: lastQV }
        });
  
        // 6) Place order
        await placeTrade({
          symbol: sym,
          side: desiredSide,
          leverage,
          notionalUsd,
          manual: false,
          note: proNote
        });
  
        StrategyStatus.bumpReversalTrades(1);
        markEntered(sym);
        console.log(`[REVERSAL] ${desiredSide} ${sym} placed (lev=${leverage}, qty=${notionalUsd})`);
        console.log(proNote);
  
      } catch (err) {
        console.warn(`[REVERSAL] Error on ${sym}${desiredSide ? ` (${desiredSide})` : ''}:`, err?.message || err);
        // loop continues; heartbeat already sent
      }
    }
  }