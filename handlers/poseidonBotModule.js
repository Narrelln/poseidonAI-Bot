// === poseidonBotModule.js — Backend-Safe Autonomous Bot Control (CommonJS)
// Server version (no 10‑minute auto‑shutdown)

const { logToFeed, formatPrice, calculateTradeAmount } = require('./futuresOps');
const { evaluatePoseidonDecision, listActiveSymbols } = require('./decisionHelper');
const { getActiveSymbols } = require('./poseidonScanner');
const { isBotActive, setBotActive } = require('../utils/botStatus');

let autoDecisionInterval = null;
let autoResumeTimer = null;
let cooldownActive = false;

// ---- helpers ----
function once(fn) {
  let ran = false;
  return (...args) => {
    if (ran) return;
    ran = true;
    return fn(...args);
  };
}

// === Autonomous decision loop ===
function startPoseidonAutonomousLoop() {
  // guard: keep only one loop running
  if (autoDecisionInterval) clearInterval(autoDecisionInterval);

  console.log('🟢 Starting Poseidon autonomous loop...');

  // defer init to avoid circular import issues
  const { initFuturesDecisionEngine } = require('./futuresDecisionEngine');
  try { initFuturesDecisionEngine(); } catch (e) {
    console.warn('[Poseidon] initFuturesDecisionEngine:', e?.message || e);
  }

  autoDecisionInterval = setInterval(async () => {
    try {
      if (!isBotActive()) return;
      const symbols = await listActiveSymbols();  // Top50 only
    
      if (Array.isArray(symbols) && symbols.length) {
        for (const symbol of symbols) {
          try {
            await evaluatePoseidonDecision(symbol);
          } catch (err) {
            console.warn(`[Poseidon] Failed to evaluate ${symbol}:`, err?.message || err);
          }
        }
      }
    } catch (e) {
      console.warn('[Poseidon] loop tick error:', e?.message || e);
    }
  }, 30_000);
}

function stopPoseidonAutonomousLoop() {
  if (autoDecisionInterval) clearInterval(autoDecisionInterval);
  autoDecisionInterval = null;
  console.log('🛑 Poseidon autonomous loop stopped.');
}

/**
 * 🔕 Server-side auto-shutdown DISABLED.
 * This is now a no-op (kept for compatibility with callers).
 */
function resetBotTimeout() {
  // Previously: setTimeout(... 10 * 60 * 1000)
  // Now intentionally disabled so the bot never turns itself OFF due to inactivity.
  return;
}

/**
 * Manual cooldown (still available if you explicitly call it).
 * Turns OFF the bot now, then auto-resumes after 30 minutes.
 */
function triggerAutoShutdownWithCooldown() {
  if (cooldownActive) return;
  cooldownActive = true;

  setBotActive(false);
  stopPoseidonAutonomousLoop();
  console.log('[Poseidon] Cooldown started (30m).');

  if (autoResumeTimer) clearTimeout(autoResumeTimer);
  autoResumeTimer = setTimeout(() => {
    cooldownActive = false;
    setBotActive(true);
    startPoseidonAutonomousLoop();
    console.log('[Poseidon] Bot resumed after cooldown.');
  }, 30 * 60 * 1000);
}

async function setBotEnabled(on) {
  window.POSEIDON_AUTOTRADE_ENABLED = !!on;

  // reflect immediately in UI
  const el = document.getElementById('poseidon-status');
  if (el) el.textContent = `Poseidon Bot: ${on ? 'ON' : 'OFF'}`;

  // tell server to mirror the flag for evaluator
  try {
    await fetch('/api/autoplace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable: !!on })
    });
  } catch (e) {
    console.warn('[BotToggle] failed to set server autoplace:', e?.message || e);
  }
}

// on boot, if you want default ON:
document.addEventListener('DOMContentLoaded', () => {
  const defaultOn = true; // <— choose your default
  setBotEnabled(defaultOn);
});

module.exports = {
  startPoseidonAutonomousLoop,
  stopPoseidonAutonomousLoop,
  resetBotTimeout,                  // now a no-op (no 10m auto-OFF)
  triggerAutoShutdownWithCooldown
};