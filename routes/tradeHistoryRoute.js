const express = require('express');
const router = express.Router();
const { safeReadHistory } = require('../utils/tradeLedger'); // or tradeHistory.js

router.get('/', async (req, res) => {
  try {
    const history = await safeReadHistory();
    res.json(history.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;