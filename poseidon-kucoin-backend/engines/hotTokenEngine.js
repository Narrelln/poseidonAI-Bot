// const { getActiveSymbols } = require('../routes/scanTokens');
// const { toKuCoinContractSymbol } = require('../handlers/futuresApi');
// const { evaluatePoseidonDecision } = require('../handlers/evaluatePoseidonDecision');
// const { isBotActive } = require('../utils/botStatus');
// const { recordHotToken, getHotTokenFeed } = require('../handlers/hotTokenFeed');
// const { calculateConfidence, fetchTA } = require('../handlers/taClient');

// const HOT_CONFIDENCE_THRESHOLD = 10;
// const HOT_PRICE_CHANGE_THRESHOLD = 0.2;
// const HOT_VOLUME_CAP = 50_000_000;
// const MAX_CONCURRENT_TRADES = 10;
// const COOLDOWN_MS = 10 * 60 * 1000;

// const lastHotTriggerTimestamps = new Map();

// async function canTrigger(symbol, open = []) {
//   if (open.length >= MAX_CONCURRENT_TRADES) return false;

//   const cooldown = lastHotTriggerTimestamps.get(symbol);
//   if (cooldown && Date.now() - cooldown < COOLDOWN_MS) return false;

//   const alreadyOpen = open.some(pos =>
//     toKuCoinContractSymbol(pos.symbol) === toKuCoinContractSymbol(symbol)
//   );
//   return !alreadyOpen;
// }

// async function detectHotTokens() {
//   const botOn = isBotActive();
//   console.log(`🧠 [HotTokenEngine] Bot active? ${botOn}`);
//   if (!botOn) return;

//   const symbols = getActiveSymbols();
//   console.log(`📡 Active Symbols: ${symbols?.length || 0}`);
//   if (!symbols || symbols.length === 0) return;

//   // 🧪 TEST MODE: Inject fake token to verify visibility
//   if (!global.__hotTestInjected) {
//     console.log(`🧪 Injecting TESTUSDT into hot feed`);
//     recordHotToken('TESTUSDT', 99, 8.88, 13_500_000);
//     global.__hotTestInjected = true;
//   }

//   for (const entry of symbols) {
//     const symbol = entry?.symbol;
//     if (!symbol || !entry.price || !entry.volume || entry.volume > HOT_VOLUME_CAP) continue;

//     const price = entry.price;
//     const volume = entry.volume;
//     const priceChange15m = entry.priceChange15m || 0;

//     try {
//       console.log(`[SCAN] ${symbol} | Δ: ${priceChange15m}% | Vol: ${volume}`);

//       if (Math.abs(priceChange15m) < HOT_PRICE_CHANGE_THRESHOLD) continue;

//       // 🧠 Optional: Skip TA if you're debugging only volume-based hot token logic
//       const ta = await fetchTA(symbol);
//       if (!ta) {
//         console.log(`❌ No TA for ${symbol}`);
//         continue;
//       }

//       const macdSignal = ta.macd?.signal === 'bullish' ? 'Buy' : 'Sell';
//       const bbSignal = ta.bb?.breakout ? 'Breakout' : 'None';
//       const volumeSpike = !!ta.volumeSpike;

//       const confidence = parseFloat(calculateConfidence(macdSignal, bbSignal, volumeSpike));
//       console.log(`📊 ${symbol} → confidence ${confidence}`);

//       if (confidence < HOT_CONFIDENCE_THRESHOLD) continue;

//       const canProceed = await canTrigger(symbol);
//       if (!canProceed) continue;

//       const analysis = {
//         macdSignal, bbSignal, volumeSpike, confidence,
//         bigDrop: false, bigPump: false, manual: false,
//         allocationPct: confidence >= 85 ? 25 : 10
//       };

//       lastHotTriggerTimestamps.set(symbol, Date.now());

//       console.log(`🔥 HOT TOKEN: ${symbol} | Δ: ${priceChange15m}% | Vol: $${volume} | Confidence: ${confidence}`);
//       recordHotToken(symbol, confidence, priceChange15m, volume);
//       await evaluatePoseidonDecision(symbol, analysis);
//     } catch (err) {
//       console.warn(`❌ Error on ${symbol}: ${err.message}`);
//     }
//   }
// }

// let hotTokenInterval = null;

// function startHotTokenEngine() {
//   if (hotTokenInterval) return;
//   console.log("🚀 [HotTokenEngine] Starting...");
//   hotTokenInterval = setInterval(detectHotTokens, 30_000);
//   detectHotTokens();
// }

// module.exports = {
//   startHotTokenEngine,
//   getHotTokenFeed
// };