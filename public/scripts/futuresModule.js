// /public/scripts/futuresModule.js  (stall‑proof boot; cleaned manual & table)
import { initSessionStats, setActiveSymbols, setActiveTrades } from './sessionStatsModule.js';
import { initManualTradeControls } from './manualTradeControls.js';
import { renderMemoryPanel, updateMemoryFromResult } from './learningMemory.js';
import { getWalletBalance, getOpenPositions } from './futuresApiClient.js';
import { startScanner, getActiveSymbols } from './poseidonScanner.js';
import { analyzeAndTrigger, startSignalEngine } from './futuresSignalModule.js';
import { renderCapitalScore } from './capitalScoreModule.js';
import { renderAutoStatus } from './autoStatusModule.js';
import { startReversalWatcher } from './reversalDriver.js';
import { calculateConfidence, _fib, POSEIDON_SESSION } from './taFrontend.js';
import { toKuCoinContractSymbol } from './futuresApiClient.js';

let STATS_STARTED = false;
let WALLET_TIMER = null;
let CAPITAL_TIMER = null;
let REV_WATCH_STARTED = false;

const BOOT = {
  SETTLE_MS: 5000,           // wait after starting scanner
  FETCH_TIMEOUT_MS: 6000,    // timeout for boot fetches
  FALLBACK_SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT']
};

