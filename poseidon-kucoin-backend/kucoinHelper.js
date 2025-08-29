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

// kucoinHelper.js  (patched excerpt: entire file updated)
const axios = require('axios');
const { signKucoinV3Request } = require('./utils/signRequest');
require('dotenv').config();

const BASE_URL = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';
const API_KEY = process.env.KUCOIN_KEY;
const API_SECRET = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;

const activeKucoinSymbols = new Set();

// ---- Base aliasing ----
const BASE_ALIASES = new Map([
  ['BTC','XBT'],
  ['XBT','XBT'],
]);
function aliasForKucoin(base) {
  const b = String(base || '').toUpperCase();
  return BASE_ALIASES.get(b) || b;
}
function aliasForBybit(base) {
  const b = String(base || '').toUpperCase();
  return b === 'XBT' ? 'BTC' : b;
}

function parseToKucoinContractSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return '';
  let s = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  // endings
  let base = s;
  if (s.endsWith('USDTM')) base = s.slice(0, -5);
  else if (s.endsWith('USDT')) base = s.slice(0, -4);

  // apply KuCoin alias (BTC->XBT)
  base = aliasForKucoin(base);
  return `${base}-USDTM`;
}

function toKucoinApiSymbol(contract) {
  return String(contract || '').replace(/-/g, '');
}

function toSpotSymbolForTA(input) {
  const c = parseToKucoinContractSymbol(input);
  const base = c.replace(/-USDTM$/, '');
  // TA (Bybit) uses BTC, not XBT
  return `${aliasForBybit(base)}USDT`;
}

let CONTRACT_CACHE_MAP = null;
let CONTRACT_CACHE_AT = 0;

async function loadContractCache() {
  const FRESH_MS = 5 * 60 * 1000;
  if (CONTRACT_CACHE_MAP && (Date.now() - CONTRACT_CACHE_AT) < FRESH_MS) {
    return CONTRACT_CACHE_MAP;
  }
  try {
    const endpoint = `${BASE_URL}/api/v1/contracts/active`;
    const res = await axios.get(endpoint, { timeout: 12000 });
    const list = res.data?.data || [];

    const map = new Map();
    for (const c of list) {
      const apiSym = String(c.symbol || '').toUpperCase();     // e.g. XBTUSDTM
      const hyphenRaw = `${apiSym.replace(/USDTM$/, '')}-USDTM`;
      const base = hyphenRaw.replace(/-USDTM$/, '');
      const aliased = `${aliasForKucoin(base)}-USDTM`;
      const hyphen = aliased;
      const noHyphen = hyphen.replace(/-/g, '');

      const meta = {
        symbol: hyphen,
        apiSymbol: noHyphen,
        lotSize: Number(c.lotSize ?? 1),
        minSize: Number(c.baseMinSize ?? c.minSize ?? 1),
        tickSize: Number(c.tickSize ?? 0.0001),
        multiplier: Number(c.multiplier ?? 1),
        marginModel: String(c.marginModel || '').toLowerCase() || 'isolated'
      };
      map.set(hyphen, meta);
      map.set(noHyphen, meta);

      if (aliasForBybit(base) === 'BTC') {
        map.set('BTC-USDTM', meta);
        map.set('BTCUSDTM',  meta);
      }
    }
    CONTRACT_CACHE_MAP = map;
    CONTRACT_CACHE_AT = Date.now();
    return map;
  } catch (err) {
    console.warn('[KuCoin] contracts/active failed; using previous cache if any:', err?.message || err);
    // fall back to last good cache or a minimal map to avoid throwing
    if (CONTRACT_CACHE_MAP) return CONTRACT_CACHE_MAP;
    CONTRACT_CACHE_MAP = new Map();
    CONTRACT_CACHE_AT = Date.now();
    return CONTRACT_CACHE_MAP;
  }
}

