// // === futuresStatsModule.js — Real-time Futures Summary (KuCoin Live) ===

// import { getOpenPositions } from './futuresApiClient';
// // Optionally: import { getTradeHistory } if needed for last trade

// export async function updateFuturesSummary() {
//   try {
//     // Get all open positions from backend
//     const positions = await getOpenPositions();

//     // Get DOM elements
//     const livePnlEl = document.getElementById('futures-live-pnl');
//     const lastTradeEl = document.getElementById('futures-last-trade');
//     const connEl = document.getElementById('futures-connection');

//     // Set Connection Status
//     if (connEl) connEl.textContent = positions.length ? "Connected" : "Disconnected";

//     // Show first open position PnL as "Live PnL"
//     if (livePnlEl) {
//       if (positions.length > 0) {
//         const pos = positions[0];
//         const pnl = pos && pos.pnlValue !== undefined ? Number(pos.pnlValue).toFixed(2) : '0.00';
//         livePnlEl.textContent = `${pnl}`;
//         livePnlEl.className = Number(pnl) >= 0 ? 'positive' : 'negative';
//       } else {
//         livePnlEl.textContent = `0.00`;
//         livePnlEl.className = '';
//       }
//     }

//     // Show "Last Trade" (last opened/closed position or symbol)
//     if (lastTradeEl) {
//       if (positions.length > 0) {
//         // Show symbol and side of first open position
//         const pos = positions[0];
//         lastTradeEl.textContent = `${pos.symbol || 'N/A'} (${(pos.side || '').toUpperCase()})`;
//       } else {
//         // No open positions: Optionally show the last closed trade (if you have backend for that)
//         lastTradeEl.textContent = 'No active trade';
//       }
//     }

//   } catch (err) {
//     console.warn("❌ Futures Summary Error:", err);
//     const connEl = document.getElementById('futures-connection');
//     const livePnlEl = document.getElementById('futures-live-pnl');
//     const lastTradeEl = document.getElementById('futures-last-trade');
//     if (connEl) connEl.textContent = "Disconnected";
//     if (livePnlEl) livePnlEl.textContent = "--";
//     if (lastTradeEl) lastTradeEl.textContent = "--";
//   }
// }

// // === Initialization (run once to activate summary panel) ===
// export function initFuturesStats() {
//   console.log("📊 Futures Stats Module initialized.");
//   updateFuturesSummary();
//   setInterval(updateFuturesSummary, 10000); // auto-refresh every 10s
// }