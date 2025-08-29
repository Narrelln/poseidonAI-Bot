// handlers/kucoinClient.js

const Kucoin = require('kucoin-node-sdk');

Kucoin.init({
  baseUrl: 'https://api-futures.kucoin.com',
  apiAuth: {
    key: process.env.KUCOIN_API_KEY,
    secret: process.env.KUCOIN_API_SECRET,
    passphrase: process.env.KUCOIN_API_PASSPHRASE,
  }
});

const kucoinFuturesClient = Kucoin.rest.Futures;

module.exports = { kucoinFuturesClient };