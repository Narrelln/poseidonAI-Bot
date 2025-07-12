// handlers/closeTradeRoute.js

const { closeFuturesPosition } = require('./closeTradeHandler');

function registerCloseTradeRoute(app, io) {
  app.post('/api/close-trade', async (req, res) => {
    const { contract, side } = req.body;

    if (!contract || !side) {
      return res.status(400).json({ success: false, error: 'Missing contract or side' });
    }

    try {
      console.log(`🔻 Closing position: ${contract} (${side})`);
      const result = await closeFuturesPosition({ contract, side });

      if (result && result.success) {
        io.emit('trade-closed', result); // Notify dashboard
        return res.json({ success: true, result });
      } else {
        return res.status(500).json({ success: false, error: 'Close failed', details: result });
      }
    } catch (err) {
      console.error('❌ /api/close-trade error:', err.message || err);
      return res.status(500).json({ success: false, error: err.message || 'Unexpected error' });
    }
  });
}

module.exports = { registerCloseTradeRoute };