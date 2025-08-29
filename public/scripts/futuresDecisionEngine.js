// === futuresDecisionEngine.js — Poseidon Deep Learning Trade Engine (With Capital Health) ===
import { getCachedScannerData } from './scannerCache.js';
import { triggerAutoShutdownWithCooldown } from './poseidonBotModule.js';
import { detectTrendPhase } from './trendPhaseDetector.js';
import { openDualEntry } from './ppdaEngine.js';
import { getWalletBalance } from './walletModule.js';
import { getLearningMemory, saveLearningMemory } from './learningMemory.js';

const MAX_VOLUME_CAP = 20_000_000;
const MIN_VOLUME_CAP = 100_000;
const TRADE_COOLDOWN_MS = 60_000;

let memory = {};
let failureStreak = 0;
let lossRecoveryMode = false;
let intervalStarted = false;
let tradeCooldown = {};

const capitalState = {
  total: 0,
  allocated: 0,
  free: 0,
  update(wallet, allocations = []) {
    this.total = Number(wallet?.available ?? 0);
    this.allocated = allocations.reduce((sum, a) => sum + Number(a || 0), 0);
    this.free = Math.max(this.total - this.allocated, 0);
  }
};

// ---------- Learning memory helpers ----------
const updateMemoryFromResult = (symbol, side, outcome, delta, confidence, meta = {}) => {
  const mem = getLearningMemory(symbol);
  const m = mem[side] || { wins: 0, trades: 0, currentStreak: 0 };

  m.trades += 1;
  if (outcome === 'win') {
    m.wins += 1;
    m.currentStreak = Math.max(1, m.currentStreak + 1);
  } else {
    m.currentStreak = Math.min(-1, m.currentStreak - 1);
  }

  mem[side] = m;
  saveLearningMemory(symbol, mem);
};

const getMemory = (symbol) => {
  const mem = getLearningMemory(symbol);
  if (!mem.LONG) mem.LONG = { wins: 0, trades: 0, currentStreak: 0 };
  if (!mem.SHORT) mem.SHORT = { wins: 0, trades: 0, currentStreak: 0 };
  return mem;
};

// ---------- local state ----------
function getState(symbol, side) {
  if (!memory[symbol]) memory[symbol] = {};
  if (!memory[symbol][side]) {
    memory[symbol][side] = {
      entryPrice: null,
      lastPrice: null,
      lastEval: 0,
      dcaCount: 0,
      size: 0,
      lastAction: null,
      lastConfidence: null,
    };
  }
  return memory[symbol][side];
}

function isInCooldown(symbol) {
  return Date.now() - (tradeCooldown[symbol] || 0) < TRADE_COOLDOWN_MS;
}
function updateCooldown(symbol) {
  tradeCooldown[symbol] = Date.now();
}

// ---------- symbol & scanner helpers ----------
function normalize(sym) {
  return String(sym || '').toUpperCase().replace(/[-_]/g, '').replace(/USDTM?$/, '');
}
function getScannerToken(symbol, top50) {
  const norm = normalize(symbol);
  return Array.isArray(top50) ? top50.find(t => normalize(t.symbol) === norm) : undefined;
}

// ---------- smarter console logger (with de-dupe) ----------
function logDecision(symbol, message, { level = 'info', dedupeMs = 10_000 } = {}) {
  if (!window.__poseidonLogCache) window.__poseidonLogCache = {};
  const now = Date.now();
  const key = `${symbol}:${message}`;

  if (window.__poseidonLogCache[key] && now - window.__poseidonLogCache[key] < dedupeMs) {
    return; // suppress duplicate spam
  }
  window.__poseidonLogCache[key] = now;

  const line = `[${new Date().toLocaleTimeString()}] ${symbol} → ${message}`;
  if (level === 'debug')      console.debug(line);
  else if (level === 'warn')  console.warn(line);
  else if (level === 'error') console.error(line);
  else                        console.log(line);
}

