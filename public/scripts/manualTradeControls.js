/**
 * File #04: public/scripts/manualTradeControls.js
 * Description:
 *   KuCoin-style manual control with robust, low-latency preview:
 *   - Debounced calls
 *   - Abort in-flight request when a new one starts
 *   - Duplicate-payload suppression
 *   - Strict symbol guard (prevents /api/ta/X-USDT)
 *   - Datalist shows CONTRACTS; user can still type base
 * Last Updated: 2025-08-29
 */

import { toKuCoinContractSymbol } from './futuresApiClient.js';

let manualDirection = 'BUY';
const $ = (id) => document.getElementById(id);

// ------- Spinner Feedback -------
function setBusy(on) {
  const tip = $('manual-preview-tooltip');
  if (!tip) return;
  tip.style.opacity = on ? '1' : '0';
  tip.textContent = on ? 'Live preview…' : 'Ready';
}

// ------- Datalist (Contract Suggestions) -------
async function populateDatalist() {
  const datalist = $('symbol-options');
  if (!datalist) return;
  const bases = new Set();

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
    opt.value = `${base}-USDTM`;
    frag.appendChild(opt);
  });
  datalist.innerHTML = '';
  datalist.appendChild(frag);
}

// ------- INIT -------
export async function initManualTradeControls() {
  if (window.__POSEIDON_MANUAL_INITED__) return;
  window.__POSEIDON_MANUAL_INITED__ = true;

  await populateDatalist();

  const longBtn = $('manual-long');
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

  const setBubble = (id, val, suffix = '') => {
    const el = $(id);
    if (el) el.textContent = ` ${val}${suffix}`;
  };

  $('manual-size')?.addEventListener('input', () => {
    setBubble('manual-size-value', $('manual-size').value);
    triggerLivePreview();
  });

  $('manual-leverage')?.addEventListener('input', () => {
    setBubble('manual-leverage-value', $('manual-leverage').value, 'x');
    triggerLivePreview();
  });

  $('manual-tp')?.addEventListener('input', (e) => setBubble('manual-tp-value', e.target.value, '%'));
  $('manual-sl')?.addEventListener('input', (e) => setBubble('manual-sl-value', e.target.value, '%'));
  $('manual-symbol')?.addEventListener('input', triggerLivePreview);

  setBubble('manual-leverage-value', $('manual-leverage')?.value || '5', 'x');
  setBubble('manual-size-value',     $('manual-size')?.value || '0');

  $('open-trade')?.addEventListener('click', onSubmitTrade);
  triggerLivePreview();
}

// ------- Submit Trade -------
async function onSubmitTrade() {
  const raw = $('manual-symbol')?.value?.trim().toUpperCase() || '';
  const contract = toKuCoinContractSymbol(raw);
  const quantityUsd = Number($('manual-size')?.value);
  const leverage = Math.max(1, parseInt($('manual-leverage')?.value || '1', 10));
  const tpPercent = parseInt($('manual-tp')?.value || '35', 10);
  const slPercent = parseInt($('manual-sl')?.value || '20', 10);

  if (!contract || !(quantityUsd > 0)) {
    overlay('❌ Please enter a valid symbol and quantity (USDT).');
    return;
  }

  try {
    overlay(`⏳ Submitting ${manualDirection} ${contract}…`);
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
        notionalUsd: quantityUsd
      })
    });
    const j = await safeJson(res);
    const ok = j?.success || j?.result?.success || j?.code === 'SUCCESS' || j?.code === 'SUCCESS_WITH_WARNING';
    overlay(ok ? `✅ Trade submitted for ${contract}` : `❌ Trade error: ${j?.error || 'Unknown'}`, ok);
  } catch (err) {
    console.error(err);
    overlay('❌ Failed to send trade request.');
  }
}

// ------- Overlay Toast -------
function overlay(message, success = false) {
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
  setTimeout(() => (el.style.display = 'none'), 3000);
}

// ------- LIVE PREVIEW -------
let previewTimer = null;
let inflightController = null;
let lastKey = '';

function triggerLivePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 250);
}

function getPreviewPayload() {
  const inputEl = $('manual-symbol');
  const typed = inputEl?.value?.trim().toUpperCase() || '';
  const contract = toKuCoinContractSymbol(typed);
  if (!contract || !/^[A-Z]{2,20}-USDTM$/.test(contract)) return null;

  const notionalUsd = Number($('manual-size')?.value || 0);
  const leverage = Math.max(1, parseInt($('manual-leverage')?.value || '1', 10));
  if (!(notionalUsd > 0)) return null;

  return { contract, symbol: contract, notionalUsd, leverage };
}

async function runPreview() {
  const payload = getPreviewPayload();
  const priceEl = $('manual-price-preview');
  const valueEl = $('manual-value-preview');
  const paint = (price, cost) => {
    if (priceEl) priceEl.textContent = Number.isFinite(price) ? ` ${price.toFixed(6)}` : ' --';
    if (valueEl) valueEl.textContent = Number.isFinite(cost)  ? ` ${cost.toFixed(2)} USDT` : ' --';
  };

  if (!payload) { paint(NaN, NaN); setBusy(false); return; }

  const key = JSON.stringify(payload);
  if (key === lastKey) return;
  lastKey = key;

  if (inflightController) inflightController.abort();
  inflightController = new AbortController();

  setBusy(true);
  try {
    const r = await fetch('/api/preview-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: inflightController.signal
    });

    const j = await safeJson(r);
    if (!r.ok) { paint(NaN, NaN); return; }

    const price = toNum(j?.price ?? j?.preview?.price ?? j?.markPrice);
    const cost = toNum(j?.cost ?? j?.preview?.cost);

    if (Number.isFinite(price) && Number.isFinite(cost)) {
      paint(price, cost);
      return;
    }

    // fallback TA
    const base = payload.contract.replace(/-USDTM$/,'');
    const taRes = await fetch(`/api/ta/${base}-USDT`, { signal: inflightController.signal });
    const ta = await safeJson(taRes);
    const p = toNum(ta?.price ?? ta?.markPrice);
    const c = payload.notionalUsd / payload.leverage;
    paint(p, c);
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.warn('[manual preview] error:', err?.message || err);
      paint(NaN, NaN);
    }
  } finally {
    setBusy(false);
  }
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

async function safeJson(r) {
  try { return await r.clone().json(); } catch { try { return JSON.parse(await r.text()); } catch { return null; } }
}