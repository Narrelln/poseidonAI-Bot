const axios = require('axios');

async function fetchFuturesSymbols() {
  try {
    const contractsUrl = 'https://api-futures.kucoin.com/api/v1/contracts/active';
    const tickersUrl = 'https://api-futures.kucoin.com/api/v1/ticker?type=all';

    const [contractsRes, tickersRes] = await Promise.all([
      axios.get(contractsUrl),
      axios.get(tickersUrl)
    ]);

    const contracts = contractsRes.data?.data || [];
    const tickers = tickersRes.data?.data || [];

    // 🔧 Normalize ticker symbols by removing the dash
    const tickerMap = {};
    for (const t of tickers) {
      const normalized = t.symbol.replace(/-/g, ''); // "BTC-USDTM" → "BTCUSDTM"
      tickerMap[normalized] = t;
    }

    const filtered = contracts
      .filter(c => c.symbol && c.status === 'Open' && c.symbol.endsWith('USDTM'))
      .map(c => {
        const t = tickerMap[c.symbol] || {};
        return {
          symbol: c.symbol,
          price: parseFloat(t.price || 0),
          volume: parseFloat(t.volValue || 0),
          change: parseFloat(t.changeRate || 0) * 100
        };
      });

    console.log(`✅ Found ${filtered.length} tradable Futures symbols`);
    console.log(filtered.slice(0, 10));
  } catch (err) {
    console.error('❌ Fetch failed:', err.message);
  }
}

fetchFuturesSymbols();