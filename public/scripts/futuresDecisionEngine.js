// === futuresDecisionEngine.js — Poseidon Deep Learning Trade Engine (drop‑in)
// • Session/time gate (shouldTradeNow)
// • Volume band guard + symbol cooldown
// • Learning memory gating
// • Optional PPDA dual-entry on high confidence / reversal
// • Concise entry/exit justifications
// • Scanner readiness gate (event + polling) to prevent "No scanner row" spam
// • Robust top50 resolution (module → global → HTTP fallback)
// • No UI status control here

/* eslint-disable no-console */

// ---- light, safe import (module may not exist in some builds) --------------
let getCachedScannerData = null;
try {
  // front-end module form
  ({ getCachedScannerData } = await import('./scannerCache.js'));
} catch { /* non-fatal; we’ll fall back */ }

import { detectTrendPhase } from './trendPhaseDetector.js';
import { openDualEntry } from './ppdaEngine.js';
import { getWalletBalance } from './walletModule.js';
import { getLearningMemory, saveLearningMemory } from './learningMemory.js';
import { shouldTradeNow } from './poseidonScheduler.js';

// -------------------- config --------------------
const MAX_VOLUME_CAP    = 20_000_000;  // USDT turnover band (upper for movers)
const MIN_VOLUME_CAP    = 100_000;     // USDT turnover band (lower)
const TRADE_COOLDOWN_MS = 60_000;      // per-symbol throttle (ms)
const TP_PCT            = 10;          // take-profit threshold (%)
const DCA_TRIGGER_PCT   = -7;          // add at drawdown (%)
const MAX_DCA           = 2;           // max DCA steps

const SCANNER_READY_MIN_ROWS = 1;
const SCANNER_READY_TIMEOUT  = 12_000;
const SCANNER_HTTP_CACHE_MS  = 3000;   // avoid hammering the route

const COOLDOWN_EVENT = 'poseidon:cooldown';

// -------------------- local engine state --------------------
let intervalStarted   = false;
let failureStreak     = 0;
let lossRecoveryMode  = false;
let tradeCooldown     = {};   // symbol -> last action ts
let memory            = {};   // per-symbol per-side ephemeral state

// last successful /api/scan-tokens pull (for fallback)
let _httpCache = { ts: 0, payload: null };

const capitalState = {
  total: 0, allocated: 0, free: 0,
  update(wallet, allocations = []) {
    this.total = Number(wallet?.available ?? 0);
    this.allocated = allocations.reduce((s, a) => s + Number(a || 0), 0);
    this.free = Math.max(this.total - this.allocated, 0);
  }
};

// -------------------- utils --------------------
const up = (s) => String(s || '').toUpperCase();
function normalizeBase(sym) {
  let b = up(sym).replace(/[-_]/g, '').replace(/USDTM?$/, '');
  if (b === 'XBT') b = 'BTC';          // unify for matching
  return b;
}
function toSafeContract(symLike) {
  let s = symLike;
  if (typeof s === 'object' && s) s = s.symbol || s.base || s.ticker || '';
  s = up(s);
  if (/^[A-Z0-9]+-USDTM$/.test(s)) return s;
  if (/^[A-Z0-9]+USDTM?$/.test(s)) return s.replace(/USDTM?$/, '') + '-USDTM';
  if (s && !s.includes('-')) return s + '-USDTM';
  return s || 'UNKNOWN-USDTM';
}
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : NaN; }

function isInCooldown(symbol) {
  return Date.now() - (tradeCooldown[symbol] || 0) < TRADE_COOLDOWN_MS;
}
function updateCooldown(symbol) { tradeCooldown[symbol] = Date.now(); }

