const { detectRSIReversal } = require('../utils/rsiReversal');

function registerRSIReversalRoute(app) {
  app.get('/api/rsi-reversal', async (req, res) => {
    try {
      const { symbol } = req.query;
      if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

      const result = await detectRSIReversal(symbol);
      res.json(result);
    } catch (err) {
      console.error('[RSI Reversal] Error:', err.message);
      res.status(500).json({ error: 'Failed to detect RSI reversal' });
    }
  });
}

module.exports = { registerRSIReversalRoute };