// handlers/sessionStatsModule.js — Live Session Stats (auto-fetch)
//
// What it does
// - On every getSessionStats() call, fetches live data from your HTTP APIs:
//   • /api/positions        → open trades + live PnL
//   • /api/scan-tokens      → token count (top list)
//   • /api/wallet-balance   → if reachable → wallets=1, else 0
//
// - Falls back to in-memory values if endpoints fail
// - Keeps the old setters around (no breaking changes)

const axios = require('axios');

// In-memory fallbacks (kept for compatibility)
let activeSymbols = [];
let trackedWallets = [];
let activeTrades = [];

function setActiveSymbols(symbols = []) { activeSymbols = symbols; }
function setTrackedWallets(walletList = []) { trackedWallets = walletList; }
function setActiveTrades(list = []) { activeTrades = list; }

// Local server base
const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

// Helpers
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// Live fetchers
async function fetchOpenPositions() {
  try {
    const { data } = await axios.get(`${BASE}/api/positions`, { timeout: 6000 });
    return Array.isArray(data?.positions) ? data.positions : [];
  } catch {
    return [];
  }
}

async function fetchTokenCount() {
  try {
    const { data } = await axios.get(`${BASE}/api/scan-tokens`, { timeout: 6000 });
    // Prefer top50 if present; else count unique from gainers/losers
    if (Array.isArray(data?.top50)) return data.top50.length;
    const pool = [
      ...(Array.isArray(data?.gainers) ? data.gainers : []),
      ...(Array.isArray(data?.losers) ? data.losers : []),
    ];
    const uniq = new Set(pool.map(t => (t?.symbol || t || '').toString()));
    return uniq.size;
  } catch {
    return 0;
  }
}

async function detectWalletPresent() {
  try {
    const { data } = await axios.get(`${BASE}/api/wallet-balance`, { timeout: 6000 });
    // If endpoint responds with a number (or success), assume one primary wallet
    if (data && (typeof data === 'number' || typeof data?.balance === 'number' || data?.success)) {
      return 1;
    }
    return 0;
  } catch {
    return 0;
  }
}

// === Public: compute session stats live, with graceful fallbacks ===
async function getSessionStats() {
  try {
    const [positions, tokenCount, walletCount] = await Promise.all([
      fetchOpenPositions(),
      fetchTokenCount(),
      detectWalletPresent(),
    ]);

    // Live PnL score: sum of pnlValue/pnl across open positions
    let pnlScore = 0;
    for (const p of positions) {
      const v = num(p.pnlValue, null);
      const alt = num(p.pnl, null);
      if (Number.isFinite(v)) pnlScore += v;
      else if (Number.isFinite(alt)) pnlScore += alt;
    }

    return {
      pnlScore: Number(pnlScore.toFixed(2)),
      wallets: walletCount || (Array.isArray(trackedWallets) ? trackedWallets.length : 0),
      tokens: tokenCount || (Array.isArray(activeSymbols) ? activeSymbols.length : 0),
      trades: Array.isArray(positions) && positions.length
        ? positions.length
        : (Array.isArray(activeTrades) ? activeTrades.length : 0),
    };
  } catch (err) {
    // Final safety fallback to in-memory values
    return {
      pnlScore: 0,
      wallets: Array.isArray(trackedWallets) ? trackedWallets.length : 0,
      tokens: Array.isArray(activeSymbols) ? activeSymbols.length : 0,
      trades: Array.isArray(activeTrades) ? activeTrades.length : 0,
    };
  }
}

module.exports = {
  setActiveSymbols,
  setTrackedWallets,
  setActiveTrades,
  getSessionStats,
};