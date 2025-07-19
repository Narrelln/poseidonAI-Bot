// === futuresDecisionEngine.js — Poseidon Deep Learning Trade Engine (With Capital Health) ===

import { fetchFuturesPrice, fetchVolumeAndOI } from './futuresApi.js';
import { updateMemoryFromResult, getMemory } from './updateMemoryFromResult.js';
import { triggerAutoShutdownWithCooldown } from './poseidonBotModule.js';
// import { getActiveSymbols } from './futuresSignalModule.js';
// Symbol logic is now handled entirely by Poseidon scanner
import { getActiveSymbols, refreshSymbols } from './poseidonScanner.js';
import { detectTrendPhase } from './trendPhaseDetector.js';
import { openDualEntry } from './ppdaEngine.js';
import { getWalletBalance } from './walletModule.js';

let memory = {};
let failureStreak = 0;
let lossRecoveryMode = false;
let intervalStarted = false;
let tradeCooldown = {}; // ⏳ Symbol-based cooldown

const MAX_VOLUME_CAP = 20_000_000;
const MIN_VOLUME_CAP = 100_000;
const TRADE_COOLDOWN_MS = 60_000; // 1 minute between trades per symbol

// 💰 Capital Health Tracker
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

export async function evaluatePoseidonDecision(symbol, signal = null) {
  console.log(`[POSEIDON] Evaluating ${symbol}:`, signal);
  logDecision(symbol, `🧪 Analyzing ${symbol} (Manual: ${signal?.manual})`);

  if (isInCooldown(symbol)) {
    logDecision(symbol, `⏳ Cooldown active — skipping ${symbol}`);
    return;
  }

  try {
    const priceData = await fetchFuturesPrice(symbol);
    const price = parseFloat(priceData?.price || 0);
    if (!price || isNaN(price) || price === 0) {
      logDecision(symbol, `⚠️ Invalid price for ${symbol}`);
      return;
    }

    const mem = getMemory(symbol);
    for (const side of ["LONG", "SHORT"]) {
      const m = mem[side];
      if (m.trades >= 8 && m.wins / m.trades < 0.3 && Math.abs(m.currentStreak) > 2) {
        logDecision(symbol, `❌ Skipping ${side} — cold memory (W:${m.wins}/${m.trades}, Streak:${m.currentStreak})`);
        return;
      }
    }

    let volume = 0;
    try {
      const volumeData = await fetchVolumeAndOI(symbol);
      volume = parseFloat(volumeData?.volume || 0);
    } catch (err) {
      console.warn(`⚠️ Volume fetch failed for ${symbol}:`, err.message);
      return;
    }

    if (volume > MAX_VOLUME_CAP && !signal?.override) {
      logDecision(symbol, `❌ Skipping — too much volume (${(volume / 1e6).toFixed(1)}M)`);
      return;
    }
    if (volume < MIN_VOLUME_CAP) {
      logDecision(symbol, `❌ Skipping — volume too low (${(volume / 1e3).toFixed(0)}K)`);
      return;
    }

    // === ✅ PPDA Auto Entry
    if (!signal?.manual && signal?.confidence >= 75) {
      const phase = await detectTrendPhase(symbol);
      if (["peak", "reversal"].includes(phase?.phase)) {
        logDecision(symbol, `🔀 PPDA Trigger — ${symbol} (${phase.phase}, C:${signal.confidence})`);
        openDualEntry({ symbol, highConfidenceSide: "SHORT", lowConfidenceSide: "LONG", baseAmount: 1 });
        updateCooldown(symbol);
        return;
      }
    }

    // === Sides Preference ===
    let sides = signal?.forceLong ? ["long"] : ["short"];
    for (const side of sides) {
      if (side === "long" && !signal?.forceLong && !signal?.ppda && !signal?.manual) {
        logDecision(symbol, `🚫 Skipping LONG — not high conviction`);
        continue;
      }

      let allowTrade = signal?.manual;
      if (!signal?.manual) {
        const phase = await detectTrendPhase(symbol);
        if (["reversal", "peak"].includes(phase?.phase)) {
          logDecision(symbol, `📉 Phase: ${phase.phase} (${phase.reasons?.join(', ')})`);
          allowTrade = true;
        } else {
          logDecision(symbol, `⛔ Trend not aligned (${phase?.phase || 'unknown'})`);
        }
      }

      if (!allowTrade) continue;

      const state = getState(symbol, side);
      if (signal?.confidence) state.lastConfidence = signal.confidence;

      if (!state.entryPrice) {
        // === Initial Entry ===
        state.entryPrice = price;
        state.lastPrice = price;
        state.lastEval = Date.now();
        state.dcaCount = 0;
        state.size = 1;
        state.lastAction = "ENTRY";

        // === Capital Allocation Logic ===
        let wallet = await getWalletBalance();
        let basePercent = 0.10;
        if (signal?.confidence >= 85) basePercent = 0.25;

        let capital = wallet.available * basePercent;
        capital = Math.min(capital, 250); // cap at $250
        const size = +(capital / price).toFixed(3);

        // 💰 Update Capital Health
        capitalState.update(wallet, [capital]);
        logDecision(symbol, `💰 Capital Health: Total $${capitalState.total.toFixed(2)}, Allocated $${capitalState.allocated.toFixed(2)}, Free $${capitalState.free.toFixed(2)}`);

        updateCooldown(symbol);
        logDecision(symbol, `🚀 ${side.toUpperCase()} entry at ${price} (size: ${size})`);

        try {
          const res = await fetch("/api/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contract: symbol,
              side,
              leverage: 5,
              size,
              type: "market"
            })
          });
          const json = await res.json();
          if (json.code === "SUCCESS") {
            logDecision(symbol, `✅ Order placed at ${json.data.entry}`);
          } else {
            logDecision(symbol, `❌ Trade rejected: ${json.msg || 'Unknown'}`);
          }
        } catch (err) {
          logDecision(symbol, `❌ Order error: ${err.message}`);
        }

        continue;
      }

      // === Existing Position ===
      state.lastPrice = price;
      state.lastEval = Date.now();
      const delta = ((state.entryPrice - price) / state.entryPrice) * 100;

      const TP = 10, DCA = -7, SL = -1000;
      const maxDCA = lossRecoveryMode ? 1 : 2;

      try {
        const confirmed = await window.confirmBullishRecovery?.(symbol);
        if (confirmed) {
          updateMemoryFromResult(symbol, side.toUpperCase(), "loss", delta, state.lastConfidence, {
            dcaCount: state.dcaCount,
            tradeType: side,
            time: Date.now()
          });
          logDecision(symbol, `🟢 [${side.toUpperCase()}] EXIT — recovery confirmed`);
          state.entryPrice = null;
          state.dcaCount = 0;
          state.size = 1;
          failureStreak++;
          checkFailureStreak();
          continue;
        }
      } catch {}

      if (delta >= TP) {
        updateMemoryFromResult(symbol, side.toUpperCase(), "win", delta, state.lastConfidence, {
          dcaCount: state.dcaCount,
          tradeType: side,
          time: Date.now()
        });
        logDecision(symbol, `✅ [${side.toUpperCase()}] TAKE PROFIT at +${delta.toFixed(2)}%`);
        state.entryPrice = null;
        state.dcaCount = 0;
        state.size = 1;
        failureStreak = 0;
        if (lossRecoveryMode) {
          lossRecoveryMode = false;
          logDecision(symbol, "🟢 Exiting recovery mode.");
        }
        continue;
      }

      if (delta <= DCA && state.dcaCount < maxDCA) {
        state.entryPrice = (state.entryPrice * state.size + price) / (state.size + 1);
        state.dcaCount++;
        state.size++;
        updateMemoryFromResult(symbol, side.toUpperCase(), "loss", delta, state.lastConfidence, {
          dcaCount: state.dcaCount,
          tradeType: side,
          time: Date.now()
        });
        logDecision(symbol, `📉 [${side.toUpperCase()}] DCA at ${delta.toFixed(2)}%`);
        failureStreak++;
        checkFailureStreak();
        continue;
      }

      logDecision(symbol, `[${side.toUpperCase()}] ⏳ HOLD — Δ ${delta.toFixed(2)}%`);
    }

    const mm = getMemory(symbol);
    logDecision(symbol, `📊 W/L: LONG ${mm.LONG.wins}/${mm.LONG.trades}, SHORT ${mm.SHORT.wins}/${mm.SHORT.trades}`);
  } catch (err) {
    console.error(`❌ Fatal error: ${symbol}:`, err.message);
  }
}

function checkFailureStreak() {
  if (failureStreak >= 3) {
    logDecision("SYSTEM", "🔴 Auto Shutdown — 3 consecutive failures");
    triggerAutoShutdownWithCooldown();
    lossRecoveryMode = true;
    failureStreak = 0;
  }
}

export async function makeTradeDecision(symbol, analysis) {
  return await evaluatePoseidonDecision(symbol, analysis);
}

export function initFuturesDecisionEngine() {
  if (intervalStarted) return;
  intervalStarted = true;
  console.log("✅ Poseidon Engine Initialized");
}

function logDecision(symbol, message) {
  if (typeof document !== "undefined") {
    const feed = document.getElementById("futures-log-feed");
    if (feed) {
      const div = document.createElement("div");
      div.className = "log-entry";
      div.innerText = `[${new Date().toLocaleTimeString()}] ${symbol} → ${message}`;
      feed.prepend(div);
      if (feed.children.length > 20) feed.removeChild(feed.lastChild);
    }
  }
  console.log(`[${new Date().toLocaleTimeString()}] ${symbol} → ${message}`);
}

export { getActiveSymbols };
window.evaluatePoseidonDecision = evaluatePoseidonDecision;
