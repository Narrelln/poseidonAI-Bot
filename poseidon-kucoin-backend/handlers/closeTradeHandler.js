/**
 * File #05: handlers/closeTradeHandler.js
 * ---------------------------------------
 * Description:
 *   Source of truth for closing KuCoin futures positions.
 *   - Exports:
 *       1) closeFuturesPositionService({ contract, side, fraction, exit, pnl, pnlPercent })
 *          (pure service; no req/res)
 *       2) closeFuturesPosition(req, res) → Express handler using the service
 *   - Finds the live open position, builds a reduceOnly market order with leverage,
 *     then delegates persistence to the single-writer ledger (closePosition).
 *
 * Upgrade U03 (Feed):
 *   - Emits TP/SL feed events on close success/failure so the UI tracker can show:
 *       🔻 Close requested / ✅ Closed / ⚠️ Close error
 *   - Uses optional pushTpFeed (safe-required) → pushTpFeed({ contract, text, state, ... })
 *
 * Last Patched: 2025-08-17
 */

const axios = require('axios');
const { signKucoinV3Request } = require('../utils/signRequest');
const {
  parseToKucoinContractSymbol,
  toKucoinApiSymbol,
  getOpenFuturesPositions,
  getContractSpecs
} = require('../kucoinHelper');

// 🔁 single-writer ledger (authoritative persistence)
const { closePosition } = require('../utils/tradeLedger');

require('dotenv').config();

const BASE_URL = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';
const API_KEY = process.env.KUCOIN_KEY;
const API_SECRET = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;

// Optional TP/SL feed hook (do NOT crash if module missing)
let pushTpFeed;
try { ({ pushTpFeed } = require('../tpSlMonitor')); } catch (_) { pushTpFeed = undefined; }
const feed = (entry) => { try { if (typeof pushTpFeed === 'function') pushTpFeed(entry); } catch (_) {} };

