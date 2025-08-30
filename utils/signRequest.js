// utils/signRequest.js
const crypto = require('crypto');

/**
 * Signs KuCoin v3 API requests (REST V3)
 */
function signKucoinV3Request(method, endpoint, query, body, apiKey, apiSecret, passphrase) {
  const now = Date.now().toString(); // must be string
  const pathWithQuery = query ? `${endpoint}?${query}` : endpoint;
  const prehash = now + method.toUpperCase() + pathWithQuery + (body || '');

  const signature = crypto.createHmac('sha256', apiSecret)
    .update(prehash)
    .digest('base64');

  // passphrase must also be signed
  const passphraseSig = crypto.createHmac('sha256', apiSecret)
    .update(passphrase)
    .digest('base64');

  return {
    'KC-API-KEY': apiKey,
    'KC-API-SIGN': signature,
    'KC-API-TIMESTAMP': now,
    'KC-API-PASSPHRASE': passphraseSig,
    'KC-API-KEY-VERSION': '2',   // v2 keys
    'Content-Type': 'application/json',
  };
}

module.exports = { signKucoinV3Request };