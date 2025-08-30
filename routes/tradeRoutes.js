// routes/tradeRoutes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');

const {
  getKucoinWalletBalance,
  getKucoinFuturesSymbols,
  getOpenFuturesPositions,
  parseToKucoinContractSymbol,
  toSpotSymbolForTA,
  getContractSpecs,
  calcOrderFromQuantityUsd, // uses multiplier, lotSize, minSize
} = require('../kucoinHelper');

const { list } = require('../utils/tradeLedger');
const { placeFuturesOrder } = require('../handlers/placeTradeHandler');

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

/* ----------------------------- Routes ------------------------------ */

// Wallet balance
router.get('/balance', async (_req, res) => {
  try {
    const balance = await getKucoinWalletBalance();
    res.json({ success: true, balance });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Futures symbols
router.get('/futures-symbols', async (_req, res) => {
  try {
    const symbols = await getKucoinFuturesSymbols();
    res.json({ success: true, symbols });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Open positions (enriched, consistent with your UI expectations)
router.get('/positions', async (_req, res) => {
  try {
    const positions = await getOpenFuturesPositions();
    const enriched = positions.map(pos => {
      const entry = parseFloat(pos.entryPrice);
      const mark = parseFloat(pos.markPrice || entry);
      const side = pos.side === 'buy' ? 'long' : 'short';
      const size = Number(pos.size) || 1;
      const leverage = Number(pos.leverage) || 5;

      let pnlValue = 0, pnlPercent = '0.00%', roi = '0.00%';
      if (side === 'long') {
        pnlValue = (mark - entry) * size;
        pnlPercent = (((mark - entry) / entry) * leverage * 100).toFixed(2) + '%';
      } else {
        pnlValue = (entry - mark) * size;
        pnlPercent = (((entry - mark) / entry) * leverage * 100).toFixed(2) + '%';
      }
      roi = pnlPercent;

      return {
        ...pos,
        symbol: pos.contract.replace('-USDTM', 'USDT'),
        side,
        leverage,
        pnlValue: pnlValue.toFixed(2),
        pnlPercent,
        roi,
      };
    });

    res.json({ success: true, positions: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trade history (latest N)
router.get('/trade-history', async (req, res) => {
  try {
    const limit = Number(req.query.limit);
    const trades = await list(Number.isFinite(limit) && limit > 0 ? limit : 50);
    res.json({ success: true, trades });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Manual test order (LEDGER‑FIRST; uses new placeFuturesOrder signature)
//
// Body:
// {
//   "symbol": "BTC-USDTM" | "BTCUSDTM" | "BTC",  // any form
//   "side": "buy" | "sell",                      // default "buy"
//   "margin": 6.5,                               // USDT margin you want to use (default 1)
//   "leverage": 5,                               // default 5
//   "confidence": 90,
//   "price": 123.45,                             // OPTIONAL; if omitted we fetch from TA
//   "note": "Manual test order"
// }
router.post('/place-futures-trade', async (req, res) => {
  try {
    const rawSymbol   = String(req.body.symbol || '');
    if (!rawSymbol) return res.status(400).json({ success: false, error: 'Missing symbol' });

    const side        = (req.body.side || 'buy').toLowerCase();   // 'buy' | 'sell'
    const margin      = Number(req.body.margin ?? 1);             // USDT margin you want to deploy
    const leverage    = Number(req.body.leverage ?? 5);
    const confidence  = Number(req.body.confidence ?? 90);
    const note        = req.body.note || 'Manual test order';

    if (!(margin > 0)) {
      return res.status(400).json({ success: false, error: 'margin must be > 0' });
    }

    // Normalize to KuCoin futures contract & TA symbol
    const contract = parseToKucoinContractSymbol(rawSymbol);      // e.g. ADA → ADA-USDTM
    const taSymbol = toSpotSymbolForTA(contract);                 // e.g. ADA-USDTM → ADAUSDT

    // Prefer caller-provided price; else pull from local TA
    let price = Number(req.body.price);
    if (!Number.isFinite(price) || price <= 0) {
      try {
        const taRes = await axios.get(`${BASE}/api/ta/${encodeURIComponent(taSymbol)}`, { timeout: 8000 });
        price = Number(taRes.data?.price ?? taRes.data?.markPrice ?? NaN);
      } catch (e) {
        // If TA fails, we still let the handler resolve from KuCoin ticker
        price = NaN;
      }
    }

    // Convert "margin" to notional (quantity USDT) the handler expects:
    // Quantity = margin * leverage
    const notionalUsd = margin * leverage;

    // Hand off to the new handler (it will compute contracts & persist to ledger)
    const result = await placeFuturesOrder({
      contract,                          // ✅ pass contract (not symbol)
      side,                              // 'buy' | 'sell' accepted
      leverage,
      notionalUsd,                       // Quantity (USDT) to deploy
      testPrice: Number.isFinite(price) ? price : null,   // give handler our price if we have it
      manual: true,                      // marks origin as manual
      tpPercent: Number(req.body.tpPercent ?? 0),
      slPercent: Number(req.body.slPercent ?? 0),
    });

    // Friendly response
    return res.json({
      success: result?.code === 'SUCCESS' || result?.code === 'SUCCESS_WITH_WARNING',
      order: {
        contract,
        side,
        leverage,
        requestedMargin: margin,
        // For transparency: handler returns computed ledger row in result.data
      },
      result
    });

  } catch (err) {
    console.error('❌ Manual trade error:', err?.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message || 'Manual trade failed' });
  }
});

module.exports = router;