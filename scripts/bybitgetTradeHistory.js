// // getTradeHistory.js — Fetch recent closed trades (real PNL)

// import { bybitSignedRequest } from './bybit.js';

// /**
//  * Fetch recent filled trades to get PNL data
//  * @returns {Promise<object>} Trade history
//  */
// export async function getTradeHistory() {
//   const params = {
//     category: 'linear',
//     limit: 20
//   };

//   const response = await bybitSignedRequest('/v5/execution/list', 'GET', params);

//   if (response?.retCode === 0) {
//     return { success: true, trades: response.result.list };
//   } else {
//     return { success: false, error: response.retMsg || 'Trade history fetch failed' };
//   }
// }