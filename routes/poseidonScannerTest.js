// const express = require('express');
// const router = express.Router();
// const axios = require('axios');

// router.get('/test-dummy', (req, res) => {
//     res.json({ status: 'working' });
//   });

// const CONTRACTS_URL     = 'https://api-futures.kucoin.com/api/v1/contracts/active';
// const MARKET_STATS_URL  = 'https://api.kucoin.com/api/v1/market/stats?symbol=';
// const BULK_TICKERS_URL  = 'https://api-futures.kucoin.com/api/v1/market/ticker?type=all';

// const MAX_GAINERS = 10;
// const MAX_LOSERS  = 10;
// const BATCH_SIZE  = 50;
// const DELAY_MS    = 1000;

// function sleep(ms) {
//   return new Promise(res => setTimeout(res, ms));
// }

// function normalizeBaseSymbol(symbol = '') {
//   return symbol.replace(/-?USDTM$/i, '').replace(/[^A-Z]/gi, '').toUpperCase() + '-USDT';
// }

// async function fetchBulkTickersMap() {
//   try {
//     const res = await axios.get(BULK_TICKERS_URL);
//     const list = res.data?.data || [];
//     const map = {};
//     for (const entry of list) {
//       map[entry.symbol] = entry;
//     }
//     return map;
//   } catch (err) {
//     console.warn('⚠️ Bulk ticker fallback failed:', err.message);
//     return {};
//   }
// }

// router.get('/test-scan-tokens', async (req, res) => {
//   try {
//     const contractsRes = await axios.get(CONTRACTS_URL);
//     const contracts = contractsRes.data?.data || [];

//     const validContracts = contracts.filter(c =>
//       typeof c.symbol === 'string' &&
//       c.symbol.endsWith('USDTM') &&
//       c.status === 'Open'
//     );

//     console.log(`📦 [TEST] Valid contracts to scan: ${validContracts.length}`);
//     const batches = [];
//     for (let i = 0; i < validContracts.length; i += BATCH_SIZE) {
//       batches.push(validContracts.slice(i, i + BATCH_SIZE));
//     }

//     const enriched = [];

//     for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
//       const batch = batches[batchIndex];
//       console.log(`🚀 [TEST] Processing batch ${batchIndex + 1}/${batches.length}`);

//       for (const contract of batch) {
//         const baseSymbol = normalizeBaseSymbol(contract.symbol);
//         try {
//           const statsRes = await axios.get(MARKET_STATS_URL + encodeURIComponent(baseSymbol));
//           const data = statsRes.data?.data;
//           if (!data) continue;

//           const price        = parseFloat(data.last || 0);
//           const changeRate   = parseFloat(data.changeRate || 0);
//           const quoteVolume  = parseFloat(data.volValue || 0);

//           if (!price || isNaN(price) || isNaN(changeRate) || isNaN(quoteVolume)) continue;

//           enriched.push({
//             symbol: contract.symbol,
//             price,
//             quoteVolume,
//             change: +(changeRate * 100).toFixed(2)
//           });
//         } catch (err) {
//           console.warn(`⚠️ [TEST] Failed spot stats: ${baseSymbol} — ${err.message}`);
//         }
//       }

//       if (batchIndex < batches.length - 1) {
//         console.log(`⏳ [TEST] Waiting ${DELAY_MS / 1000}s before next batch...`);
//         await sleep(DELAY_MS);
//       }
//     }

//     const gainers = enriched
//       .filter(t => t.change > 0 && t.quoteVolume < 20_000_000)
//       .sort((a, b) => b.change - a.change)
//       .slice(0, MAX_GAINERS);

//     const losers = enriched
//       .filter(t => t.change < 0 && t.quoteVolume > 100_000)
//       .sort((a, b) => a.change - b.change)
//       .slice(0, MAX_LOSERS);

//     console.log(`✅ [TEST] Gainers: ${gainers.length}, Losers: ${losers.length}`);
//     res.json({ success: true, count: gainers.length + losers.length, gainers, losers });

//   } catch (err) {
//     console.error('❌ [TEST] /api/test-scan-tokens error:', err.message);
//     res.status(500).json({ success: false, error: err.message });
//   }
// });

// module.exports = router;