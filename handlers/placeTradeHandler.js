/**
 * File: handlers/placeTradeHandler.js (LEDGER-FIRST)
 *
 * Places KuCoin futures orders using KuCoin-style sizing where the user inputs
 * Quantity (USDT) a.k.a. exposure. We convert to contracts with contract
 * multiplier + lot/min rounding, compute Cost (margin) = Quantity / Leverage,
 * and send size (+ optional marginAmount for manual) to KuCoin.
 *
 * Notes:
 *   - Price resolution: TA → KuCoin ticker fallback.
 *   - API side MUST be lowercase ('buy'|'sell').
 *   - Limit orders include a tick-size-rounded price.
 *   - Persists OPEN row into tradeLedger and seeds TP/SL feed.
 */

const axios = require('axios');
require('dotenv').config();
const { writeTpAndBroadcast } = require('./tpFeedWriter'); // ✅ add
const { signKucoinV3Request } = require('../utils/signRequest');
const { getKucoinOrderFill }  = require('../utils/kucoinUtils');
const { ensureSnapshot }      = require('../tpSlMonitor');          // TP/SL feed seed line
const { recordOpen }          = require('../utils/tradeLedger');    // ✅ ledger-first
const { withTimeout }         = require('../utils/withTimeout');    // ✅ add this line

const {
  parseToKucoinContractSymbol,
  toKucoinApiSymbol,
  toSpotSymbolForTA,
  getContractSpecs,
  calcOrderFromQuantityUsd,
  fetchKucoinTickerPrice,
  getOpenFuturesPositions,
} = require('../kucoinHelper');

const BASE_URL       = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';
const API_KEY        = process.env.KUCOIN_KEY;
const API_SECRET     = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;
const TA_BASE        = process.env.TA_BASE_URL || 'http://localhost:3000';



// ---------- small helpers ----------
function toLedgerSide(side) {
  const s = String(side || '').toUpperCase();
  if (s === 'LONG' || s === 'BUY')  return 'buy';
  if (s === 'SHORT' || s === 'SELL') return 'sell';
  return 'buy';
}
function clampNum(v, min = 0, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}
function roundToIncrement(value, increment) {
  const inc = Number(increment);
  const v   = Number(value);
  if (!(inc > 0) || !(v > 0)) return v;
  const precision = Math.max(0, (inc.toString().split('.')[1] || '').length);
  return Number((Math.round(v / inc) * inc).toFixed(precision));
}


async function resolvePrice(contractHyphen, testPrice) {
  // 1) explicit test price (for backtests/unit)
  if (Number.isFinite(testPrice) && testPrice > 0) return Number(testPrice);

  // 2) TA endpoint (keeps parity with preview cards)
  try {
    const spot = toSpotSymbolForTA(contractHyphen); // e.g. BTC-USDTM → BTCUSDT
    const taRes = await withTimeout(
      axios.get(`${TA_BASE}/api/ta/${spot}`, { timeout: 8000 }),
      9000,
      'ta/price timeout'
    );
    const p = Number(taRes.data?.price ?? taRes.data?.markPrice);
    if (Number.isFinite(p) && p > 0) return p;
  } catch (_) {}

  // 3) KuCoin ticker/mark
  const ex = await withTimeout(fetchKucoinTickerPrice(contractHyphen), 9000, 'ticker timeout');
  return Number.isFinite(ex) && ex > 0 ? ex : null;
}

