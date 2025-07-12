// sessionStatsModule.js — Live Session Stats (Patched, Live Data)

import { getCapitalStatus } from './capitalRiskEngine.js';
import { getOpenPositions } from './futuresApi.js';

// Live session data (injected or auto-fetched)
export let activeSymbols = [];
export let trackedWallets = [];
export let activeTrades = [];

// External Setters
export function setActiveSymbols(symbols = []) { activeSymbols = symbols; }
export function setTrackedWallets(walletList = []) { trackedWallets = walletList; }
export function setActiveTrades(list = []) { activeTrades = list; }

// === Session Stats Init ===
export function initSessionStats() {
  console.log("📊 Session stats tracking initialized.");
  updateSessionStats();
  setInterval(updateSessionStats, 10000);
}

// === Update UI Panel ===
async function updateSessionStats() {
  const pnlEl = document.getElementById("session-pnl");
  const walletEl = document.getElementById("wallets-tracked");
  const tokenEl = document.getElementById("tokens-monitored");
  const tradeEl = document.getElementById("active-trades");

  let liveTrades = activeTrades;
  try {
    // --- Always refresh live trades from backend if not injected
    if (!activeTrades.length) {
      liveTrades = await getOpenPositions();
    }
    // --- PATCH: Defensive fallback for undefined/null lists
    const numWallets = Array.isArray(trackedWallets) ? trackedWallets.length : 0;
    const numTokens = Array.isArray(activeSymbols) ? activeSymbols.length : 0;
    const numTrades = Array.isArray(liveTrades) ? liveTrades.length : 0;

    // --- Session PnL: Prefer capital engine, else sum live trade PNL
    let pnlScore = 0;
    const pnlStatus = getCapitalStatus && typeof getCapitalStatus === 'function'
      ? getCapitalStatus()
      : null;
    if (pnlStatus && typeof pnlStatus.score === "number") {
      pnlScore = pnlStatus.score;
    } else if (numTrades) {
      pnlScore = liveTrades.reduce((sum, pos) => sum + Number(pos.pnlValue || 0), 0);
    }

    if (pnlEl) pnlEl.textContent = `${Number(pnlScore).toFixed(2)}%`;
    if (walletEl) walletEl.textContent = numWallets;
    if (tokenEl) tokenEl.textContent = numTokens;
    if (tradeEl) tradeEl.textContent = numTrades;
  } catch (err) {
    console.warn("⚠️ Stats update failed:", err.message);
    if (pnlEl) pnlEl.textContent = "0.00%";
    if (walletEl) walletEl.textContent = "0";
    if (tokenEl) tokenEl.textContent = "0";
    if (tradeEl) tradeEl.textContent = "0";
  }
}