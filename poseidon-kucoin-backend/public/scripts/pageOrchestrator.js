// /public/scripts/pageOrchestrator.js
// Glue the page back together (datalist • session • memory • wallet glance • voice).
// Safe to include multiple times; calls are idempotent or throttled.

import { getWalletBalance, getOpenPositions } from '/scripts/futuresApiClient.js';
import { initSessionStats, setActiveTrades } from '/scripts/sessionStatsModule.js';
import { renderMemoryPanel } from '/scripts/learningMemory.js';
import { renderCapitalScore } from '/scripts/capitalScoreModule.js';

/* =============== Datalist (symbols) =============== */
async function populateDatalist() {
  const datalist = document.getElementById('symbol-options');
  if (!datalist) return;
  try {
    const res = await fetch('/api/scan-tokens', { cache: 'no-store' });
    if (!res.ok) throw new Error(`scan-tokens HTTP ${res.status}`);
    const data = await res.json();
    const rows = [...(data.top50 || []), ...(data.moonshots || [])];

    const seen = new Set();
    datalist.innerHTML = '';
    for (const t of rows) {
      const raw = String(t?.symbol || t || '').toUpperCase();
      const base = raw.replace(/[-_]/g, '').replace(/USDTM?$/, '');
      if (!base || seen.has(base)) continue;
      seen.add(base);
      const opt = document.createElement('option');
      opt.value = base;
      opt.dataset.symbol = raw;
      datalist.appendChild(opt);
    }
  } catch (err) {
    console.warn('[orchestrator] datalist:', err.message);
  }
}

/* =============== Session + positions =============== */
async function refreshPositions() {
  try {
    const positions = await getOpenPositions();
    // broadcast for positionEnhancer / open-positions renderer
    window.dispatchEvent(new CustomEvent('poseidon:positions', { detail: { positions } }));
    // update session stats
    try { setActiveTrades(Array.isArray(positions) ? positions : []); } catch {}
  } catch (e) {
    console.warn('[orchestrator] positions:', e.message);
  }
}

async function warmSession() {
  try { initSessionStats(); } catch {}
  await refreshPositions();
}

/* =============== Memory panel (left column) =============== */
async function warmMemory() {
  try { await renderMemoryPanel(); }
  catch (e) {
    // Wake backend softly if renderer throws
    try { await fetch('/api/learning-memory', { cache: 'no-store' }); } catch {}
  }
}

/* =============== Voice wake (announcer handles gestures) =============== */
function wakeVoice() {
  try { window.dispatchEvent(new CustomEvent('poseidon:voice:init')); } catch {}
  // If you want voice ON by default only after a user click somewhere else:
  // try { window.dispatchEvent(new CustomEvent('poseidon:voice:enable')); } catch {}
}

/* =============== Wallet glance + capital score =============== */
async function paintWalletGlance() {
  try {
    const total = await getWalletBalance(); // number | null
    const totalEl = document.getElementById('wallet-total');
    const availEl = document.getElementById('wallet-available');
    if (Number.isFinite(total)) {
      if (totalEl) totalEl.textContent = total.toFixed(2);
      if (availEl)  availEl.textContent  = total.toFixed(2); // mirror until API exposes available
    } else {
      if (totalEl) totalEl.textContent = '--';
      if (availEl)  availEl.textContent  = '--';
    }
  } catch (e) {
    console.warn('[orchestrator] wallet:', e.message);
  }

  // Recompute capital score (independent from wallet call)
  try { await renderCapitalScore(); } catch {}
}

/* =============== Boot =============== */
let booted = false;
async function boot() {
  if (booted) return; booted = true;

  // Kick parallel warmups (don’t block UI)
  await Promise.allSettled([
    populateDatalist(),
    warmSession(),
    warmMemory(),
    paintWalletGlance(),
  ]);

  wakeVoice();

  // Heartbeats
  setInterval(populateDatalist, 60_000);   // refresh symbols each minute
  setInterval(refreshPositions, 12_000);   // keep open positions fresh
  setInterval(warmMemory, 45_000);         // keep memory panel lively
  setInterval(paintWalletGlance, 20_000);  // wallet + capital score
}

document.addEventListener('DOMContentLoaded', boot);

// Manual poke from console if needed
window.poseidonBoot = boot;