// import crypto from 'crypto';
// import dotenv from 'dotenv';
// dotenv.config();

// const API_KEY = process.env.BYBIT_API_KEY;
// const API_SECRET = process.env.BYBIT_API_SECRET;

// /**
//  * Create HMAC-SHA256 signature
//  */
// function createSignature(secret, payload) {
//   return crypto.createHmac('sha256', secret).update(payload).digest('hex');
// }

// /**
//  * Stable JSON stringify — ensures key order consistency
//  */
// function stableJSONStringify(obj) {
//   const ordered = {};
//   Object.keys(obj).sort().forEach(key => {
//     ordered[key] = obj[key];
//   });
//   return JSON.stringify(ordered);
// }

// /**
//  * Signed headers for Bybit V5 GET & POST
//  * @param {Object} params
//  * @param {string} method
//  * @param {string} externalTimestamp
//  * @returns {Object} headers
//  */
// export function signedHeaders(params = {}, method = 'GET', externalTimestamp = null) {
//   const timestamp = externalTimestamp || Date.now().toString();
//   const recvWindow = '10000';

//   let rawPayload;
//   if (method === 'POST') {
//     rawPayload = timestamp + API_KEY + recvWindow + stableJSONStringify(params);
//   } else {
//     const queryString = new URLSearchParams(params).toString();
//     rawPayload = timestamp + API_KEY + recvWindow + queryString;
//   }

//   const signature = createSignature(API_SECRET, rawPayload);

//   return {
//     'X-BAPI-API-KEY': API_KEY,
//     'X-BAPI-SIGN': signature,
//     'X-BAPI-TIMESTAMP': timestamp,
//     'X-BAPI-RECV-WINDOW': recvWindow,
//     'Content-Type': 'application/json'
//   };
// }

// export { createSignature };