// ───────────────────────── helpers ─────────────────────────
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const pctStr = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}%` : undefined);

// We still compute a best-effort PnL/ROI for the FEED message only,
// but the ledger will compute and persist authoritative values.
function computeLocalPnl({ entry, exit, side, size, multiplier }) {
  const e = +entry, x = +exit, s = Math.abs(+size||0), m = +multiplier || 1;
  if (!(e>0 && x>0 && s>0)) return NaN;
  const diff = x - e;
  const signed = (String(side).toLowerCase()==='sell') ? -diff : diff;
  return signed * s * m;
}
function computeLocalROI({ pnl, entry, size, multiplier, leverage }) {
  const e=+entry, s=Math.abs(+size||0), m=+multiplier||1, L=Math.max(1,+leverage||1);
  const cost = e>0 ? (e*s*m)/L : NaN;
  if (!Number.isFinite(cost) || cost<=0 || !Number.isFinite(+pnl)) return '';
  return ((+pnl / cost)*100).toFixed(2)+'%';
}

// ──────────────────────── main service ─────────────────────
/**
 * closeFuturesPositionService
 * @param {Object} args
 * @param {string} args.contract    - symbol in any form (DOGE, DOGEUSDTM, DOGE-USDTM)
 * @param {string} [args.side]      - optional UI side (ignored for safety; we derive from live pos)
 * @param {number} [args.fraction]  - optional partial fraction (0..1). If omitted → full size
 * @param {number} [args.exit]      - optional exit price hint (only used for feed text)
 * @param {number} [args.pnl]       - optional pnl USDT hint (only used for feed text)
 * @param {string} [args.pnlPercent]- optional ROI string "12.34%" hint (only used for feed text)
 */
async function closeFuturesPositionService({
  contract: raw,
  side: _uiSide,
  fraction,
  exit: exitHint,
  pnl: pnlHint,
  pnlPercent: roiHint
}) {
  if (!raw) {
    const res = { success: false, error: 'Missing contract', code: 400 };
    feed({ contract: '-', state: 'CLOSE_ERROR', text: `❌ Close error: ${res.error}` });
    return res;
  }

  const contractHyphen = parseToKucoinContractSymbol(raw); // e.g. ADA-USDTM
  const apiSymbolKey   = toKucoinApiSymbol(contractHyphen); // e.g. ADAUSDTM

  // Fetch live open positions
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
    num(pos.currentQty) > 0 ||
    num(pos.sizeSigned) > 0;

  const closeSide = positionIsLong ? 'SELL' : 'BUY';

  // Contracts + lot rounding (support partial fraction)
  const specs = await getContractSpecs(contractHyphen); // lotSize, multiplier, etc.
  const totalContracts = Math.max(0, num(pos.size) || 0);
  const lot = Math.max(1, specs.lotSize || 1);

  let fractionSafe = num(fraction);
  if (!Number.isFinite(fractionSafe) || fractionSafe <= 0 || fractionSafe > 1) {
    fractionSafe = 1; // full close by default
  }

  // round down to lot size, minimum 1 lot if fraction > 0
  let contractsToClose = Math.floor(totalContracts * fractionSafe / lot) * lot;
  if (fractionSafe > 0 && contractsToClose === 0 && totalContracts > 0) {
    contractsToClose = Math.min(lot, totalContracts);
  }

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
    text: `🔻 Close requested: ${contractHyphen} • side=${closeSide} • size=${contractsToClose}${fractionSafe < 1 ? ` (${Math.round(fractionSafe*100)}%)` : ''}`
  });

  // Sign & send to KuCoin
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

  // Try to fetch fill price (only to show nicer feed text; persistence is handled by ledger)
  let exitForFeed = Number(exitHint) || 0;
  try {
    const { getKucoinOrderFill } = require('../utils/kucoinUtils');
    let fill = await getKucoinOrderFill(orderId);
    if (!fill?.price) {
      await new Promise(r => setTimeout(r, 1200));
      fill = await getKucoinOrderFill(orderId);
    }
    exitForFeed = Number(fill?.price) || exitForFeed;
  } catch { /* ignore */ }

  // Compute PnL/ROI for FEED text (best-effort, not persisted)
  const entry = num(pos.entryPrice) || 0;
  const baseQty = (contractsToClose * (specs.multiplier || 1)); // not used in feed but kept for clarity
  let pnlForFeed = (Number.isFinite(num(pnlHint)) ? num(pnlHint) : NaN);
  let roiForFeed = (typeof roiHint === 'string' && roiHint) ? roiHint : '';

  if (!Number.isFinite(pnlForFeed) && entry > 0 && Number.isFinite(exitForFeed) && exitForFeed > 0) {
    const pnlUsd = computeLocalPnl({
      entry,
      exit: exitForFeed,
      side: sideStr,
      size: contractsToClose,
      multiplier: specs.multiplier || 1
    });
    pnlForFeed = pnlUsd;
    if (!roiForFeed) {
      roiForFeed = computeLocalROI({
        pnl: pnlUsd,
        entry,
        size: contractsToClose,
        multiplier: specs.multiplier || 1,
        leverage: lev
      }) || '0.00%';
    }
  }
  const pnlOut = Number.isFinite(pnlForFeed) ? pnlForFeed.toFixed(4) : '0.0000';

  // 🔒 Persist via ledger — single authoritative writer (resolves exit, computes PnL/ROI)
  await closePosition({
    symbol: contractHyphen,
    side: positionIsLong ? 'buy' : 'sell',
    // ❗ FIX: use exitForFeed/roiForFeed variables (exitOut/pnlPercent did not exist)
    exitHint: Number(exitForFeed) || 0,
    // pass the numeric hint if available; ledger will recompute if not finite
    pnlHint: Number.isFinite(pnlForFeed) ? pnlForFeed : undefined,
    roiHint: roiForFeed
  });

  // Feed: final success (show exit if we got a fill; else ≈ means ledger resolved it)
  feed({
    contract: contractHyphen,
    state: 'CLOSED',
    text: `✅ Closed ${contractHyphen} • ${closeSide} • size=${contractsToClose} @ ${exitForFeed || '≈'} | PnL ${pnlOut} (${roiForFeed || '0.00%'})`,
    pnl: pnlOut,
    pnlPercent: roiForFeed || '0.00%',
    exitPrice: Number.isFinite(exitForFeed) && exitForFeed > 0 ? exitForFeed : null
  });

  return {
    success: true,
    data: {
      contract: contractHyphen,
      closedSide: closeSide,
      size: contractsToClose,
      orderId,
      // note: persisted exit/pnl/roi live in the ledger; this is feed-only
      exit: Number.isFinite(exitForFeed) && exitForFeed > 0 ? exitForFeed : 0,
      pnl: pnlOut,
      pnlPercent: roiForFeed || '0.00%'
    }
  };
}

// ───────────────────── express handler ────────────────────
async function closeFuturesPosition(req, res) {
  try {
    const {
      contract: rawContract,
      symbol,
      side,
      fraction,
      exit,
      pnl,
      pnlPercent
    } = req.body || {};

    const contract = (rawContract || symbol || '').trim();

    const result = await closeFuturesPositionService({
      contract,
      side,
      fraction,
      exit,
      pnl,
      pnlPercent
    });

    if (result.success) {
      return res.json(result);
    }
    const code = result.code || 500;
    return res.status(code).json(result);
  } catch (err) {
    const msg = err?.response?.data?.msg || err.message;
    feed({
      contract: (req.body?.contract || req.body?.symbol || '-'),
      state: 'CLOSE_ERROR',
      text: `❌ Close error: ${msg}`
    });
    console.error('[closeFuturesPosition] ❌ ERROR:', err?.response?.data || err.message);
    return res.status(500).json({ success: false, error: msg });
  }
}

// ───────────────────────── exports ────────────────────────
module.exports = {
  closeFuturesPositionService,
  closeFuturesPosition
};