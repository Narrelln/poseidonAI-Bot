// /* === futures.js – Poseidon Futures Runtime (Debug Version) === */

// import { initFuturesAPI } from './futuresApi.js';
// import { initFuturesStats } from './futuresStatsModule.js';
// import { analyzeAndTrigger } from './futuresSignalModule.js';
// import { initFuturesExecutionModule } from './futuresExecutionModule.js';
// import { initFuturesPositionTracker } from './futuresPositionTracker.js';
// import { initFuturesDecisionEngine } from './futuresDecisionEngine.js';
// import { updatePerformance } from './futuresPerformancePanel.js';
// import { logToFeed } from './futuresUtils.js';
// import { initBot } from './poseidonBotModule.js';
// import { initSessionStats } from './sessionStatsModule.js';

// export function setFuturesConnectionStatus(connected = true) {
//   const el = document.getElementById("futures-connection");
//   if (!el) return;
//   el.textContent = connected ? "Connected" : "Disconnected";
//   el.classList.toggle("connected", connected);
// }

// async function refreshWalletBalance() {
//   try {
//     const res = await fetch('http://localhost:3000/api/wallet-balance');
//     const data = await res.json();
//     const total = parseFloat(data.balance ?? data.totalBalance ?? 0);
//     const available = parseFloat(data.available ?? data.availableBalance ?? 0);
//     const totalEl = document.getElementById("wallet-total");
//     const availableEl = document.getElementById("wallet-available");
//     if (totalEl) totalEl.textContent = (isNaN(total) ? 0 : total).toFixed(2);
//     if (availableEl) availableEl.textContent = (isNaN(available) ? 0 : available).toFixed(2);
//   } catch (err) {
//     console.warn("⚠️ Wallet balance fetch failed:", err.message);
//   }
// }

// async function initFuturesPage() {
//   console.log("📈 Poseidon Futures Activated");

//   initFuturesAPI();
//   initFuturesStats();
//   initFuturesExecutionModule();
//   initFuturesDecisionEngine([]);
//   initBot();
//   initSessionStats();

//   refreshWalletBalance();
//   setInterval(refreshWalletBalance, 10000);

//   const longBtn = document.getElementById('manual-long');
//   const shortBtn = document.getElementById('manual-short');
//   if (longBtn && shortBtn) {
//     longBtn.addEventListener('click', () => {
//       longBtn.classList.add("active");
//       shortBtn.classList.remove("active");
//     });
//     shortBtn.addEventListener('click', () => {
//       shortBtn.classList.add("active");
//       longBtn.classList.remove("active");
//     });
//   }

//   const openBtn = document.getElementById('open-trade');
//   if (openBtn) {
//     openBtn.addEventListener('click', async () => {
//       // 🔥 DEBUG LOG
//       console.log("🟢 [DEBUG] Open Trade BUTTON CLICKED");

//       // Support both "manual-symbol" and "symbol-selector" as input IDs
//       const symbolInput =
//         document.getElementById('manual-symbol') ||
//         document.getElementById('symbol-selector');
//       const symbol = symbolInput?.value?.trim().toUpperCase();

//       // Logging for diagnosis
//       console.log("[Open Trade] Clicked! Input symbol:", symbol);

//       if (!symbol) {
//         logToFeed(`❌ No symbol selected (input missing)`);
//         alert('Please enter a symbol to trade!');
//         return;
//       }

//       const tp = parseFloat(document.getElementById('manual-tp')?.value || 35);
//       const sl = parseFloat(document.getElementById('manual-sl')?.value || 20);
//       const qty = '1';
//       const leverage = 10;

//       // Support both class "active" for direction
//       const longBtn = document.getElementById('manual-long');
//       const shortBtn = document.getElementById('manual-short');
//       let side = "Buy"; // default
//       if (longBtn && shortBtn) {
//         if (longBtn.classList.contains('active')) side = "Buy";
//         if (shortBtn.classList.contains('active')) side = "Sell";
//       }

//       logToFeed(`🟢 Sending ${side} order for ${symbol} — TP: ${tp}%, SL: ${sl}%, Leverage: ${leverage}x`);
//       console.log("[Open Trade] Sending fetch POST to /api/order with:", { symbol, side, qty, leverage });

//       try {
//         const res = await fetch('http://localhost:3000/api/order', {
//           method: 'POST',
//           headers: { 'Content-Type': 'application/json' },
//           body: JSON.stringify({ symbol, side, qty, leverage, orderType: 'Market' }),
//         });

//         const data = await res.json();
//         console.log("[Open Trade] Received response:", data);

//         if (data?.message?.includes('Order Placed')) {
//           logToFeed(`✅ Trade executed: ${side} ${symbol}`);
//           updatePerformance({ symbol, direction: side, confidence: 100, result: 'manual' });
//         } else {
//           logToFeed(`❌ Error: ${data?.error || data?.retMsg || 'Unknown failure'}`);
//         }
//       } catch (err) {
//         console.error("[Open Trade] Error sending trade:", err);
//         logToFeed(`❌ Failed to send trade: ${err.message}`);
//       }
//     });
//   }

//   // FSM handles scanning loop independently
// }

// document.addEventListener("DOMContentLoaded", initFuturesPage);