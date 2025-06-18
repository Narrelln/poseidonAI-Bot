import { evaluateWalletBehavior } from './wallet_evaluator.js';

console.log("Poseidon Learning Kernel Active");

const walletMemory = {};
const trackedWallets = new Set();
const scoredWallets = [];

function observeTransaction(tx) {
  const { wallet, token, action, marketCap, time, isBonding, exitROI, tokenImpactSpike } = tx;

  if (!walletMemory[wallet]) walletMemory[wallet] = [];

  walletMemory[wallet].push({
    token,
    action,
    marketCap,
    time,
    isBonding: isBonding || false,
    exitROI: exitROI ?? null,
    tokenImpactSpike: tokenImpactSpike ?? false
  });

  if (shouldEvaluate(wallet)) {
    const result = evaluateWalletBehavior(walletMemory[wallet]);

    if (result.isPromising && !trackedWallets.has(wallet)) {
      trackedWallets.add(wallet);
      scoredWallets.push({ wallet, score: result.score, summary: result.summary });

      console.log(`🧠 Smart wallet identified: ${wallet} | Score: ${result.score}`);
    }
  }
}

function shouldEvaluate(wallet) {
  return walletMemory[wallet].length >= 3;
}

function getTopWallets(limit = 10) {
  return scoredWallets.sort((a, b) => b.score - a.score).slice(0, limit);
}

function getTrackedWallets() {
  return Array.from(trackedWallets);
}

function getWalletMemory(wallet) {
  return walletMemory[wallet] || [];
}

export {
  observeTransaction,
  getTopWallets,
  getTrackedWallets,
  getWalletMemory
 };
 
 // === 🧠 Poseidon Learning Kernel ===

const learningMemory = [];

// Log smart wallet entries with bonding/volume info
function logLearningEvent({ token, bonding, volume, wallet, marketCap }) {
  const timestamp = new Date().toISOString();
  const entry = {
    token,
    bonding,
    volume,
    wallet,
    marketCap,
    time: timestamp,
    outcome: null
  };
  learningMemory.push(entry);
  console.log("📚 Learning Kernel Logged:", entry);
}

// Simulate outcome after a delay (e.g. 3 mins)
function simulateOutcomeEvaluation(token, result = "+42%") {
  const match = learningMemory.find(e => e.token === token && !e.outcome);
  if (match) {
    match.outcome = result;
    console.log(`🔍 Outcome Recorded for ${token}: ${result}`);
  }
}

// Auto-call from live wallet events
function triggerLearningFromWallet(message) {
  const tokenMatch = message.match(/\$(\w+)/);
  const walletMatch = message.match(/Groovy|Cupsey|Assassin/);
  const walletName = walletMatch ? walletMatch[0] : "Unknown";

  if (tokenMatch) {
    const token = `$${tokenMatch[1]}`;
    const bonding = Math.floor(Math.random() * 40);  // placeholder
    const volume = 4000 + Math.floor(Math.random() * 8000);  // placeholder
    const marketCap = 55000 + Math.floor(Math.random() * 30000);  // placeholder

    logLearningEvent({
      token,
      bonding,
      volume,
      wallet: walletName,
      marketCap
    });

    setTimeout(() => simulateOutcomeEvaluation(token), 180000);  // 3 mins later
  }
}