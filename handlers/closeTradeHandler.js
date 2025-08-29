/**
 * File #05: handlers/closeTradeHandler.js
 * ---------------------------------------
 * Description:
 *   Source of truth for closing KuCoin futures positions.
 *   - Exports:
 *       1) closeFuturesPositionService({ contract, side }) → Promise<{success,...}>
 *          (pure service; no req/res)
 *       2) closeFuturesPosition(req, res) → Express handler using the service
 *   - Finds the live open position, builds a reduceOnly market order with leverage,
 *     computes PnL/ROI, and updates local trade history.
 *
 * Upgrade U03 (Feed):
 *   - Emits TP/SL feed events on close success/failure so the UI tracker can show:
 *       🔻 Close requested / ✅ Closed / ⚠️ Close error
 *   - Uses optional pushTpFeed (safe-required) → pushTpFeed({ contract, text, state, ... })
 *
 * Last Updated: 2025-08-13
 */

/* ───────────────────────── §0. Imports & setup ────────────────────────── */
const axios = require('axios');
const { signKucoinV3Request } = require('../utils/signRequest');
const {
  parseToKucoinContractSymbol,
  toKucoinApiSymbol,
  getOpenFuturesPositions,
  getContractSpecs
} = require('../kucoinHelper');
const { closeTrade, safeReadHistory } = require('../utils/tradeHistory');
const { getKucoinOrderFill } = require('../utils/kucoinUtils');
require('dotenv').config();

const BASE_URL = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';
const API_KEY = process.env.KUCOIN_KEY;
const API_SECRET = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;

// Optional TP/SL feed hook (do NOT crash if module missing)
let pushTpFeed;
try { ({ pushTpFeed } = require('../tpSlMonitor')); } catch (_) { pushTpFeed = undefined; }
const feed = (entry) => { try { if (typeof pushTpFeed === 'function') pushTpFeed(entry); } catch (_) {} };

/* ───────────────────────── §1. Pure service ────────────────────────────── */
/**
 * closeFuturesPositionService({ contract, side? })
 * - Closes a live KuCoin futures position with reduceOnly MARKET order
 * - Computes PnL/ROI for local history
 * - Emits feed events (if feed hook available)
 */
