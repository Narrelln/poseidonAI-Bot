// === futuresDecisionEngine.js — Poseidon Deep Learning Trade Engine (Synced with FSM, Manual Trade Enabled) ===

import { fetchFuturesPrice, fetchVolumeAndOI } from './futuresApi.js';
import { updateMemoryFromResult, getMemory } from './updateMemoryFromResult.js';
import { triggerAutoShutdownWithCooldown } from './poseidonBotModule.js';
import { getActiveSymbols } from './futuresSignalModule.js';
import { detectTrendPhase } from './trendPhaseDetector.js';

let memory = {};
let failureStreak = 0;
let lossRecoveryMode = false;
let intervalStarted = false;

const MAX_VOLUME_CAP = 20_000_000;

// === Utility: Get trade state ===
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

// === MAIN LOGIC ===
export async function evaluatePoseidonDecision(symbol, signal = null) {
  console.log(`[POSEIDON] Received decision request for ${symbol}:`, signal);
  logDecision(symbol, `🧪 Starting analysis for ${symbol} — Manual: ${signal?.manual}`);
  try {
    const priceData = await fetchFuturesPrice(symbol);
    const price = parseFloat(priceData?.price || 0);
    if (!price || isNaN(price) || price === 0) {
      logDecision(symbol, `⚠️ Skipping ${symbol} — invalid price`);
      return;
    }

    const mem = getMemory(symbol);
    let skipDueToMemory = false;
    ["LONG", "SHORT"].forEach(side => {
      const m = mem[side];
      if (m.trades >= 8 && m.wins / m.trades < 0.30 && Math.abs(m.currentStreak) > 2) {
        skipDueToMemory = true;
        logDecision(symbol, `⛔ Skipping ${side} — COLD (Winrate: ${(m.wins / m.trades * 100).toFixed(1)}%, Streak: ${m.currentStreak})`);
      }
    });
    if (skipDueToMemory) return;

    let volume = 0;
    try {
      const volumeData = await fetchVolumeAndOI(symbol);
      volume = parseFloat(volumeData?.volume || 0);
    } catch (err) {
      console.warn(`⚠️ Volume fetch failed for ${symbol}:`, err.message);
      return;
    }

    let sides = ["short"];

    for (const side of sides) {
      let allowTrade = signal?.manual;

      if (!signal?.manual) {
        const phase = await detectTrendPhase(symbol);
        if (phase?.phase === 'reversal' || phase?.phase === 'peak') {
          logDecision(symbol, `📉 Phase Detected: ${phase.phase} (${phase.reasons?.join(', ')})`);
          allowTrade = true;
        } else {
          logDecision(symbol, `⛔ Trend not ripe (${phase?.phase || 'unknown'})`);
        }
      }

      if (!allowTrade) {
        logDecision(symbol, `⛔ Skipping SHORT — no valid trend phase`);
        continue;
      }

      if (volume > MAX_VOLUME_CAP && !signal?.override) {
        logDecision(symbol, `⛔ Skipping — volume too high (${(volume / 1e6).toFixed(1)}M)`);
        continue;
      }

      const state = getState(symbol, side);
      if (signal?.confidence) state.lastConfidence = signal.confidence;

      if (!state.entryPrice) {
        state.entryPrice = price;
        state.lastPrice = price;
        state.lastEval = Date.now();
        state.dcaCount = 0;
        state.size = 1;
        state.lastAction = "ENTRY";
        logDecision(symbol, `🚀 Watching ${side.toUpperCase()} from ${price}`);

        if (signal?.manual) {
          try {
            console.log(`[MANUAL] Sending order for ${symbol} — side: ${side}`);
            const res = await fetch('/api/order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contract: symbol,
                side,
                leverage: 5,
                size: 1,
                type: 'market'
              })
            });

            const json = await res.json();
            console.log(`[MANUAL] Response from /api/order:`, json);

            if (json.code !== 'SUCCESS') {
              logDecision(symbol, `❌ Trade rejected: ${json.msg || 'Unknown error'}`);
              return;
            } else {
              logDecision(symbol, `📥 Trade placed at ${json.data.entry}`);
            }
          } catch (err) {
            console.error(`[MANUAL] Order error for ${symbol}:`, err.message);
            logDecision(symbol, `❌ Order error: ${err.message}`);
            return;
          }
        }

        continue;
      }

      state.lastPrice = price;
      state.lastEval = Date.now();
      let delta = ((state.entryPrice - price) / state.entryPrice) * 100;

      const TP = 10, DCA = -7, SL = -12;
      const maxDCA = lossRecoveryMode ? 1 : 2;

      try {
        const confirmed = await window.confirmBullishRecovery?.(symbol);
        if (confirmed) {
          updateMemoryFromResult(symbol, side.toUpperCase(), "loss", delta, state.lastConfidence || signal?.confidence || null, {
            dcaCount: state.dcaCount,
            tradeType: side,
            time: Date.now()
          });
          state.entryPrice = null;
          state.dcaCount = 0;
          state.size = 1;
          failureStreak++;
          checkFailureStreak();
          logDecision(symbol, `🟢 [${side.toUpperCase()}] EXIT — Recovery confirmed (RSI+MACD+BB)`);
          continue;
        }
      } catch {}

      if (delta >= TP) {
        updateMemoryFromResult(symbol, side.toUpperCase(), "win", delta, state.lastConfidence || signal?.confidence || null, {
          dcaCount: state.dcaCount,
          tradeType: side,
          time: Date.now()
        });
        state.entryPrice = null;
        state.dcaCount = 0;
        state.size = 1;
        failureStreak = 0;
        if (lossRecoveryMode) {
          lossRecoveryMode = false;
          logDecision(symbol, "✅ Recovery complete. Returning to normal mode.");
        }
        logDecision(symbol, `✅ [${side.toUpperCase()}] TAKE PROFIT at +${delta.toFixed(2)}%`);
        continue;
      }

      if (delta <= DCA && state.dcaCount < maxDCA) {
        state.entryPrice = (state.entryPrice * state.size + price) / (state.size + 1);
        state.dcaCount += 1;
        state.size += 1;
        updateMemoryFromResult(symbol, side.toUpperCase(), "loss", delta, state.lastConfidence || signal?.confidence || null, {
          dcaCount: state.dcaCount,
          tradeType: side,
          time: Date.now()
        });
        failureStreak++;
        checkFailureStreak();
        logDecision(symbol, `📉 [${side.toUpperCase()}] DCA triggered at ${delta.toFixed(2)}%`);
        continue;
      }

      if (delta <= SL) {
        updateMemoryFromResult(symbol, side.toUpperCase(), "loss", delta, state.lastConfidence || signal?.confidence || null, {
          dcaCount: state.dcaCount,
          tradeType: side,
          time: Date.now()
        });
        state.entryPrice = null;
        state.dcaCount = 0;
        state.size = 1;
        failureStreak++;
        checkFailureStreak();
        logDecision(symbol, `🛑 [${side.toUpperCase()}] STOP LOSS at ${delta.toFixed(2)}%`);
        continue;
      }

      logDecision(symbol, `[${side.toUpperCase()}] ⏳ HOLD — Δ ${delta.toFixed(2)}%`);
    }

    const mm = getMemory(symbol);
    logDecision(
      symbol,
      `📊 Memory: LONG W/L: ${mm.LONG.wins}/${mm.LONG.trades} | SHORT W/L: ${mm.SHORT.wins}/${mm.SHORT.trades} — [Streak L: ${mm.LONG.currentStreak}, S: ${mm.SHORT.currentStreak}]`
    );
  } catch (err) {
    console.error(`❌ Fatal error during decision for ${symbol}:`, err.message);
  }
}

function checkFailureStreak() {
  if (failureStreak >= 3) {
    logDecision('SYSTEM', "🔴 Triggering Auto Shutdown — 3 failed trades");
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
  console.log("✅ Poseidon Decision Engine synced to FSM symbols");
}

function logDecision(symbol, message) {
  if (typeof document !== "undefined") {
    const feed = document.getElementById("futures-log-feed");
    if (feed) {
      const div = document.createElement("div");
      div.className = "log-entry";
      div.innerText = `[${new Date().toLocaleTimeString()}] ${symbol} → ${message}`;
      feed.prepend(div);
      if (feed.children.length > 20) {
        feed.removeChild(feed.lastChild);
      }
    }
  }
  console.log(`[${new Date().toLocaleTimeString()}] ${symbol} → ${message}`);
}

export { getActiveSymbols };
window.evaluatePoseidonDecision = evaluatePoseidonDecision;