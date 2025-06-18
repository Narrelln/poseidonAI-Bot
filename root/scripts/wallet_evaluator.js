console.log("Wallet Evaluator Loaded");

function evaluateWalletBehavior(walletTxs) {
  let earlyBuys = 0;
  let impactBuys = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const tx of walletTxs) {
    const { action, marketCap, isBonding, exitROI, tokenImpactSpike } = tx;

    if (action !== 'buy') continue;

    if (marketCap < 80000 && isBonding) earlyBuys++;
    if (tokenImpactSpike === true) impactBuys++;
    if (exitROI >= 20) winCount++;
    else if (exitROI <= -20) lossCount++;
  }

  const totalBuys = earlyBuys + impactBuys;
  const totalTrades = winCount + lossCount || 1;
  const consistencyScore = winCount / totalTrades;
  const rawScore = (earlyBuys * 10) + (impactBuys * 15) + (consistencyScore * 100);
  const finalScore = Math.round(rawScore);

  return {
    score: finalScore,
    isPromising: finalScore >= 80,
    summary: {
      earlyBuys,
      impactBuys,
      winCount,
      lossCount,
      consistency: consistencyScore.toFixed(2),
      totalTxs: walletTxs.length
    }
  };
}

export { evaluateWalletBehavior };