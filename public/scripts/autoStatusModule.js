// === autoStatusModule.js — Resilient Strategy Bot Status ===
// Shows ON across refreshes using localStorage + grace window,
// and updates live via a custom "poseidon:bot-state" event.

import { isBotActive } from './poseidonBotModule.js';
import { getOpenPositions } from './futuresApiClient.js';

let currentPhase = 'Idle';
let currentEngine = 'Memory';
let cooldownUntil = null;

// ---- persistence & debounce ----
const LS_KEY = 'POSEIDON_BOT_ACTIVE';    // "1" | "0"
const GRACE_MS = 30_000;                  // keep ON if we were ON in last 30s
let lastOnTs = 0;                         // last time we *knew* the bot was ON
let cachedBotActive = null;               // most recent decision

const n   = (v, d=0) => (Number.isFinite(+v) ? +v : d);
const fmt = (v, d=2) => n(v, 0).toFixed(d);

function readStoredActive() {
  const v = localStorage.getItem(LS_KEY);
  return v === '1' || v === 'true';
}

function decideActiveNow() {
  // 1) fast path: bot module exposes a function (after it loads)
  try {
    if (typeof window.isPoseidonActive === 'function') {
      return !!window.isPoseidonActive();
    }
  } catch {}
  try {
    return !!isBotActive();
  } catch {}

  // 2) fallback: persistent flag (set by poseidonBotModule on toggle)
  if (readStoredActive()) return true;

  // 3) grace: if we were ON moments ago, keep ON briefly during boot
  if (Date.now() - lastOnTs < GRACE_MS) return true;

  return false;
}

function paintStatus(active) {
  const statusEl = document.getElementById('futures-connection');
  const dotEl    = document.getElementById('futures-connection-dot');
  if (statusEl) {
    statusEl.textContent = active ? 'Connected' : 'OFF';
    statusEl.classList.toggle('text-green', active);
    statusEl.classList.toggle('text-red', !active);
  }
  if (dotEl) {
    dotEl.textContent = active ? '🟢' : '🔴';
    dotEl.classList.toggle('text-green', active);
    dotEl.classList.toggle('text-red', !active);
  }
}

// === External Setters (unchanged) ===
export function setPoseidonPhase(phase) { currentPhase = phase || 'Idle'; }
export function setEngineMode(mode) { currentEngine = mode || 'Memory'; }
export function setCooldownUntil(ts) { cooldownUntil = ts || null; }

export async function renderAutoStatus() {
  const lastEl   = document.getElementById('futures-last-trade');
  const pnlEl    = document.getElementById('futures-live-pnl');
  const phaseEl  = document.getElementById('poseidon-phase');
  const engineEl = document.getElementById('poseidon-engine');
  const openEl   = document.getElementById('poseidon-open-count');
  const coolEl   = document.getElementById('poseidon-cooldown');

  // determine active with resilience
  const active = decideActiveNow();
  cachedBotActive = active;
  if (active) lastOnTs = Date.now();              // refresh grace
  paintStatus(active);

  try {
    if (phaseEl)  phaseEl.textContent  = currentPhase;
    if (engineEl) engineEl.textContent = currentEngine;

    const open = await getOpenPositions().catch(() => []);
    const cnt  = Array.isArray(open) ? open.length : 0;
    const notional = (open || []).reduce((s,p)=> s + n(p.value ?? p.margin ?? p.marginUsd, 0), 0);
    const totalPnl = (open || []).reduce((s,p)=> s + n(p.pnlValue ?? p.pnl, 0), 0);

    if (openEl) openEl.textContent = `${cnt} trades / $${fmt(notional,2)}`;
    if (pnlEl) {
      pnlEl.textContent = `${fmt(totalPnl,2)} USDT`;
      pnlEl.classList.toggle('text-green', totalPnl > 0);
      pnlEl.classList.toggle('text-red', totalPnl < 0);
      pnlEl.classList.toggle('text-gray', totalPnl === 0);
    }
    if (lastEl) lastEl.textContent = localStorage.getItem('poseidon-last-trade') || '--';

    if (coolEl) {
      if (!cooldownUntil) coolEl.textContent = '--';
      else {
        const sec = Math.max(0, Math.floor((cooldownUntil - Date.now())/1000));
        coolEl.textContent = sec > 0 ? `${sec}s` : '--';
      }
    }
  } catch (err) {
    // leave the status painted from earlier decision
    if (pnlEl)  pnlEl.textContent  = '--';
    if (lastEl) lastEl.textContent = '--';
    if (openEl) openEl.textContent = '--';
    if (phaseEl) phaseEl.textContent = '--';
    if (engineEl) engineEl.textContent = '--';
    if (coolEl) coolEl.textContent = '--';
    console.warn('⚠️ Auto Status render failed:', err.message);
  }
}

// Listen for bot toggle events so we update immediately
window.addEventListener('poseidon:bot-state', (ev) => {
  // Expect ev.detail = { active: boolean }
  const on = !!(ev?.detail?.active);
  localStorage.setItem(LS_KEY, on ? '1' : '0');
  if (on) lastOnTs = Date.now();
  cachedBotActive = on;
  paintStatus(on);
});