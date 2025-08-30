// /public/scripts/poseidonBotModule.js
// Cycle-only Poseidon Bot controller (single owner).
// - No TA loops, no futuresDecisionEngine, no evaluate calls.
// - ON → POST /api/start-cycle-watcher-server
// - OFF → POST /api/stop-cycle-watcher
// - Scanner can run for UI, but never dispatches decisions (SCANNER_DECISIONS=false).

/* eslint-disable no-console */

import { startScanner } from './poseidonScanner.js';
import { renderAutoStatus } from './autoStatusModule.js';

// ---- Optional client wrappers (guarded) ----
let startCycleWatcherServer = async (contracts = []) => {
  const res = await fetch('/api/start-cycle-watcher-server', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Array.isArray(contracts) ? { contracts } : { contracts: [] })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(j?.error || `HTTP ${res.status}`);
  return j;
};

let stopCycleWatcherServer = async () => {
  const res = await fetch('/api/stop-cycle-watcher', { method: 'POST' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(j?.error || `HTTP ${res.status}`);
  return j;
};

let getCycleWatcherStatus = async () => {
  const res = await fetch('/api/cycle-watcher-status', { cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  return j;
};

// ---- persistence keys (UI-only memory for convenience) ----
const LS_KEY_NEW = 'POSEIDON_BOT_ACTIVE';   // '1' | '0'
const LS_KEY_OLD = 'poseidonBotActive';     // 'true' | 'false' (legacy)

// ---- configurable (client-side) auto-shutdown; 0 = disabled (default) ----
function getAutoShutdownMs() {
  const mins = Number(localStorage.getItem('POSEIDON_IDLE_AUTO_OFF_MIN') || '0');
  return Number.isFinite(mins) && mins > 0 ? mins * 60 * 1000 : 0;
}

// ---- internal state ----
let autoShutdownTimer = null;
let autoResumeTimer = null;
let cooldownActive = false;
let botActive = false; // current state

// guards to prevent double init / double binding
let _initialized = false;
let _uiBound = false;

// global flags to prevent duplicate services (HMR / multi-import safety)
if (!window.__POSEIDON_GLOBALS__) window.__POSEIDON_GLOBALS__ = {};
const G = window.__POSEIDON_GLOBALS__;
G.scannerStarted ??= false;

// ---------- backend API helpers ----------
async function apiGetBot() {
  try {
    const r = await fetch('/api/bot', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return !!j?.enabled;
  } catch (e) {
    console.warn('[PoseidonBot] /api/bot GET failed:', e?.message || e);
    return null; // fall back to local storage
  }
}

async function apiSetBot(enabled) {
  try {
    const r = await fetch('/api/bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !!enabled })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return !!j?.enabled;
  } catch (e) {
    console.warn('[PoseidonBot] /api/bot POST failed:', e?.message || e);
    return null; // keep local state as-is
  }
}

// ---------- helpers ----------
function readSavedActive() {
  const v = localStorage.getItem(LS_KEY_NEW);
  if (v === '1' || v === '0') return v === '1';
  const legacy = localStorage.getItem(LS_KEY_OLD);
  if (legacy === 'true' || legacy === 'false') return legacy === 'true';
  return false;
}

function persistActive(value) {
  localStorage.setItem(LS_KEY_NEW, value ? '1' : '0');
  localStorage.setItem(LS_KEY_OLD, value ? 'true' : 'false'); // keep legacy in sync
}

function clearShutdownTimer() {
  if (autoShutdownTimer) {
    clearTimeout(autoShutdownTimer);
    autoShutdownTimer = null;
  }
}
function clearResumeTimer() {
  if (autoResumeTimer) {
    clearTimeout(autoResumeTimer);
    autoResumeTimer = null;
  }
}

function broadcastBotState() {
  try {
    window.dispatchEvent(new CustomEvent('poseidon:bot-state', { detail: { active: botActive } }));
  } catch (_) {}
}

function updateBotGlow() {
  const toggleBtn = document.getElementById('poseidon-toggle'); // small round toggle
  const botPanel  = document.getElementById('poseidon-bot');    // large panel tile
  const statusEl  = document.getElementById('poseidon-status');

  if (toggleBtn) toggleBtn.classList.toggle('active', botActive);
  if (botPanel)  botPanel.classList.toggle('glow', botActive);

  if (statusEl) {
    statusEl.textContent = botActive ? 'Poseidon Bot: ON' : 'Poseidon Bot: OFF';
    statusEl.classList.toggle('text-green', botActive);
    statusEl.classList.toggle('text-red', !botActive);
  }
}

// ---------- public API ----------
export function isBotActive() { return botActive; }

export async function setBotActive(value) {
  const next = !!value;
  if (botActive === next) return; // no-op

  // Optimistically update UI/state
  botActive = next;
  window.__poseidonBotActive = next;          // keep global in sync on toggle
  persistActive(next);
  broadcastBotState();
  updateBotGlow();
  try { renderAutoStatus(); } catch (_) {}

  // Push to backend main toggle (authoritative execution gate)
  const serverState = await apiSetBot(next);
  if (serverState === null) {
    console.warn('[PoseidonBot] Backend toggle not reachable; keeping local UI state.');
  } else if (serverState !== next) {
    // Server rejected/overrode; reflect it
    botActive = serverState;
    window.__poseidonBotActive = serverState;
    persistActive(serverState);
    broadcastBotState();
    updateBotGlow();
    try { renderAutoStatus(); } catch (_) {}
  }

  if (botActive) {
    console.log('[PoseidonBot] → ON');
    clearResumeTimer();
    cooldownActive = false;
    resetBotTimeout();

    // Start scanner once (UI only; SCANNER_DECISIONS=false ensures it won’t trade)
    if (!G.scannerStarted) {
      try { startScanner(); G.scannerStarted = true; }
      catch (e) { console.warn('[PoseidonBot] startScanner:', e?.message || e); }
    }

    // Start CycleWatcher on the backend (single owner)
    try {
      const startRes = await startCycleWatcherServer([]); // [] → backend autoselects
      console.log('[cycle] started:', startRes?.status || startRes);
      const status = await getCycleWatcherStatus();
      console.log('[cycle] status:', status);
    } catch (e) {
      console.warn('[cycle] start failed:', e?.message || e);
    }
  } else {
    console.log('[PoseidonBot] → OFF');
    clearShutdownTimer();
    // Stop CycleWatcher cleanly
    try {
      const stopRes = await stopCycleWatcherServer();
      console.log('[cycle] stopped:', stopRes?.status || stopRes);
    } catch (e) {
      console.warn('[cycle] stop failed:', e?.message || e);
    }
  }
}

// === Auto-shutdown is DISABLED by default ===
export function resetBotTimeout() {
  clearShutdownTimer();
  const ms = getAutoShutdownMs();
  if (!ms) return; // disabled
  autoShutdownTimer = setTimeout(() => {
    console.log('[Poseidon] Auto-disabled after inactivity window.');
    setBotActive(false);
  }, ms);
}

// Manual cooldown (opt-in only)
export function triggerAutoShutdownWithCooldown() {
  if (cooldownActive) return;

  setBotActive(false);
  cooldownActive = true;
  clearResumeTimer();

  const RESUME_MS = 30 * 60 * 1000;
  console.log('[Poseidon] Bot cooldown started (30m).');
  autoResumeTimer = setTimeout(() => {
    setBotActive(true);
    console.log('[Poseidon] Bot resumed after cooldown.');
  }, RESUME_MS);
}

// ---- explicit boot (no side-effects on import) ----
export async function initBot() {
  if (_initialized) return;
  _initialized = true;

  // 1) Try server truth first
  let serverEnabled = await apiGetBot();

  // 2) Fallback to saved UI state if server unreachable
  const saved = readSavedActive();
  botActive = (serverEnabled === null) ? !!saved : !!serverEnabled;

  // Keep both storages consistent & seed global
  persistActive(botActive);
  window.__poseidonBotActive = botActive;

  // hydrate UI once and broadcast
  updateBotGlow();
  try { renderAutoStatus(); } catch (_) {}
  broadcastBotState();

  // If ON, start services now (idempotent)
  if (botActive) {
    console.log('[PoseidonBot] restoring ON state');
    resetBotTimeout();

    if (!G.scannerStarted) {
      try { startScanner(); G.scannerStarted = true; } catch (_) {}
    }

    try {
      await startCycleWatcherServer([]);
      await getCycleWatcherStatus();
    } catch (_) {}
  }
}

// ---- optional: bind UI (idempotent) ----
export function bindBotToggleUI() {
  if (_uiBound) return;
  _uiBound = true;

  const toggleBtn = document.getElementById('poseidon-toggle');
  const botPanel  = document.getElementById('poseidon-bot');
  const handler = (e) => {
    e?.preventDefault?.();
    setBotActive(!isBotActive());
  };

  if (toggleBtn) toggleBtn.addEventListener('click', handler);
  if (botPanel)  botPanel.addEventListener('click', handler);

  // Reflect future changes fired from elsewhere
  window.addEventListener('poseidon:bot-state', (ev) => {
    const on = !!ev.detail?.active;
    if (toggleBtn) toggleBtn.classList.toggle('active', on);
    if (botPanel)  botPanel.classList.toggle('glow', on);
  });

  // initial reflect
  updateBotGlow();
}

// ✅ optional debug handle
window.PoseidonBot = {
  isBotActive,
  setBotActive,
  initBot,
  bindBotToggleUI
};