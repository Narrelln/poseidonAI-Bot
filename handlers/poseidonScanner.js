// === handlers/poseidonScanner.js ===

const { setActiveSymbols } = require('../handlers/sessionStatsModule.js');
const { initFuturesPositionTracker } = require('../handlers/futuresPositionTracker.js');
const { getCachedScannerData } = require('../routes/newScanTokens');
const { toKuCoinContractSymbol } = require('../handlers/futuresApi.js');
const { initFuturesDecisionEngine } = require('./futuresDecisionEngine');
const { analyzeAndTrigger } = require('./analyzeAndTrigger');
const { logSignalToFeed } = require('./liveFeedRenderer');

let activeSymbols = [];
let scannerStarted = false;
let DEBUG_MODE = false;
const lastAnalysisCache = {}; // symbol -> { price, volume, ts }

function toggleScannerDebug() {
  DEBUG_MODE = !DEBUG_MODE;
  console.log(`🛠️ DEBUG_MODE is now ${DEBUG_MODE ? 'ON' : 'OFF'}`);
}
global.toggleScannerDebug = toggleScannerDebug;

async function refreshSymbols() {
  try {
    const response = await getCachedScannerData(true);
    if (!response || response.success === false) return;

    const combined = response.top50 || [];
    const seen = new Set();

    const enrichedSymbols = combined.filter(item => {
      const symbol = item.symbol?.toUpperCase();
      const price = parseFloat(item.price);
      const volume = parseFloat(item.quoteVolume);
      const change = parseFloat(item.priceChgPct);

      const isFake = /ALTCOIN|TEST|TROLL/i.test(symbol || '');
      const isDuplicate = seen.has(symbol);
      const isMissingSymbol = !symbol;

      if (isMissingSymbol || isDuplicate || isFake) return false;

      seen.add(symbol);
      item.symbol = symbol;
      item.price = isNaN(price) ? 0 : price;
      item.quoteVolume = isNaN(volume) ? 0 : volume;
      item.change = isNaN(change) ? 0 : +change.toFixed(2);
      return true;
    });

    activeSymbols = enrichedSymbols.map(e => ({
      symbol: toKuCoinContractSymbol(e.symbol),
      price: e.price,
      volume: e.quoteVolume || e.volume || 0,
      confidence: e.confidence || 0,
    }));

    setActiveSymbols(activeSymbols);
    activeSymbols.forEach(initFuturesPositionTracker);

    for (const token of enrichedSymbols) {
      const now = Date.now();
      const last = lastAnalysisCache[token.symbol];
      const price = token.price;
      const volume = token.quoteVolume;

      // 🚨 Validate before processing
      const { getPattern } = require('./data/tokenPatternMemory.js'); // place at top

      // ...
      
      const profile = getPattern(token.symbol) || {};
      const isWhitelisted = profile?.whitelisted || false;
      
      if (
        !token.symbol ||
        typeof token.symbol !== 'string' ||
        isNaN(price) || price <= 0 ||
        isNaN(volume) || volume <= 0 ||
        (volume > 20_000_000 && !isWhitelisted)
      ) {
        console.warn(`⚠️ Invalid scanner data for ${token.symbol} — Price: ${price}, Volume: ${volume}, Whitelisted: ${isWhitelisted}`);
        continue;
      }

      // Skip if minimal change
      if (last && now - last.ts < 15_000) {
        const priceChange = Math.abs(price - last.price) / last.price;
        const volChange = Math.abs(volume - last.volume) / last.volume;
        if (priceChange < 0.01 && volChange < 0.01) continue;
      }

      try {
        const result = await analyzeAndTrigger(token.symbol, {
          price,
          volume,
          change: token.change
        });

        lastAnalysisCache[token.symbol] = { price, volume, ts: now };

        if (!result || result.signal === 'neutral') continue;

        const confidence = result.confidence || 0;
        const alreadyOpen = result.openPosition === true;

        if (confidence >= 70 && !alreadyOpen) {
          const allocation = confidence >= 85 ? 0.25 : 0.10;
          result.allocation = allocation;
          logSignalToFeed(result);
        }
      } catch (err) {
        if (DEBUG_MODE) console.warn(`⚠️ Analysis failed for ${token.symbol}: `, err.message);
      }
    }
  } catch (err) {
    if (DEBUG_MODE) console.warn('⚠️ refreshSymbols error:', err.message);
  }
}

function getActiveSymbols() {
  return activeSymbols;
}

function startScanner() {
  if (scannerStarted) return;
  scannerStarted = true;

  initFuturesDecisionEngine();

  // const { startHotTokenEngine } = require('../engines/hotTokenEngine.js');
  // startHotTokenEngine();

  // setInterval(refreshSymbols, 15 * 60 * 1000); // Every 15 minutes
  // refreshSymbols();
}

module.exports = {
  refreshSymbols,
  getActiveSymbols,
  startScanner
};