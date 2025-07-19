// routes/walletRoutes.js
const express = require('express');
const router = express.Router();
const { getKucoinWalletBalance } = require('../kucoinHelper');

router.get('/wallet', async (req, res) => {
  try {
    const balance = await getKucoinWalletBalance();

    if (!balance || typeof balance.total === 'undefined' || typeof balance.available === 'undefined') {
      throw new Error('Invalid wallet data structure received from KuCoin');
    }

    res.json({ success: true, balance });
  } catch (err) {
    console.error('❌ Failed to fetch wallet:', err?.response?.data || err.message || err);
    res.status(500).json({
      success: false,
      error: err.message || 'Unknown error'
    });
  }
});

module.exports = router;