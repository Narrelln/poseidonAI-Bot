const axios = require('axios');
const { signKucoinV3Request } = require('../utils/signRequest');
const { getOpenFuturesPositions, parseToKucoinContractSymbol, getKucoinFuturesSymbols } = require('../kucoinHelper');
const { getKucoinOrderFill } = require('../utils/kucoinUtils');
const { recordTrade } = require('../utils/tradeHistory');
require('dotenv').config();

const BASE_URL = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';
const API_KEY = process.env.KUCOIN_KEY;
const API_SECRET = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;

async function fetchContractPrice(symbol) {
  const markUrl = `${BASE_URL}/api/v1/mark-price/${symbol}`;
  const fallbackSymbol = symbol.replace(/^XBT/i, 'BTC').replace('-USDTM', '') + '-USDT';

  try {
    const markRes = await axios.get(markUrl);
    const mark = parseFloat(markRes?.data?.data?.markPrice);
    if (mark && !isNaN(mark)) return mark;
  } catch {}

  try {
    const res = await axios.get(`${BASE_URL}/api/v1/ticker?symbol=${symbol}`);
    const price = parseFloat(res?.data?.data?.price);
    if (price && !isNaN(price)) return price;
  } catch {}

  try {
    const tickRes = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${fallbackSymbol}`);
    const last = parseFloat(tickRes?.data?.data?.price);
    if (last && !isNaN(last)) return last;
  } catch {}

  return { failed: true, reason: 'Price unavailable', symbol, tried: [symbol, fallbackSymbol] };
}

async function placeFuturesOrder({
  contract,
  side,
  leverage = 5,
  size = 1,
  notionalUsd = null,
  type = 'market',
  reduceOnly = false,
  tp = null,
  sl = null,
  testPrice = null
}) {
  const normSymbol = parseToKucoinContractSymbol(contract);
  const rawSymbol = normSymbol.replace('-', '');
  let normSide = (side || '').toLowerCase();
  if (normSide === 'long') normSide = 'buy';
  else if (normSide === 'short') normSide = 'sell';
  normSide = normSide.toUpperCase();
  const normType = (type || 'market').toLowerCase();
  const safeLeverage = Number(leverage) || 5;

  let price = await fetchContractPrice(normSymbol);
  if (price?.failed) {
    return { code: 'ERROR', msg: `Failed to fetch price for ${contract}: ${price.reason}` };
  }

  if (testPrice && !isNaN(testPrice)) {
    console.warn(`[TEST MODE] Overriding price with testPrice = ${testPrice}`);
    price = parseFloat(testPrice);
  }

  let contractQty = 1;

  // === Dynamic Capital Scaling ===
  let allocationUsd = 1;
  try {
    const accountEndpoint = '/api/v1/account-overview';
    const accountHeaders = signKucoinV3Request('GET', accountEndpoint, '', '', API_KEY, API_SECRET, API_PASSPHRASE);
    const balanceRes = await axios.get(BASE_URL + accountEndpoint, { headers: accountHeaders });
    const balance = parseFloat(balanceRes?.data?.data?.availableBalance || 0);

    if (!isNaN(balance) && balance > 0) {
      const walletFraction = (typeof contract === 'object' && contract.confidence > 90) ? 0.25 : 0.10;
      allocationUsd = +(balance * walletFraction).toFixed(2);
      if (allocationUsd < 1) allocationUsd = 1;

      console.log(`[ALLOC] Wallet=$${balance} â Allocated=${allocationUsd} USDT`);
    }
  } catch (e) {
    console.warn('â ï¸ Wallet fetch failed:', e.message);
  }

  // ✅ Always use 10% wallet allocation by default
contractQty = +(allocationUsd * safeLeverage / price).toFixed(3);

  const safeTp = tp && !isNaN(tp) ? parseFloat(tp) : null;
  const safeSl = sl && !isNaN(sl) ? parseFloat(sl) : null;

  try {
    const validSymbols = await getKucoinFuturesSymbols();
    const isValid = validSymbols.includes(normSymbol);
    if (!isValid) console.warn(`[KUCOIN WARN] ${normSymbol} not found â continuing anyway.`);
  } catch {}

  const openPositions = await getOpenFuturesPositions();
  const found = openPositions.find(p =>
    p.contract === normSymbol &&
    (p.side || '').toLowerCase() === normSide.toLowerCase() &&
    Number(p.size) > 0
  );
  if (found) {
    return { code: 'DUPLICATE', msg: 'Trade already open' };
  }

  const endpoint = '/api/v1/orders';
  const bodyObj = {
    clientOid: Date.now().toString(),
    symbol: rawSymbol.toUpperCase(),
    side: normSide,
    leverage: safeLeverage,
    type: normType,
    size: contractQty,
    reduceOnly
  };

  const bodyStr = JSON.stringify(bodyObj);
  const headers = signKucoinV3Request('POST', endpoint, '', bodyStr, API_KEY, API_SECRET, API_PASSPHRASE);

  try {
    const res = await axios.post(BASE_URL + endpoint, bodyObj, { headers });
    const orderId = res.data?.data?.orderId;
    let entry = 0.0000;

    if (res.data.code === '200000' && orderId) {
      let fill = await getKucoinOrderFill(orderId);
      if (!fill?.price) {
        await new Promise(r => setTimeout(r, 1500));
        fill = await getKucoinOrderFill(orderId);
      }

      if (fill?.price) {
        entry = parseFloat(fill.price);
      } else {
        const updatedPositions = await getOpenFuturesPositions();
        const match = updatedPositions.find(p => p.contract === normSymbol && (p.side || '').toLowerCase() === normSide.toLowerCase());
        entry = match?.entryPrice ? parseFloat(match.entryPrice) : price;
      }

      const trade = {
        symbol: normSymbol,
        side: normSide,
        entry: entry.toFixed(4),
        size: contractQty,
        leverage: safeLeverage,
        tp: safeTp,
        sl: safeSl,
        status: 'OPEN',
        orderId,
        timestamp: new Date().toISOString()
      };

      await recordTrade(trade);
      return { code: 'SUCCESS', data: trade };
    } else {
      throw new Error(res.data?.msg || 'Order rejected');
    }
  } catch (err) {
    console.error('â Order Error:', err?.response?.data || err.message);
    return { code: 'ERROR', msg: err?.response?.data?.msg || err.message || 'Order failed' };
  }
}

module.exports = { placeFuturesOrder };