// ---------- smarter console logger (with de-dupe) ----------
function logDecision(symbol, message, { level = 'info', dedupeMs = 10_000 } = {}) {
  if (!window.__poseidonLogCache) window.__poseidonLogCache = {};
  const now = Date.now();
  const key = `${symbol}:${message}`;
  if (window.__poseidonLogCache[key] && now - window.__poseidonLogCache[key] < dedupeMs) return;
  window.__poseidonLogCache[key] = now;

  const line = `[${new Date().toLocaleTimeString()}] ${symbol} → ${message}`;
  if (level === 'debug')      console.debug(line);
  else if (level === 'warn')  console.warn(line);
  else if (level === 'error') console.error(line);
  else                        console.log(line);
}

// ---------- live feed bridge (optional) ----------
function pushToLiveFeed(payload) {
  try { if (window.logToLiveFeed) window.logToLiveFeed(payload); } catch {}
}

// ---------- concise justification builders ----------
function buildEntryReasons({ phase, confidence, quoteVolume, minQV, maxQV, manual }) {
  const r = [];
  if (manual) r.push('manual entry');
  if (confidence != null) {
    const c = Number(confidence);
    if (c >= 90) r.push('high conviction');
    else if (c >= 80) r.push('strong setup');
    else if (c >= 70) r.push('favorable setup');
  }
  if (Number.isFinite(quoteVolume)) {
    if (quoteVolume < minQV) r.push('low liquidity window');
    else if (quoteVolume > maxQV) r.push('overheated turnover');
    else r.push('volume within band');
  }
  if (phase?.phase) {
    if (phase.phase === 'reversal') r.push('reversal confirmation');
    else if (phase.phase === 'peak') r.push('fade at peak');
    else r.push(`phase: ${phase.phase}`);
  }
  return r;
}
function buildExitReasons({ hitTP, phase, weakening, trailing, capitalGuard }) {
  const r = [];
  if (hitTP) r.push('target reached');
  if (weakening) r.push('momentum weakening');
  if (phase?.phase) {
    if (phase.phase === 'reversal') r.push('reversal signal');
    else if (phase.phase === 'peak') r.push('peak tagged');
  }
  if (trailing) r.push('trailing stop');
  if (capitalGuard) r.push('protect capital');
  if (r.length === 0) r.push('protect capital');
  return r;
}
function logTradeEntry({ symbol, side, price, reasons = [] }) {
  console.log(`[POSEIDON ENTRY] ${side.toUpperCase()} on ${symbol} @ ${price}`);
  if (reasons.length) console.log(reasons.join(' • '));
  pushToLiveFeed({ symbol, message: `${side.toUpperCase()} @ ${price}`, detail: reasons.join(' • '), type: 'analysis', tag: side.toLowerCase() });
}
function logTradeExit({ symbol, side, price, roiPct, reasons = [] }) {
  const roiTxt = Number.isFinite(roiPct) ? ` (${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(2)}% ROI)` : '';
  console.log(`[POSEIDON EXIT] Closed ${side.toUpperCase()} ${symbol} @ ${price}${roiTxt}`);
  if (reasons.length) console.log(reasons.join(' • '));
  pushToLiveFeed({ symbol, message: `Closed ${side.toUpperCase()} @ ${price}${roiTxt}`, detail: reasons.join(' • '), type: 'decision', tag: 'exit' });
}

// ---------- learning memory ----------
function getMemory(symbol) {
  const mem = getLearningMemory(symbol);
  if (!mem.LONG)  mem.LONG  = { wins: 0, trades: 0, currentStreak: 0 };
  if (!mem.SHORT) mem.SHORT = { wins: 0, trades: 0, currentStreak: 0 };
  return mem;
}
function updateMemoryFromResult(symbol, side, outcome, delta, confidence, meta = {}) {
  const mem = getLearningMemory(symbol);
  const bucket = mem[side] || { wins: 0, trades: 0, currentStreak: 0 };
  bucket.trades += 1;
  if (outcome === 'win') { bucket.wins += 1; bucket.currentStreak = Math.max(1, bucket.currentStreak + 1); }
  else { bucket.currentStreak = Math.min(-1, bucket.currentStreak - 1); }
  mem[side] = bucket; saveLearningMemory(symbol, mem);
}