function withTimeout(promise, ms, label = 'op') {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/* ---------------- Wallet + Positions ---------------- */
async function loadWalletAndPositions() {
  try {
    const balance = await withTimeout(getWalletBalance(), BOOT.FETCH_TIMEOUT_MS, 'wallet');
    const balanceEl = document.getElementById('wallet-balance');
    if (balanceEl) {
      const num = Number(balance);
      balanceEl.textContent = Number.isFinite(num) ? `$${num.toFixed(2)}` : '⚠️ Error';
    }

    renderCapitalScore(balance);

    const posTable = document.getElementById('open-positions-body');
    const positions = await withTimeout(getOpenPositions(), BOOT.FETCH_TIMEOUT_MS, 'positions');
    const rows = Array.isArray(positions) ? positions : [];

    try { setActiveTrades(rows); } catch {}

    if (!posTable) return;
    posTable.innerHTML = '';

    rows.forEach(pos => {
      const contract = String(pos.contract || pos.symbol || '').toUpperCase();
      const side     = String(pos.side || '').toUpperCase();        // 'BUY' | 'SELL' | 'LONG'|'SHORT'
      const entry    = Number(pos.entryPrice ?? pos.entry ?? 0);
      const size     = Number(pos.size ?? pos.contracts ?? 0);
      const value    = pos.value ?? pos.notionalUsd ?? '--';
      const margin   = pos.margin ?? pos.costUsd ?? '--';
      const pnlVal   = (pos.pnlValue !== undefined) ? pos.pnlValue : '--';
      const roi      = pos.roi ?? pos.pnlPercent ?? '--';
      const lev      = pos.leverage ?? '--';
      const liq      = pos.liquidation ?? pos.liqPrice ?? '--';
      const notes    = pos.notes || '';
      const age      = pos.age || '--';

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${contract}</td>
        <td>${side}</td>
        <td>${Number.isFinite(entry) ? entry : '--'}</td>
        <td>${size}</td>
        <td>${value}</td>
        <td>${margin}</td>
        <td>${pnlVal}</td>
        <td>${roi}</td>
        <td>${lev}</td>
        <td>${liq}</td>
        <td><button class="close-btn" data-contract="${contract}">Close</button></td>
        <td>${notes}</td>
        <td>${age}</td>
      `;
      posTable.appendChild(row);
    });

    // Close position handler (normalize symbol robustly)
    document.querySelectorAll('.close-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const raw = String(e.currentTarget.dataset.contract || '');
        const contract = toKuCoinContractSymbol(raw); // e.g. BTC-USDTM
        try {
          const res = await fetch('/api/close-trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contract })
          });
          const result = await res.json();
          const ok = result?.success || result?.result?.success;
          alert(ok ? `${contract} closed ✅` : `❌ Failed to close ${contract}: ${result?.error || result?.result?.error || 'Unknown error'}`);
        } catch (err) {
          alert(`❌ Close error for ${contract}: ${err.message}`);
        } finally {
          await loadWalletAndPositions();
        }
      });
    });

  } catch (err) {
    console.warn('⚠️ Wallet/position init:', err.message);
  }
}

/* ---------------- Manual Symbol Auto‑fill ---------------- */
async function autoFillManualTradeSymbols() {
  const datalist = document.getElementById('symbol-options');
  const input = document.getElementById('manual-symbol');
  if (!datalist || !input) return;

  try {
    const res = await withTimeout(fetch('/api/scan-tokens'), BOOT.FETCH_TIMEOUT_MS, 'scan-tokens');
    const data = await res.json();
    const all = [...(data.top50 || []), ...(data.moonshots || [])];

    datalist.innerHTML = '';
    all.forEach(token => {
      const fullSymbol = token.symbol || token; // e.g. "ADA-USDT"
      const display = String(fullSymbol).replace(/[-_/]?USDTM?$/i, '').toUpperCase();
      const option = document.createElement('option');
      option.value = display;               // what user types
      option.dataset.symbol = fullSymbol;   // original
      datalist.appendChild(option);
    });

    console.log(`✅ Auto‑fill: ${datalist.children.length} symbols`);
  } catch (err) {
    console.warn('❌ Auto‑fill:', err.message);
  }
}

/* ---------------- Manual Trade Entry (fixed route/fields) ---------------- */
async function initManualTradeEntry() {
  const tradeBtn = document.getElementById('open-trade');
  if (!tradeBtn) return;

  tradeBtn.addEventListener('click', async () => {
    try {
      const input    = document.getElementById('manual-symbol');
      const datalist = document.getElementById('symbol-options');
      const entered  = (input?.value || '').trim().toUpperCase();
      if (!entered) return alert('Enter a symbol (e.g., ADA)');

      // Resolve selected autocomplete entry → normalize
      let picked = null;
      if (datalist) {
        const m = Array.from(datalist.options).find(opt => opt.value.toUpperCase() === entered && opt.dataset.symbol);
        picked = m ? m.dataset.symbol : null;
      }
      const normalized = toKuCoinContractSymbol(picked || entered); // → "ADA-USDTM"

      // Side from UI (must be 'buy' | 'sell')
      const rawSide = (window.manualDirection || '').toLowerCase();
      const side = rawSide === 'sell' ? 'sell' : 'buy';

      // Form numbers
      const qtyUsd   = Number(document.getElementById('manual-size')?.value);     // Quantity (USDT)
      const tp       = Number(document.getElementById('manual-tp')?.value);
      const sl       = Number(document.getElementById('manual-sl')?.value);
      const leverage = Number(document.getElementById('manual-leverage')?.value);

      if (!(qtyUsd > 0))  return alert('Enter Quantity (USDT) > 0');
      if (!(leverage > 0)) return alert('Enter leverage > 0');

      // Optional: pass a price if your route supports it (it does in your patched version)
      // We’ll let the route fetch TA price if this fails.
      let price = NaN;
      try {
        const baseSpot = normalized.replace('-USDTM', 'USDT');
        const ta = await (await fetch(`/api/ta/${encodeURIComponent(baseSpot)}`)).json();
        const p = Number(ta?.price ?? ta?.markPrice);
        if (Number.isFinite(p) && p > 0) price = p;
      } catch {}

      const payload = {
        symbol: normalized,      // server normalizes anyway; send hyphenated FUT
        side,                    // 'buy' | 'sell'
        margin: qtyUsd,          // ✅ route expects "margin" (USDT to allocate)
        leverage,
        tpPercent: Number.isFinite(tp) ? tp : undefined,
        slPercent: Number.isFinite(sl) ? sl : undefined,
        confidence: 90,
        ...(Number.isFinite(price) && price > 0 ? { price } : {}),
        note: 'Manual trade from UI'
      };

      const res = await fetch('/api/place-futures-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const out = await res.json();
      if (!out?.success && out?.code !== 'SUCCESS' && out?.code !== 'SUCCESS_WITH_WARNING') {
        const msg = out?.error || out?.msg || 'Unknown error';
        alert(`❌ Order failed: ${msg}`);
      } else {
        alert('✅ Order placed');
      }

      await loadWalletAndPositions();

    } catch (err) {
      alert(`❌ Manual trade error: ${err.message}`);
    }
  });
}

/* ---------------- Boot ---------------- */
async function initPoseidon() {
  console.log('[boot] initPoseidon start');
  const tooltip = document.getElementById('manual-preview-tooltip');
  if (tooltip) tooltip.textContent = 'Loading symbols...';

  if (!STATS_STARTED) {
    initSessionStats();
    STATS_STARTED = true;
  }

  // Kick off long steps in parallel (none block the UI)
  const p1 = autoFillManualTradeSymbols();
  const p2 = initManualTradeControls();
  const p3 = initManualTradeEntry();
  const p4 = loadWalletAndPositions();

  // Start scanner immediately (non‑blocking)
  try { startScanner(); } catch (e) { console.warn('[boot] startScanner:', e.message); }

  // allow scanner to populate (bounded)
  await new Promise(r => setTimeout(r, BOOT.SETTLE_MS));

  // try to fetch actives (bounded)
  let actives = [];
  try {
    const a = await withTimeout(getActiveSymbols(), BOOT.FETCH_TIMEOUT_MS, 'getActiveSymbols');
    actives = Array.isArray(a) ? a : [];
    if (actives.length) setActiveSymbols(actives);
    console.log(`[boot] actives: ${actives.length}`);
  } catch (e) {
    console.warn('[boot] actives:', e.message);
  }

  // analyze initial actives once (non‑blocking failures)
  const resultSet = [];
  for (const s of actives) {
    const sym = s.symbol || s;
    try {
      const res = await withTimeout(analyzeAndTrigger(sym), BOOT.FETCH_TIMEOUT_MS, `analyze ${sym}`);
      if (res) resultSet.push({ symbol: sym, ...res });
    } catch (err) {
      console.warn(`[boot] analyze ${sym}:`, err.message);
    }
  }

  // hydrate memory panel
  for (const r of resultSet) {
    try { await updateMemoryFromResult(r.symbol, r); } catch {}
  }
  renderMemoryPanel();

  // ensure signal engine starts even if actives empty (no‑op but harmless)
  setTimeout(() => {
    try { startSignalEngine(); } catch (e) { console.warn('[boot] startSignalEngine:', e.message); }
  }, 1500);

  // start Reversal watcher with fallback if needed
  if (!REV_WATCH_STARTED) {
    try {
      const revList = (actives.length ? actives : BOOT.FALLBACK_SYMBOLS).map(a => a.symbol || a);
      startReversalWatcher(revList);
      REV_WATCH_STARTED = true;
      console.log(`[boot] ReversalWatcher on ${revList.length} symbols`);
    } catch (e) {
      console.warn('[boot] ReversalWatcher:', e.message);
    }
  }

  // periodic UI refresh
  if (WALLET_TIMER) clearInterval(WALLET_TIMER);
  WALLET_TIMER = setInterval(() => {
    loadWalletAndPositions();
    renderAutoStatus();
  }, 12_000);

  if (!CAPITAL_TIMER) {
    CAPITAL_TIMER = setInterval(renderCapitalScore, 15_000);
  }

  await Promise.allSettled([p1, p2, p3, p4]);
  if (tooltip) tooltip.textContent = 'Symbols loaded ✅';
  renderAutoStatus();
  console.log('[boot] initPoseidon done');
}

/* ---------------- First paint hooks + console helpers ---------------- */
renderCapitalScore();
document.addEventListener('DOMContentLoaded', initPoseidon);

window.POSEIDON_SESSION = POSEIDON_SESSION;
window.calculateConfidence = calculateConfidence;
window._fib = _fib;
window.analyzeAndTrigger = analyzeAndTrigger;
window.getOpenPositions = getOpenPositions;
window.testBias = function (session = 'US', dir = 'long', rsi = 60, headroomPct = 6, price = 1.0) {
  const cfg = window.POSEIDON_SESSION?.inspect?.().config?.weights;
  console.log('Session weights:', cfg);
  const { session: cur, dow } = window.POSEIDON_SESSION.getSessionInfo(new Date());
  const pts = window.POSEIDON_SESSION.sessionBiasPoints({
    session: session || cur,
    dow,
    dir,
    volumeSpike: true,
    rsi,
    price,
    range24h: { low: 0.9, high: 1.1 },
    headroomPct
  });
  console.log(`[testBias] session=${session || cur}, dir=${dir} → biasPts=${pts}`);
  return pts;
};