const axios = require('axios');
const { signKucoinV3Request } = require('./signRequest');
require('dotenv').config();

const BASE_URL = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';
const API_KEY = process.env.KUCOIN_KEY;
const API_SECRET = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;

// ✅ PATCHED: Return precise fill price, size, and side with retry
async function getKucoinOrderFill(orderId, expectedSide = null) {
  const endpoint = '/api/v1/fills';
  const query = `orderId=${orderId}`;
  const headers = signKucoinV3Request('GET', endpoint, query, '', API_KEY, API_SECRET, API_PASSPHRASE);

  for (let i = 0; i < 5; i++) {
    try {
      const res = await axios.get(`${BASE_URL}${endpoint}?${query}`, { headers });
      let fills = Array.isArray(res.data?.data) ? res.data.data : [];
      
      if (fills.length > 0) {
        // Filter by expected side if provided
        if (expectedSide) {
          fills = fills.filter(f => f.side?.toLowerCase() === expectedSide.toLowerCase());
        }
        const latestFill = fills[fills.length - 1];
        if (latestFill && latestFill.price) {
          return {
            price: parseFloat(latestFill.price),
            side: latestFill.side,
            size: parseFloat(latestFill.size || 0)
          };
        }
      }
    } catch (err) {
      console.error('❌ Error fetching fill:', err?.response?.data || err.message);
    }

    await new Promise(r => setTimeout(r, 1000)); // wait 1s between retries
  }

  return null;
}

module.exports = {
  getKucoinOrderFill
};