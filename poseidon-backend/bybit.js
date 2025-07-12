// import dotenv from 'dotenv';
// dotenv.config();

// import { signedHeaders } from './signRequest.js';

// const BASE_URL = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
// const RECV_WINDOW = '5000';  // Keep recvWindow consistent as string

// // ===== Helper: Safe JSON Parse =====
// async function safeParseJSON(res) {
//   try {
//     return await res.json();
//   } catch (e) {
//     const text = await res.text().catch(() => "");
//     console.warn('⚠️ Could not parse JSON. Raw:', text);
//     return null;
//   }
// }

// // ===== Get Bybit server time (milliseconds) =====
// async function getBybitServerTime() {
//   try {
//     const res = await fetch(`${BASE_URL}/v5/market/time`);
//     const json = await safeParseJSON(res);
//     console.log('📆 Bybit Time Response:', json);

//     if (json && json.result && typeof json.result.time === 'number') {
//       return json.result.time;
//     }
//     throw new Error('Invalid response format from Bybit time API');
//   } catch (err) {
//     console.warn('⚠️ Fallback to local time (Bybit time fetch failed)', err.message);
//     return Date.now();
//   }
// }

// // ===== Main signed Bybit request (GET/POST) =====
// export async function bybitSignedRequest(endpoint, method = 'GET', params = {}) {
//   if (endpoint.includes('/v5/account/wallet-balance') && !params.accountType) {
//     params.accountType = 'UNIFIED';
//   }

//   const timestamp = await getBybitServerTime();
//   const timestampStr = timestamp.toString();

//   params.timestamp = timestampStr;
//   params.recvWindow = RECV_WINDOW;

//   const url = `${BASE_URL}${endpoint}`;
//   const headers = signedHeaders(params, method, timestampStr);

//   const fullUrl =
//     method === 'GET' && Object.keys(params).length
//       ? `${url}?${new URLSearchParams(params).toString()}`
//       : url;

//   const options = {
//     method,
//     headers,
//     ...(method === 'POST' ? { body: JSON.stringify(params) } : {}),
//   };

//   console.log(`📡 ${method} ${fullUrl}`);
//   if (method === 'POST') {
//     console.log('📝 Payload:', JSON.stringify(params));
//   }

//   try {
//     const res = await fetch(fullUrl, options);
//     const status = res.status;
//     const allHeaders = Object.fromEntries(res.headers.entries());
//     const text = await res.text();

//     console.log("🔵 BYBIT RESPONSE STATUS:", status);
//     console.log("🔵 BYBIT RESPONSE HEADERS:", allHeaders);
//     console.log("🔵 RAW BYBIT RESPONSE:", text);

//     let json;
//     try {
//       json = JSON.parse(text);
//     } catch (e) {
//       console.error('❌ Invalid JSON from Bybit:', text);
//       return { error: 'Invalid JSON from Bybit', status, headers: allHeaders, text };
//     }
//     if (json.retCode !== 0) {
//       console.warn('⚠️ Bybit returned error:', json.retMsg, json);
//     }
//     return json;
//   } catch (err) {
//     console.error('❌ Fetch Error:', err);
//     return { error: 'Fetch failed', message: err.message };
//   }
// }