async function closeFuturesPositionService({ contract: raw, side: uiSide }) {
  if (!raw) {
    const res = { success: false, error: 'Missing contract', code: 400 };
    feed({ contract: '-', state: 'CLOSE_ERROR', text: `❌ Close error: ${res.error}` });
    return res;
  }

  const contractHyphen = parseToKucoinContractSymbol(raw); // e.g. ADA-USDTM
  const apiSymbolKey   = toKucoinApiSymbol(contractHyphen); // e.g. ADAUSDTM

  // Fetch live
  let open = [];
  try {
    open = await getOpenFuturesPositions();
  } catch (e) {
    const msg = e?.message || 'Failed to fetch open positions';
    feed({ contract: contractHyphen, state: 'CLOSE_ERROR', text: `❌ Close error: ${msg}` });
    return { success: false, error: msg, code: 500 };
  }

  const pos = open.find(p => toKucoinApiSymbol(String(p.contract || p.symbol || '')) === apiSymbolKey);
  if (!pos) {
    const res = {
      success: false,
      error: `No open position for ${contractHyphen}`,
      code: 404,
      openContracts: open.map(p => String(p.contract))
    };
    feed({ contract: contractHyphen, state: 'CLOSE_ERROR', text: `❌ ${res.error}` });
    return res;
  }

  // Determine opposite close side from live position (robust)
  const sideStr = String(pos.side || '').toLowerCase(); // 'buy' | 'sell'
  const positionIsLong =
    sideStr === 'buy' ||
    Number(pos.currentQty) > 0 ||
    Number(pos.sizeSigned) > 0;

  const closeSide = positionIsLong ? 'SELL' : 'BUY';

  // Units to close
  const contractsToClose = Number(pos.size || 0);
  if (!(contractsToClose > 0)) {
    const res = { success: false, error: 'Position size is zero', code: 400 };
    feed({ contract: contractHyphen, state: 'CLOSE_ERROR', text: `❌ Close error: ${res.error}` });
    return res;
  }

  const lev = Math.max(1, parseInt(pos.leverage || 1, 10));

  // Build KuCoin order body
  const apiSymbol = toKucoinApiSymbol(contractHyphen);
  const bodyObj = {
    clientOid: `close_${apiSymbol}_${Date.now()}`,
    symbol: apiSymbol,
    side: closeSide,
    type: 'market',
    leverage: String(lev),
    size: contractsToClose,
    reduceOnly: true
  };

  // Feed: announce attempt
  feed({
    contract: contractHyphen,
    state: 'CLOSE_REQUEST',
    text: `🔻 Close requested: ${contractHyphen} • side=${closeSide} • size=${contractsToClose}`
  });

  // Sign & send
  const bodyStr = JSON.stringify(bodyObj);
  const headers = signKucoinV3Request('POST', '/api/v1/orders', '', bodyStr, API_KEY, API_SECRET, API_PASSPHRASE);
  const kuRes = await axios.post(`${BASE_URL}/api/v1/orders`, bodyObj, { headers }).catch(e => ({ error: e }));

  if (kuRes?.error) {
    const d = kuRes.error?.response?.data;
    const msg = d?.msg || kuRes.error.message || 'Close order failed';
    feed({ contract: contractHyphen, state: 'CLOSE_ERROR', text: `❌ KuCoin reject: ${msg}` });
    return { success: false, error: msg, detail: d, code: 500 };
  }

  const accepted = kuRes?.data?.code === '200000' && kuRes?.data?.data?.orderId;
  if (!accepted) {
    const msg = kuRes?.data?.msg || 'Close order rejected';
    feed({ contract: contractHyphen, state: 'CLOSE_ERROR', text: `❌ KuCoin reject: ${msg}` });
    return { success: false, error: msg, detail: kuRes?.data, code: 400 };
  }

  const orderId = kuRes.data.data.orderId;

  // Try to fetch fill price
  let exit = 0;
  try {
    let fill = await getKucoinOrderFill(orderId);
    if (!fill?.price) {
      await new Promise(r => setTimeout(r, 1200));
      fill = await getKucoinOrderFill(orderId);
    }
    exit = Number(fill?.price) || 0;
  } catch { /* ignore */ }

  // Fallback if still missing
  if (!exit) {
    try {
      await getOpenFuturesPositions(); // refresh (not strictly needed)
      exit = Number(pos.markPrice || pos.entryPrice || 0) || 0;
    } catch { /* ignore */ }
  }

  // PnL/ROI calc for history
  const entry = Number(pos.entryPrice || 0);
  const specs = await getContractSpecs(contractHyphen);
  const baseQty = contractsToClose * (specs.multiplier || 1);
  let pnl = '0.0000';
  let pnlPercent = '0.00%';

  if (entry > 0 && exit > 0) {
    const diff = positionIsLong ? (exit - entry) : (entry - exit);
    const pnlUsd = diff * baseQty;                 // fees ignored
    pnl = pnlUsd.toFixed(4);
    const cost = (baseQty * entry) / lev;          // initial margin
    const roi = cost > 0 ? (pnlUsd / cost) * 100 : 0;
    pnlPercent = roi.toFixed(2) + '%';
  }

  // Update local trade history
  const history = safeReadHistory() || [];
  const openTrade = history.find(t =>
    String(t.symbol).toUpperCase() === contractHyphen.toUpperCase() &&
    String(t.status).toUpperCase() === 'OPEN'
  );

  if (openTrade) {
    await closeTrade(contractHyphen, openTrade.side, exit || 0, pnl, pnlPercent);
  } else {
    await closeTrade(contractHyphen, positionIsLong ? 'buy' : 'sell', exit || 0, pnl, pnlPercent);
  }

  // Feed: final success
  feed({
    contract: contractHyphen,
    state: 'CLOSED',
    text: `✅ Closed ${contractHyphen} • ${closeSide} • size=${contractsToClose} @ ${exit || '≈'} | PnL ${pnl} (${pnlPercent})`,
    pnl,
    pnlPercent,
    exitPrice: exit || null
  });

  return {
    success: true,
    data: {
      contract: contractHyphen,
      closedSide: closeSide,
      size: contractsToClose,
      orderId,
      exit,
      pnl,
      pnlPercent
    }
  };
}

/* ───────────────────────── §2. Express handler ─────────────────────────── */
async function closeFuturesPosition(req, res) {
  try {
    const { contract: rawContract, symbol, side } = req.body || {};
    const contract = (rawContract || symbol || '').trim();
    const result = await closeFuturesPositionService({ contract, side });

    if (result.success) {
      return res.json(result);
    }
    const code = result.code || 500;
    return res.status(code).json(result);
  } catch (err) {
    const msg = err?.response?.data?.msg || err.message;
    feed({ contract: (req.body?.contract || req.body?.symbol || '-'), state: 'CLOSE_ERROR', text: `❌ Close error: ${msg}` });
    console.error('[closeFuturesPosition] ❌ ERROR:', err?.response?.data || err.message);
    return res.status(500).json({ success: false, error: msg });
  }
}

/* ───────────────────────── §3. Exports ─────────────────────────────────── */
module.exports = {
  closeFuturesPositionService,
  closeFuturesPosition
};