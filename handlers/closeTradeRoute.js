// File #07: handlers/closeTradeRoute.js
// Wrapper for /api/close-trade that defers to the service handler
// and emits `trade-closed` when the close succeeds.
// Pushes feed on REQUEST and ERROR only (service emits CLOSED).

const { closeFuturesPosition } = require('./closeTradeHandler');

// Normalize symbols/contracts to KuCoin hyphen format
let parseToKucoinContractSymbol = null;
try {
  ({ parseToKucoinContractSymbol } = require('../kucoinHelper'));
} catch (_) {
  // optional; if missing we’ll pass through the raw symbol
  parseToKucoinContractSymbol = (s) => (s || '').toString().toUpperCase();
}

// Optional hook into the TP/SL monitor feed (safe-required)
let pushTpFeed;
try {
  ({ pushTpFeed } = require('../tpSlMonitor'));
} catch (_) {
  pushTpFeed = undefined;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return undefined;
}
function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(1, n));
}

function registerCloseTradeRoute(app, io) {
  app.post('/api/close-trade', async (req, res) => {
    try {
      // ---- Normalize inbound body (keep keys used by partial TP & service) ----
      const bIn = req.body || {};
      const rawSym = (bIn.contract || bIn.symbol || '').toString().trim();
      const contract = rawSym ? parseToKucoinContractSymbol(rawSym) : '';

      if (!contract) {
        return res.status(400).json({ success: false, error: 'Missing contract (or symbol)' });
      }

      // coerce fields the service may use
      const body = {
        // core identity
        contract,
        symbol: contract, // some services look at symbol; safe to mirror

        // optional close controls
        side: (bIn.side ?? '').toString().trim().toLowerCase() || undefined, // 'buy'|'sell'
        fraction: clamp01(bIn.fraction),
        quantityContracts: toNum(bIn.quantityContracts),  // <-- keep partial-close quantity
        reduceOnly: toBool(bIn.reduceOnly),               // <-- partial close flag
        closeAll: toBool(bIn.closeAll),                   // <-- full close short-circuit

        // optional exit context (for feed/ledger)
        exit: toNum(bIn.exit),
        pnl: toNum(bIn.pnl),
        pnlPercent: (typeof bIn.pnlPercent === 'string' || typeof bIn.pnlPercent === 'number')
          ? bIn.pnlPercent
          : undefined,
      };

      // Replace req.body for the downstream handler
      req.body = body;

      // ---- FEED: announce request (service will emit CLOSED on success) ----
      if (typeof pushTpFeed === 'function') {
        const parts = [];
        parts.push(`🔻 Close requested for ${body.contract}`);
        if (body.side) parts.push(`(${body.side})`);
        if (Number.isFinite(body.quantityContracts)) parts.push(`• qty=${body.quantityContracts}`);
        if (Number.isFinite(body.fraction) && body.fraction > 0 && body.fraction < 1) {
          parts.push(`• fraction=${Math.round(body.fraction * 100)}%`);
        }
        if (body.reduceOnly) parts.push('• reduceOnly');
        if (body.closeAll) parts.push('• closeAll');
        pushTpFeed({ contract: body.contract, state: 'CLOSE_REQUEST', text: parts.join(' ') });
      }

      // Intercept res.json to emit socket after the service responds.
      const send = res.json.bind(res);
      res.json = (payload) => {
        try {
          if (payload && payload.success) {
            const d = payload.data || payload.result || {};
            const closeEvent = {
              contract: d.contract || body.contract,
              closedSide: d.closedSide || body.side || null,
              size: d.size,
              exit: d.exit,
              pnl: d.pnl,
              pnlPercent: d.pnlPercent,
              orderId: d.orderId || null
            };
            io.emit('trade-closed', closeEvent);
            // NOTE: do NOT push a feed here; service is expected to emit CLOSED.
          } else if (typeof pushTpFeed === 'function') {
            pushTpFeed({
              contract: body.contract,
              state: 'CLOSE_ERROR',
              text: `⚠️ Close failed for ${body.contract}: ${payload?.error || 'Unknown error'}`
            });
          }
        } catch (_) {
          // never block the response on feed/socket issues
        }
        return send(payload);
      };

      // Delegate to the real service (Express-style handler)
      return closeFuturesPosition(req, res);

    } catch (err) {
      try {
        if (typeof pushTpFeed === 'function' && req?.body?.contract) {
          pushTpFeed({
            contract: req.body.contract,
            state: 'CLOSE_ERROR',
            text: `❌ Close error for ${req.body.contract}: ${err?.message || err}`
          });
        }
      } catch (_) {}
      console.error('❌ /api/close-trade wrapper error:', err?.message || err);
      return res.status(500).json({ success: false, error: err.message || 'Unexpected error' });
    }
  });
}

module.exports = { registerCloseTradeRoute };