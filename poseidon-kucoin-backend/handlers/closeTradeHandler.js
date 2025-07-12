const { getKucoinOrderFill } = require('../utils/kucoinUtils');
const { getOpenFuturesPositions, parseToKucoinContractSymbol } = require('../kucoinHelper');
const { closeTrade, safeReadHistory } = require('../utils/tradeHistory');
require('dotenv').config();

const API_KEY = process.env.KUCOIN_KEY;
const API_SECRET = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;
const BASE_URL = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';

async function closeFuturesPosition({ contract, side }) {
  contract = parseToKucoinContractSymbol(contract);
  console.log(`[closeFuturesPosition] CALLED for: contract=${contract}, side=${side}`);

  const endpoint = '/api/v1/orders';
  const normalizedSide = side === 'long' ? 'buy' : side === 'short' ? 'sell' : side.toLowerCase();
  const closeSide = normalizedSide === 'buy' ? 'sell' : 'buy';

  const bodyObj = {
    clientOid: Date.now().toString(),
    symbol: contract,
    side: closeSide,
    type: 'market',
    size: 1,
    reduceOnly: true
  };

  const bodyStr = JSON.stringify(bodyObj);
  const headers = require('../utils/signRequest').signKucoinV3Request(
    'POST', endpoint, '', bodyStr, API_KEY, API_SECRET, API_PASSPHRASE
  );

  try {
    console.log(`[closeFuturesPosition] Sending close order:`, bodyObj);
    const axios = require('axios');
    const res = await axios.post(BASE_URL + endpoint, bodyObj, { headers });
    const result = res.data;
    const orderId = result?.data?.orderId;
    console.log(`[closeFuturesPosition] KuCoin response:`, result);

    const history = safeReadHistory();
    const openTrade = history.find(
      t =>
        parseToKucoinContractSymbol(t.symbol) === contract &&
        (t.side === normalizedSide || t.side === side.toLowerCase()) &&
        t.status === 'OPEN'
    );
    if (!openTrade) {
      console.error(`[closeFuturesPosition] No matching open trade found in history for ${contract}, side=${normalizedSide}`);
      return { success: false, error: 'No matching open trade found in history' };
    }

    const entry = parseFloat(openTrade?.entry) || 0;
    const size = openTrade?.size || 1;
    const leverage = openTrade?.leverage || 5;

    // === ⏱️ Faster parallel fill + fallback
    const [fill, updated] = await Promise.all([
      getKucoinOrderFill(orderId).catch(() => null),
      getOpenFuturesPositions().catch(() => [])
    ]);

    let exit = '-';
    if (fill?.price) {
      exit = parseFloat(fill.price);
    } else {
      const pos = updated.find(
        p => p.contract === contract &&
        (p.side === normalizedSide || p.side === side.toLowerCase())
      );
      if (pos?.markPrice && !isNaN(pos.markPrice)) exit = parseFloat(pos.markPrice);
      else if (pos?.entryPrice && !isNaN(pos.entryPrice)) exit = parseFloat(pos.entryPrice);
      else exit = entry;
    }

    let pnl = '0.0000';
    let pnlPercent = '0.00%';

    if (!isNaN(entry) && typeof exit === 'number') {
      if (normalizedSide === 'buy') {
        pnl = ((exit - entry) * size).toFixed(4);
        pnlPercent = entry !== 0
          ? (((exit - entry) / entry) * leverage * 100).toFixed(2) + '%'
          : '0.00%';
      } else {
        pnl = ((entry - exit) * size).toFixed(4);
        pnlPercent = entry !== 0
          ? (((entry - exit) / entry) * leverage * 100).toFixed(2) + '%'
          : '0.00%';
      }
    }

    console.log(`[CLOSE LOG] entry=${entry}, exit=${exit}, pnl=${pnl}, pnl%=${pnlPercent}`);
    await closeTrade(contract, openTrade.side, exit, pnl, pnlPercent);

    if (result.code === '200000') {
      return { success: true, status: 'closed', pnl, pnlPercent, exit };
    } else {
      return { success: false, error: result.msg || 'Unknown error' };
    }
  } catch (err) {
    console.error('[closeFuturesPosition] ❌ ERROR:', err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  closeFuturesPosition
};