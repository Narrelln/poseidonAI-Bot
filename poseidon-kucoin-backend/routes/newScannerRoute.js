const express = require('express');
const axios = require('axios');
const router = express.Router();

const CONTRACTS_URL = 'https://api-futures.kucoin.com/api/v1/contracts/active';
const TICKERS_URL   = 'https://api-futures.kucoin.com/api/v1/market/ticker?type=all';
const MIN_VOLUME = 1000;

router.get('/api/scan-tokens', async (req, res) => {
  try {
    const contractsRes = await axios.get(CONTRACTS_URL);
    const contractsRaw = contractsRes.data?.data || [];
    const contracts = contractsRaw.filter(c =>
      c?.symbol?.endsWith('USDTM') && c.status === 'Open'
    );
    console.log(`📦 Contracts: ${contracts.length}`);

    const tickersRes = await axios.get(TICKERS_URL);
    const tickersRaw = tickersRes.data?.data || [];
    console.log(`📊 Tickers: ${tickersRaw.length}`);

    const tickerMap = new Map(tickersRaw.map(t => [t.symbol, t]));

    const enriched = [];

    for (const c of contracts) {
      const symbol = c.symbol;
      const t = tickerMap.get(symbol);
      if (!t) continue;

      const price = parseFloat(t.price || 0);
      const quoteVolume = parseFloat(t.volValue || t.vol || 0);
      const changeRate = parseFloat(t.changeRate || 0);

      if (!price || quoteVolume < MIN_VOLUME) continue;

      enriched.push({
        symbol,
        price,
        quoteVolume,
        change: +(changeRate * 100).toFixed(2)
      });
    }

    console.log(`✅ Enriched: ${enriched.length} symbols`);
    res.json({ success: true, count: enriched.length, symbols: enriched });
  } catch (err) {
    console.error('❌ /api/scan-tokens error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;