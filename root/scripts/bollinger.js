console.log('📊 Bollinger Bands Engine Activated');

function calculateBollingerBands(candles, period = 20, multiplier = 2) {
  if (candles.length < period) return null;

  const closes = candles.slice(-period).map(c => c.close);

  const sma = closes.reduce((a, b) => a + b, 0) / period;

  const variance = closes.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = sma + multiplier * stdDev;
  const lower = sma - multiplier * stdDev;

  const lastPrice = candles[candles.length - 1].close;
  const breakout =
    lastPrice > upper ? 'above' :
    lastPrice < lower ? 'below' :
    'inside';

  const bandWidth = upper - lower;
  const compression = bandWidth / sma < 0.05; // 5% band width

  return {
    upper,
    lower,
    sma,
    breakout,
    compression
  };
}