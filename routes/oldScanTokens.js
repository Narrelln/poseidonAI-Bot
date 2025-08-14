const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getTA } = require('../handlers/taHandler');
const WHITELIST = require('../config/tokenWhitelist.json'); // Fixed 24 tokens

let kucoinContractsCache = [];
let cachedScannerData = { top50: [], moonshots: [], lastUpdated: 0 };

async function fetchKucoinContracts() {
  try {
    const res = await axios.get('https://api-futures.kucoin.com/api/v1/contracts/active');
    const contracts = res.data.data || [];
    kucoinContractsCache = contracts.map(c => c.symbol.replace(/-?USDT[M]?$/, '').toUpperCase());
  } catch (err) {
    console.error('❌ Failed to fetch KuCoin contracts:', err.message);
  }
}

async function fetchBybitTickers() {
  const res = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear');
  return res.data.result.list;
}

function normalizeSymbol(symbol) {
  return symbol.replace(/-?USDT[M]?$/, '').toUpperCase();
}

function isFakeToken(symbol) {
  return /TEST|ALTCOIN|ZEUS|TROLL|MIXIE|DADDY|WEN|PORT|DOOD|NOBODY|GOR/i.test(symbol);
}

async function enrichWithTA(tokens) {
  const enriched = [];
  for (const t of tokens) {
    try {
      const ta = await getTA(t.symbol);
      enriched.push({ ...t, signal: ta.signal || 'neutral', confidence: ta.confidence || 0 });
    } catch {
      enriched.push({ ...t, signal: 'neutral', confidence: 0 });
    }
  }
  return enriched;
}

async function refreshScannerCache() {
  try {
    if (kucoinContractsCache.length === 0) await fetchKucoinContracts();

    const bybitData = await fetchBybitTickers();
    const tokens = bybitData
      .filter(t => t.symbol.endsWith('USDT'))
      .map(t => {
        const quoteVolume = parseFloat(t.turnover24h || 0);
        return {
          symbol: t.symbol,
          price: parseFloat(t.lastPrice || 0),
          quoteVolume,
          priceChgPct: parseFloat(t.price24hPcnt || 0) * 100,
          source: 'Bybit'
        };
      })
      .filter(t => kucoinContractsCache.includes(normalizeSymbol(t.symbol)))
      .filter(t => !isFakeToken(t.symbol));

    const whitelistTokens = tokens.filter(t =>
      WHITELIST.includes(normalizeSymbol(t.symbol))
    );

    const gainers = tokens
      .filter(t => t.quoteVolume >= 500_000 && t.quoteVolume <= 20_000_000)
      .filter(t => !WHITELIST.includes(normalizeSymbol(t.symbol)))
      .sort((a, b) => b.priceChgPct - a.priceChgPct)
      .slice(0, 13);

    const losers = tokens
      .filter(t => t.quoteVolume >= 500_000 && t.quoteVolume <= 20_000_000)
      .filter(t => !WHITELIST.includes(normalizeSymbol(t.symbol)))
      .sort((a, b) => a.priceChgPct - b.priceChgPct)
      .slice(0, 13);

    const moonshots = tokens
      .filter(t => t.quoteVolume < 500_000 && Math.abs(t.priceChgPct) > 10)
      .sort((a, b) => Math.abs(b.priceChgPct) - Math.abs(a.priceChgPct))
      .slice(0, 5);

    const [whitelistEnriched, gainersEnriched, losersEnriched, moonshotEnriched] =
      await Promise.all([
        enrichWithTA(whitelistTokens),
        enrichWithTA(gainers),
        enrichWithTA(losers),
        enrichWithTA(moonshots)
      ]);

    cachedScannerData = {
      top50: [...whitelistEnriched, ...gainersEnriched, ...losersEnriched].slice(0, 50),
      moonshots: moonshotEnriched,
      lastUpdated: Date.now()
    };

    console.log(`[Scanner] ✅ Refreshed: ${cachedScannerData.top50.length} Top50, ${cachedScannerData.moonshots.length} moonshots`);
  } catch (err) {
    console.error('❌ Scanner refresh error:', err.message);
  }
}

setInterval(refreshScannerCache, 60_000);
refreshScannerCache();

router.get('/scan-tokens', (req, res) => {
  res.json({ success: true, ...cachedScannerData });
});

function getCachedScannerData() {
  return cachedScannerData;
}

function getActiveSymbols() {
  return cachedScannerData.top50.map(t => t.symbol);
}

module.exports = {
  router,
  getCachedScannerData,
  getActiveSymbols
};
