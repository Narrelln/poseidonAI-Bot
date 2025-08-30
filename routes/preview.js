// routes/preview.js (or wherever you handle it)
const express = require('express');
const router = express.Router();
const { previewOrder } = require('../handlers/kucoinOrders');

router.post('/preview-order', async (req, res) => {
  const { symbol, contract, notionalUsd, leverage } = req.body || {};
  const out = await previewOrder({ symbol: contract || symbol, notionalUsd, leverage });
  if (!out.ok) return res.status(400).json(out);
  res.json(out);
});

module.exports = router;