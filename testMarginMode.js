// testMarginMode.js

const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';

(async () => {
  try {
    const res = await axios.get(`${BASE_URL}/api/v1/contracts/active`);
    const contracts = res.data?.data || [];

    const symbolToCheck = 'WIFUSDTM';
    const found = contracts.find(c => c.symbol === symbolToCheck);

    if (found) {
      console.log(`[MARGIN MODE] ${symbolToCheck} uses:`, found.marginModel);
    } else {
      console.warn(`[NOT FOUND] Symbol "${symbolToCheck}" not in KuCoin active contracts.`);
    }
  } catch (err) {
    console.error('[ERROR]', err.message || err);
  }
})();