const express = require('express');
const router = express.Router();
const { getOpenFuturesPositions } = require('../kucoinHelper');
const { getRecentTrades } = require('../utils/tradeHistory');
const { analyzeSymbol } = require('../handlers/taClient');

// Normalize KuCoin symbols for TA (e.g., DOGEUSDTM → DOGEUSDT)
function normalizeForTA(symbol) {
  let s = symbol.toUpperCase().replace(/[-_]/g, '');
  if (s.endsWith('USDTM')) s = s.slice(0, -1);
  if (!s.endsWith('USDT')) s += 'USDT';
  return s;
}

router.get('/position-details/:contract', async (req, res) => {
  const contract = req.params.contract;
  if (!contract) return res.status(400).json({ success: false, error: 'Missing contract' });

  try {
    const positions = await getOpenFuturesPositions();
    const position = positions.find(p => p.symbol === contract);
    if (!position) return res.status(404).json({ success: false, error: 'Position not found' });

    const entryPrice = parseFloat(position.entryPrice);
    const markPrice = parseFloat(position.markPrice || entryPrice);
    const size = parseFloat(position.size || 0);
    const leverage = parseFloat(position.leverage || 1);
    const value = entryPrice * size;
    const pnlValue = position.side === 'buy'
      ? (markPrice - entryPrice) * size
      : (entryPrice - markPrice) * size;
    const roi = value > 0 ? ((pnlValue / value) * 100).toFixed(2) : '0.00';

    // Normalize for TA
    const taSymbol = normalizeForTA(contract);
    const ta = await analyzeSymbol(taSymbol);

    // Fetch history for this contract
    const history = (await getRecentTrades()).filter(t => t.contract === contract);

    return res.json({
      success: true,
      entryPrice,
      exitPrice: markPrice,
      leverage,
      liquidation: position.liquidationPrice || '-',
      margin: parseFloat(position.margin) || value / leverage,
      value,
      price: ta?.price || markPrice,
      volume: ta?.quoteVolume || ta?.volume || null,
      confidence: ta?.confidence || null,
      pnlValue: pnlValue.toFixed(2),
      roi,
      tradeHistory: history.map(t => ({
        entry: t.entry,
        exit: t.exit,
        roi: t.roi,
        pnl: t.pnl,
        win: t.pnl > 0,
        timestamp: t.timestamp
      })),
      ath: ta?.ath || null,
      atl: ta?.atl || null
    });
  } catch (err) {
    console.error('❌ /api/position-details error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;