/**
 * handlers/kucoinOrders.js
 * Single source of truth for preview/place/close with correct marginMode.
 * - Detects marginMode from the live KuCoin position (CROSS vs ISOLATED)
 * - Sets marginMode accordingly for place/close
 * - Retries once with flipped mode on KuCoin margin mismatch error
 * - Adds per-contract cooldown to stop spam loops
 * - Re-exports a preview helper that uses contract specs (lot/min/multiplier)
 */

const axios = require('axios');
require('dotenv').config();

const { signKucoinV3Request } = require('../utils/signRequest');
const {
  parseToKucoinContractSymbol,
  toKucoinApiSymbol,
  getContractSpecs,
  fetchKucoinTickerPrice,
  getOpenFuturesPositions,
} = require('../kucoinHelper');

const BASE_URL       = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';
const API_KEY        = process.env.KUCOIN_KEY;
const API_SECRET     = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;

// ---------- helpers ----------
const now = () => Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isMarginMismatch = (err) => {
  const msg = err?.response?.data?.msg || err?.response?.data?.message || err?.message || '';
  return /margin mode does not match/i.test(msg);
};

// Cooldown so we don’t DOS KuCoin if something is wrong
const COOLDOWN_MS = 8000;
const lastActionAt = new Map(); // key: contract → timestamp

function underCooldown(contract) {
  const t = lastActionAt.get(contract) || 0;
  return now() - t < COOLDOWN_MS;
}
function stampCooldown(contract) {
  lastActionAt.set(contract, now());
}

// Read margin mode for a live position
async function getLiveMarginMode(contractLike) {
  const hyphen = parseToKucoinContractSymbol(contractLike);
  try {
    const list = await getOpenFuturesPositions();
    const match = list.find(p => String(p.contract).toUpperCase() === hyphen);
    if (match) {
      // KuCoin returns marginMode: 'CROSS'|'ISOLATED' or crossMode: boolean
      if (typeof match.marginMode === 'string') return match.marginMode.toUpperCase();
      if (typeof match.crossMode === 'boolean') return match.crossMode ? 'CROSS' : 'ISOLATED';
    }
  } catch (e) {
    // fall through
  }
  // Default to ISOLATED if unknown
  return 'ISOLATED';
}

// ---------- preview ----------
async function previewOrder({ symbol, notionalUsd, leverage = 5 }) {
  const contract = parseToKucoinContractSymbol(symbol);
  const specs = await getContractSpecs(contract);
  const price = await fetchKucoinTickerPrice(contract);

  if (!(price > 0)) {
    return { ok: false, error: 'No price available for preview' };
  }
  const contractsRaw = (notionalUsd / (price * specs.multiplier));
  const contracts = Math.max(specs.minSize, Math.floor(contractsRaw / specs.lotSize) * specs.lotSize);
  if (contracts <= 0) {
    return { ok: false, error: 'Contracts computed as 0 (check lotSize/minSize)' };
  }

  const costUsd = notionalUsd / Math.max(1, leverage);
  const baseQty = contracts * specs.multiplier;
  const exposure = baseQty * price;

  return {
    ok: true,
    symbol: contract,
    contract,
    price,
    leverage,
    contracts,
    costUsd,
    notionalUsd,
    marginUsd: costUsd,
    baseQty,
    exposure,
    lotSize: specs.lotSize,
    minSize: specs.minSize,
    multiplier: specs.multiplier,
  };
}

// ---------- KuCoin order endpoints (v1) ----------
async function kucoinCreateOrder(payload) {
  const endpoint = '/api/v1/orders';
  const body = JSON.stringify(payload);
  const headers = signKucoinV3Request('POST', endpoint, '', body, API_KEY, API_SECRET, API_PASSPHRASE);
  const { data } = await axios.post(`${BASE_URL}${endpoint}`, payload, { headers, timeout: 15000 });
  return data;
}

async function kucoinClosePosition(payload) {
  const endpoint = '/api/v1/position/close';
  const body = JSON.stringify(payload);
  const headers = signKucoinV3Request('POST', endpoint, '', body, API_KEY, API_SECRET, API_PASSPHRASE);
  const { data } = await axios.post(`${BASE_URL}${endpoint}`, payload, { headers, timeout: 15000 });
  return data;
}

// ---------- place ----------
async function placeOrder({ contract: symbolLike, side, notionalUsd, leverage = 5, reduceOnly = false }) {
  const contract = parseToKucoinContractSymbol(symbolLike);
  if (underCooldown(contract)) {
    return { ok: false, error: `Cooldown active for ${contract}` };
  }

  const prev = await previewOrder({ symbol: contract, notionalUsd, leverage });
  if (!prev.ok) return prev;

  const marginMode = await getLiveMarginMode(contract); // ← pick the real mode
  const kucoinSymbol = toKucoinApiSymbol(contract);

  const payload = {
    symbol: kucoinSymbol,
    side: String(side).toUpperCase(),      // BUY / SELL
    type: 'market',
    size: prev.contracts,
    leverage: String(leverage),
    marginMode,                            // **critical**
    reduceOnly: !!reduceOnly,
  };

  try {
    const res = await kucoinCreateOrder(payload);
    stampCooldown(contract);
    return { ok: true, result: res, payload };
  } catch (err) {
    if (isMarginMismatch(err)) {
      // Retry once with flipped mode
      const flipped = marginMode === 'CROSS' ? 'ISOLATED' : 'CROSS';
      try {
        const res = await kucoinCreateOrder({ ...payload, marginMode: flipped });
        stampCooldown(contract);
        return { ok: true, result: res, payload: { ...payload, marginMode: flipped }, note: 'retried:flippedMode' };
      } catch (err2) {
        return { ok: false, error: err2?.response?.data || err2.message || 'place failed (retry)' };
      }
    }
    return { ok: false, error: err?.response?.data || err.message || 'place failed' };
  }
}

// ---------- close (reduce-only market) ----------
async function closePosition({ contract: symbolLike }) {
  const contract = parseToKucoinContractSymbol(symbolLike);
  if (underCooldown(contract)) {
    return { ok: false, error: `Cooldown active for ${contract}` };
  }

  // Inspect live position to get side/size/mode
  const list = await getOpenFuturesPositions();
  const pos = list.find(p => String(p.contract).toUpperCase() === contract);
  if (!pos || !pos.size) return { ok: false, error: 'No open position to close' };

  const marginMode = await getLiveMarginMode(contract);
  const kucoinSymbol = toKucoinApiSymbol(contract);

  const payload = {
    symbol: kucoinSymbol,
    marginMode,                // **critical**
    // When using /position/close, KuCoin closes the entire position;
    // if you prefer an order, use /orders with reduceOnly:true and size.
  };

  try {
    const res = await kucoinClosePosition(payload);
    stampCooldown(contract);
    return { ok: true, result: res, payload };
  } catch (err) {
    if (isMarginMismatch(err)) {
      const flipped = marginMode === 'CROSS' ? 'ISOLATED' : 'CROSS';
      try {
        const res = await kucoinClosePosition({ ...payload, marginMode: flipped });
        stampCooldown(contract);
        return { ok: true, result: res, payload: { ...payload, marginMode: flipped }, note: 'retried:flippedMode' };
      } catch (err2) {
        return { ok: false, error: err2?.response?.data || err2.message || 'close failed (retry)' };
      }
    }
    return { ok: false, error: err?.response?.data || err.message || 'close failed' };
  }
}

module.exports = {
  previewOrder,
  placeOrder,
  closePosition,
};