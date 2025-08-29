// // getOpenPositions.js — Fetch real open futures positions from Bybit

// import { bybitSignedRequest } from './bybit.js';

// /**
//  * Fetches all open futures positions.
//  * @returns {Promise<object>} List of positions or error
//  */
// export async function getOpenPositions(symbol = 'DOGEUSDT') {
//   try {
//     const response = await fetch(`http://localhost:3000/api/positions?symbol=${symbol}`);
//     const data = await response.json();

//     const list = Array.isArray(data) ? data : [];

//     const filtered = list.filter(pos =>
//       pos && parseFloat(pos.size) > 0 && pos.side && pos.side !== 'None'
//     );

//     return filtered;
//   } catch (err) {
//     console.error(`❌ Error fetching open position for ${symbol}:`, err.message);
//     return [];
//   }
// }