// ---------- per-position scratchpad ----------
function getState(symbol, side) {
  if (!memory[symbol]) memory[symbol] = {};
  if (!memory[symbol][side]) {
    memory[symbol][side] = {
      entryPrice: null, lastPrice: null, lastEval: 0,
      dcaCount: 0, size: 0, lastAction: null, lastConfidence: null
    };
  }
  return memory[symbol][side];
}

// === cooldown request (break circular dep) ===
function requestCooldown() {
  try { window.dispatchEvent(new CustomEvent(COOLDOWN_EVENT)); } catch {}
}

// --- scanner readiness + top50 resolution -----------------------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getTop50FromGlobals() {
  // Multiple front-ends may stash this differently
  const g1 = window?.__SCANNER_CACHE__?.top50;
  const g2 = window?.__scannerCache?.top50;
  const g3 = window?.top50List;
  if (Array.isArray(g1) && g1.length) return g1;
  if (Array.isArray(g2) && g2.length) return g2;
  if (Array.isArray(g3) && g3.length) return g3;
  return null;
}

async function getTop50ViaModule() {
  if (typeof getCachedScannerData === 'function') {
    try {
      const res = await getCachedScannerData(true);
      if (res && Array.isArray(res.top50)) return res.top50;
    } catch {}
  }
  return null;
}

async function getTop50ViaHTTP() {
  const now = Date.now();
  if (now - _httpCache.ts < SCANNER_HTTP_CACHE_MS && Array.isArray(_httpCache.payload)) return _httpCache.payload;
  try {
    const resp = await fetch('/api/scan-tokens', { cache: 'no-store' });
    const json = await resp.json().catch(() => ({}));
    const arr = Array.isArray(json?.top50) ? json.top50 : [];
    _httpCache = { ts: now, payload: arr };
    return arr;
  } catch { return []; }
}

async function resolveTop50() {
  // 1) module
  const m = await getTop50ViaModule();
  if (m && m.length) return m;
  // 2) globals
  const g = getTop50FromGlobals();
  if (g && g.length) return g;
  // 3) HTTP fallback
  return await getTop50ViaHTTP();
}

/**
 * Wait until the scanner has populated at least `minRows` rows,
 * or until timeout; uses 'poseidon:scanner-ready' if emitted,
 * otherwise polls resolveTop50() to avoid boot races.
 */
async function waitForScannerReady({ minRows = SCANNER_READY_MIN_ROWS, timeout = SCANNER_READY_TIMEOUT } = {}) {
  if (window.__scannerReadyOnce) return true;

  // quick path
  try {
    const arr = await resolveTop50();
    if (Array.isArray(arr) && arr.length >= minRows) {
      window.__scannerReadyOnce = true;
      return true;
    }
  } catch {}

  const eventPromise = new Promise(resolve => {
    const handler = () => {
      window.removeEventListener('poseidon:scanner-ready', handler);
      window.__scannerReadyOnce = true;
      resolve(true);
    };
    window.addEventListener('poseidon:scanner-ready', handler, { once: true });
  });

  const pollPromise = (async () => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const arr = await resolveTop50();
      if (Array.isArray(arr) && arr.length >= minRows) {
        window.__scannerReadyOnce = true;
        return true;
      }
      await sleep(250);
    }
    return false;
  })();

  return await Promise.race([eventPromise, pollPromise]);
}

function findScannerRow(contractSymbol, top50) {
  const want = normalizeBase(contractSymbol);
  return Array.isArray(top50)
    ? top50.find(t => normalizeBase(t.symbol || t.base) === want)
    : undefined;
}

