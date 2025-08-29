/**
 * File #04: public/scripts/manualTradeControls.js
 * Description:
 *   KuCoin‑style manual control:
 *   - User inputs Quantity (USDT) and Leverage
 *   - Preview asks backend for contracts & cost (margin)
 *   - Submit sends only notionalUsd (Quantity) and leverage
 *   - Frontend displays the exact cost from backend (after lot/min/multiplier rounding)
 * Last Updated: 2025‑08‑25 (fix preview symbol & response handling)
 */

import { toKuCoinContractSymbol } from './futuresApiClient.js';

let manualDirection = 'BUY';
const $ = (id) => document.getElementById(id);

function showTradeOverlay(message, success = false) {
  let el = $('trade-processing-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'trade-processing-overlay';
    Object.assign(el.style, {
      position: 'fixed', top: '20px', right: '20px',
      padding: '12px 20px', borderRadius: '6px',
      backgroundColor: '#222', color: '#fff', zIndex: 9999,
      boxShadow: '0 0 10px rgba(0,0,0,0.5)', fontSize: '16px'
    });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.backgroundColor = success ? '#1e8c36' : '#222';
  el.style.display = 'block';
  setTimeout(() => (el.style.display = 'none'), 4000);
}

const fmt = (n, d = 2) => {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : '--';
};

/* ---------------- Datalist ---------------- */
async function populateDatalist() {
  const datalist = document.getElementById('symbol-options');
  if (!datalist) return;
  const bases = new Set();

  // primary: scanner
  try {
    const r = await fetch('/api/scan-tokens');
    const j = await r.json();
    const rows = Array.isArray(j?.top50) ? j.top50 : [];
    for (const t of rows) {
      const raw = String(t?.symbol || t || '').toUpperCase();
      const base = raw.replace(/[-_]/g,'').replace(/USDTM?$/,'');
      if (base) bases.add(base);
    }
  } catch {}

  // fallback: positions
  if (!bases.size) {
    try {
      const r = await fetch('/api/positions');
      const j = await r.json();
      const rows = Array.isArray(j?.positions) ? j.positions : [];
      for (const p of rows) {
        const raw = String(p?.symbol || p?.contract || '').toUpperCase();
        const base = raw.replace(/[-_]/g,'').replace(/USDTM?$/,'');
        if (base) bases.add(base);
      }
    } catch {}
  }

  if (!bases.size) ['BTC','ETH','SOL','ADA','DOGE'].forEach(b => bases.add(b));

  const frag = document.createDocumentFragment();
  [...bases].forEach(base => {
    const opt = document.createElement('option');
    opt.value = base;            // user sees/chooses base (e.g., ADA)
    opt.dataset.symbol = base;   // we’ll normalize to contract later
    frag.appendChild(opt);
  });
  datalist.innerHTML = '';
  datalist.appendChild(frag);
}

/* ---------------- INIT ---------------- */
export async function initManualTradeControls() {
  await populateDatalist();

  const longBtn  = $('manual-long');
  const shortBtn = $('manual-short');

  longBtn?.addEventListener('click', () => {
    manualDirection = 'BUY';
    longBtn.classList.add('selected');
    shortBtn?.classList.remove('selected');
    triggerLivePreview();
  });

  shortBtn?.addEventListener('click', () => {
    manualDirection = 'SELL';
    shortBtn.classList.add('selected');
    longBtn?.classList.remove('selected');
    triggerLivePreview();
  });

  const setBubble = (id, value, suffix = '') => {
    const el = $(id);
    if (el) el.textContent = ` ${value}${suffix}`;
  };

  // Quantity (USDT)
  $('manual-size')?.addEventListener('input', () => {
    const q = $('manual-size').value;
    setBubble('manual-size-value', q, '');
    triggerLivePreview();
  });

  // Leverage
  $('manual-leverage')?.addEventListener('input', () => {
    const lev = $('manual-leverage').value;
    setBubble('manual-leverage-value', lev, 'x');
    triggerLivePreview();
  });

  // TP/SL (cosmetic bubbles)
  $('manual-tp')?.addEventListener('input', (e) => setBubble('manual-tp-value', e.target.value, '%'));
  $('manual-sl')?.addEventListener('input', (e) => setBubble('manual-sl-value', e.target.value, '%'));

  // Symbol change
  $('manual-symbol')?.addEventListener('input', triggerLivePreview);

  // Initial bubbles
  setBubble('manual-leverage-value', $('manual-leverage')?.value || '5', 'x');
  setBubble('manual-size-value',     $('manual-size')?.value || '0', '');

  // Submit
  $('open-trade')?.addEventListener('click', async () => {
    const raw = $('manual-symbol')?.value?.trim().toUpperCase();
    const contract = toKuCoinContractSymbol(raw);
    const quantityUsd = Number($('manual-size')?.value);
    const leverage    = Math.max(1, parseInt($('manual-leverage')?.value || '1', 10));
    const tpPercent   = parseInt($('manual-tp')?.value || '35', 10);
    const slPercent   = parseInt($('manual-sl')?.value || '20', 10);

    if (!contract || !(quantityUsd > 0)) {
      showTradeOverlay('❌ Please enter a valid symbol and quantity (USDT).');
      return;
    }

    try {
      showTradeOverlay(`⏳ Submitting ${manualDirection} ${contract}…`);
      const res = await fetch('/api/place-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: contract,
          contract,
          side: manualDirection,
          leverage,
          tpPercent,
          slPercent,
          manual: true,
          notionalUsd: quantityUsd          // 🔑 Quantity in USDT
        })
      });
      const json = await res.json();
      const ok = json?.success || json?.result?.success || json?.code === 'SUCCESS' || json?.code === 'SUCCESS_WITH_WARNING';
      showTradeOverlay(ok ? `✅ Trade submitted for ${contract}` : `❌ Trade error: ${json?.error || json?.result?.error || 'Unknown'}`, !!ok);
    } catch (err) {
      console.error(err);
      showTradeOverlay('❌ Failed to send trade request.');
    }
  });

  triggerLivePreview();
}

