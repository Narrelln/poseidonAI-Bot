const { getTA } = require('./handlers/getTA');

(async () => {
  const symbols = ['BTCUSDTM', 'ETHUSDTM', 'SOLUSDTM', 'DOGEUSDTM'];
  
  for (const symbol of symbols) {
    console.log(`\n⏱ Testing TA for: ${symbol}`);
    const result = await getTA(symbol);
    console.log(JSON.stringify(result, null, 2));
  }
})();