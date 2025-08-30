// /public/scripts/strategyStatus.js
// Pro status strip for Poseidon / Reversal / Cycle
/* eslint-disable no-console */

const REFRESH_MS = 2000;

let els = null;
let intervalId = null;
let mounted = false;

// Soft dynamic imports
let Bot = null;
let getCycleWatcherStatus = null;
let getReversalStatus = null;

// ---------- Utilities ----------
const q = (sel) => document.querySelector(sel);

function injectStyleOnce() {
  if (document.getElementById('strategy-status-css')) return;
  const css = `
  .strategy-status {
    position: fixed; left: 12px; bottom: 12px; z-index: 2147483647;
    background: rgba(11,14,18,.78); color: #e8f5ff;
    border: 1px solid rgba(255,255,255,.08);
    box-shadow: 0 2px 14px rgba(0,0,0,.25);
    border-radius: 10px; padding: 6px 10px; pointer-events: none;
    font: 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    display:flex; gap:.6rem; align-items:center; backdrop-filter: blur(4px);
  }
  .strategy-status .st-chip { display:flex; gap:.35rem; align-items:center; }
  .strategy-status .sep { opacity:.5; }
  .strategy-status .kv { opacity:.85; margin-left:.35rem; }
  .strategy-status .dot { width:.55rem; height:.55rem; border-radius:50%; background:#555; display:inline-block; }
  .strategy-status .dot--on { background:#19d27c; box-shadow:0 0 8px rgba(25,210,124,.65); }
  .strategy-status .dot--off { background:#666; box-shadow:none; }
  .strategy-status strong { font-weight:700; letter-spacing:.2px; color:#aee6ff; }
  `;
  const style = document.createElement('style');
  style.id = 'strategy-status-css';
  style.textContent = css;
  document.head.appendChild(style);
}

function nowMs() { return Date.now(); }

