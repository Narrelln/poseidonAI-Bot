// File #07: handlers/closeTradeRoute.js
// Wrapper for /api/close-trade that defers to the service handler
// and emits `trade-closed` when the close succeeds.
// Also pushes TP/SL feed lines (if tpSlMonitor exposes pushTpFeed).

const { closeFuturesPosition } = require('./closeTradeHandler');

// Safe, optional hook into the TP/SL monitor feed
let pushTpFeed;
try {
  // adjust the path if your tpSlMonitor lives elsewhere
  ({ pushTpFeed } = require('../tpSlMonitor'));
} catch (_) {
  pushTpFeed = undefined; // feed is optional
}

function registerCloseTradeRoute(app, io) {
  app.post('/api/close-trade', async (req, res) => {
    try {
      // Normalize body – allow side to be omitted
      const body = req.body || {};
      body.contract = (body.contract || body.symbol || '').trim();
      body.side = (body.side || '').toString().trim().toLowerCase();
      req.body = body;

      if (!body.contract) {
        return res.status(400).json({ success: false, error: 'Missing contract (or symbol)' });
      }

      // 🔵 FEED: immediately note that a close was requested
      if (typeof pushTpFeed === 'function') {
        pushTpFeed({
          contract: body.contract,
          state: 'CLOSE_REQUESTED',
          text: `🟥 Close requested for ${body.contract}${body.side ? ` (${body.side})` : ''}`
        });
      }

      // Intercept res.json so we can emit after the service responds
      const send = res.json.bind(res);
      res.json = (payload) => {
        try {
          if (payload && payload.success) {
            const d = payload.data || payload.result || {};
            const closeEvent = {
              contract: d.contract,
              closedSide: d.closedSide,
              size: d.size,
              exit: d.exit,
              pnl: d.pnl,
              pnlPercent: d.pnlPercent,
              orderId: d.orderId || null
            };

            // Socket event for any live widgets
            io.emit('trade-closed', closeEvent);

            // 🔵 FEED: closed successfully
            if (typeof pushTpFeed === 'function') {
              const pnlText = d.pnlPercent ? `${d.pnl} (${d.pnlPercent})` : (d.pnl ?? '--');
              pushTpFeed({
                contract: d.contract,
                state: 'CLOSED',
                text: `🔴 Closed ${d.contract} @ ${d.exit || '--'} • PnL ${pnlText}`
              });
            }
          } else if (typeof pushTpFeed === 'function') {
            // 🔵 FEED: service responded but not success
            pushTpFeed({
              contract: body.contract,
              state: 'CLOSE_ERROR',
              text: `⚠️ Close failed for ${body.contract}: ${payload?.error || 'Unknown error'}`
            });
          }
        } catch (_) {
          // keep response flow even if emit/feed fails
        }
        return send(payload);
      };

      // Delegate to the real service (Express-style handler)
      return closeFuturesPosition(req, res);

    } catch (err) {
      // 🔵 FEED: unexpected wrapper error
      if (typeof pushTpFeed === 'function' && req?.body?.contract) {
        pushTpFeed({
          contract: req.body.contract,
          state: 'CLOSE_ERROR',
          text: `❌ Close error for ${req.body.contract}: ${err?.message || err}`
        });
      }
      console.error('❌ /api/close-trade wrapper error:', err?.message || err);
      return res.status(500).json({ success: false, error: err.message || 'Unexpected error' });
    }
  });
}

module.exports = { registerCloseTradeRoute };