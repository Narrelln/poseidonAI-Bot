// testPlaceOrder.js
const { placeFuturesOrder } = require('../handlers/placeTradeHandler');


(async () => {
  const payload = {
    contract: 'LINK-USDTM',
    side: 'SELL',
    leverage: 5,
    notionalUsd: 0.1773, // ✅ You can adjust this to test different minimum thresholds
    type: 'market',
    reduceOnly: false,
    tpPercent: 35,
    slPercent: 20,
    manual: true
  };

  console.log('[TEST] Sending order payload:', payload);

  const result = await placeFuturesOrder(payload);

  console.log('[TEST RESULT]', JSON.stringify(result, null, 2));
})();