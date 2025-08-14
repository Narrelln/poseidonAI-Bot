const axios = require('axios');
const crypto = require('crypto');

exports.getBalance = async (req, res) => {
  const apiKey = process.env.KUCOIN_API_KEY;
  const apiSecret = process.env.KUCOIN_SECRET_KEY;
  const passphrase = process.env.KUCOIN_PASSPHRASE;
  const baseUrl = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';

  const endpoint = '/api/v1/account-overview?currency=USDT';
  const method = 'GET';
  const now = Date.now();

  const strToSign = now + method + endpoint;
  const signature = crypto.createHmac('sha256', apiSecret).update(strToSign).digest('base64');
  const passphraseSig = crypto.createHmac('sha256', apiSecret).update(passphrase).digest('base64');

  const headers = {
    'KC-API-KEY': apiKey,
    'KC-API-SIGN': signature,
    'KC-API-TIMESTAMP': now,
    'KC-API-PASSPHRASE': passphraseSig,
    'KC-API-KEY-VERSION': '2'
  };

  try {
    const response = await axios.get(baseUrl + endpoint, { headers });
    console.log('[✅ Balance Fetched]', response.data);
    res.json({
      balance: response.data.data.accountEquity,
      available: response.data.data.availableBalance,
    });
  } catch (error) {
    console.error('[❌ Balance Error]', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
};