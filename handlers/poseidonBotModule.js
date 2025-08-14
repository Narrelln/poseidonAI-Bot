// === poseidonBotModule.js — Backend-Safe Autonomous Bot Control (CommonJS)

const { logToFeed, formatPrice, calculateTradeAmount } = require('../handlers/futuresOps');
const { evaluatePoseidonDecision } = require('./decisionHelper');
const { getActiveSymbols } = require('./poseidonScanner');
const { isBotActive, setBotActive } = require('../utils/botStatus');

let autoShutdownTimer = null;
let autoResumeTimer = null;
let cooldownActive = false;
let autoDecisionInterval = null;

// === Autonomous decision loop ===
function startPoseidonAutonomousLoop() {
  if (autoDecisionInterval) clearInterval(autoDecisionInterval);

  console.log("🟢 Starting Poseidon autonomous loop...");

  // ✅ DEFER init to avoid top-level circular load
  const { initFuturesDecisionEngine } = require('./futuresDecisionEngine');
  initFuturesDecisionEngine();

  autoDecisionInterval = setInterval(async () => {
    if (!isBotActive()) return;

    const symbols = getActiveSymbols();
    if (Array.isArray(symbols) && symbols.length) {
      for (const symbol of symbols) {
        try {
          await evaluatePoseidonDecision(symbol); // ✅ from decisionHelper only
        } catch (err) {
          console.warn(`[Poseidon] Failed to evaluate ${symbol}:`, err.message);
        }
      }
    }
  }, 30_000);
}

function stopPoseidonAutonomousLoop() {
  if (autoDecisionInterval) clearInterval(autoDecisionInterval);
  autoDecisionInterval = null;
  console.log("🛑 Poseidon autonomous loop stopped.");
}

function resetBotTimeout() {
  if (autoShutdownTimer) clearTimeout(autoShutdownTimer);

  autoShutdownTimer = setTimeout(() => {
    console.log("[Poseidon] Auto-disabled after 10m inactivity.");
    setBotActive(false);
    stopPoseidonAutonomousLoop();
  }, 10 * 60 * 1000);
}

function triggerAutoShutdownWithCooldown() {
  if (cooldownActive) return;

  setBotActive(false);
  stopPoseidonAutonomousLoop();
  cooldownActive = true;
  console.log("[Poseidon] Cooldown started (30m).");

  autoResumeTimer = setTimeout(() => {
    setBotActive(true);
    cooldownActive = false;
    resetBotTimeout();
    startPoseidonAutonomousLoop();
    console.log("[Poseidon] Bot resumed after cooldown.");
  }, 30 * 60 * 1000);
}

module.exports = {
  startPoseidonAutonomousLoop,
  stopPoseidonAutonomousLoop,
  resetBotTimeout,
  triggerAutoShutdownWithCooldown
};