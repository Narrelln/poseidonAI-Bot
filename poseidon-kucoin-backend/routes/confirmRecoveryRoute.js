const { confirmBullishRecovery } = require('../utils/confirmBullishRecovery');

function registerConfirmRecoveryRoute(app) {
  app.get('/api/confirm-recovery', async (req, res) => {
    try {
      const { symbol } = req.query;
      if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

      const result = await confirmBullishRecovery(symbol);
      res.json({ confirmed: result }); // ✅ KEY CHANGED HERE
    } catch (err) {
      console.error('Confirm recovery error:', err.message);
      res.status(500).json({ error: 'Internal error' });
    }
  });
}

module.exports = { registerConfirmRecoveryRoute };