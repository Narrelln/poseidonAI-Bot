const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getTA } = require('../handlers/taHandler');
const WHITELIST = require('../config/tokenWhitelist.json'); // 24 tokens
const WHITELIST_ARRAY = [...WHITELIST.top, ...WHITELIST.memes]; // Flattened

let kucoinContractsCache = [];
let cachedScannerData = { top50: [], moonshots: [], lastUpdated: 0 };

// === Fetch active KuCoin futures ===
async function fetchKucoinContracts() {
  try {
    const res = await axios.get('https://api-futures.kucoin.com/api/v1/contracts/active');
    const contracts = res.data.data || [];
    kucoinContractsCache = contracts.map(c => c.symbol.replace(/-?USDT[M]?$/, '').toUpperCase());
  } catch (err) {
    console.error('❌ Failed to fetch KuCoin contracts:', err.message);
  }
}

// === Fetch Bybit tickers ===
async function fetchBybitTickers() {
  const res = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear');
  return res.data.result.list || [];
}

// === Utility ===
function normalizeSymbol(symbol) {
  return symbol.replace(/-?USDT[M]?$/, '').toUpperCase();
}

function isFakeToken(symbol) {
  return /TEST|ALTCOIN|ZEUS|TROLL|MIXIE|DADDY|WEN|PORT|DOOD|NOBODY|GOR/i.test(symbol);
}

function attachPriceFromRaw(symbol, rawList) {
  const raw = rawList.find(t => t.symbol?.toUpperCase() === symbol.toUpperCase());
  if (!raw) return { price: 0, quoteVolume: 0, priceChgPct: 0 };

  const price = parseFloat(raw.lastPrice || 0);
  const quoteVolume = parseFloat(raw.turnover24h || 0);
  const priceChgPct = parseFloat(raw.price24hPcnt || 0) * 100;

  if (price === 0 || quoteVolume === 0) {
    console.warn(`[Scanner] Zero price/volume for ${symbol} — raw:`, raw);
  }

  return { price, quoteVolume, priceChgPct };
}

// === TA Enrichment ===
async function enrichWithTA(tokens) {
  const enriched = [];
  for (const t of tokens) {
    try {
      const ta = await getTA(t.symbol);
      if (ta?.success) {
        enriched.push({ ...t, signal: ta.signal, confidence: ta.confidence });
      } else {
        enriched.push({ ...t, signal: 'neutral', confidence: 0 });
      }
    } catch {
      enriched.push({ ...t, signal: 'neutral', confidence: 0 });
    }
  }
  return enriched;
}
function isValidTokenSymbol(symbol = '') {
  const base = symbol.replace(/-?USDT[M]?$/, '').toUpperCase();
  if (!base || base.length < 2) return false;
  return !/^(USDT|M|BTCBTC|TEST|FAKE)$/i.test(base);
}
// === Scanner Refresh ===
async function refreshScannerCache() {
  try {
    if (kucoinContractsCache.length === 0) await fetchKucoinContracts();

    const bybitRaw = await fetchBybitTickers();

    const tokens = bybitRaw
      .filter(t => t.symbol.endsWith('USDT'))
      .filter(t => isValidTokenSymbol(t.symbol))  // 🧼 Skip invalid base tokens
      .map(t => {
        const { price, quoteVolume, priceChgPct } = attachPriceFromRaw(t.symbol, bybitRaw);
        return {
          symbol: t.symbol,
          price,
          quoteVolume,
          priceChgPct,
          source: 'Bybit'
        };
      })
      .filter(t => kucoinContractsCache.includes(normalizeSymbol(t.symbol)))
      .filter(t => !isFakeToken(t.symbol));

    // === Token groups ===
    const whitelistTokens = tokens.filter(t =>
      WHITELIST_ARRAY.includes(normalizeSymbol(t.symbol))
    );

    const gainers = tokens
    .filter(t => !WHITELIST_ARRAY.includes(normalizeSymbol(t.symbol)))
    .filter(t => t.quoteVolume >= 500_000 && t.quoteVolume <= 20_000_000)
    .sort((a, b) => b.priceChgPct - a.priceChgPct)
    .slice(0, 13);

  const losers = tokens
    .filter(t => !WHITELIST_ARRAY.includes(normalizeSymbol(t.symbol)))
    .filter(t => t.quoteVolume >= 500_000 && t.quoteVolume <= 20_000_000)
    .sort((a, b) => a.priceChgPct - b.priceChgPct)
    .slice(0, 13);

    const moonshots = tokens
      .filter(t => t.quoteVolume < 500_000 && Math.abs(t.priceChgPct) > 10)
      .sort((a, b) => Math.abs(b.priceChgPct) - Math.abs(a.priceChgPct))
      .slice(0, 5);

// ✅ Normalize symbols before enrichment to avoid downstream mismatches
const normalizeAllSymbols = list => list.map(t => {
  const base = normalizeSymbol(t.symbol);
  return { ...t, symbol: `${base}-USDTM` };
});
const [
  whitelistEnriched,
  gainersEnriched,
  losersEnriched,
  moonshotEnriched
] = await Promise.all([
  enrichWithTA(normalizeAllSymbols(whitelistTokens)),
  enrichWithTA(normalizeAllSymbols(gainers)),
  enrichWithTA(normalizeAllSymbols(losers)),
  enrichWithTA(normalizeAllSymbols(moonshots))
]);

    // ✅ PATCH: Add moonshots into top50 if needed
    const combined = [...whitelistEnriched, ...gainersEnriched, ...losersEnriched];
    const combinedTop50 = [...combined];

    if (combinedTop50.length < 50 && moonshotEnriched.length) {
      const remaining = 50 - combinedTop50.length;
      combinedTop50.push(...moonshotEnriched.slice(0, remaining));
    }

    cachedScannerData = {
      top50: combinedTop50.slice(0, 50),
      moonshots: moonshotEnriched,
      lastUpdated: Date.now()
    };

    console.log(`[Scanner] ✅ Refreshed: ${cachedScannerData.top50.length} Top50, ${cachedScannerData.moonshots.length} moonshots`);
  } catch (err) {
    console.error('❌ Scanner refresh error:', err.message);
  }
}

// Auto-refresh
setInterval(refreshScannerCache, 60_000);
refreshScannerCache();

// === Routes ===
router.get('/scan-tokens', (req, res) => {
  res.json({ success: true, ...cachedScannerData });
});

// === Exports ===
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