// futuresExecutionModule.js — Unified Manual + Auto Futures Trade Execution

import { updateCapitalScore } from './capitalRiskEngine.js';
import { logToFeed } from './futuresUtils.js';

let activeTrades = [];

export function initFuturesExecutionModule() {
  console.log("⚙️ Futures Trade Execution Module Loaded");
  setupTradeButtons();
}

// === Setup Manual Controls ===
function setupTradeButtons() {
  const openBtn = document.getElementById("open-trade");
  const closeBtn = document.getElementById("close-trade");
  const tpBtn = document.getElementById("set-tp-sl");

  openBtn?.addEventListener("click", () => {
    const coin = prompt("🟢 Open Trade — Enter Coin (e.g., DOGEUSDT):", "DOGEUSDT");
    const direction = prompt("Direction? Type LONG or SHORT", "LONG");
    const confidence = parseFloat(prompt("Confidence level (0–100):", "80"));

    if (!coin || !direction || isNaN(confidence)) return alert("❌ Invalid trade input.");
    executeTrade(coin.toUpperCase(), direction.toUpperCase(), confidence, true);
  });

  closeBtn?.addEventListener("click", () => {
    const coin = prompt("🔴 Close Trade — Enter Coin:", "DOGEUSDT");
    if (coin) closePosition(coin.toUpperCase(), true);
  });

  tpBtn?.addEventListener("click", () => {
    const tp = prompt("🎯 Set Take Profit (%)", "20");
    const sl = prompt("🛑 Set Stop Loss (%)", "-10");

    if (tp && sl) {
      logToFeed(`🎯 TP/SL config updated → TP: ${tp}%, SL: ${sl}%`);
      alert(`TP/SL set → TP = ${tp}%, SL = ${sl}%`);
    }
  });
}

// === Auto/Manual Trade Entry Handler ===
export function executeTrade(symbol, direction, confidence, isManual = false) {
  if (!isManual && confidence < 70) {
    console.warn(`⚠️ Skipping ${symbol} — confidence too low: ${confidence}%`);
    return;
  }

  const entry = {
    symbol,
    direction,
    confidence,
    entryTime: new Date().toLocaleTimeString(),
    manual: isManual
  };

  activeTrades.push(entry);
  logTrade(entry);

  // Optional Capital Score penalty
  updateCapitalScore(-3);
}

// === Trade Exit ===
export function closePosition(symbol, isManual = false) {
  const index = activeTrades.findIndex(t => t.symbol === symbol);
  if (index !== -1) {
    const closed = activeTrades.splice(index, 1)[0];
    logClose(closed, isManual);
    updateCapitalScore(5); // Reward capital score
  }
}

export const closeTrade = closePosition; // Alias

// === Logging ===
function logTrade(trade) {
  const logEl = document.getElementById("futures-log-feed");
  if (!logEl) return;

  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `✅ [${trade.entryTime}] <strong>${trade.symbol}</strong> → ${trade.direction} @ ${trade.confidence}% ${trade.manual ? '(Manual)' : '(Auto)'}`;
  logEl.prepend(entry);
  if (logEl.children.length > 30) logEl.removeChild(logEl.lastChild);
}

function logClose(trade, isManual) {
  const logEl = document.getElementById("futures-log-feed");
  if (!logEl) return;

  const entry = document.createElement("div");
  entry.className = "log-entry closed";
  entry.innerHTML = `🔻 [${new Date().toLocaleTimeString()}] <strong>${trade.symbol}</strong> → CLOSED ${isManual ? '(Manual)' : '(Auto)'}`;
  logEl.prepend(entry);
  if (logEl.children.length > 30) logEl.removeChild(logEl.lastChild);
}