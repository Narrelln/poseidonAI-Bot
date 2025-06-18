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