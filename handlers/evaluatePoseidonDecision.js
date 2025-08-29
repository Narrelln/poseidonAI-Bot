// === evaluatePoseidonDecision.js — Symbol-level Trade Decision Engine (TP-Enhanced, QuoteVolume-aware) ===

const { getPattern } = require('./data/tokenPatternMemory');
const { updateMemoryFromResult, getMemory } = require('./data/updateMemoryFromResult.js');
const { triggerAutoShutdownWithCooldown } = require('./poseidonBotModule.js');
const { detectTrendPhase } = require('./trendPhaseDetector.js');
const { openDualEntry } = require('./ppdaEngine.js');
const { getWalletBalance } = require('./walletModule.js');
const { fetchTA } = require('./taClient.js'); // ✅ TA source (returns price, rsi, quoteVolume/volumeBase, ranges)

const formatVolume = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`;

const MAX_VOLUME_CAP = 20_000_000;
const MIN_VOLUME_CAP = 100_000;
const TRADE_COOLDOWN_MS = 60_000;

let memory = {};
let failureStreak = 0;
let lossRecoveryMode = false;
const tradeCooldown = {};

const capitalState = {
  total: 0,
  allocated: 0,
  free: 0,
  update(wallet, allocations = []) {
    this.total = wallet.available;
    this.allocated = allocations.reduce((sum, a) => sum + a, 0);
    this.free = Math.max(this.total - this.allocated, 0);
  }
};

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
      tpTarget: null,
      tpReached: false,
      holdingForMoon: false
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

function checkFailureStreak() {
  if (failureStreak >= 3) {
    logDecision("SYSTEM", "🔴 Auto Shutdown — 3 consecutive failures");
    triggerAutoShutdownWithCooldown();
    lossRecoveryMode = true;
    failureStreak = 0;
  }
}

function logDecision(symbol, message) {
  console.log(`[${new Date().toLocaleTimeString()}] ${symbol} → ${message}`);
}

// Dynamic TP bands based on confidence
function determineTP(confidence) {
  if (confidence >= 90) return 60;
  if (confidence >= 85) return 40;
  if (confidence >= 75) return 30;
  return 20;
}

/**
 * Main decision evaluator (non-invasive patches):
 * - Prefers quoteVolume (USDT) over base volume
 * - Backfills ranges from TA when not in signal
 * - Safe RSI selection (signal → TA → 0)
 * - Computes dynamic TP% and attaches to signal (no auto-close here)
 */
async function evaluatePoseidonDecision(symbol, signal = null) {
  console.log(`[POSEIDON] Evaluating ${symbol}:`, signal);
  logDecision(symbol, `🧪 Analyzing ${symbol} (Manual: ${signal?.manual})`);

  if (isInCooldown(symbol)) {
    logDecision(symbol, `⏳ Cooldown active — skipping ${symbol}`);
    return;
  }

  try {
    // Pull TA once (server already enforces volume gates in TA route)
    const ta = await fetchTA(symbol);
    const price = Number(ta?.price || 0);

    if (!Number.isFinite(price) || price <= 0) {
      logDecision(symbol, `⚠️ Invalid price from TA for ${symbol}`);
      return;
    }

    // Prefer quote volume (USDT). Fall back to base units if needed.
    const volReal = Number(
      signal?.quoteVolume ??
      ta?.quoteVolume ??
      ta?.volumeBase ??
      ta?.volume ?? 0
    );

    // Backfill ranges from TA if missing on the signal
    const range24h = (signal && signal.range24h) || ta?.range24h || null;
    const range7D  = (signal && signal.range7D)  || ta?.range7D  || null;
    const range30D = (signal && signal.range30D) || ta?.range30D || null;

    // Safe RSI selection
    const rsi = Number.isFinite(Number(signal?.rsi)) ? Number(signal.rsi)
              : Number.isFinite(Number(ta?.rsi))      ? Number(ta.rsi)
              : 0;

    // Token pattern / profile
    const profile = getPattern(symbol);
    const isWhitelisted = !!profile?.whitelisted;

    // Required min volume per profile (default to MIN_VOLUME_CAP)
    const vol = Number(
      signal?.quoteVolume ??
      signal?.volume ??
      volReal
    );
    const requiredVolume = Number(profile?.needsVolume ?? MIN_VOLUME_CAP);

    if (!(Number.isFinite(vol) && vol >= requiredVolume)) {
      logDecision(symbol, `🔇 Skipping – Volume too low (${formatVolume(vol)} < ${formatVolume(requiredVolume)})`);
      return;
    }

    if (volReal > MAX_VOLUME_CAP && !isWhitelisted && !signal?.override) {
      logDecision(symbol, `❌ Skipping — too much volume (${(volReal / 1e6).toFixed(1)}M)`);
      return;
    }
    if (isWhitelisted && volReal > MAX_VOLUME_CAP) {
      logDecision(symbol, `🟢 Whitelisted — ignoring volume cap (${(volReal / 1e6).toFixed(1)}M)`);
    }

    // Optional RSI gating if profile requires it
    if (profile?.requiresHighRSI && rsi < 75) {
      logDecision(symbol, `⚠️ Skipping – ${symbol} needs stronger RSI (${rsi})`);
      return;
    }

    // Range helper predicates (guard for null ranges)
    const isNearRangeHigh = (range) => range && Number.isFinite(range.high) && price >= range.high * 0.99;
    const isNearRangeLow  = (range) => range && Number.isFinite(range.low)  && price <= range.low  * 1.01;
    const isBreakingOut   = (range) => range && Number.isFinite(range.high) && price >  range.high;
    const isReversing     = (range) => range && Number.isFinite(range.low)  && price <  range.low;

    // Non-manual cautions (unchanged behavior, just safer guards)
    if (!signal?.manual) {
      if (isNearRangeHigh(range24h)) {
        logDecision(symbol, `⛔ Near 24H ATH (${price}) → Skipping or shorting`);
        return;
      }
      if (isNearRangeHigh(range7D)) {
        logDecision(symbol, `⚠️ Near 7D ATH (${price}) → Short setup possible`);
      }
      if (isNearRangeHigh(range30D)) {
        logDecision(symbol, `⚠️ Near 30D ATH (${price}) → Short preferred`);
      }
      if (isBreakingOut(range7D)) {
        if (rsi >= 60 && rsi <= 80 && !signal?.trapWarning) {
          logDecision(symbol, `📈 Breakout continuation confirmed (RSI: ${rsi})`);
        } else {
          logDecision(symbol, `⚠️ Breakout weak or risky (RSI: ${rsi}, Trap: ${signal?.trapWarning})`);
          return;
        }
      }
      if (isBreakingOut(range30D)) {
        logDecision(symbol, `🚀 ATH breakout! ${price} > 30D High (${range30D?.high})`);
        if (signal?.trapWarning || rsi > 85) {
          logDecision(symbol, `⚠️ Caution — breakout may be unsustainable (Trap: ${signal?.trapWarning}, RSI: ${rsi})`);
          return;
        }
      }
      if (isReversing(range24h)) {
        logDecision(symbol, `📉 Breakdown below 24H ATL — potential rebound or breakdown`);
      }
      if (isNearRangeLow(range24h) || isNearRangeLow(range7D)) {
        logDecision(symbol, `🔍 Watching ATL zone for rebound confirmation`);
      }
    }

    // Memory guardrails (unchanged)
    const mem = getMemory(symbol);
    for (const side of ['LONG', 'SHORT']) {
      const m = mem[side] || { wins: 0, trades: 0, currentStreak: 0 };
      if (m.trades >= 8 && m.wins / m.trades < 0.3 && Math.abs(m.currentStreak) > 2) {
        logDecision(symbol, `❌ Skipping ${side} — cold memory (W:${m.wins}/${m.trades}, Streak:${m.currentStreak})`);
        return;
      }
    }

    // PPDA trigger (unchanged)
    if (!signal?.manual && Number(signal?.confidence) >= 75) {
      const phase = await detectTrendPhase(symbol);
      if (['peak', 'reversal'].includes(phase?.phase)) {
        logDecision(symbol, `🔀 PPDA Trigger — ${symbol} (${phase.phase}, C:${signal.confidence})`);
        openDualEntry({ symbol, highConfidenceSide: 'SHORT', lowConfidenceSide: 'LONG', baseAmount: 1 });
        updateCooldown(symbol);
        return;
      }
    }

    // --- Dynamic TP% wiring (no auto-close here) ---
    const conf = Number(signal?.confidence ?? ta?.confidence ?? 0);
    if (signal && signal.tpPercent == null) {
      signal.tpPercent = determineTP(conf); // expose to your downstream entry/executor logic
      logDecision(symbol, `🎯 Computed TP% from confidence=${conf} → ${signal.tpPercent}%`);
    }

    // ✅ Remaining logic stays yours (entry/DCA/SL/TP executor etc.)
    // Keep using: price, volReal/vol, rsi, signal.tpPercent, memory, capitalState, etc.

  } catch (err) {
    console.error(`❌ Fatal error: ${symbol}:`, err.message);
  }
}

module.exports = {
  evaluatePoseidonDecision,
  updateMemoryFromResult,
  getMemory
};