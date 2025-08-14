/**
 * File #01: kucoinHelper.js
 * Description:
 *   Unified helper utilities for KuCoin futures integration in Poseidon AI.
 *   Handles:
 *     - Symbol normalization (hyphenated, non-hyphenated, TA-ready)
 *     - Contract specs caching (lot size, min size, tick size, multiplier, margin model)
 *     - Price fetching (mark price & ticker)
 *     - Order sizing from USDT value (margin-based)
 *     - Leverage setting
 *     - Wallet balance fetching
 *     - Futures symbols list
 *     - Open positions with TA price enrichment
 * Notes:
 *   - All functions here are backend-safe; no frontend references.
 *   - Uses only stable KuCoin API endpoints.
 *   - `getOpenFuturesPositions()` returns both margin value and exposure for better UI rendering.
 *   - `parseToKucoinContractSymbol()` is the standard normalization method — all other modules should use it.
 * Last Updated: 2025-08-10
 */

const axios = require('axios');
const { signKucoinV3Request } = require('./utils/signRequest');
require('dotenv').config();

const BASE_URL = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';
const API_KEY = process.env.KUCOIN_KEY;
const API_SECRET = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;

const activeKucoinSymbols = new Set();

// -----------------------------
// Symbol normalization helpers
// -----------------------------
function parseToKucoinContractSymbol(symbol) {
  // Always return "BASE-USDTM" (hyphenated futures contract)
  if (!symbol || typeof symbol !== 'string') return '';
  let s = symbol.trim().toUpperCase();

  // Strip any separators
  s = s.replace(/[^A-Z0-9]/g, '');

  // Common endings to normalize
  if (s.endsWith('USDTM')) {
    const base = s.slice(0, -5);
    return `${base}-USDTM`;
  }
  if (s.endsWith('USDT')) {
    const base = s.slice(0, -4);
    return `${base}-USDTM`;
  }
  // If only base is provided, default to USDTM futures
  return `${s}-USDTM`;
}

function toKucoinApiSymbol(contract) {
  // API query param often expects no hyphen (e.g., BTCUSDTM)
  return String(contract || '').replace(/-/g, '');
}

function toSpotSymbolForTA(input) {
  // Futures contract or raw -> "BASEUSDT" (no hyphen) for TA route
  const c = parseToKucoinContractSymbol(input);
  const base = c.replace(/-USDTM$/, '');
  return `${base}USDT`;
}

// ---------------------------------
// Contracts/Active cache & helpers
// ---------------------------------
let CONTRACT_CACHE_MAP = null;
let CONTRACT_CACHE_AT = 0;

async function loadContractCache() {
  const FRESH_MS = 5 * 60 * 1000;
  if (CONTRACT_CACHE_MAP && (Date.now() - CONTRACT_CACHE_AT) < FRESH_MS) {
    return CONTRACT_CACHE_MAP;
  }
  const endpoint = `${BASE_URL}/api/v1/contracts/active`;
  const res = await axios.get(endpoint);
  const list = res.data?.data || [];

  // Dual-key map: store entries for both hyphen ("BTC-USDTM") and no-hyphen ("BTCUSDTM")
  const map = new Map();
  for (const c of list) {
    const apiSym = String(c.symbol || '').toUpperCase(); // usually no-hyphen in response
    const hyphen = parseToKucoinContractSymbol(apiSym);
    const noHyphen = toKucoinApiSymbol(hyphen);
    const meta = {
      symbol: hyphen,
      apiSymbol: noHyphen,
      lotSize: Number(c.lotSize ?? 1),        // qty step
      minSize: Number(c.baseMinSize ?? c.minSize ?? 1), // minimum order qty (favor baseMinSize)
      tickSize: Number(c.tickSize ?? 0.0001),
      multiplier: Number(c.multiplier ?? 1),
      marginModel: String(c.marginModel || '').toLowerCase() || 'isolated'
    };
    map.set(hyphen, meta);
    map.set(noHyphen, meta);
  }
  CONTRACT_CACHE_MAP = map;
  CONTRACT_CACHE_AT = Date.now();
  return map;
}

async function getContractSpecs(symbolLike) {
  // Accept "BTC-USDTM", "BTCUSDTM", "btc", etc.
  const hyphen = parseToKucoinContractSymbol(symbolLike);
  const noHyphen = toKucoinApiSymbol(hyphen);
  const map = await loadContractCache();
  return map.get(hyphen) || map.get(noHyphen) || {
    symbol: hyphen,
    apiSymbol: noHyphen,
    lotSize: 1,
    minSize: 1,
    tickSize: 0.0001,
    multiplier: 1,
    marginModel: 'isolated'
  };
}

