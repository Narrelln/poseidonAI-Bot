// === handlers/futuresOps.js — Backend-compatible Futures Utilities (patched) ===

const {
  getScanTokenBySymbol,
  getCachedTokens,
  refreshScanTokens
} = require('./futuresApi'); // ✅ scanner-backed, with internal symbol normalization

// Optional: wallet helpers (keep soft dependency)
let getOpenPositions = async () => [];
let getWalletBalance = async () => ({ available: 0 });
try {
  ({ getOpenPositions, getWalletBalance } = require('../utils/walletHelper'));
} catch (_) {
  // no-op: functions above return safe defaults
}

/* -------------------------- number helpers --------------------------- */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/* -------------------------- formatters ------------------------------- */
// Price → up to 6 dp (no trailing “NaN”)
function formatPrice(value) {
  const n = toNum(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(6);
}

// Volume → compacts in K/M (handles 0/NaN safely)
function formatVolume(value) {
  const n = toNum(value);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toString();
}

// Backend-safe log feed (single line, easy to grep)
function logToFeed(msg) {
  console.log(`🧾 ${msg}`);
}

/* -------------------------- scanner helpers -------------------------- */
/**
 * Retrieves scanner row for a symbol (base, spot, or contract form) with a
 * best-effort cache refresh if missing.
 * @returns {Promise<{symbol:string, price:number, quoteVolume:number} | null>}
 */
async function getScannerRow(symbol) {
  // First try current cache
  let row = getScanTokenBySymbol(symbol);
  if (!row) {
    // Force a refresh once and try again
    try { await refreshScanTokens(); } catch (_) {}
    row = getScanTokenBySymbol(symbol);
  }
  if (!row) return null;

  // Normalize numbers defensively
  const price = toNum(row.price ?? row.lastPrice);
  const quoteVolume = toNum(row.quoteVolume ?? row.turnover ?? row.volume);
  return {
    symbol: String(row.symbol || '').toUpperCase(),
    price: Number.isFinite(price) ? price : NaN,
    quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : NaN
  };
}

/**
 * Lightweight helper to get { price, quoteVolume } pair for any symbol.
 * Returns null if not available or invalid.
 */
async function getScannerPriceVolume(symbol) {
  const row = await getScannerRow(symbol);
  if (!row || !(row.price > 0) || !(row.quoteVolume >= 0)) return null;
  return { price: row.price, quoteVolume: row.quoteVolume };
}

/* -------------------------- trade math ------------------------------- */
/**
 * Calculates an estimated *token units* amount for a given USD allocation using
 * the scanner price. This is only for UI/preview; placement should use
 * notionalUsd directly (margin-first flow).
 */
async function calculateTradeAmount(symbol, allocationUsd = 20) {
  try {
    const row = await getScannerRow(symbol);
    const price = row?.price;
    if (!(price > 0)) return 0;
    const units = allocationUsd / price;
    // Keep 3 dp for readability; executors will round to lot size later
    return +units.toFixed(3);
  } catch (err) {
    console.warn('⚠️ Trade amount error:', err.message);
    return 0;
  }
}

module.exports = {
  // scanner-backed exports
  getScanTokenBySymbol,
  getCachedTokens,
  refreshScanTokens,

  // wallet hooks (soft)
  getOpenPositions,
  getWalletBalance,

  // helpers
  calculateTradeAmount,
  getScannerPriceVolume,
  formatPrice,
  formatVolume,
  logToFeed
};