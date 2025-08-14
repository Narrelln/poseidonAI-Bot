
/**
 * File #02: handlers/placeFuturesOrder.js
 * Description:
 *   Places KuCoin futures orders using KuCoin-style sizing where the user inputs
 *   Quantity (USDT) a.k.a. exposure. We convert to contracts with contract
 *   multiplier + lot/min rounding, compute Cost (margin) = Quantity / Leverage,
 *   and send size + marginAmount to KuCoin. Records the trade consistently.
 * Notes:
 *   - Uses TA price first for parity with preview, then KuCoin mark/ticker fallback.
 *   - Duplicate guard prevents opening same side on same contract if already open.
 *   - Requires helpers from kucoinHelper.js (symbols, specs, sizing, price).
 * Last Updated: 2025-08-10 (patched tp/sl → tpPercent/slPercent)
 */

// PATCHED placeFuturesOrder.js — includes ensureSnapshot() to show TP feed 'Opened' line


const axios = require('axios');
const { signKucoinV3Request } = require('../utils/signRequest');
const { getKucoinOrderFill } = require('../utils/kucoinUtils');
const { recordTrade } = require('../utils/tradeHistory');
const { ensureSnapshot } = require('../tpSlMonitor');

const {
  parseToKucoinContractSymbol,
  toKucoinApiSymbol,
  toSpotSymbolForTA,
  getContractSpecs,
  calcOrderFromQuantityUsd,
  fetchKucoinTickerPrice,
  getOpenFuturesPositions,
} = require('../kucoinHelper');

require('dotenv').config();

const BASE_URL = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';
const API_KEY = process.env.KUCOIN_KEY;
const API_SECRET = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;
const TA_BASE = process.env.TA_BASE_URL || 'http://localhost:3000';

async function resolvePrice(contractHyphen, testPrice) {
  if (Number.isFinite(testPrice) && testPrice > 0) return Number(testPrice);
  try {
    const spot = toSpotSymbolForTA(contractHyphen);
    const taRes = await axios.get(`${TA_BASE}/api/ta/${spot}`);
    const p = Number(taRes.data?.price ?? taRes.data?.markPrice);
    if (Number.isFinite(p) && p > 0) return p;
  } catch {}
  const ex = await fetchKucoinTickerPrice(contractHyphen);
  return Number.isFinite(ex) && ex > 0 ? ex : null;
}

async function placeFuturesOrder({
  contract,
  side,
  leverage = 5,
  notionalUsd = null,
  type = 'market',
  reduceOnly = false,
  tpPercent = 35,
  slPercent = 20,
  testPrice = null,
  manual = false
}) {
  try {
    const normContract = parseToKucoinContractSymbol(contract);
    const apiSymbol = toKucoinApiSymbol(normContract);

    let normSide = String(side || '').toUpperCase();
    if (normSide === 'LONG') normSide = 'BUY';
    if (normSide === 'SHORT') normSide = 'SELL';
    if (!['BUY', 'SELL'].includes(normSide)) return { code: 'ERROR', msg: `Invalid side: ${side}` };

    const safeLev = Math.max(1, Number(leverage) || 1);
    const qtyUsd = Number(notionalUsd);
    if (!(qtyUsd > 0)) return { code: 'ERROR', msg: 'notionalUsd (Quantity USDT) must be > 0' };

    const specs = await getContractSpecs(normContract);
    let price = await resolvePrice(normContract, testPrice);
    if (!Number.isFinite(price) || price <= 0)
      return { code: 'ERROR', msg: `Failed to resolve price for ${normContract}` };

    const { contracts, costUsd } = calcOrderFromQuantityUsd({
      quantityUsd: qtyUsd,
      price,
      leverage: safeLev,
      lotSize: specs.lotSize,
      minSize: specs.minSize,
      multiplier: specs.multiplier
    });

    if (!(contracts > 0)) {
      return { code: 'ERROR', msg: `Contracts computed as 0 for ${normContract} (check minSize/lotSize)` };
    }

    try {
      const open = await getOpenFuturesPositions();
      const dup = open.find(p =>
        String(p.contract).toUpperCase() === normContract.toUpperCase() &&
        String(p.side || '').toLowerCase() === (normSide === 'BUY' ? 'buy' : 'sell') &&
        Number(p.size) > 0
      );
      if (dup) return { code: 'DUPLICATE', msg: `Trade already open on ${normContract} (${normSide})` };
    } catch {}

    const bodyObj = {
      clientOid: Date.now().toString(),
      symbol: apiSymbol,
      side: normSide,
      leverage: String(safeLev),
      type: String(type || 'market').toLowerCase(),
      size: contracts,
      reduceOnly,
      ...(specs.marginModel === 'cross' ? { autoDeposit: true } : {}),
      ...(manual ? { marginAmount: costUsd } : {})
    };

    const bodyStr = JSON.stringify(bodyObj);
    const headers = signKucoinV3Request('POST', '/api/v1/orders', '', bodyStr, API_KEY, API_SECRET, API_PASSPHRASE);
    const res = await axios.post(`${BASE_URL}/api/v1/orders`, bodyObj, { headers });

    const okCode = res.data?.code === '200000';
    const orderId = res.data?.data?.orderId;
    if (!okCode || !orderId) {
      return { code: 'ERROR', msg: res.data?.msg || 'Order rejected', detail: res.data };
    }

    let entry = 0;
    try {
      let fill = await getKucoinOrderFill(orderId);
      if (!fill?.price) {
        await new Promise(r => setTimeout(r, 1200));
        fill = await getKucoinOrderFill(orderId);
      }
      entry = Number(fill?.price) || price;
    } catch { entry = price; }

    const trade = {
      symbol: normContract,
      side: normSide,
      entry: Number(entry).toFixed(6),
      size: contracts,
      leverage: safeLev,
      tpPercent: Number(tpPercent),
      slPercent: Number(slPercent),
      status: 'OPEN',
      orderId,
      timestamp: new Date().toISOString(),
      manual: !!manual,
      value: Number(costUsd).toFixed(2),
      notionalUsd: Number(qtyUsd).toFixed(2)
    };

    await recordTrade(trade);
    ensureSnapshot(normContract); // ✅ trigger TP feed line
    return { code: 'SUCCESS', data: trade };
    

  } catch (err) {
    const data = err?.response?.data;
    const msg = data?.msg || err.message || 'Order failed';

    const isAccepted = data?.code === '200000' && data?.data?.orderId;
    if (isAccepted) {
      const fallback = {
        symbol: parseToKucoinContractSymbol(contract),
        side: String(side || '').toUpperCase(),
        entry: '0.000000',
        size: 0,
        leverage: Math.max(1, Number(leverage) || 1),
        tpPercent: Number(tpPercent),
        slPercent: Number(slPercent),
        status: 'OPEN',
        orderId: data.data.orderId,
        timestamp: new Date().toISOString(),
        manual: !!manual
      };
      await recordTrade(fallback);
      ensureSnapshot(fallback.symbol); // ✅ snapshot for fallback too
      return { code: 'SUCCESS_WITH_WARNING', data: fallback, note: msg };
    }

    console.error('Order Error:', data || err);
    return { code: 'ERROR', msg, detail: data };
  }
}

module.exports = { placeFuturesOrder };