// -----------------------------
// Rounding helpers
// -----------------------------
function roundToLot(qty, lotSize = 1) {
  if (!(qty > 0) || !(lotSize > 0)) return 0;
  // Floor to lot (contracts are integers/steps)
  return Math.floor(qty / lotSize) * lotSize;
}

function enforceMinSize(qty, minSize = 0) {
  if (!(qty > 0)) return 0;
  return qty < minSize ? minSize : qty;
}

// -----------------------------
// Quantity(USDT) → Contracts & Cost
// -----------------------------
function calcOrderFromQuantityUsd({ quantityUsd, price, leverage, lotSize, minSize, multiplier = 1 }) {
  // KuCoin method with multiplier:
  // contracts = quantity / (price × multiplier)
  // costUsd   = quantity / leverage
  if (!(quantityUsd > 0) || !(price > 0) || !(leverage > 0)) {
    return { contracts: 0, costUsd: 0 };
  }
  let contracts = quantityUsd / (price * multiplier);
  contracts = roundToLot(contracts, lotSize);
  contracts = enforceMinSize(contracts, minSize);
  const costUsd = quantityUsd / leverage;
  return { contracts, costUsd };
}

// -----------------------------
// Public utilities
// -----------------------------
async function initializeActiveKucoinSymbols() {
  try {
    const res = await axios.get(`${BASE_URL}/api/v1/contracts/active`);
    const symbols = res.data?.data?.map(c => c.symbol);
    if (Array.isArray(symbols)) {
      symbols.forEach(sym => activeKucoinSymbols.add(sym));
      console.log(`[KuCoin] Loaded ${symbols.length} active symbols`);
    }
  } catch (err) {
    console.warn('[KuCoin] Failed to load active contract symbols:', err?.response?.data || err.message);
  }
}

async function fetchKucoinTickerPrice(symbolLike) {
  // Try both mark and ticker, with both hyphen/no-hyphen variants
  const hyphen = parseToKucoinContractSymbol(symbolLike);
  const noHyphen = toKucoinApiSymbol(hyphen);

  // 1) Mark price (path style)
  try {
    const markRes = await axios.get(`${BASE_URL}/api/v1/mark-price/${hyphen}/current`);
    const mark = markRes.data?.data?.value ?? markRes.data?.data?.markPrice;
    if (mark && !isNaN(+mark)) return +mark;
  } catch (e) {
    // ignore, try next
  }

  // 2) Ticker (query style, often expects no-hyphen)
  try {
    const res = await axios.get(`${BASE_URL}/api/v1/ticker?symbol=${noHyphen}`);
    const price = res.data?.data?.price;
    if (price && !isNaN(+price)) return +price;
  } catch (e) {
    // ignore, try hyphen as a fallback
    try {
      const res2 = await axios.get(`${BASE_URL}/api/v1/ticker?symbol=${hyphen}`);
      const price2 = res2.data?.data?.price;
      if (price2 && !isNaN(+price2)) return +price2;
    } catch {}
  }

  return null;
}

async function setLeverageForSymbol(contractLike, leverage) {
  const endpoint = '/api/v1/position/margin/leverage';
  const payload = {
    symbol: parseToKucoinContractSymbol(contractLike), // KuCoin accepts hyphen futures symbol here
    leverage: String(leverage),
    marginType: 'isolated'
  };
  const headers = signKucoinV3Request('POST', endpoint, '', JSON.stringify(payload), API_KEY, API_SECRET, API_PASSPHRASE);
  try {
    console.log(`[KuCoin] SET Leverage: ${payload.symbol} → ${leverage}x`);
    const res = await axios.post(`${BASE_URL}${endpoint}`, payload, { headers });
    return res.data;
  } catch (err) {
    console.error(`❌ Leverage set failed for ${payload.symbol}:`, err?.response?.data || err.message);
    throw err;
  }
}

// -----------------------------
// Wallet / Symbols / Positions
// -----------------------------
async function getKucoinWalletBalance(currency = 'USDT') {
  const endpoint = '/api/v1/account-overview';
  const query = `currency=${currency}`;
  const headers = signKucoinV3Request('GET', endpoint, query, '', API_KEY, API_SECRET, API_PASSPHRASE);
  try {
    const res = await axios.get(`${BASE_URL}${endpoint}?${query}`, { headers });
    const data = res.data.data;
    return {
      total: parseFloat(data.accountEquity).toFixed(2),
      available: parseFloat(data.availableBalance).toFixed(2)
    };
  } catch (err) {
    console.error('❌ Wallet error:', err?.response?.data || err);
    return { total: '0.00', available: '0.00', error: 'Fetch failed' };
  }
}

