require('dotenv').config();  // Loads .env from root
const axios = require('axios');
const signKucoinV3Request = require('./utils/signRequest'); // ✅ Use default import, not destructuring!

const BASE_URL = 'https://api-futures.kucoin.com';
const API_KEY = process.env.KUCOIN_KEY;
const API_SECRET = process.env.KUCOIN_SECRET;
const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;

console.log('KUCOIN_KEY:', API_KEY);
console.log('KUCOIN_SECRET:', API_SECRET);
console.log('KUCOIN_PASSPHRASE:', API_PASSPHRASE);

async function placeKucoinOrder() {
  const endpoint = '/api/v1/orders';
  const method = 'POST';
  const query = '';

  const bodyObj = {
    clientOid: Date.now().toString(),
    symbol: 'DOGEUSDTM',
    side: 'buy',
    leverage: 5,
    type: 'market',
    size: 1
  };

  const bodyStr = JSON.stringify(bodyObj);
  const { headers } = signKucoinV3Request(method, endpoint, query, bodyStr, API_KEY, API_SECRET, API_PASSPHRASE);

  try {
    const res = await axios.post(BASE_URL + endpoint, bodyObj, { headers });
    console.log('✅ SUCCESS:', res.data);
  } catch (err) {
    console.error('❌ ERROR:', err.response?.data || err.message);
  }
}

placeKucoinOrder();