import { getTrackedWallets } from './learning_kernel.js';

console.log("Smart Trigger Engine Activated");

const recentBuys = [];
const CONVERGENCE_WINDOW_MS = 30000;
const MIN_WALLETS_REQUIRED = 2;

function logSmartBuy(wallet, token, timestamp) {
  const now = Date.now();
  const tokenUpper = token.toUpperCase();

  for (let i = recentBuys.length - 1; i >= 0; i--) {
    if (now - recentBuys[i].time > CONVERGENCE_WINDOW_MS) {
      recentBuys.splice(i, 1);
    }
  }

  recentBuys.push({ wallet, token: tokenUpper, time: timestamp });

  const activeWallets = new Set();
  for (const buy of recentBuys) {
    if (buy.token === tokenUpper) {
      activeWallets.add(buy.wallet);
    }
  }

  if (activeWallets.size >= MIN_WALLETS_REQUIRED) {
    console.log(`🚨 Smart Wallet Trigger: ${tokenUpper} bought by ${activeWallets.size} tracked wallets`);
    return {
      triggered: true,
      token: tokenUpper,
      wallets: Array.from(activeWallets),
      timestamp: now
    };
  }

  return { triggered: false };
}

export { logSmartBuy };