/**
 * placeFuturesOrder: place & persist an OPEN row into tradeLedger.
 *
 * @param {Object} params
 * @param {string} params.contract    futures contract e.g. "BTC-USDTM" (any format accepted)
 * @param {string} params.side        "BUY" | "SELL" | "LONG" | "SHORT"
 * @param {number} params.leverage    leverage (default 5)
 * @param {number} params.notionalUsd quantity in USDT to deploy (required)
 * @param {string} params.type        'market' | 'limit' (market default)
 * @param {boolean}params.reduceOnly  default false
 * @param {number} params.tpPercent   TP percent (value only)
 * @param {number} params.slPercent   SL percent (value only)
 * @param {number} params.testPrice   override price (testing)
 * @param {boolean}params.manual      whether this is a manual placement
 */
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
  // sanitize inputs
  const tp = clampNum(tpPercent, 0, 0);
  const sl = clampNum(slPercent, 0, 0);

  try {
    // --- normalize & validate contract/symbol ---
    const normContract = parseToKucoinContractSymbol(contract);      // e.g. ADA-USDTM
    if (!normContract || !/^[A-Z0-9]+-USDTM$/.test(normContract)) {
      return { code: 'ERROR', msg: `Invalid/empty contract: "${contract}" → "${normContract || ''}"` };
    }

    const apiSymbol = toKucoinApiSymbol(normContract);               // e.g. ADAUSDTM / XBTUSDTM
    if (!apiSymbol || !/^[A-Z0-9]+USDTM$/.test(apiSymbol)) {
      return { code: 'ERROR', msg: `Failed to derive KuCoin API symbol for ${normContract}` };
    }

    // --- normalize & validate side ---
    let normSide = String(side || '').toUpperCase();
    if (normSide === 'LONG')  normSide = 'BUY';
    if (normSide === 'SHORT') normSide = 'SELL';
    if (!['BUY', 'SELL'].includes(normSide)) {
      return { code: 'ERROR', msg: `Invalid side: ${side}` };
    }

    // --- basic numeric inputs ---
    const userLev = Math.max(1, Number(leverage) || 1);
    const qtyUsd  = Number(notionalUsd);
    if (!(qtyUsd > 0)) {
      return { code: 'ERROR', msg: 'notionalUsd (Quantity USDT) must be > 0' };
    }

    // --- specs + price ---
    let specs = {};
    try {
      specs = await withTimeout(getContractSpecs(normContract), 8000, 'specs timeout');
    } catch (_) {
      specs = {};
    }

    // 1) Prefer explicit testPrice from caller (evaluator/autopilot)
    let price = Number(testPrice);

    // 2) If missing/invalid, resolve via TA endpoint (spot symbol) then KuCoin ticker
    if (!Number.isFinite(price) || price <= 0) {
      price = await resolvePrice(normContract, null);  // TA → ticker inside
    }

    // 3) Final guard
    if (!Number.isFinite(price) || price <= 0) {
      return { code: 'ERROR', msg: `Price unavailable for ${normContract} (all sources failed)` };
    }

    // --- clamp leverage to exchange min/max if provided ---
    const exchMaxLev = Number(specs?.maxLeverage) || 100;
    const exchMinLev = Number(specs?.minLeverage) || 1;
    const finalLeverage = Math.min(Math.max(userLev, exchMinLev), exchMaxLev);

    // --- compute contracts & margin cost (USDT) ---
    let { contracts, costUsd } = calcOrderFromQuantityUsd({
      quantityUsd: qtyUsd,
      price,
      leverage: finalLeverage,
      lotSize: Number(specs?.lotSize) || 1,
      minSize: Number(specs?.minSize) || 1,
      multiplier: Number(specs?.multiplier) || 1
    });

    
    // 🔸 AUTO-BUMP: if below exchange minimum, force to minSize (>=1)
    if (!(contracts > 0)) {
      const min = Math.max(1, Number(specs.minSize) || 1);
      contracts = min;

      // recompute cost for transparency (what margin this requires)
      costUsd = (contracts * price * (Number(specs.multiplier) || 1)) / finalLeverage;
    }

    // duplicate guard: same contract & same side already open
    try {
      const open = await withTimeout(getOpenFuturesPositions(), 8000, 'positions timeout');
      const dup = Array.isArray(open) && open.find(p =>
        String(p.contract).toUpperCase() === normContract.toUpperCase() &&
        String(p.side || '').toLowerCase() === (normSide === 'BUY' ? 'buy' : 'sell') &&
        Number(p.size) > 0
      );
      if (dup) return { code: 'DUPLICATE', msg: `Trade already open on ${normContract} (${normSide})` };
    } catch (_) {}

    // ---------- build KuCoin order payload ----------
    const apiSide   = (normSide === 'BUY') ? 'buy' : 'sell';     // ✅ lowercase
    const orderType = String(type || 'market').toLowerCase();

    const bodyObj = {
      clientOid: Date.now().toString(),
      symbol: apiSymbol,
      side: apiSide,                       // 'buy' | 'sell'
      leverage: String(finalLeverage),
      type: orderType,                     // 'market' | 'limit'
      size: contracts,
      reduceOnly,
      ...(specs.marginModel === 'cross' ? { autoDeposit: true } : {}),
      ...(manual ? { marginAmount: costUsd } : {})
    };

    // If LIMIT → include tick-size-rounded price
    if (orderType === 'limit') {
      const inc = specs.priceIncrement ?? specs.tickSize ?? 0.0001;
      bodyObj.price = roundToIncrement(price, inc);
    }

    // ---------- submit to KuCoin ----------
    const bodyStr = JSON.stringify(bodyObj);
    const headers = signKucoinV3Request('POST', '/api/v1/orders', '', bodyStr, API_KEY, API_SECRET, API_PASSPHRASE);

    const res = await withTimeout(
      axios.post(`${BASE_URL}/api/v1/orders`, bodyObj, { headers, timeout: 12000 }),
      15000,
      'kucoin/placeOrder timeout'
    );

    const okCode = res.data?.code === '200000';
    const orderId = res.data?.data?.orderId;

    if (!okCode || !orderId) {
      return { code: 'ERROR', msg: res.data?.msg || 'Order rejected', detail: res.data };
    }

    // try to read fill price for nicer entry; fallback to resolved price
    let entry = price;
    try {
      let fill = await withTimeout(getKucoinOrderFill(orderId), 6000, 'orderFill timeout');
      if (!fill?.price) {
        await new Promise(r => setTimeout(r, 1200));
        fill = await withTimeout(getKucoinOrderFill(orderId), 6000, 'orderFill retry timeout');
      }
      const px = Number(fill?.price);
      if (Number.isFinite(px) && px > 0) entry = px;
    } catch (_) {}

    // ---------- persist to LEDGER ----------
    const ledgerRow = recordOpen({
      symbol: normContract,                         // e.g. BTC-USDTM
      side: toLedgerSide(normSide),                 // 'buy' | 'sell'
      entry: entry,
      size: contracts,
      leverage: finalLeverage,
      multiplier: Number(specs.multiplier) || 1,
      orderId,
      tpPercent: tp,                                // numbers (no % sign)
      slPercent: sl
    });
// ✅ Feed + persistence: OPENED
try {
  await writeTpAndBroadcast({
    contract: normContract,
    state: 'OPENED',
    text: `Opened ${apiSide.toUpperCase()} @ ${entry} • lev ${finalLeverage}x • size ${contracts}`,
    roi: 0,
    peak: 0
  });
} catch (_) {}
    // seed TP/SL live feed with "Opened" (non-blocking)
    try { ensureSnapshot(normContract); } catch (_) {}

    // respond
    return {
      code: 'SUCCESS',
      data: {
        ...ledgerRow,
        value: Number(costUsd).toFixed(2),
        notionalUsd: Number(qtyUsd).toFixed(2)
      }
    };

  } catch (err) {
    const data = err?.response?.data;
    const msg  = data?.msg || err.message || 'Order failed';

    // Rare case: API says accepted but throws; persist minimal OPEN row
    const isAccepted = data?.code === '200000' && data?.data?.orderId;
    if (isAccepted) {
      const fallbackSymbol = parseToKucoinContractSymbol(contract);
      const fallbackSide   = toLedgerSide(side);

      const row = recordOpen({
        symbol: fallbackSymbol,
        side: fallbackSide,
        entry: 0,
        size: 0,
        leverage: Math.max(1, Number(leverage) || 1),
        multiplier: 1,
        orderId: data.data.orderId,
        tpPercent: clampNum(tp, 0, 0),
        slPercent: clampNum(sl, 0, 0)
      });

      try { ensureSnapshot(fallbackSymbol); } catch (_) {}

      return { code: 'SUCCESS_WITH_WARNING', data: row, note: msg };
    }

    console.error('Order Error:', data || err);
    return { code: 'ERROR', msg, detail: data };
  }
}

module.exports = { placeFuturesOrder };