/**
 * File #04: public/scripts/manualTradeControls.js
 * Description:
 *   KuCoin-style manual control:
 *   - User inputs Quantity (USDT) and Leverage
 *   - Preview asks backend for contracts & cost (margin)
 *   - Submit sends only notionalUsd (Quantity) and leverage
 *   - Frontend displays the exact cost from backend (after lot/min/multiplier rounding)
 * Last Updated: 2025-08-10
 */

import { toKuCoinContractSymbol } from './futuresApiClient.js';

let manualDirection = 'BUY';

function showTradeOverlay(message, success = false) {
  let overlay = document.getElementById('trade-processing-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'trade-processing-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '20px';
    overlay.style.right = '20px';
    overlay.style.padding = '12px 20px';
    overlay.style.backgroundColor = success ? '#1e8c36' : '#222';
    overlay.style.color = '#fff';
    overlay.style.borderRadius = '6px';
    overlay.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
    overlay.style.fontSize = '16px';
    overlay.style.zIndex = 9999;
    document.body.appendChild(overlay);
  }
  overlay.textContent = message;
  overlay.style.backgroundColor = success ? '#1e8c36' : '#222';
  overlay.style.display = 'block';
  setTimeout(() => (overlay.style.display = 'none'), 4000);
}

function fmt(n, d = 2) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : '--';
}

// --- Datalist (simple + safe) ---
async function populateDatalist() {
  const datalist = document.getElementById('symbol-options');
  if (!datalist) return;
  const opts = [];

  // primary: scanner
  try {
    const r = await fetch('/api/scan-tokens');
    const j = await r.json();
    const rows = Array.isArray(j?.top50) ? j.top50 : [];
    for (const t of rows) {
      const sym = toKuCoinContractSymbol(t?.symbol || t);
      if (sym) opts.push(sym);
    }
  } catch {}

  // fallback: positions
  if (opts.length === 0) {
    try {
      const r = await fetch('/api/positions');
      const j = await r.json();
      const rows = Array.isArray(j?.positions) ? j.positions : [];
      for (const p of rows) {
        const sym = toKuCoinContractSymbol(p?.symbol || p?.contract);
        if (sym) opts.push(sym);
      }
    } catch {}
  }

  // last resort
  if (opts.length === 0) {
    ['BTC', 'ETH', 'ADA', 'DOGE', 'SOL'].forEach(b => opts.push(toKuCoinContractSymbol(b)));
  }

  const uniq = [...new Set(opts.filter(Boolean))];
  const frag = document.createDocumentFragment();
  uniq.forEach(contract => {
    const opt = document.createElement('option');
    opt.value = contract;
    opt.dataset.symbol = contract;
    frag.appendChild(opt);
  });
  datalist.innerHTML = '';
  datalist.appendChild(frag);
  console.log(`✅ Datalist populated with ${uniq.length} symbols`);
}

