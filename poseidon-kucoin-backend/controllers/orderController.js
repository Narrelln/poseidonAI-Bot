// const axios = require('axios');
// const crypto = require('crypto');
// const { v4: uuidv4 } = require('uuid');

// exports.placeOrder = async (req, res) => {
//   const { symbol = 'DOGEUSDTM', side = 'buy', size = '1' } = req.body;

//   const apiKey = process.env.KUCOIN_API_KEY;
//   const apiSecret = process.env.KUCOIN_SECRET_KEY;
//   const passphrase = process.env.KUCOIN_PASSPHRASE;
//   const baseUrl = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';

//   const endpoint = '/api/v1/orders';
//   const method = 'POST';
//   const now = Date.now();

//   const body = {
//     clientOid: uuidv4(),
//     symbol,
//     side,
//     type: 'market',
//     size: size.toString(),
//     timeInForce: 'GTC'
//   };

//   const strToSign = now + method + endpoint + JSON.stringify(body);
//   const signature = crypto.createHmac('sha256', apiSecret).update(strToSign).digest('base64');
//   const passphraseSig = crypto.createHmac('sha256', apiSecret).update(passphrase).digest('base64');

//   const headers = {
//     'KC-API-KEY': apiKey,
//     'KC-API-SIGN': signature,
//     'KC-API-TIMESTAMP': now,
//     'KC-API-PASSPHRASE': passphraseSig,
//     'KC-API-KEY-VERSION': '2',
//     'Content-Type': 'application/json',
//   };

//   try {
//     const response = await axios.post(baseUrl + endpoint, body, { headers });
//     console.log('✅ ORDER SUCCESS:', response.data);
//     res.json({ status: 'success', order: response.data });
//   } catch (error) {
//     console.error('❌ ORDER ERROR:', error.response?.data || error.message);
//     res.status(500).json({
//       error: error.response?.data || error.message,
//     });
//   }
// };