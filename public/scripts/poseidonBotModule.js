import { evaluatePoseidonDecision as makeTradeDecision, initFuturesDecisionEngine } from './futuresDecisionEngine.js';
import { getActiveSymbols, startScanner } from './poseidonScanner.js';
import { renderAutoStatus } from './autoStatusModule.js';

let autoShutdownTimer = null;
let autoResumeTimer = null;
let cooldownActive = false;
let autoDecisionInterval = null;

let botActive = false;

export function isBotActive() {
  return botActive;
}

export function setBotActive(value) {
  botActive = value;
  window.__poseidonBotActive = value;
  localStorage.setItem('poseidonBotActive', value ? 'true' : 'false');
  updateBotGlow();
}

function updateBotGlow() {
  const glow = document.getElementById('poseidon-toggle');
  const statusEl = document.getElementById('poseidon-status');
  const botPanel = document.getElementById('poseidon-bot');

  if (glow) {
    glow.classList.remove('active');
    if (botActive) glow.classList.add('active');
  }

  if (botPanel) {
    botPanel.classList.remove('glow');
    if (botActive) botPanel.classList.add('glow');
  }

  if (statusEl) {
    statusEl.textContent = botActive ? 'Poseidon Bot: ON' : 'Poseidon Bot: OFF';
    statusEl.classList.toggle('text-green', botActive);
    statusEl.classList.toggle('text-red', !botActive);
  }
}

export function startPoseidonAutonomousLoop() {
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
  }, 30_000);
}

export function stopPoseidonAutonomousLoop() {
  if (autoDecisionInterval) clearInterval(autoDecisionInterval);
  autoDecisionInterval = null;
}

export function resetBotTimeout() {
  if (autoShutdownTimer) clearTimeout(autoShutdownTimer);
  autoShutdownTimer = setTimeout(async () => {
    console.log("[Poseidon] Auto-disabled after inactivity.");
    setBotActive(false);
    stopPoseidonAutonomousLoop();
    await renderAutoStatus();
  }, 10 * 60 * 1000);
}

export function triggerAutoShutdownWithCooldown() {
  if (cooldownActive) return;

  setBotActive(false);
  stopPoseidonAutonomousLoop();
  cooldownActive = true;
  renderAutoStatus();

  console.log("[Poseidon] Bot cooldown started (30m).");

  autoResumeTimer = setTimeout(async () => {
    setBotActive(true);
    cooldownActive = false;
    resetBotTimeout();
    startPoseidonAutonomousLoop();
    startScanner();
    await renderAutoStatus();
    console.log("[Poseidon] Bot resumed after cooldown.");
  }, 30 * 60 * 1000);
}

export function initBot() {
  const savedState = localStorage.getItem('poseidonBotActive');
  if (savedState === 'true') {
    setBotActive(true);
    startPoseidonAutonomousLoop();
    startScanner();
  } else {
    setBotActive(false);
    stopPoseidonAutonomousLoop();
  }
  resetBotTimeout();
  updateBotGlow();
}

// ✅ PATCH: Explicitly export makeTradeDecision to fix external calls
export { makeTradeDecision };

// ✅ Expose to browser console for live toggling
window.isBotActive = isBotActive;
window.setBotActive = setBotActive;
window.startPoseidonAutonomousLoop = startPoseidonAutonomousLoop;
window.stopPoseidonAutonomousLoop = stopPoseidonAutonomousLoop;

// === ✅ TOGGLE BUTTON UI LOGIC ===
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('poseidon-toggle');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', async () => {
    const newState = !isBotActive();
    setBotActive(newState);
    await renderAutoStatus();

    if (newState) {
      console.log('[Poseidon] Bot toggled ON');
      startPoseidonAutonomousLoop();
      resetBotTimeout();
      startScanner();
    } else {
      console.log('[Poseidon] Bot toggled OFF');
      stopPoseidonAutonomousLoop();
    }
  });

  updateBotGlow(); // ✅ Set initial glow state after DOM is loaded
});