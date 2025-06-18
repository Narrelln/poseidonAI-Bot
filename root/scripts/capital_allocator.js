console.log("Capital Allocator Loaded");

const MIN_ALLOCATION = 0.1;
const MAX_ALLOCATION = 1.0;

function capitalForToken(token, context = {}) {
  const {
    bondingPercent = 20,
    walletCount = 2,
    volume = 4000,
    impactScore = 40
  } = context;

  const normBonding = 1 - bondingPercent / 100;
  const normWallets = Math.min(walletCount / 5, 1);
  const normVolume = Math.min(volume / 10000, 1);
  const normImpact = Math.min(impactScore / 100, 1);

  const confidence = (
    normBonding * 0.35 +
    normWallets * 0.25 +
    normVolume * 0.20 +
    normImpact * 0.20
  );

  const allocation = MIN_ALLOCATION + (MAX_ALLOCATION - MIN_ALLOCATION) * confidence;

  return {
    token,
    confidence: Math.round(confidence * 100),
    amount: parseFloat(allocation.toFixed(3))
  };
}

export { capitalForToken };