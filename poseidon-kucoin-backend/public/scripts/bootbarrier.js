// /public/scripts/bootBarrier.js
// Central "ready" signal + simple whenReady() helper with retries.

const state = {
    dom: document.readyState !== 'loading',
    api: false,
    scanner: false,
  };
  const listeners = [];
  
  function fireReadyIf() {
    if (state.dom && state.api && state.scanner) {
      window.dispatchEvent(new CustomEvent('poseidon:ready'));
      // flush queued callbacks once
      while (listeners.length) (listeners.shift())();
    }
  }
  
  // DOM gate
  if (!state.dom) {
    document.addEventListener('DOMContentLoaded', () => {
      state.dom = true; fireReadyIf();
    });
  }
  
  // Ping API health (retry, cool)
  async function waitHealth(retryMs = 1500) {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const j = await r.json();
      if (j && j.ok) { state.api = true; fireReadyIf(); return; }
    } catch {}
    setTimeout(() => waitHealth(retryMs), retryMs);
  }
  waitHealth();
  
  // Scanner “first payload” detector (from scannerPanel / poseidonScanner)
  async function waitScanner(retryMs = 1500) {
    try {
      // prefer cache endpoint if present
      const r = await fetch('/api/scan-tokens', { cache: 'no-store' });
      const j = await r.json();
      const list = (j && (j.top50 || j.data || j.rows)) || [];
      if (Array.isArray(list) && list.length) {
        state.scanner = true; fireReadyIf(); return;
      }
    } catch {}
    setTimeout(() => waitScanner(retryMs), retryMs);
  }
  waitScanner();
  
  // Public helper — queue a callback to run once everything is ready.
  export function whenReady(fn) {
    if (state.dom && state.api && state.scanner) { try { fn(); } catch {} ; return; }
    listeners.push(fn);
  }
  
  // Also expose an event-based interface
  export const PoseidonBoot = {
    isReady: () => state.dom && state.api && state.scanner
  };