// Accept seconds or ms, ISO or number; return “age” ms
function ageFromStamp(anyTs) {
  if (anyTs == null) return NaN;
  // Number? could be seconds or ms
  if (typeof anyTs === 'number') {
    const ms = anyTs > 1e12 ? anyTs : (anyTs > 1e9 ? anyTs * 1000 : anyTs);
    return nowMs() - ms;
  }
  // String? try parse
  const n = Number(anyTs);
  if (!Number.isNaN(n)) return ageFromStamp(n);
  const d = new Date(anyTs);
  const t = d.getTime();
  return Number.isFinite(t) ? (nowMs() - t) : NaN;
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

// ---------- DOM ----------
function ensureDom() {
  injectStyleOnce();

  let root = q('#strategy-status');
  if (!root) {
    root = document.createElement('div');
    root.id = 'strategy-status';
    root.className = 'strategy-status';
    root.innerHTML = `
      <span id="st-poseidon" class="st-chip">
        <strong>Poseidon</strong> <span class="dot dot--off"></span>
      </span>
      <span class="sep">·</span>
      <span id="st-reversal" class="st-chip">
        <strong>Reversal</strong> <span class="dot dot--off"></span>
        <span class="kv">tick: <span id="st-rev-tick">—</span></span>
        <span class="kv">trades: <span id="st-rev-trades">0</span></span>
      </span>
      <span class="sep">|</span>
      <span id="st-cycle" class="st-chip">
        <strong>Cycle</strong> <span class="dot dot--off"></span>
        <span class="kv">tick: <span id="st-cyc-tick">—</span></span>
        <span class="kv">trades: <span id="st-cyc-trades">0</span></span>
      </span>
    `;
    document.body.appendChild(root);
  }

  els = {
    poseidon: q('#st-poseidon .dot'),
    revDot:   q('#st-reversal .dot'),
    cycDot:   q('#st-cycle .dot'),
    revTick:  q('#st-rev-tick'),
    revTrades:q('#st-rev-trades'),
    cycTick:  q('#st-cyc-tick'),
    cycTrades:q('#st-cyc-trades'),
  };
}

function setDot(dotEl, on) {
  if (!dotEl) return;
  dotEl.classList.toggle('dot--on', !!on);
  dotEl.classList.toggle('dot--off', !on);
}

// ---------- Lazy deps ----------
async function loadDepsOnce() {
  if (!Bot) {
    try {
      const mod = await import('./poseidonBotModule.js');
      Bot = { isBotActive: mod.isBotActive || (() => false) };
    } catch { Bot = { isBotActive: () => false }; }
  }
  if (!getCycleWatcherStatus) {
    try {
      const cw = await import('./cycleWatcherClient.js');
      getCycleWatcherStatus = cw.getCycleWatcherStatus || null;
    } catch { getCycleWatcherStatus = null; }
  }
  if (!getReversalStatus) {
    try {
      const rev = await import('./reversalDriver.js');
      getReversalStatus = rev.getReversalStatus || null;
    } catch { getReversalStatus = null; }
  }
}

// ---------- Tick ----------
async function tick() {
  if (!els) return;

  // Poseidon
  try {
    setDot(els.poseidon, !!(Bot && Bot.isBotActive && Bot.isBotActive()));
  } catch {}

  // Reversal
  try {
    if (getReversalStatus) {
      const rs = await getReversalStatus();
      setDot(els.revDot, !!rs?.running);
      if (els.revTick)   els.revTick.textContent   = formatAge(ageFromStamp(rs?.lastTickMs ?? rs?.lastTick));
      if (els.revTrades) els.revTrades.textContent = String(rs?.tradeCount ?? 0);
    } else {
      const r = await fetch('/api/reversal/status').then(r => r.ok ? r.json() : null).catch(() => null);
      setDot(els.revDot, !!r?.running);
      if (els.revTick)   els.revTick.textContent   = formatAge(ageFromStamp(r?.lastTickMs ?? r?.lastTick));
      if (els.revTrades) els.revTrades.textContent = String(r?.tradeCount ?? 0);
    }
  } catch {}

  // Cycle
  try {
    if (getCycleWatcherStatus) {
      const cs = await getCycleWatcherStatus();
      setDot(els.cycDot, !!cs?.running);
      if (els.cycTick)   els.cycTick.textContent   = formatAge(ageFromStamp(cs?.lastTickMs ?? cs?.lastTick));
      if (els.cycTrades) els.cycTrades.textContent = String(cs?.tradeCount ?? 0);
    } else {
      const r = await fetch('/api/cycle-watcher/status').then(r => r.ok ? r.json() : null).catch(() => null);
      setDot(els.cycDot, !!r?.running);
      if (els.cycTick)   els.cycTick.textContent   = formatAge(ageFromStamp(r?.lastTickMs ?? r?.lastTick));
      if (els.cycTrades) els.cycTrades.textContent = String(r?.tradeCount ?? 0);
    }
  } catch {}
}

function startLoop() {
  if (intervalId) return;
  intervalId = setInterval(tick, REFRESH_MS);
}

function stopLoop() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}

// ---------- Public mount ----------
async function mount() {
  if (mounted) return;
  mounted = true;

  ensureDom();
  await loadDepsOnce();

  tick();
  startLoop();

  // react to bot flips immediately
  try {
    window.addEventListener('poseidon:bot-state', (ev) => {
      setDot(els.poseidon, !!ev?.detail?.active);
    });
  } catch {}
}

function unmount() { stopLoop(); mounted = false; }

// ---------- Reversal shims (called by reversalDriver) ----------
let __revLastTickMs = 0;

function setReversalOn(on) {
  if (!els) return;
  setDot(els.revDot, !!on);
}
function bumpReversalTrades(n = 1) {
  if (!els || !els.revTrades) return;
  const cur = parseInt(els.revTrades.textContent || '0', 10);
  els.revTrades.textContent = String(cur + (Number.isFinite(n) ? n : 1));
}
function reportReversalTick() {
  __revLastTickMs = nowMs();
  if (els?.revTick) els.revTick.textContent = '0s';
}

// Improve live “seconds since last tick” without showing huge numbers
const _origTick = tick;
tick = async function patchedTick() {
  await _origTick();
  if (els?.revTick && __revLastTickMs) {
    els.revTick.textContent = formatAge(nowMs() - __revLastTickMs);
  }
};

// ---------- Exports ----------
export const StrategyStatus = {
  mount,
  unmount,
  setReversalOn,
  bumpReversalTrades,
  reportReversalTick
};
export default StrategyStatus;