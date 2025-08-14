// === handlers/futuresOps.js — Backend-compatible Futures Utilities ===

const {
  getScanTokenBySymbol,
  getCachedTokens,
  refreshScanTokens
} = require('./futuresApi'); // ✅ Now scanner-backed

const { getOpenPositions, getWalletBalance } = require('../utils/walletHelper'); // if needed


// ✅ Formats price to 6 decimal places or returns placeholder
function formatPrice(value) {
  if (!value || isNaN(value)) return '—';
  return parseFloat(value).toFixed(6);
}

// ✅ Formats volume in K/M units
function formatVolume(value) {
  if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toFixed(0);
}

// ✅ Backend-safe log feed
function logToFeed(msg) {
  console.log(`🧾 ${msg}`);
}

// ✅ Recalculates trade quantity based on USD allocation
async function calculateTradeAmount(symbol, allocationUsd = 20) {
  try {
    const token = getScanTokenBySymbol(symbol);
    const price = parseFloat(token?.price);
    if (!price || isNaN(price)) return 0;
    return +(allocationUsd / price).toFixed(3);
  } catch (err) {
    console.warn('⚠️ Trade amount error:', err.message);
    return 0;
  }
}

module.exports = {
  getScanTokenBySymbol,
  getCachedTokens,
  refreshScanTokens,
  getOpenPositions,
  getWalletBalance,
  calculateTradeAmount,
  formatPrice,
  formatVolume,
  logToFeed
};