/* ---------------- LIVE PREVIEW ----------------
 * Input: Quantity (USDT) → backend calculates contracts & margin
 * Output: show backend *exact* price & cost (margin)
 */
let previewTimer = null;
async function triggerLivePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(_doPreview, 120);
}

async function _doPreview() {
  const inputEl  = document.getElementById('manual-symbol');
  const priceEl  = document.getElementById('manual-price-preview');
  const valueEl  = document.getElementById('manual-value-preview');

  const typed = inputEl?.value?.trim().toUpperCase() || '';
  if (!typed) { if (priceEl) priceEl.textContent=' --'; if (valueEl) valueEl.textContent=' --'; return; }

  // You can type “ADA” or “ADA-USDTM” — both are fine:
  const contract    = toKuCoinContractSymbol(typed); // e.g., ADA → ADA-USDTM
  const quantityUsd = Number(document.getElementById('manual-size')?.value || 0);
  const leverage    = Math.max(1, parseInt(document.getElementById('manual-leverage')?.value || '1', 10));

  if (!(quantityUsd > 0)) { if (priceEl) priceEl.textContent=' --'; if (valueEl) valueEl.textContent=' --'; return; }

  // Helper to paint UI
  const paint = (price, cost) => {
    if (priceEl) priceEl.textContent = Number.isFinite(price) ? ` ${price.toFixed(6)}` : ' --';
    if (valueEl) valueEl.textContent = Number.isFinite(cost)  ? ` ${cost.toFixed(2)} USDT` : ' --';
  };

  // 1) Try your backend preview (best source of truth)
  try {
    const res = await fetch('/api/preview-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: contract,
        contract,
        notionalUsd: quantityUsd,
        leverage
      })
    });

    const text = await res.text();
    let j = {};
    try { j = JSON.parse(text); } catch {}

    // Dev aid
    console.debug('[manual preview] status=', res.status, 'body=', j || text);

    // Accept multiple shapes
    const p = j?.price ?? j?.preview?.price ?? j?.markPrice ?? null;
    const c = j?.costUsd ?? j?.marginUsd ?? j?.preview?.costUsd ?? j?.margin ?? null;

    if (Number.isFinite(p) && Number.isFinite(c)) {
      paint(p, c);
      return;
    }
    // fall through to TA if preview didn’t give what we need
  } catch (e) {
    console.warn('[manual preview] /api/preview-order failed:', e?.message || e);
  }

  // 2) Fallback: get price from TA …
  try {
    const base = contract.replace(/-USDTM$/,'');
    const taRes = await fetch(`/api/ta/${encodeURIComponent(base)}-USDT`);
    const ta = taRes.ok ? await taRes.json() : null;
    const price = Number(ta?.price ?? ta?.markPrice);

    // … and compute cost (margin) with exchange‑style approximation:
    //   margin ≈ notional / leverage   (this matches typical futures)
    const cost = quantityUsd / leverage;

    paint(price, cost);
  } catch (e) {
    console.warn('[manual preview] TA fallback failed:', e?.message || e);
    paint(NaN, NaN);
  }
}
// Optional dev helpers
window.triggerManualPreview = triggerLivePreview;
window.setManualDirection = (d) => { manualDirection = (String(d).toUpperCase() === 'SELL' ? 'SELL' : 'BUY'); };