// handlers/getOpenPositions.js

const { kucoinFuturesClient } = require('../handlers/kucoinClient'); // ✅ Corrected path


async function getOpenPositions(req, res) {
  try {
    const rawPositions = await kucoinFuturesClient.getPositionList();

    const formatted = (rawPositions || [])
      .filter(p => parseFloat(p.size) > 0)
      .map(pos => {
        const entry = parseFloat(pos.entryPrice || 0);
        const mark = parseFloat(pos.markPrice || entry);
        const size = parseFloat(pos.size || 0);
        const leverage = parseFloat(pos.leverage || 5);
        const margin = parseFloat(pos.margin || 0);
        const side = pos.side === 'buy' ? 'long' : 'short';

        let pnlValue = 0, pnlPercent = "0.00%", roi = "0.00%";
        if (side === 'long') {
          pnlValue = (mark - entry) * size;
          pnlPercent = (((mark - entry) / entry) * leverage * 100).toFixed(2) + "%";
        } else {
          pnlValue = (entry - mark) * size;
          pnlPercent = (((entry - mark) / entry) * leverage * 100).toFixed(2) + "%";
        }
        roi = pnlPercent;

        return {
          symbol: pos.symbol.replace('-USDTM', 'USDT'),
          contract: pos.symbol,
          side,
          entryPrice: entry,
          markPrice: mark,
          size,
          leverage,
          margin,
          liquidation: pos.liquidationPrice || '-',
          pnlValue: pnlValue.toFixed(2),
          pnlPercent,
          roi
        };
      });

    return res.json({ success: true, positions: formatted });
  } catch (err) {
    console.error('❌ Failed to fetch positions from KuCoin:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch positions' });
  }
}

module.exports = { getOpenPositions };