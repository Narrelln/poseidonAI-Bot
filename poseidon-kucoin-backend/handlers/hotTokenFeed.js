// === /handlers/hotTokenFeed.js ===
// Mirror of frontend hotFeed logic — backend-safe (CommonJS)

const hotFeed = [];
const MAX_FEED_SIZE = 50;

function recordHotToken(symbol, confidence, priceChange, volume) {
  hotFeed.unshift({
    symbol,
    confidence,
    priceChange: Number(priceChange.toFixed(2)),
    volume: Number((volume / 1e6).toFixed(2)),
    timestamp: Date.now()
  });

  if (hotFeed.length > MAX_FEED_SIZE) hotFeed.pop();
}

function getHotTokenFeed() {
  return hotFeed;
}

module.exports = {
  getHotTokenFeed,
  recordHotToken
};