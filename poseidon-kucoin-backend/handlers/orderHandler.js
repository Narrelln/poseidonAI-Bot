// handlers/orderHandler.js
const { placeFuturesOrder } = require('./placeTradeHandler');

function registerOrderRoute(app, io) {
  app.post('/api/order', async (req, res) => {
    try {
      const body = req.body;

      // ✅ Support marginUsd or size input (one must be valid number)
      if (!body.contract || !body.side || (isNaN(body.size) && isNaN(body.notionalUsd))) {
        return res.status(400).json({ error: 'Missing required order parameters.' });
      }

      io.emit('trade-pending', { ...body, timestamp: Date.now() });

      const result = await placeFuturesOrder(body);

      if (result?.code === 'SUCCESS') {
        io.emit('trade-confirmed', result.data);
        return res.json({ success: true, data: result.data });
      } else {
        return res.status(400).json({ success: false, error: result?.msg || 'Unknown error' });
      }
    } catch (err) {
      console.error("/api/order error:", err?.response?.data || err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

module.exports = { registerOrderRoute };