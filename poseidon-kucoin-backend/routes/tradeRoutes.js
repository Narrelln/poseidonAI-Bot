// routes/tradeRoutes.js

const express = require('express');
const router = express.Router();

const {
  getKucoinWalletBalance,
  getKucoinFuturesSymbols,
  getOpenFuturesPositions
} = require('../kucoinHelper');

const { getRecentTrades } = require('../utils/tradeHistory');

// Wallet balance route
router.get('/balance', async (req, res) => {
  try {
    const balance = await getKucoinWalletBalance();
    res.json({ success: true, balance });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Futures symbol list
router.get('/futures-symbols', async (req, res) => {
  try {
    const symbols = await getKucoinFuturesSymbols();
    res.json({ success: true, symbols });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Open positions
router.get('/positions', async (req, res) => {
  try {
    const positions = await getOpenFuturesPositions();
    const enriched = positions.map(pos => {
      const entry = parseFloat(pos.entryPrice);
      const mark = parseFloat(pos.markPrice || entry);
      const side = pos.side === "buy" ? "long" : "short";
      const size = Number(pos.size) || 1;
      const leverage = Number(pos.leverage) || 5;
      let pnlValue = 0, pnlPercent = "0.00%", roi = "0.00%";

      if (side === "long") {
        pnlValue = (mark - entry) * size;
        pnlPercent = (((mark - entry) / entry) * leverage * 100).toFixed(2) + "%";
      } else {
        pnlValue = (entry - mark) * size;
        pnlPercent = (((entry - mark) / entry) * leverage * 100).toFixed(2) + "%";
      }
      roi = pnlPercent;

      return {
        ...pos,
        symbol: pos.contract.replace("-USDTM", "USDT"),
        side,
        leverage,
        pnlValue: pnlValue.toFixed(2),
        pnlPercent,
        roi
      };
    });

    res.json({ success: true, positions: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trade history
router.get('/trade-history', (req, res) => {
  try {
    const trades = getRecentTrades();
    res.json({ success: true, trades });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;