// test-scanner-log.js
const axios = require('axios');

function shouldTriggerTrade(signal, confidence) {
  return ['bullish', 'bearish'].includes(signal) && confidence >= 70;
}

async function fetchScannerData() {
  try {
    const res = await axios.get('http://localhost:3000/api/scan-tokens');
    return res.data;
  } catch (err) {
    console.error('Failed to fetch scanner data:', err.message);
    return { gainers: [], losers: [] };
  }
}

function logPotentialTrades(list, type) {
  console.log(`\n=== ${type.toUpperCase()} ===`);
  list.forEach(t => {
    const { symbol, price, priceChgPct, quoteVolume, signal, confidence } = t;
    const tag = shouldTriggerTrade(signal, confidence) ? '[ALERT]' : '        ';
    console.log(`${tag} ${symbol.padEnd(10)} | ${signal.padEnd(8)} | Conf: ${String(confidence).padStart(3)}% | Price: ${price.toFixed(5)} | Chg: ${priceChgPct.toFixed(2)}% | Vol: ${quoteVolume.toLocaleString()}`);
  });
}

async function run() {
  const { gainers, losers } = await fetchScannerData();
  logPotentialTrades(gainers, 'Gainers');
  logPotentialTrades(losers, 'Losers');
}

run();