async function getKucoinFuturesSymbols() {
  const endpoint = '/api/v1/contracts/active';
  try {
    const res = await axios.get(`${BASE_URL}${endpoint}`);
    return (res.data.data || [])
      .filter(c => /USDTM$/i.test(c.symbol) && /Open/i.test(c.status))
      .map(c => parseToKucoinContractSymbol(c.symbol)) // normalized hyphen form
      .map(s => s.replace('-USDTM', 'USDT')) // for UI/TA lists if needed
      .sort();
  } catch (err) {
    console.error('❌ Fetching symbols failed:', err?.response?.data || err);
    return [];
  }
}

async function getOpenFuturesPositions() {
  const endpoint = '/api/v1/positions';
  const headers = signKucoinV3Request('GET', endpoint, '', '', API_KEY, API_SECRET, API_PASSPHRASE);

  try {
    const res = await axios.get(`${BASE_URL}${endpoint}`, { headers });
    const raw = res.data?.data || [];
    if (!Array.isArray(raw) || raw.length === 0) return [];

    const positions = raw.filter(pos => Math.abs(Number(pos.currentQty)) > 0);

    // Prefer TA price; fallback to KuCoin mark
    const tickerPriceMap = {};
    await Promise.all(
      positions.map(async pos => {
        try {
          const taSymbol = toSpotSymbolForTA(pos.symbol);
          const taBase = process.env.TA_BASE_URL || 'http://localhost:3000';
          const taRes = await axios.get(`${taBase}/api/ta/${taSymbol}`);
          const taPrice = parseFloat(taRes.data?.price ?? taRes.data?.markPrice ?? 0);
          tickerPriceMap[pos.symbol] = taPrice || parseFloat(pos.markPrice || pos.avgEntryPrice || 0);
        } catch {
          tickerPriceMap[pos.symbol] = parseFloat(pos.markPrice || pos.avgEntryPrice || 0);
        }
      })
    );

    // Build enriched positions
    const enriched = [];
    for (const pos of positions) {
      const specs = await getContractSpecs(pos.symbol); // lotSize, minSize, multiplier
      const quantityContracts = Number(pos.currentQty);
      const size = Math.abs(quantityContracts);
      const isLong = quantityContracts > 0;

      const entryPrice = parseFloat(pos.avgEntryPrice || 0);
      const markPrice  = tickerPriceMap[pos.symbol] || parseFloat(pos.markPrice || entryPrice);
      const levNum     = Number(pos.leverage) || 1;

      // Convert contracts → base qty using multiplier (e.g., ADA: 1 contract = 10 ADA)
      const baseQty = size * (specs.multiplier || 1);

      // Exposure at mark & initial margin at entry
      const exposure      = baseQty * markPrice;                          // USDT
      const initialMargin = levNum > 0 ? (baseQty * entryPrice) / levNum  : (baseQty * entryPrice);

      // Prefer KuCoin unrealisedPnl/ROE if provided
      const pnlValue = (pos.unrealisedPnl !== undefined)
        ? parseFloat(pos.unrealisedPnl)
        : isLong
          ? (markPrice - entryPrice) * baseQty
          : (entryPrice - markPrice) * baseQty;

      const roiNum = (pos.unrealisedRoePcnt !== undefined)
        ? parseFloat(pos.unrealisedRoePcnt) * 100
        : (initialMargin > 0 ? (pnlValue / initialMargin) * 100 : 0);

      const normalizedSymbol = pos.symbol.replace('-USDTM', 'USDT');

      enriched.push({
        ...pos,
        contract: pos.symbol,
        symbol: normalizedSymbol,
        side: isLong ? 'buy' : 'sell',
        entryPrice: entryPrice.toFixed(6),
        markPrice,
        quantity: baseQty,                      // base units (matches KuCoin app "Quantity")
        size,                                   // contracts
        value: initialMargin.toFixed(2),        // Cost (USDT)
        margin: initialMargin.toFixed(2),
        exposure: exposure.toFixed(2),          // Notional (USDT)
        pnlValue: pnlValue.toFixed(2),
        roi: roiNum.toFixed(2) + '%',
        pnlPercent: roiNum.toFixed(2) + '%',
        liquidation: parseFloat(pos.liquidationPrice || 0).toFixed(6),
        leverage: levNum.toFixed(2)
      });
    }

    return enriched;

  } catch (err) {
    console.error('❌ Fetching positions failed:', err?.response?.data || err);
    return [];
  }
}

// ---------------------------------
// Exports
// ---------------------------------
module.exports = {
  // core utils
  parseToKucoinContractSymbol,
  toKucoinApiSymbol,
  toSpotSymbolForTA,

  // specs & rounding
  getContractSpecs,
  roundToLot,
  enforceMinSize,
  calcOrderFromQuantityUsd,

  // data/ops
  fetchKucoinTickerPrice,
  setLeverageForSymbol,
  initializeActiveKucoinSymbols,
  getKucoinWalletBalance,
  getKucoinFuturesSymbols,
  getOpenFuturesPositions
};
