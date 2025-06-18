// wallet_tracker.js
console.log("Poseidon Wallet Tracker Initialized");

const trackedWalletLogs = {};
const walletStats = {};

function trackWallet(walletAddress) {
  if (!trackedWalletLogs[walletAddress]) {
    trackedWalletLogs[walletAddress] = [];
    walletStats[walletAddress] = {
      totalBuys: 0,
      totalSells: 0,
      uniqueTokens: new Set(),
      lastSeen: null
    };
    console.log(`🛰️ Now tracking wallet: ${walletAddress}`);
  }
}

function logWalletAction(wallet, token, action, marketCap, time) {
  if (!trackedWalletLogs[wallet]) return;

  trackedWalletLogs[wallet].push({ token, action, marketCap, time });

  if (action === "buy") walletStats[wallet].totalBuys++;
  if (action === "sell") walletStats[wallet].totalSells++;

  walletStats[wallet].uniqueTokens.add(token);
  walletStats[wallet].lastSeen = new Date(time).toLocaleTimeString();

  console.log(`📡 Wallet ${wallet} ${action} ${token} @ ${marketCap}`);
}

function getWalletLog(wallet) {
  return trackedWalletLogs[wallet] || [];
}

function getWalletStats(wallet) {
  const stats = walletStats[wallet];
  if (!stats) return null;

  return {
    ...stats,
    uniqueTokenCount: stats.uniqueTokens.size
  };
}

function getAllTrackedWallets() {
  return Object.keys(trackedWalletLogs);
}

export {
  trackWallet,
  logWalletAction,
  getWalletLog,
  getWalletStats,
  getAllTrackedWallets
};
function evaluateWalletBehavior(walletTxs) {
    let earlyBuyCount = 0;
    let impactCount = 0;
    let tokenWins = 0;
    let tokenLosses = 0;
  
    for (let tx of walletTxs) {
      if (tx.action !== "buy") continue;
  
      // 1. Early Entry (buys below 80K market cap within bonding phase)
      if (tx.marketCap < 80000 && tx.isBonding) earlyBuyCount++;
  
      // 2. Volume Impact (token spiked 50%+ within 2 mins after wallet's buy)
      if (tx.tokenImpactSpike === true) impactCount++;
  
      // 3. Win/Loss Tracking (wallet exited with +20% or more)
      if (tx.exitROI >= 20) tokenWins++;
      else if (tx.exitROI <= -20) tokenLosses++;
    }
  
    // Calculate dynamic behavior score
    const consistency = tokenWins / (tokenWins + tokenLosses || 1);
    const score = (earlyBuyCount * 10) + (impactCount * 15) + (consistency * 100);
  
    return {
      score: Math.round(score),
      isPromising: score > 80,
      summary: {
        earlyBuyCount,
        impactCount,
        tokenWins,
        tokenLosses,
        consistency: consistency.toFixed(2)
      }
    };
  }