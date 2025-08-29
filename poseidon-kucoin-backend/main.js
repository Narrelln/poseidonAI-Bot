const { getTA, calculateConfidence } = require('./handlers/taHandler');

(async () => {
  const symbol = 'BTC-USDTM';

  const ta = await getTA(symbol);
  if (!ta) {
    console.log(`[${symbol}] ❌ Failed to get TA`);
    return;
  }

  const macdSignal = ta.macd?.direction === 'bullish' ? 'Buy' : 'Sell';
  const bbSignal = ta.bb?.breakout ? 'Breakout' : 'Normal';
  const volumeSpike = !ta.volumeFade;

  const confidence = calculateConfidence(macdSignal, bbSignal, volumeSpike);

  console.log(`🔍 Symbol: ${symbol}`);
  console.log(`MACD: ${macdSignal}`);
  console.log(`BB: ${bbSignal}`);
  console.log(`Volume Spike: ${volumeSpike}`);
  console.log(`🧠 Confidence Score: ${confidence}%`);
})();