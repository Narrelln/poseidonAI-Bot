const express = require('express');
const axios = require('axios');
const router = express.Router();

// === Proxy: KuCoin Market Stats ===
router.get('/kucoin/market-stats', async (req, res) => {
  try {
    let { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    symbol = symbol
      .replace(/-USDTM$/i, '')
      .replace(/USDTM$/i, '')
      .replace(/-USDT$/i, '')
      .replace(/USDT$/i, '')
      .toUpperCase() + '-USDT';
    const statsRes = await axios.get(`https://api.kucoin.com/api/v1/market/stats?symbol=${symbol}`);
    res.json(statsRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Proxy: KuCoin Price ===
router.get('/kucoin/price', async (req, res) => {
  try {
    let { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    symbol = symbol
      .replace(/-USDTM$/i, '')
      .replace(/USDTM$/i, '')
      .replace(/-USDT$/i, '')
      .replace(/USDT$/i, '')
      .toUpperCase() + '-USDT';
    const priceRes = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${symbol}`);
    res.json(priceRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Gainers ===
router.get('/top-gainers', async (req, res) => {
  try {
    const contractsRes = await axios.get('https://api-futures.kucoin.com/api/v1/contracts/active');
    const contracts = Array.isArray(contractsRes.data.data)
      ? contractsRes.data.data
      : Object.values(contractsRes.data.data);

    const filtered = contracts.filter(c =>
      c.symbol.endsWith('USDTM') &&
      c.status === 'Open' &&
      typeof c.priceChgPct === 'number'
    );

    const gainers = filtered
      .filter(c => c.priceChgPct > 0)
      .sort((a, b) => b.priceChgPct - a.priceChgPct)
      .slice(0, 21)
      .map(c => ({
        symbol: c.symbol,
        change: parseFloat(c.priceChgPct.toFixed(2))
      }));

    console.log('Top 21 gainers:', gainers);
    res.json(gainers);
  } catch (err) {
    console.error("❌ /api/top-gainers error:", err.message);
    res.json([]);
  }
});

// === Losers ===
router.get('/top-losers', async (req, res) => {
  try {
    const contractsRes = await axios.get('https://api-futures.kucoin.com/api/v1/contracts/active');
    const contracts = Array.isArray(contractsRes.data.data)
      ? contractsRes.data.data
      : Object.values(contractsRes.data.data);

    const filtered = contracts.filter(c =>
      c.symbol.endsWith('USDTM') &&
      c.status === 'Open' &&
      typeof c.priceChgPct === 'number'
    );

    const losers = filtered
      .filter(c => c.priceChgPct < 0)
      .sort((a, b) => a.priceChgPct - b.priceChgPct)
      .slice(0, 9)
      .map(c => ({
        symbol: c.symbol,
        change: parseFloat(c.priceChgPct.toFixed(2))
      }));

    console.log('Top 9 losers:', losers);
    res.json(losers);
  } catch (err) {
    console.error("❌ /api/top-losers error:", err.message);
    res.json([]);
  }
});

// === Robust KuCoin Futures Price ===
router.get('/futures-price/:symbol', async (req, res) => {
  try {
    const rawSymbol = req.params.symbol.toUpperCase();
    const kucoinSymbol = rawSymbol
      .replace(/-?USDTM$/i, '')
      .replace(/-?USDT$/i, '')
      .replace(/[^A-Z]/g, '') + 'USDTM';

    const markPriceUrl = `https://api-futures.kucoin.com/api/v1/mark-price/${kucoinSymbol}`;
    const tickerUrl = `https://api-futures.kucoin.com/api/v1/ticker?symbol=${kucoinSymbol}`;

    console.log(`[DEBUG] Fetching price for: ${kucoinSymbol}`);

    let price = null;
    const history = [];

    try {
      const tickerRes = await axios.get(tickerUrl);
      if (tickerRes.data?.data?.price) {
        price = parseFloat(tickerRes.data.data.price);
      }
    } catch (err) {
      console.warn(`[TICKER FAIL] ${kucoinSymbol}: ${err.message}`);
    }

    if (price === null || price === undefined || isNaN(price)) {
      try {
        const markRes = await axios.get(markPriceUrl);
        if (markRes.data?.data?.markPrice) {
          price = parseFloat(markRes.data.data.markPrice);
        }
      } catch (err) {
        console.warn(`[MARK PRICE FAIL] ${kucoinSymbol}: ${err.message}`);
      }
    }

    if (price === null || price === undefined || isNaN(price)) {
      console.warn(`⚠️ Returning failed price for: ${kucoinSymbol}`);
      return res.json({ symbol: kucoinSymbol, price: 0, history: [], failed: true });
    }

    history.push(price);
    await new Promise(r => setTimeout(r, 300));
    try {
      const markRes2 = await axios.get(markPriceUrl);
      const second = parseFloat(markRes2.data.data.markPrice);
      if (!isNaN(second)) history.push(second);
    } catch {}

    res.json({ symbol: kucoinSymbol, price, history, failed: false });
  } catch (err) {
    console.error(`[FUTURES PRICE FAIL] ${req.params.symbol}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// === Tradable Futures Symbols ===
router.get('/futures-symbols', async (req, res) => {
  try {
    const contractsRes = await axios.get('https://api-futures.kucoin.com/api/v1/contracts/active');
    const contracts = Array.isArray(contractsRes.data.data)
      ? contractsRes.data.data
      : Object.values(contractsRes.data.data);

    const normalizedSymbols = contracts
      .filter(c =>
        c.symbol &&
        typeof c.symbol === 'string' &&
        c.symbol.endsWith('USDTM') &&
        c.status === 'Open' &&
        /^[A-Z]+USDTM$/.test(c.symbol)
      )
      .map(c => {
        const base = c.symbol.replace(/USDTM$/, '');
        return base + '-USDTM';
      });

    res.json({ success: true, symbols: normalizedSymbols });
  } catch (err) {
    console.error("❌ /api/futures-symbols error:", err.message);
    res.status(500).json({ success: false, symbols: [] });
  }
});

module.exports = router;