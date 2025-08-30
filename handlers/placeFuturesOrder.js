// handlers/placeFuturesOrder.js
// Shim so evaluatePoseidonDecision can call the real handler.
const { placeFuturesOrder: place } = require('./placeTradeHandler');

// Keep the same name/export the evaluator expects.
async function placeFuturesOrder(params = {}) {
  // evaluator sends {symbol, side, notionalUsd, leverage, tpPercent, slPercent, testPrice, manual}
  // our real handler expects `contract` and `notionalUsd`, and honors `testPrice`
  const {
    symbol,
    side,
    notionalUsd,
    leverage,
    tpPercent,
    slPercent,
    testPrice,
    manual,
  } = params;

  return place({
    contract: symbol,        // normalize inside real handler
    side,
    notionalUsd,
    leverage,
    tpPercent,
    slPercent,
    testPrice,               // <- preserves evaluator’s live price
    manual: !!manual,
  });
}

module.exports = { placeFuturesOrder };