async function getContractSpecs(symbolLike) {
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

// rounding helpers unchanged
function roundToLot(qty, lotSize = 1) {
  if (!(qty > 0) || !(lotSize > 0)) return 0;
  return Math.floor(qty / lotSize) * lotSize;
}
function enforceMinSize(qty, minSize = 0) {
  if (!(qty > 0)) return 0;
  return qty < minSize ? minSize : qty;
}
function calcOrderFromQuantityUsd({ quantityUsd, price, leverage, lotSize, minSize, multiplier = 1 }) {
  if (!(quantityUsd > 0) || !(price > 0) || !(leverage > 0)) {
    return { contracts: 0, costUsd: 0 };
  }
  let contracts = quantityUsd / (price * multiplier);
  contracts = roundToLot(contracts, lotSize);
  contracts = enforceMinSize(contracts, minSize);
  const costUsd = quantityUsd / leverage;
  return { contracts, costUsd };
}

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
  const hyphen = parseToKucoinContractSymbol(symbolLike);
  const noHyphen = toKucoinApiSymbol(hyphen);

  try {
    const markRes = await axios.get(`${BASE_URL}/api/v1/mark-price/${hyphen}/current`);
    const mark = markRes.data?.data?.value ?? markRes.data?.data?.markPrice;
    if (mark && !isNaN(+mark)) return +mark;
  } catch {}

  try {
    const res = await axios.get(`${BASE_URL}/api/v1/ticker?symbol=${noHyphen}`);
    const price = res.data?.data?.price;
    if (price && !isNaN(+price)) return +price;
  } catch (e) {
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
    symbol: parseToKucoinContractSymbol(contractLike),
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

// replace getKucoinWalletBalance with:
async function getKucoinWalletBalance(currency = 'USDT') {
  const endpoint = '/api/v1/account-overview';
  const query = `currency=${currency}`;
  const headers = signKucoinV3Request('GET', endpoint, query, '', API_KEY, API_SECRET, API_PASSPHRASE);
  try {
    const res = await axios.get(`${BASE_URL}${endpoint}?${query}`, { headers });
    const data = res.data.data;
    const totalNum = Number.parseFloat(data.accountEquity || '0');
    const availNum = Number.parseFloat(data.availableBalance || '0');
    return {
      total: totalNum.toFixed(2),      // keep legacy strings
      available: availNum.toFixed(2),
      totalNum,                        // ✅ numeric for math
      availableNum: availNum
    };
  } catch (err) {
    console.error('❌ Wallet error:', err?.response?.data || err);
    return { total: '0.00', available: '0.00', totalNum: 0, availableNum: 0, error: 'Fetch failed' };
  }
}

async function getKucoinFuturesSymbols() {
  const endpoint = '/api/v1/contracts/active';
  try {
    const res = await axios.get(`${BASE_URL}${endpoint}`);
    return (res.data.data || [])
      .filter(c => /USDTM$/i.test(c.symbol) && /Open/i.test(c.status))
      .map(c => parseToKucoinContractSymbol(c.symbol)) // normalized hyphen form (with aliasing)
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

    // Prefer TA mark when possible
    const tickerPriceMap = {};
    await Promise.all(
      positions.map(async pos => {
        try {
          const taSymbol = toSpotSymbolForTA(pos.symbol); // maps XBT->BTC for TA
          const taBase = process.env.TA_BASE_URL || 'http://localhost:3000';
          const taRes = await axios.get(`${taBase}/api/ta/${taSymbol}`);
          const taPrice = parseFloat(taRes.data?.price ?? taRes.data?.markPrice ?? 0);
          tickerPriceMap[pos.symbol] = taPrice || parseFloat(pos.markPrice || pos.avgEntryPrice || 0);
        } catch {
          tickerPriceMap[pos.symbol] = parseFloat(pos.markPrice || pos.avgEntryPrice || 0);
        }
      })
    );

    const enriched = [];
    for (const pos of positions) {
      const specs = await getContractSpecs(pos.symbol);
      const quantityContracts = Number(pos.currentQty);
      const size = Math.abs(quantityContracts);
      const isLong = quantityContracts > 0;

      const entryPrice = parseFloat(pos.avgEntryPrice || 0);
      const markPrice  = tickerPriceMap[pos.symbol] || parseFloat(pos.markPrice || entryPrice);
      const levNum     = Number(pos.leverage) || 1;

      const baseQty = size * (specs.multiplier || 1);
      const exposure      = baseQty * markPrice;
      const initialMargin = levNum > 0 ? (baseQty * entryPrice) / levNum  : (baseQty * entryPrice);

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
        quantity: baseQty,
        size,
        value: initialMargin.toFixed(2),
        margin: initialMargin.toFixed(2),
        exposure: exposure.toFixed(2),
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

module.exports = {
  parseToKucoinContractSymbol,
  toKucoinApiSymbol,
  toSpotSymbolForTA,
  getContractSpecs,
  roundToLot,
  enforceMinSize,
  calcOrderFromQuantityUsd,
  fetchKucoinTickerPrice,
  setLeverageForSymbol,
  initializeActiveKucoinSymbols,
  getKucoinWalletBalance,
  getKucoinFuturesSymbols,
  getOpenFuturesPositions
};