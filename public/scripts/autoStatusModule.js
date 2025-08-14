// === autoStatusModule.js — Enhanced Strategy Bot Status Module ===

import { isBotActive } from './poseidonBotModule.js';
import { getOpenPositions } from './futuresApiClient.js';

let currentPhase = 'Idle';
let currentEngine = 'Memory';
let cooldownUntil = null;

// small helpers
const n = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const fmt = (v, digits = 2) => n(v, 0).toFixed(digits);

// === External Setters
export function setPoseidonPhase(phase) { currentPhase = phase || 'Idle'; }
export function setEngineMode(mode) { currentEngine = mode || 'Memory'; }
export function setCooldownUntil(timestampMs) { cooldownUntil = timestampMs || null; }

export async function renderAutoStatus() {
  const statusEl   = document.getElementById('futures-connection');
  const lastEl     = document.getElementById('futures-last-trade');
  const pnlEl      = document.getElementById('futures-live-pnl');
  const phaseEl    = document.getElementById('poseidon-phase');
  const engineEl   = document.getElementById('poseidon-engine');
  const openEl     = document.getElementById('poseidon-open-count');
  const cooldownEl = document.getElementById('poseidon-cooldown');
  const liveDot    = document.getElementById('futures-connection-dot');

  try {
    const botActive = typeof window.isPoseidonActive === 'function'
      ? window.isPoseidonActive()
      : isBotActive();

    // Status text + dot
    if (statusEl) {
      statusEl.textContent = botActive ? 'ON' : 'OFF';
      statusEl.classList.toggle('text-green', botActive);
      statusEl.classList.toggle('text-red', !botActive);
    }
    if (liveDot) {
      liveDot.textContent = botActive ? '🟢 Live' : '🔴';
      liveDot.classList.toggle('text-green', botActive);
      liveDot.classList.toggle('text-red', !botActive);
    }

    // Phase / Engine
    if (phaseEl)  phaseEl.textContent  = currentPhase;
    if (engineEl) engineEl.textContent = currentEngine;

    // Open positions snapshot
    const open = await getOpenPositions().catch(() => []);
    const count = Array.isArray(open) ? open.length : 0;

    // "value" is margin/cost on our UI; also accept margin/marginUsd
    const notional = (open || []).reduce(
      (sum, p) => sum + n(p.value ?? p.margin ?? p.marginUsd, 0),
      0
    );

    // Prefer pnlValue; else pnl; else 0
    const totalPnl = (open || []).reduce(
      (sum, p) => sum + n(p.pnlValue ?? p.pnl, 0),
      0
    );

    if (openEl) openEl.textContent = `${count} trades / $${fmt(notional, 2)}`;

    if (pnlEl) {
      const txt = `${fmt(totalPnl, 2)} USDT`;
      pnlEl.textContent = txt;
      pnlEl.classList.toggle('text-green', totalPnl > 0);
      pnlEl.classList.toggle('text-red', totalPnl < 0);
      pnlEl.classList.toggle('text-gray', totalPnl === 0);
    }

    // Last trade (kept as localStorage hint; backend hook can replace later)
    if (lastEl) lastEl.textContent = localStorage.getItem('poseidon-last-trade') || '--';

    // Cooldown timer
    if (cooldownEl) {
      if (!cooldownUntil) {
        cooldownEl.textContent = '--';
      } else {
        const sec = Math.max(0, Math.floor((cooldownUntil - Date.now()) / 1000));
        cooldownEl.textContent = sec > 0 ? `${sec}s` : '--';
      }
    }
  } catch (err) {
    console.warn('⚠️ Failed to render Auto Status:', err.message);
    if (statusEl) statusEl.textContent = 'OFF';
    if (lastEl) lastEl.textContent = '--';
    if (pnlEl) pnlEl.textContent = '--';
    if (phaseEl) phaseEl.textContent = '--';
    if (engineEl) engineEl.textContent = '--';
    if (openEl) openEl.textContent = '--';
    if (cooldownEl) cooldownEl.textContent = '--';
    if (liveDot) liveDot.textContent = '🔴';
  }
}