// utils/marketScanner.js
// Utility-only fetchers for KuCoin Futures

const axios = require('axios');

const normalizeSymbol = (symbol) =>
  symbol
    .replace(/-?USDTM$/i, '')
    .replace(/-?USDT$/i, '')
    .replace(/[^A-Z]/gi, '')
    .toUpperCase();

const toKucoinContract = (symbol) => `${normalizeSymbol(symbol)}-USDTM`;
const toBybitSymbol   = (symbol) => `${normalizeSymbol(symbol)}USDT`;

/**
 * Fetch the full array of futures tickers (bulk snapshot).
 * Returns an array of objects: { symbol, price, volValue, changeRate, … }
 */
async function fetchBulkTickers() {
  const url = 'https://api-futures.kucoin.com/api/v1/market/ticker?type=all';
  try {
    const res  = await axios.get(url);
    const list = res.data?.data || [];
    console.log(`✅ Loaded ${list.length} futures tickers.`);
    return list;
  } catch (err) {
    console.error('❌ fetchBulkTickers failed:', err.message);
    return [];
  }
}

/**
 * Fetch the list of active contracts.
 * Returns an array of contract objects (filtered to USDT-margined, status “Open”).
 */
async function fetchKucoinContracts() {
  const url = 'https://api-futures.kucoin.com/api/v1/contracts/active';
  try {
    const res  = await axios.get(url);
    const raw  = Array.isArray(res.data?.data)
      ? res.data.data
      : Object.values(res.data?.data || {});
    console.log(`📦 Raw contracts fetched: ${raw.length}`);

    const valid = raw.filter(c => {
      const ok =
        c &&
        typeof c.symbol === 'string' &&
        c.symbol.endsWith('USDTM') &&
        c.status === 'Open';
      if (!ok) console.warn(`[SKIP] Invalid/closed contract: ${c?.symbol}`);
      return ok;
    });

    console.log(`✅ Valid tradable contracts: ${valid.length}`);
    return valid;
  } catch (err) {
    console.error('❌ fetchKucoinContracts failed:', err.message);
    return [];
  }
}

/**
 * Fallback single-symbol price fetch.
 */
async function fetchTickerPrice(symbol) {
  try {
    const url  = `https://api-futures.kucoin.com/api/v1/market/ticker?symbol=${symbol}`;
    const res  = await axios.get(url);
    const data = res.data?.data || {};
    const price = parseFloat(data.price || data.last);
    if (!price || isNaN(price)) throw new Error('Invalid price');
    return price;
  } catch (err) {
    console.warn(`❌ fetchTickerPrice failed for ${symbol}:`, err.message);
    return null;
  }
}

module.exports = {
  normalizeSymbol,
  toKucoinContract,
  toBybitSymbol,
  fetchKucoinContracts,
  fetchTickerPrice,
  fetchBulkTickers,
};