// ===== INIT =====
export async function initManualTradeControls() {
  await populateDatalist();

  const longBtn      = document.getElementById('manual-long');
  const shortBtn     = document.getElementById('manual-short');
  const openTradeBtn = document.getElementById('open-trade');

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

  function setBubble(id, value, suffix = '') {
    const el = document.getElementById(id);
    if (el) el.textContent = ` ${value}${suffix}`;
  }

  // Quantity (USDT) slider/input
  document.getElementById('manual-size')?.addEventListener('input', () => {
    const q = document.getElementById('manual-size').value;
    setBubble('manual-size-value', q, ''); // This is Quantity (USDT)
    triggerLivePreview();
  });

  // Leverage input
  document.getElementById('manual-leverage')?.addEventListener('input', () => {
    const lev = document.getElementById('manual-leverage').value;
    setBubble('manual-leverage-value', lev, 'x');
    triggerLivePreview();
  });

  // TP/SL bubbles (cosmetic)
  document.getElementById('manual-tp')?.addEventListener('input', e =>
    setBubble('manual-tp-value', e.target.value, '%')
  );
  document.getElementById('manual-sl')?.addEventListener('input', e =>
    setBubble('manual-sl-value', e.target.value, '%')
  );

  // Symbol change
  document.getElementById('manual-symbol')?.addEventListener('input', triggerLivePreview);

  // Initial bubbles
  setBubble('manual-leverage-value', document.getElementById('manual-leverage')?.value || '5', 'x');
  setBubble('manual-size-value',     document.getElementById('manual-size')?.value || '0', '');

  // Submit — send ONLY notionalUsd (Quantity USDT). Backend computes size & cost.
  openTradeBtn?.addEventListener('click', async () => {
    const input = document.getElementById('manual-symbol');
    const raw = input?.value?.trim().toUpperCase();
    const symbol = toKuCoinContractSymbol(raw);

    const quantityUsd = Number(document.getElementById('manual-size')?.value);
    const leverage    = Math.max(1, parseInt(document.getElementById('manual-leverage')?.value || '1', 10));
    const tpPercent   = parseInt(document.getElementById('manual-tp')?.value || '35', 10);
    const slPercent   = parseInt(document.getElementById('manual-sl')?.value || '20', 10);

    if (!symbol || !(quantityUsd > 0)) {
      showTradeOverlay('❌ Please enter a valid symbol and quantity (USDT).');
      return;
    }

    try {
      showTradeOverlay(`⏳ Submitting ${manualDirection} ${symbol}…`);
      const res = await fetch('/api/place-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          side: manualDirection,
          leverage,
          tpPercent,
          slPercent,
          manual: true,
          // 🔑 KuCoin method: Quantity (USDT) only
          notionalUsd: quantityUsd
        })
      });
      const json = await res.json();
      const ok = json?.success || json?.result?.success || json?.code === 'SUCCESS' || json?.code === 'SUCCESS_WITH_WARNING';
      showTradeOverlay(ok ? `✅ Trade submitted for ${symbol}` : `❌ Trade error: ${json?.error || json?.result?.error || 'Unknown'}`, !!ok);
    } catch (err) {
      console.error(err);
      showTradeOverlay('❌ Failed to send trade request.');
    }
  });

  // First render
  triggerLivePreview();
}

// ===== LIVE PREVIEW (KuCoin-style) =====
// Input:  Quantity (USDT)  → Backend returns Contracts (rounded) + Cost (USDT)
// Shows:  Price + Cost (USDT) exactly as backend will use
async function triggerLivePreview() {
  const rawSymbol = document.getElementById('manual-symbol')?.value?.trim().toUpperCase() || '';
  if (!rawSymbol) return;

  const symbol = toKuCoinContractSymbol(rawSymbol);
  const quantityUsd = Number(document.getElementById('manual-size')?.value || 0);
  const leverage    = Math.max(1, parseInt(document.getElementById('manual-leverage')?.value || '1', 10));

  const priceEl = document.getElementById('manual-price-preview');
  const valueEl = document.getElementById('manual-value-preview'); // We will show Cost (USDT) here

  if (!(quantityUsd > 0)) {
    if (priceEl) priceEl.textContent = ' --';
    if (valueEl) valueEl.textContent = ' --';
    return;
  }

  try {
    // Ask backend preview to ensure rounding & multiplier match execution
    const res = await fetch('/api/preview-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: rawSymbol,            // backend normalizes to futures contract
        notionalUsd: quantityUsd,     // Quantity (USDT)
        leverage
      })
    });
    const p = await res.json();
    if (!p?.ok) throw new Error(p?.error || 'Preview error');

    // Display exactly what backend will use
    if (priceEl) priceEl.textContent = ` ${fmt(p.price, 6)}`;
    const cost = Number(p.costUsd ?? p.marginUsd); // Cost (margin) after rounding
    if (valueEl) valueEl.textContent = ` ${fmt(cost, 2)} USDT`;
  } catch (err) {
    console.error('Preview error:', err?.message || err);
    if (priceEl) priceEl.textContent = ' --';
    if (valueEl) valueEl.textContent = ' --';
  }
}