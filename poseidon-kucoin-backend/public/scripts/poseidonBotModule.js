// scripts/poseidonBotModule.js — Controls Poseidon's Auto Mode + Cooldowns

import { setFuturesConnectionStatus } from './futuresModule.js';
import { makeTradeDecision, initFuturesDecisionEngine } from './futuresDecisionEngine.js';
import { getActiveSymbols } from './poseidonScanner.js';

let autoShutdownTimer = null;
let autoResumeTimer = null;
let cooldownActive = false;
let autoDecisionInterval = null;
let lastToggleTime = 0;

function startPoseidonAutonomousLoop() {
  if (autoDecisionInterval) clearInterval(autoDecisionInterval);

  initFuturesDecisionEngine();

  autoDecisionInterval = setInterval(async () => {
    if (!isBotActive()) return;
    const symbols = getActiveSymbols();
    if (Array.isArray(symbols) && symbols.length) {
      for (const symbol of symbols) {
        try {
          await makeTradeDecision(symbol);
        } catch (err) {
          console.warn(`[Poseidon] Failed to evaluate ${symbol}:`, err.message);
        }
      }
    }
  }, 30000);
}

function stopPoseidonAutonomousLoop() {
  if (autoDecisionInterval) clearInterval(autoDecisionInterval);
  autoDecisionInterval = null;
}

export function initBot() {
  const bot = document.getElementById("poseidon-bot");
  const panel = document.getElementById("memory-panel");
  const glow = bot?.querySelector(".bot-glow");
  const botIcon = bot?.querySelector("img");

  if (!bot || !panel) {
    console.warn("Poseidon bot or components not found.");
    return;
  }

  bot.addEventListener("click", () => {
    const now = Date.now();
    if (now - lastToggleTime < 600) return;
    lastToggleTime = now;

    bot.classList.toggle("active");
    resetBotTimeout();

    if (bot.classList.contains("active")) {
      panel.textContent = "Autonomous Mode Activated 🔥";
      if (glow) glow.classList.add("glow-on");
      if (botIcon) botIcon.classList.add("pulsing");
      setFuturesConnectionStatus("connected");
      startPoseidonAutonomousLoop();
      console.log("[Poseidon] Bot toggled ON.");
    } else {
      panel.textContent = "I'm Poseidon. Strategy loaded ✅";
      if (glow) glow.classList.remove("glow-on");
      if (botIcon) botIcon.classList.remove("pulsing");
      setFuturesConnectionStatus("disconnected");
      stopPoseidonAutonomousLoop();
      console.log("[Poseidon] Bot toggled OFF.");
    }
  });

  resetBotTimeout();

  if (bot.classList.contains("active")) {
    setFuturesConnectionStatus("connected");
    startPoseidonAutonomousLoop();
    panel.textContent = "Autonomous Mode Activated 🔥";
    if (glow) glow.classList.add("glow-on");
    if (botIcon) botIcon.classList.add("pulsing");
  } else {
    setFuturesConnectionStatus("disconnected");
    panel.textContent = "I'm Poseidon. Strategy loaded ✅";
    if (glow) glow.classList.remove("glow-on");
    if (botIcon) botIcon.classList.remove("pulsing");
  }
}

// -- Timeout after inactivity (10 min)
function resetBotTimeout() {
  if (autoShutdownTimer) clearTimeout(autoShutdownTimer);
  autoShutdownTimer = setTimeout(() => {
    const bot = document.getElementById("poseidon-bot");
    const glow = bot?.querySelector(".bot-glow");
    const panel = document.getElementById("memory-panel");
    const botIcon = bot?.querySelector("img");

    if (bot?.classList.contains("active")) {
      bot.classList.remove("active");
      if (glow) glow.classList.remove("glow-on");
      if (botIcon) botIcon.classList.remove("pulsing");
      if (panel) panel.textContent = "Auto-Disabled (Inactivity)";
      setFuturesConnectionStatus("disconnected");
      stopPoseidonAutonomousLoop();
      console.log("[Poseidon] Auto-disabled after inactivity.");
    }
  }, 10 * 60 * 1000);
}

// -- Called externally (e.g. after 3 failed trades)
export function triggerAutoShutdownWithCooldown() {
  const bot = document.getElementById("poseidon-bot");
  const panel = document.getElementById("memory-panel");
  const glow = bot?.querySelector(".bot-glow");
  const botIcon = bot?.querySelector("img");

  if (!bot || cooldownActive) return;

  bot.classList.remove("active");
  if (glow) glow.classList.remove("glow-on");
  if (botIcon) botIcon.classList.remove("pulsing");
  if (panel) panel.textContent = "Auto-Disabled (3 failed trades)";
  setFuturesConnectionStatus("disconnected");
  stopPoseidonAutonomousLoop();

  cooldownActive = true;
  console.log("[Poseidon] Bot cooldown started (30m).");

  autoResumeTimer = setTimeout(() => {
    bot.classList.add("active");
    if (glow) glow.classList.add("glow-on");
    if (botIcon) botIcon.classList.add("pulsing");
    if (panel) panel.textContent = "♻️ Poseidon resumed autonomous mode after cooldown.";
    setFuturesConnectionStatus("connected");
    cooldownActive = false;
    resetBotTimeout();
    startPoseidonAutonomousLoop();
    console.log("[Poseidon] Bot resumed after cooldown.");
  }, 30 * 60 * 1000);
}

export function isBotActive() {
  const bot = document.getElementById("poseidon-bot");
  return !!bot?.classList.contains("active");
}

// Optional: expose timeout reset externally
window.resetPoseidonBotTimeout = resetBotTimeout;