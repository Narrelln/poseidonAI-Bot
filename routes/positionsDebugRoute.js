// routes/positionsDebugRoute.js
const express = require('express');
const router = express.Router();
const { getOpenFuturesPositions } = require('../kucoinHelper');

router.get('/open-positions-debug', async (_req, res) => {
  try {
    const rows = await getOpenFuturesPositions();
    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

module.exports = router;