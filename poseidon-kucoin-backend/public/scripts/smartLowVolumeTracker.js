// import { makeTradeDecision } from './futuresDecisionEngine.js'; // ⬅️ Added for smart decision-making

// // smartLowVolumeTracker.js — Scans & tracks low-volume futures tokens

// import { fetchVolumeAndOI } from './futuresApi.js';
// import { detectFuturesSignal } from './futuresSignalModule.js';
// import { updateFuturesSummary } from './futuresStatsModule.js';

// const trackedSymbols = [
//   "ALPACAUSDT", "SCAUSDT", "FARTCOINUSDT", "ZINUUSDT", "XALPHAUSDT"
// ]; // Add/remove tokens you're interested in

// const lowVolumeThreshold = 10_000_000; // 10 million

// export async function startLowVolumeMonitoring() {
//   console.log("📉 Scanning for low-volume coins...");

//   for (const symbol of trackedSymbols) {
//     try {
//       const volInfo = await fetchVolumeAndOI(symbol);
//       const vol = parseFloat(volInfo.turnover24h);

//       if (vol < lowVolumeThreshold) {
//         console.log(`✅ ${symbol} is under 10M volume: tracking...`);

//         // Run signal detection and stats tracking
//         detectFuturesSignal(symbol);
//         updateFuturesSummary(symbol);
//       } else {
//         console.log(`⛔ ${symbol} skipped — too high volume (${vol})`);
//       }
//     } catch (err) {
//       console.warn(`⚠️ Failed to check ${symbol}:`, err);
//     }
//   }
// }

// // Auto-run every 15 seconds
// // setInterval(startLowVolumeMonitoring, 15000);