// ---------- core ----------
async function evaluatePoseidonDecision(symbol, signal = null) {
  try {
    logDecision(symbol, `🧪 Analyzing ${symbol} (Manual: ${!!signal?.manual})`, { level: 'debug' });

    if (isInCooldown(symbol)) {
      logDecision(symbol, `⏳ Cooldown active — skipping ${symbol}`, { level: 'debug' });
      return;
    }

    const { top50 } = await getCachedScannerData();
    const token = getScannerToken(symbol, top50);

    const price = Number(token?.price);
    const quoteVolume = Number(token?.quoteVolume ?? token?.turnover ?? token?.volume);

    // guards
    if (!Number.isFinite(price) || price <= 0) {
      logDecision(symbol, `⚠️ Invalid price for ${symbol} (got: ${token?.price})`, { level: 'warn' });
      return;
    }
    if (quoteVolume > MAX_VOLUME_CAP && !signal?.override) {
      logDecision(symbol, `❌ Skipping — too much quote volume (${(quoteVolume / 1e6).toFixed(1)}M)`, { level: 'debug' });
      return;
    }
    if (quoteVolume < MIN_VOLUME_CAP) {
      logDecision(symbol, `❌ Skipping — quote volume too low (${(quoteVolume / 1e3).toFixed(0)}K)`, { level: 'debug' });
      return;
    }

    // memory gating
    const mem = getMemory(symbol);
    for (const side of ['LONG', 'SHORT']) {
      const m = mem[side];
      if (m.trades >= 8 && m.wins / m.trades < 0.3 && Math.abs(m.currentStreak) > 2) {
        logDecision(symbol, `❌ Skipping ${side} — cold memory (W:${m.wins}/${m.trades}, Streak:${m.currentStreak})`, { level: 'debug' });
        return;
      }
    }

    // PPDA hook on high confidence non-manual
    if (!signal?.manual && Number(signal?.confidence) >= 75) {
      const phase = await detectTrendPhase(symbol).catch(() => null);
      if (phase && ['peak', 'reversal'].includes(phase.phase)) {
        logDecision(symbol, `🔀 PPDA Trigger — ${symbol} (${phase.phase}, C:${signal.confidence})`);
        openDualEntry({ symbol, highConfidenceSide: 'SHORT', lowConfidenceSide: 'LONG', baseAmount: 1 });
        updateCooldown(symbol);
        return;
      }
    }

    // Decide side:
    let desiredSide = signal?.forceLong ? 'long'
      : (signal?.signal === 'bullish' ? 'long'
      : (signal?.signal === 'bearish' ? 'short' : 'short'));

    const sides = [desiredSide];

    for (const side of sides) {
      // require conviction when not manual
      let allowTrade = !!signal?.manual;
      if (!allowTrade) {
        const phase = await detectTrendPhase(symbol).catch(() => null);
        if (phase && ['reversal', 'peak'].includes(phase.phase)) {
          logDecision(symbol, `📉 Phase: ${phase.phase} (${Array.isArray(phase.reasons) ? phase.reasons.join(', ') : ''})`, { level: 'debug' });
          allowTrade = true;
        } else {
          logDecision(symbol, `⛔ Trend not aligned (${phase?.phase || 'unknown'})`, { level: 'debug' });
        }
      }
      if (!allowTrade) continue;

      const S = getState(symbol, side);
      if (Number.isFinite(Number(signal?.confidence))) S.lastConfidence = Number(signal.confidence);

      // ENTRY
      if (!S.entryPrice) {
        S.entryPrice = price;
        S.lastPrice = price;
        S.lastEval = Date.now();
        S.dcaCount = 0;
        S.size = 1;
        S.lastAction = 'ENTRY';

        // wallet.available OR number
        let walletRaw;
        try { walletRaw = await getWalletBalance(); } catch { walletRaw = 0; }
        const wallet = { available: Number(typeof walletRaw === 'number' ? walletRaw : (walletRaw?.available ?? 0)) };

        let basePercent = Number(signal?.confidence) >= 85 ? 0.25 : 0.10;
        let capital = wallet.available * basePercent;
        capital = Math.min(capital, 250);
        const size = +(capital / price).toFixed(3);

        capitalState.update(wallet, [capital]);
        logDecision(symbol, `🚀 ${side.toUpperCase()} entry @ ${price} (size: ${size})`);
        updateCooldown(symbol);
        continue;
      }

      // UPDATE (TP/DCA rules)
      S.lastPrice = price;
      S.lastEval = Date.now();

      // Side-aware delta (% PnL relative to entry)
      const entry = Number(S.entryPrice);
      const isLong = side === 'long';
      const delta = isLong
        ? ((price / entry) - 1) * 100
        : ((entry / price) - 1) * 100;

      const TP = 10;     // take-profit threshold (% gain)
      const DCA = -7;    // add risk threshold (% loss)
      const SL = -1000;  // (placeholder — wire SL later)
      const maxDCA = lossRecoveryMode ? 1 : 2;

      // TP
      if (delta >= TP) {
        updateMemoryFromResult(symbol, side.toUpperCase(), 'win', delta, S.lastConfidence, {
          dcaCount: S.dcaCount,
          tradeType: side,
          time: Date.now()
        });
        logDecision(symbol, `✅ [${side.toUpperCase()}] TAKE PROFIT at +${delta.toFixed(2)}%`);
        S.entryPrice = null;
        S.dcaCount = 0;
        S.size = 1;
        failureStreak = 0;
        if (lossRecoveryMode) {
          lossRecoveryMode = false;
          logDecision(symbol, '🟢 Exiting recovery mode.', { level: 'debug' });
        }
        continue;
      }

      // DCA
      if (delta <= DCA && S.dcaCount < maxDCA) {
        S.entryPrice = (S.entryPrice * S.size + price) / (S.size + 1);
        S.dcaCount += 1;
        S.size += 1;

        updateMemoryFromResult(symbol, side.toUpperCase(), 'loss', delta, S.lastConfidence, {
          dcaCount: S.dcaCount,
          tradeType: side,
          time: Date.now()
        });
        logDecision(symbol, `📉 [${side.toUpperCase()}] DCA at ${delta.toFixed(2)}% (dca=${S.dcaCount})`);
        failureStreak += 1;
        checkFailureStreak();
        continue;
      }

      // (optional future) SL if you wire it:
      // if (delta <= SL) { ... }

      logDecision(symbol, `[${side.toUpperCase()}] ⏳ HOLD — Δ ${delta.toFixed(2)}%`, { level: 'debug' });
    }

    const mm = getMemory(symbol);
    logDecision(symbol, `📊 W/L: LONG ${mm.LONG.wins}/${mm.LONG.trades}, SHORT ${mm.SHORT.wins}/${mm.SHORT.trades}`, { level: 'debug' });
  } catch (err) {
    console.error(`❌ Fatal error: ${symbol}:`, err.message);
  }
}

function checkFailureStreak() {
  if (failureStreak >= 3) {
    logDecision('SYSTEM', '🔴 Auto Shutdown — 3 consecutive failures');
    triggerAutoShutdownWithCooldown();
    lossRecoveryMode = true;
    failureStreak = 0;
  }
}

function initFuturesDecisionEngine() {
  if (intervalStarted) return;
  intervalStarted = true;
  console.log('✅ Poseidon Engine Initialized');
}

async function getActiveSymbols() {
  try {
    const res = await fetch('/api/scan-tokens');
    const data = await res.json();
    const all = [...(data?.gainers || []), ...(data?.losers || [])].map(t => t.symbol);
    return all;
  } catch (err) {
    console.warn('⚠️ Failed to fetch active symbols:', err.message);
    return [];
  }
}

export {
  evaluatePoseidonDecision,
  initFuturesDecisionEngine,
  getActiveSymbols
};