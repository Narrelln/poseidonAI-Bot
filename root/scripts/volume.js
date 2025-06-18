console.log("📈 Volume Strength Analyzer Activated");

function analyzeVolumeStrength(candles, period = 20, spikeMultiplier = 2) {
  if (candles.length < period) return null;

  const recent = candles.slice(-period);
  const volumes = recent.map(c => c.volume || 0);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / period;

  const lastCandle = candles[candles.length - 1];
  const currentVolume = lastCandle.volume || 0;
  const currentPrice = lastCandle.close;

  const previousPrice = candles[candles.length - 2]?.close || currentPrice;
  const priceDelta = currentPrice - previousPrice;

  const spike = currentVolume > avgVolume * spikeMultiplier;
  const divergence =
    (priceDelta > 0 && currentVolume < avgVolume) ||
    (priceDelta < 0 && currentVolume < avgVolume);

  return {
    avgVolume,
    currentVolume,
    spike,
    divergence,
    volumeTrend: currentVolume > avgVolume ? "rising" : "falling"
  };
}