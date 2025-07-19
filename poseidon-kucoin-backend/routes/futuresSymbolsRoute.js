// routes/futuresSymbolsRoute.js

const express = require('express');
const router = express.Router();
const axios = require('axios');

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
    console.error('Error fetching futures symbols:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;