// ================== CORE ==================
export async function evaluatePoseidonDecision(symbolLike, signal = null) {
  try {
    const contract = toSafeContract(symbolLike);
    const baseDisp = contract.replace('-USDTM', '');
    logDecision(baseDisp, `🧪 Analyzing ${contract} (Manual: ${!!signal?.manual})`, { level: 'debug' });

    // ---- session/time-of-day gate ----
    const okSession = await shouldTradeNow({ manual: !!signal?.manual, symbol: contract });
    if (!okSession) { logDecision(baseDisp, `🛌 REST window — skip ${contract}`, { level: 'debug' }); return; }

    // ---- per-symbol cooldown ----
    if (isInCooldown(contract)) { logDecision(baseDisp, `⏳ Cooldown — skip ${contract}`, { level: 'debug' }); return; }

    // ---- wait for scanner to be ready ----
    await waitForScannerReady();

    // ---- scanner row ----
    const top50 = await resolveTop50();
    const token = findScannerRow(contract, top50);
    if (!token) {
      // debounced warning
      logDecision(baseDisp, `⚠️ No scanner row`, { level: 'warn', dedupeMs: 30_000 });
      return;
    }

    // Resolve price & turnover robustly
    const priceRaw = token.price ?? token.lastPrice;
    const price = n(priceRaw);
    const quoteVolume = n(token.quoteVolume24h ?? token.quoteVolume ?? token.turnover ?? token.volume);

    if (!Number.isFinite(price) || price <= 0)  { logDecision(baseDisp, `⚠️ Invalid price (${priceRaw})`, { level: 'warn' }); return; }
    if (!Number.isFinite(quoteVolume))         { logDecision(baseDisp, `⚠️ Missing quoteVolume`, { level: 'warn' }); return; }
    if (quoteVolume > MAX_VOLUME_CAP && !signal?.override) {
      logDecision(baseDisp, `❌ Volume too high (${(quoteVolume/1e6).toFixed(1)}M)`, { level: 'debug' }); return;
    }
    if (quoteVolume < MIN_VOLUME_CAP) {
      logDecision(baseDisp, `❌ Volume too low (${(quoteVolume/1e3).toFixed(0)}K)`, { level: 'debug' }); return;
    }

    // ---- memory gating ----
    const mem = getMemory(contract);
    for (const side of ['LONG','SHORT']) {
      const m = mem[side];
      if (m.trades >= 8 && m.wins / m.trades < 0.30 && Math.abs(m.currentStreak) > 2) {
        logDecision(baseDisp, `❌ Skip ${side} — cold memory (W:${m.wins}/${m.trades}, Streak:${m.currentStreak})`, { level: 'debug' });
        return;
      }
    }

    // ---- trend phase ----
    let phase = null;
    try { phase = await detectTrendPhase(contract); } catch {}

    // ---- PPDA hook on high confidence near peak/reversal ----
    if (!signal?.manual && Number(signal?.confidence) >= 75 && phase && ['peak','reversal'].includes(phase.phase)) {
      logDecision(baseDisp, `🔀 PPDA on ${phase.phase} (C:${signal.confidence})`);
      openDualEntry({ symbol: contract, highConfidenceSide: 'SHORT', lowConfidenceSide: 'LONG', baseAmount: 1 });
      updateCooldown(contract);
      return;
    }

    // ---- desired side from signal (default short if unknown) ----
    const desiredSide =
      signal?.forceLong ? 'long'
      : (signal?.signal === 'bullish' ? 'long'
      : (signal?.signal === 'bearish' ? 'short' : 'short'));

    const sides = [desiredSide];

    for (const side of sides) {
      // require some conviction for auto (manual always allowed)
      let allowTrade = !!signal?.manual;
      if (!allowTrade) {
        if (phase && ['reversal','peak'].includes(phase.phase)) {
          logDecision(baseDisp, `📈 Phase ok: ${phase.phase}`, { level: 'debug' });
          allowTrade = true;
        } else {
          logDecision(baseDisp, `⛔ Trend not aligned (${phase?.phase || 'unknown'})`, { level: 'debug' });
        }
      }
      if (!allowTrade) continue;

      const S = getState(contract, side);
      if (Number.isFinite(Number(signal?.confidence))) S.lastConfidence = Number(signal.confidence);

      // ===== ENTRY =====
      if (!S.entryPrice) {
        S.entryPrice = price;
        S.lastPrice  = price;
        S.lastEval   = Date.now();
        S.dcaCount   = 0;
        S.size       = 1;
        S.lastAction = 'ENTRY';

        let walletRaw;
        try { walletRaw = await getWalletBalance(); } catch { walletRaw = 0; }
        const wallet = { available: Number(typeof walletRaw === 'number' ? walletRaw : (walletRaw?.available ?? 0)) };

        let basePercent = Number(signal?.confidence) >= 85 ? 0.25 : 0.10;
        let capital = wallet.available * basePercent;
        capital = Math.min(capital, 250);
        const size = +(capital / price).toFixed(3);

        capitalState.update(wallet, [capital]);

        const entryReasons = buildEntryReasons({
          phase, confidence: Number(signal?.confidence), quoteVolume,
          minQV: MIN_VOLUME_CAP, maxQV: MAX_VOLUME_CAP, manual: !!signal?.manual
        });
        logTradeEntry({ symbol: contract, side, price, reasons: entryReasons });

        updateCooldown(contract);
        continue;
      }

      // ===== UPDATE (TP / DCA rules) =====
      S.lastPrice = price;
      S.lastEval  = Date.now();

      const entry = Number(S.entryPrice);
      const isLong = side === 'long';
      const delta = isLong ? ((price/entry)-1)*100 : ((entry/price)-1)*100;

      // ---- TAKE PROFIT ----
      if (delta >= TP_PCT) {
        updateMemoryFromResult(contract, side.toUpperCase(), 'win', delta, S.lastConfidence, {
          dcaCount: S.dcaCount, tradeType: side, time: Date.now()
        });

        let phaseOnExit = null;
        try { phaseOnExit = await detectTrendPhase(contract); } catch {}
        const exitReasons = buildExitReasons({
          hitTP: true,
          phase: phaseOnExit,
          weakening: phaseOnExit?.phase === 'reversal' || phaseOnExit?.phase === 'peak',
          trailing: false,
          capitalGuard: false
        });

        logTradeExit({ symbol: contract, side, price, roiPct: delta, reasons: exitReasons });

        // reset
        S.entryPrice = null; S.dcaCount = 0; S.size = 1;
        failureStreak = 0;
        if (lossRecoveryMode) { lossRecoveryMode = false; logDecision(baseDisp, '🟢 Exit recovery', { level: 'debug' }); }
        continue;
      }

      // ---- DCA (risk add) ----
      const maxDCA = lossRecoveryMode ? 1 : MAX_DCA;
      if (delta <= DCA_TRIGGER_PCT && S.dcaCount < maxDCA) {
        S.entryPrice = (S.entryPrice * S.size + price) / (S.size + 1);
        S.dcaCount  += 1;
        S.size      += 1;

        updateMemoryFromResult(contract, side.toUpperCase(), 'loss', delta, S.lastConfidence, {
          dcaCount: S.dcaCount, tradeType: side, time: Date.now()
        });
        logDecision(baseDisp, `📉 [${side.toUpperCase()}] DCA @ Δ${delta.toFixed(2)}% (dca=${S.dcaCount})`);
        failureStreak += 1;
        checkFailureStreak();
        continue;
      }

      logDecision(baseDisp, `[${side.toUpperCase()}] ⏳ HOLD — Δ ${delta.toFixed(2)}%`, { level: 'debug' });
    }

    const mm = getMemory(contract);
    logDecision(baseDisp, `📊 W/L: LONG ${mm.LONG.wins}/${mm.LONG.trades}, SHORT ${mm.SHORT.wins}/${mm.SHORT.trades}`, { level: 'debug' });
  } catch (err) {
    console.error(`❌ Fatal decision error for ${String(symbolLike)}:`, err?.message || err);
  }
}

function checkFailureStreak() {
  if (failureStreak >= 3) {
    logDecision('SYSTEM', '🔴 Auto Shutdown — 3 consecutive failures');
    requestCooldown();
    lossRecoveryMode = true;
    failureStreak = 0;
  }
}

export function initFuturesDecisionEngine() {
  if (intervalStarted) return;
  intervalStarted = true;
  console.log('✅ Poseidon Engine Initialized');
}