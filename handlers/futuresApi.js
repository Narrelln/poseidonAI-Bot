// === Updated: futuresApi.js — Now backed by /api/scan-tokens ===

const axios = require('axios');

let cachedTokens = [];
let lastUpdated = 0;
let isRefreshing = false;

async function refreshScanTokens() {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    const res = await axios.get('http://localhost:3000/api/scan-tokens');
    const json = res.data;

    if (json?.top50?.length) {
      cachedTokens = json.top50;
      lastUpdated = Date.now();
      console.log(`✅ Scanner token cache updated (${cachedTokens.length})`);
    } else {
      console.warn('⚠️ Invalid scanner data');
    }
  } catch (err) {
    console.error('❌ Scanner refresh error:', err.message);
  } finally {
    isRefreshing = false;
  }
}

async function getCachedTokens(force = false) {
  const stale = Date.now() - lastUpdated > 30_000;
  if (force || stale || !cachedTokens.length) {
    await refreshScanTokens();
  }
  return cachedTokens;
}

function normalizeSymbol(symbol) {
  return symbol.replace(/[-_]/g, '').replace(/USDTM?$/, '').toUpperCase();
}

function getScanTokenBySymbol(symbol) {
  const norm = normalizeSymbol(symbol);
  return cachedTokens.find(t => normalizeSymbol(t.symbol) === norm);
}

// ✅ Add this missing function
function toKuCoinContractSymbol(symbol) {
  if (!symbol) return '';
  let s = symbol.trim().toUpperCase();

  if (s === 'PERP' || s === 'PERPUSDT') return '';

  if (['BTCUSDT', 'BTC-USDT', 'BTCUSDTM', 'XBTUSDT'].includes(s)) {
    return 'XBT-USDTM';
  }

  s = s.replace(/[-\/]/g, '').replace(/PERP/i, '');

  if (s.endsWith('USDTM')) return s.slice(0, -5) + '-USDTM';
  if (s.endsWith('USDT')) return s.slice(0, -4) + '-USDTM';

  return s + '-USDTM';
}

module.exports = {
  getScanTokenBySymbol,
  getCachedTokens,
  refreshScanTokens,
  toKuCoinContractSymbol // ✅ now exported
};