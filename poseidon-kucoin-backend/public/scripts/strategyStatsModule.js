// // strategyStatsModule.js

// import { getMemory } from './updateMemoryFromResult.js';

// // Utility: Calculate average from array
// function average(arr) {
//   if (!arr.length) return 0;
//   return arr.reduce((a, b) => a + b, 0) / arr.length;
// }

// export async function updateStrategyStats() {
//   const memory = getMemory();
//   let totalTrades = 0, totalWins = 0, allRois = [];
//   let topCoin = { symbol: '--', winrate: 0 };

//   // Scan memory for stats
//   Object.keys(memory).forEach(symbol => {
//     ["LONG", "SHORT"].forEach(side => {
//       const m = memory[symbol][side];
//       totalTrades += m.trades;
//       totalWins += m.wins;
//       allRois = allRois.concat(m.roiHistory);
//       // Track top coin by winrate (min 8 trades)
//       const winrate = m.trades >= 8 ? m.wins / m.trades : 0;
//       if (winrate > topCoin.winrate) {
//         topCoin = { symbol: symbol + ' ' + side, winrate };
//       }
//     });
//   });

//   // Calculate winrate/roi
//   const winrate = totalTrades ? (totalWins / totalTrades) * 100 : 0;
//   const avgRoi = allRois.length ? average(allRois) : 0;

//   // Update DOM
//   document.getElementById("fut-total").textContent = totalTrades;
//   document.getElementById("fut-winrate").textContent = winrate.toFixed(1) + "%";
//   document.getElementById("fut-roi").textContent = avgRoi.toFixed(2) + "%";
//   document.getElementById("fut-topcoin").textContent = topCoin.symbol !== '--'
//     ? `${topCoin.symbol} (${(topCoin.winrate*100).toFixed(1)}%)`
//     : '--';
// }

// // === Call this on startup + interval ===
// export function initStrategyStats() {
//   updateStrategyStats();
//   setInterval(updateStrategyStats, 15000); // Update every 15s
// }