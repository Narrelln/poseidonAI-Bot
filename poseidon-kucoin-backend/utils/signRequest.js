// utils/signRequest.js

const crypto = require('crypto');

/**
 * Signs KuCoin v3 API requests (REST V3)
 * @param {string} method - HTTP verb (GET/POST/DELETE/PUT)
 * @param {string} endpoint - Path, e.g. '/api/v1/orders'
 * @param {string} query - URL query string ("" if none)
 * @param {string} body - Stringified JSON for POST, "" for GET
 * @param {string} apiKey
 * @param {string} apiSecret
 * @param {string} passphrase
 * @returns {object} - headers object
 */
function signKucoinV3Request(method, endpoint, query, body, apiKey, apiSecret, passphrase) {
  const now = Date.now(); // number, not string
  const pathWithQuery = endpoint + (query ? `?${query}` : '');
  const prehash = now + method.toUpperCase() + pathWithQuery + (body || '');
  const signature = crypto.createHmac('sha256', apiSecret)
    .update(prehash)
    .digest('base64');
  const passphraseSig = crypto.createHmac('sha256', apiSecret)
    .update(passphrase)
    .digest('base64');
  return {
    'KC-API-KEY': apiKey,
    'KC-API-SIGN': signature,
    'KC-API-TIMESTAMP': now,
    'KC-API-PASSPHRASE': passphraseSig,
    'KC-API-KEY-VERSION': '2',
    'Content-Type': 'application/json'
  };
}

module.exports = { signKucoinV3Request };