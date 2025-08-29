// handlers/sessionStatsModule.js — Live Session Stats (auto-fetch) + BACK-COMPAT SHIMS

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
    if (data && (typeof data === 'number' || typeof data?.balance === 'number' || data?.success)) {
      return 1;
    }
    return 0;
  } catch {
    return 0;
  }
}

// === NEW: Back-compat shim for callers expecting safeReadHistory() ===
// Reads from the ledger; never throws; returns [] on failure.
async function safeReadHistory(limit = 100) {
  try {
    const { list } = require('../utils/tradeLedger');
    const rows = await list(Math.min(Math.max(Number(limit) || 100, 1), 500));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// === NEW: Back-compat shim for callers expecting safeReadPositions() ===
async function safeReadPositions() {
  try {
    return await fetchOpenPositions();
  } catch {
    return [];
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

    // Live PnL score: sum pnl/pnlValue across open positions
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
  } catch {
    return {
      pnlScore: 0,
      wallets: Array.isArray(trackedWallets) ? trackedWallets.length : 0,
      tokens: Array.isArray(activeSymbols) ? activeSymbols.length : 0,
      trades: Array.isArray(activeTrades) ? activeTrades.length : 0,
    };
  }
}

module.exports = {
  // setters
  setActiveSymbols,
  setTrackedWallets,
  setActiveTrades,
  // live stats
  getSessionStats,
  // BACK-COMPAT shims
  safeReadHistory,
  safeReadPositions,
};