// === utils/walletHelper.js — Wallet + Position Helpers ===

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

// ✅ Get wallet balance from backend
async function getWalletBalance() {
  try {
    const res = await axios.get(`${BASE_URL}/api/wallet`);
    const json = res.data;

    const total = parseFloat(json?.balance?.total || 0);
    const used = parseFloat(json?.balance?.used || 0);

    return !isNaN(total - used) ? total - used : null;
  } catch (err) {
    console.warn('⚠️ Wallet fetch error:', err.message);
    return null;
  }
}

// ✅ Get all open positions, or filter by symbol
async function getOpenPositions(symbol = null) {
  try {
    const res = await axios.get(`${BASE_URL}/api/positions`);
    if (!res.data?.success) throw new Error('Bad positions response');

    const all = res.data.positions || [];
    if (!symbol) return all;

    const filtered = {};
    const target = symbol.toUpperCase();

    for (const p of all) {
      if (p.symbol === target || p.contract === target) {
        const side = p.side?.toUpperCase();
        if (side === 'BUY' || side === 'SELL') {
          filtered[side] = p;
        }
      }
    }

    return filtered;
  } catch (err) {
    console.warn('⚠️ Position fetch error:', err.message);
    return symbol ? {} : [];
  }
}

module.exports = {
  getWalletBalance,
  getOpenPositions
};