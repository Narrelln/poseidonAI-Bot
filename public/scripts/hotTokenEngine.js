// // === /public/scripts/hotTokenEngine.js ===

// import { toKuCoinContractSymbol, fetchFuturesPrice } from '/scripts/futuresApiClient.js';
// import { calculateConfidence, fetchTA } from '/scripts/taFrontend.js';
// import { evaluatePoseidonDecision } from '/scripts/decisionHelper.js';  // ✅ Patched here
// import { isBotActive } from '/scripts/poseidonBotModule.js';
// import { logToLiveFeed } from '/scripts/liveFeedRenderer.js';

// const HOT_CONFIDENCE_THRESHOLD = 50;
// const HOT_PRICE_CHANGE_THRESHOLD = 0.5;
// const HOT_VOLUME_CAP = 20_000_000;
// const MAX_CONCURRENT_TRADES = 10;
// const COOLDOWN_MS = 10 * 60 * 1000;

// const lastHotTriggerTimestamps = new Map();
// const hotFeed = [];

// async function canTrigger(symbol, open = []) {
//   if (open.length >= MAX_CONCURRENT_TRADES) return false;

//   const cooldown = lastHotTriggerTimestamps.get(symbol);
//   if (cooldown && Date.now() - cooldown < COOLDOWN_MS) return false;

//   const alreadyOpen = open.some(pos =>
//     toKuCoinContractSymbol(pos.symbol) === toKuCoinContractSymbol(symbol)
//   );
//   return !alreadyOpen;
// }

// function recordHotToken(symbol, confidence, priceChange, volume) {
//   hotFeed.unshift({
//     symbol,
//     confidence,
//     priceChange: Number(priceChange.toFixed(2)),
//     volume: Number((volume / 1e6).toFixed(2)),
//     timestamp: Date.now()
//   });

//   if (hotFeed.length > 50) hotFeed.pop();
// }

// async function detectHotTokens() {
//   if (!isBotActive()) return;

//   const symbols = getActiveSymbols();
//   if (!symbols || symbols.length === 0) return;

//   for (const symbol of symbols) {
//     try {
//       const { price, quoteVolume, priceChange15m } = await fetchFuturesPrice(symbol);
//       if (!price || !quoteVolume || !priceChange15m) continue;
//       if (quoteVolume > HOT_VOLUME_CAP || Math.abs(priceChange15m) < HOT_PRICE_CHANGE_THRESHOLD) continue;

//       const ta = await fetchTA(symbol);
//       if (!ta) continue;

//       const macdSignal = ta.macd?.signal === 'bullish' ? 'Buy' : 'Sell';
//       const bbSignal = ta.bb?.breakout ? 'Breakout' : 'None';
//       const volumeSpike = !!ta.volumeSpike;

//       const confidence = parseFloat(calculateConfidence(macdSignal, bbSignal, volumeSpike));
//       if (confidence < HOT_CONFIDENCE_THRESHOLD) continue;

//       const canProceed = await canTrigger(symbol);
//       if (!canProceed) continue;

//       const analysis = {
//         macdSignal,
//         bbSignal,
//         volumeSpike,
//         confidence,
//         bigDrop: false,
//         bigPump: false,
//         manual: false,
//         allocationPct: confidence >= 85 ? 25 : 10
//       };

//       lastHotTriggerTimestamps.set(symbol, Date.now());
//       recordHotToken(symbol, confidence, priceChange15m, quoteVolume);

//       logToLiveFeed({
//         symbol,
//         message: `🔥 HOT TOKEN | Confidence: ${confidence}% | Δ15m: ${priceChange15m.toFixed(2)}% | Vol: $${(quoteVolume / 1e6).toFixed(2)}M`,
//         type: 'hot-token'
//       });

//       await evaluatePoseidonDecision(symbol, analysis);
//     } catch (err) {
//       console.warn(`⚠️ Hot token check failed for ${symbol}:`, err.message);
//     }
//   }
// }


// let hotTokenInterval = null;

// export function startHotTokenEngine() {
//   if (hotTokenInterval) return;
//   hotTokenInterval = setInterval(detectHotTokens, 30_000);
//   detectHotTokens();
// }

// export function getHotTokenFeed() {
//   return hotFeed;
// }