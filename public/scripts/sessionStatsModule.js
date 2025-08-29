// sessionStatsModule.js — Live Session Stats (Patched, with Win/Loss)

import { getCapitalStatus } from './capitalRiskEngine.js';
import { getOpenPositions } from './futuresApiClient.js';

// Live session data (externally fed)
export let activeSymbols = [];
export let trackedWallets = [];
export let activeTrades = [];

// External setters
export function setActiveSymbols(symbols = []) { activeSymbols = symbols; }
export function setTrackedWallets(walletList = []) { trackedWallets = walletList; }
export function setActiveTrades(list = []) { activeTrades = list; }

// Initialize session stats
export function initSessionStats() {
  console.log("📊 Session stats tracking initialized.");
  updateSessionStats();
  setInterval(updateSessionStats, 10000);
}

// === UI Updater ===
async function updateSessionStats() {
  const pnlEl = document.getElementById("session-pnl");
  const walletEl = document.getElementById("wallets-tracked");
  const tokenEl = document.getElementById("tokens-monitored");
  const tradeEl = document.getElementById("active-trades");
  const winEl = document.getElementById("session-wins");
  const lossEl = document.getElementById("session-losses");
  const rateEl = document.getElementById("session-winrate");

  let liveTrades = activeTrades;

  try {
    // Refresh active trades if not injected
    if (!activeTrades.length) {
      liveTrades = await getOpenPositions();
    }

    const numWallets = Array.isArray(trackedWallets) ? trackedWallets.length : 0;
    const numTokens = Array.isArray(activeSymbols) ? activeSymbols.length : 0;
    const numTrades = Array.isArray(liveTrades) ? liveTrades.length : 0;

    // Session PnL
    let pnlScore = 0;
    const pnlStatus = getCapitalStatus && typeof getCapitalStatus === 'function'
      ? getCapitalStatus()
      : null;

    if (pnlStatus && typeof pnlStatus.score === "number") {
      pnlScore = pnlStatus.score;
    } else if (numTrades) {
      pnlScore = liveTrades.reduce((sum, pos) => sum + Number(pos.pnlValue || 0), 0);
    }

    // === WIN/LOSS FETCH ===
    const memoryRes = await fetch('/api/memory');
    const memory = await memoryRes.json();

    let wins = 0, losses = 0;

    if (memory && typeof memory === 'object') {
      for (const symbol in memory) {
        const sides = memory[symbol];
        for (const side in sides) {
          const mem = sides[side];
          if (mem?.wins) wins += mem.wins;
          if (mem?.losses) losses += mem.losses;
        }
      }
    }

    const total = wins + losses;
    const winrate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    // === RENDER ALL STATS ===
    if (pnlEl) pnlEl.textContent = `${Number(pnlScore).toFixed(2)}%`;
    if (walletEl) walletEl.textContent = numWallets;
    if (tokenEl) tokenEl.textContent = numTokens;
    if (tradeEl) tradeEl.textContent = numTrades;
    if (winEl) winEl.textContent = wins;
    if (lossEl) lossEl.textContent = losses;
    if (rateEl) rateEl.textContent = `${winrate}%`;

  } catch (err) {
    console.warn("⚠️ Stats update failed:", err.message);
    if (pnlEl) pnlEl.textContent = "0.00%";
    if (walletEl) walletEl.textContent = "0";
    if (tokenEl) tokenEl.textContent = "0";
    if (tradeEl) tradeEl.textContent = "0";
    if (winEl) winEl.textContent = "0";
    if (lossEl) lossEl.textContent = "0";
    if (rateEl) rateEl.textContent = "0%";
  }
}
