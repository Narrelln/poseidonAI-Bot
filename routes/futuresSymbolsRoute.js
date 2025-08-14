const express = require('express');
const router = express.Router();
const axios = require('axios');

// === GET /api/futures-symbols ===
router.get('/futures-symbols', async (req, res) => {
  try {
    const url = 'https://api-futures.kucoin.com/api/v1/contracts/active';
    const response = await axios.get(url);
    const contracts = Array.isArray(response.data?.data) ? response.data.data : [];

    const symbols = contracts
      .filter(c => c.symbol && c.symbol.endsWith('USDTM') && c.status === 'Open')
      .map(c => ({
        symbol: c.symbol,
        baseCurrency: c.baseCurrency,
        quoteCurrency: c.quoteCurrency,
        status: c.status
      }));

    res.json({ success: true, symbols });
  } catch (error) {
    console.error('[futures-symbols] Error:', error.message || error);
    res.status(500).json({ success: false, error: error.message || 'Internal error' });
  }
});

module.exports = router;