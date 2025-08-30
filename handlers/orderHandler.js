/**
 * File #06: handlers/orderHandler.js
 * Description:
 *   Express route wiring for placing KuCoin futures orders.
 *   - /api/order and /api/place-trade → open positions (Quantity USDT flow)
 *   - Emits TP/SL feed events when an order is accepted.
 * Notes:
 *   - Uses setLeverageForSymbol before placing to match UI leverage.
 *   - Close route is NOT registered here; main server registers it once.
 * Last Updated: 2025-08-13
 */

const { placeFuturesOrder } = require('./placeTradeHandler'); // open orders only
const {
  parseToKucoinContractSymbol,
  setLeverageForSymbol,
} = require('../kucoinHelper');

// 🔵 TP/SL feed helpers (safe if module present)
let pushTpFeed = null;
let ensureSnapshot = null;
try {
  ({ pushTpFeed, ensureSnapshot } = require('../tpSlMonitor'));
} catch (_) {
  // optional in case the module isn't loaded yet
}

function registerOrderRoute(app, io) {
  const openHandler = async (req, res) => {
    try {
      const body = req.body || {};

      // 1) Normalize symbol → KuCoin futures "BASE-USDTM"
      const rawSymbol = body.contract || body.symbol;
      if (!rawSymbol) {
        return res.status(400).json({ success: false, error: 'Missing symbol/contract' });
      }
      const contract = parseToKucoinContractSymbol(rawSymbol);

      // 2) Side
      const side = String(body.side || '').toUpperCase();
      if (!['BUY', 'SELL'].includes(side)) {
        return res.status(400).json({ success: false, error: 'Invalid side' });
      }

      // 3) Leverage
      const leverage = Math.max(1, parseInt(body.leverage || 1, 10));
      try {
        await setLeverageForSymbol(contract, leverage);
      } catch (e) {
        console.warn('⚠️ setLeverageForSymbol failed:', e?.response?.data || e.message);
      }

// 4) Quantity (USDT) as source of truth
const notionalUsd =
  (Number.isFinite(+body.notionalUsd) && +body.notionalUsd > 0)
    ? +body.notionalUsd
    : (Number.isFinite(+body.value) && +body.value > 0 && leverage > 0)
    ? (+body.value * leverage)
    : (Number.isFinite(+body.marginUsd) && +body.marginUsd > 0 && leverage > 0)
    ? (+body.marginUsd * leverage)
    : NaN;

if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
  return res.status(400).json({ success: false, error: 'Provide notionalUsd (Quantity USDT) or margin/value' });
}

// sanitize TP/SL to clean numbers (default + no negatives)
const tp = Math.max(0, Number.isFinite(+body.tpPercent) ? +body.tpPercent : 35);
const sl = Math.max(0, Number.isFinite(+body.slPercent) ? +body.slPercent : 20);

// build tradePayload using sanitized tp/sl
const tradePayload = {
  contract,
  side,
  type: 'market',
  leverage,
  manual: !!body.manual,
  notionalUsd,
  tpPercent: tp,
  slPercent: sl,
};

// UI event: pending (✅ also use tp/sl here)
io.emit('trade-pending', {
  contract,
  side,
  leverage,
  notionalUsd,
  manual: !!body.manual,
  tpPercent: tp,
  slPercent: sl,
  timestamp: Date.now(),
});

      // 🚀 Place order
      const result = await placeFuturesOrder(tradePayload);

      if (result?.code === 'SUCCESS' || result?.code === 'SUCCESS_WITH_WARNING') {
        io.emit('trade-confirmed', result.data);

        // 🔵 Seed TP/SL feed so the UI never shows "no snapshot yet"
        try { ensureSnapshot?.(contract); } catch (e) {}

        // Normalize side for consistent UI text
        const SIDE = side === 'SELL' ? 'SELL' : 'BUY';

        // 1) Log the entry placement immediately (persists in feed)
        try {
          pushTpFeed?.({
            contract,
            state: 'OPENED',
            text: `🟢 Entry placed: \`${contract}\` • ${SIDE}`,
          });
        } catch (e) {}

        // 2) Then log the exchange acceptance
        try {
          pushTpFeed?.({
            contract,
            state: 'ORDER_ACCEPTED',
            text: `✅ Order accepted for ${contract} (${SIDE}) • lev ${leverage}x`,
          });
        } catch (e) {}

        return res.json({ success: true, data: result.data, code: result.code });
      } // ← close the success IF block

      // Error path (non‑success result)
      try {
        pushTpFeed?.({
          contract,
          state: 'ORDER_ERROR',
          text: `❌ Order rejected for ${contract}: ${result?.msg || 'Unknown error'}`,
        });
      } catch (e) {}

      return res.status(400).json({ success: false, error: result?.msg || 'Unknown error' });

    } catch (err) {
      console.error('/api/order error:', err?.response?.data || err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  // ---------- OPEN ORDER ROUTES ----------
  app.post('/api/order', openHandler);
  app.post('/api/place-trade', openHandler);

  // ❌ Do NOT register /api/close-trade here
}

module.exports = { registerOrderRoute };