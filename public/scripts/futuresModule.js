// === /public/scripts/futuresModule.js ===
// Patch notes (2025-08-11):
// 1) Close button handler: send only { contract } and remove undefined `symbol` usage.
// 2) Learning memory update: loop over resultSet and call updateMemoryFromResult per item.
// 3) Session stats: render on boot and on the 12s refresh loop.

import { renderSessionStats } from './sessionStatsClient.js';
import { initManualTradeControls } from './manualTradeControls.js';
import { renderMemoryPanel, updateMemoryFromResult } from './learningMemory.js';
import { getWalletBalance, getOpenPositions } from './futuresApiClient.js';
import { startScanner, getActiveSymbols } from './poseidonScanner.js';
import { analyzeAndTrigger, startSignalEngine } from './futuresSignalModule.js';
import { renderCapitalScore } from './capitalScoreModule.js';
import { renderAutoStatus } from './autoStatusModule.js';

// ❌ remove legacy sessionStatsModule import & calls
// import { initSessionStats, setActiveSymbols, setTrackedWallets, setActiveTrades } from './sessionStatsModule.js';

// ❌ remove these legacy arrays & setters (no longer used)
// const actualSymbolsArray = [];
// const walletArray = [];
// const tradeArray = [];
// setActiveSymbols(actualSymbolsArray);
// setTrackedWallets(walletArray);
// setActiveTrades(tradeArray);
// initSessionStats();

// (optional) If formatVolume isn't used anywhere, you can delete it.

async function loadWalletAndPositions() {
  try {
    const balance = await getWalletBalance();
    const balanceEl = document.getElementById('wallet-balance');
    if (balanceEl) {
      balanceEl.textContent = !balance || isNaN(balance)
        ? '⚠️ Error'
        : `$${balance.toFixed(2)}`;
    }

    renderCapitalScore(balance);

    const posTable = document.getElementById('open-positions-body');
    if (!posTable) return;

    posTable.innerHTML = '';
    const positions = await getOpenPositions();

    setActiveTrades(positions);

    positions.forEach(pos => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${pos.symbol}</td>
        <td>${pos.side}</td>
        <td>${pos.entryPrice}</td>
        <td>${pos.size}</td>
        <td>${pos.value}</td>
        <td>${pos.margin}</td>
        <td>${pos.pnl}</td>
        <td>${pos.roi}</td>
        <td>${pos.leverage}</td>
        <td>${pos.liquidationPrice || '--'}</td>
        <td><button class="close-btn" data-symbol="${pos.symbol}">Close</button></td>
        <td>${pos.notes || ''}</td>
        <td>${pos.age || '--'}</td>
      `;
      posTable.appendChild(row);
    });

    // 🔧 PATCH: Close handler sends only { contract } and avoids undefined `symbol`
    document.querySelectorAll('.close-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        const rawSymbol = e.target.dataset.symbol; // e.g., "ADAUSDT" or "ADA-USDTM"
        const contract = /-USDTM$/i.test(rawSymbol)
          ? rawSymbol
          : `${rawSymbol.replace(/USDT$/i, '')}-USDTM`;

        try {
          const res = await fetch('/api/close-trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // ✅ send only contract; backend infers side from live position
            body: JSON.stringify({ contract })
          });

          const result = await res.json();
          const ok = result?.success || result?.result?.success;

          if (ok) {
            alert(`${contract.toUpperCase()} closed ✅`);
          } else {
            const err = result?.error || result?.result?.error || 'Unknown error';
            alert(`❌ Failed to close ${contract.toUpperCase()}: ${err}`);
          }
        } catch (err) {
          alert(`❌ Close error for ${contract.toUpperCase()}: ${err.message}`);
        } finally {
          await loadWalletAndPositions(); // resync UI either way
          renderSessionStats().catch(() => {});
        }
      });
    });

  } catch (err) {
    console.warn('⚠️ Wallet or position error:', err.message);
  }
}

async function autoFillManualTradeSymbols() {
  const datalist = document.getElementById('symbol-options');
  const input = document.getElementById('manual-symbol');
  if (!datalist || !input) return;

  try {
    const res = await fetch('/api/scan-tokens');
    const data = await res.json();
    const all = [...(data.gainers || []), ...(data.losers || [])];

    datalist.innerHTML = '';

    all.forEach(token => {
      const fullSymbol = token.symbol || token;
      const display = fullSymbol.replace(/[-_/]?USDTM?$/i, '').toUpperCase();

      const option = document.createElement('option');
      option.value = display;
      option.dataset.symbol = fullSymbol;
      datalist.appendChild(option);
    });

    console.log(`✅ Auto-fill loaded ${datalist.children.length} symbols`);
  } catch (err) {
    console.warn('❌ Auto-fill failed:', err.message);
  }
}

async function initManualTradeEntry() {
  const tradeBtn = document.getElementById('open-trade');
  if (!tradeBtn) return;

  tradeBtn.addEventListener('click', async () => {
    const input = document.getElementById('manual-symbol');
    const datalist = document.getElementById('symbol-options');
    const entered = input?.value.trim().toUpperCase();

    let symbol = null;
    const match = Array.from(datalist.options).find(opt =>
      opt.value.toUpperCase() === entered && opt.dataset.symbol
    );

    if (match) {
      symbol = match.dataset.symbol;
    } else {
      symbol = entered.endsWith('M') ? entered : `${entered}M`;
    }

    const side = window.manualDirection;
    const size = parseFloat(document.getElementById('manual-size')?.value);
    const tp = parseInt(document.getElementById('manual-tp')?.value);
    const sl = parseInt(document.getElementById('manual-sl')?.value);
    const leverage = parseInt(document.getElementById('manual-leverage')?.value);

    if (!symbol || isNaN(size)) return alert('Invalid symbol or size');

    await fetch('/api/place-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        side,
        size,
        tpPercent: tp,
        slPercent: sl,
        leverage,
        manual: true
      })
    });

    await loadWalletAndPositions();
    renderSessionStats().catch(() => {});
  });
}

async function initPoseidon() {
  const tooltip = document.getElementById('manual-preview-tooltip');
  if (tooltip) tooltip.textContent = 'Loading symbols...';

  await autoFillManualTradeSymbols();
  await initManualTradeControls();
  await initManualTradeEntry();
  await loadWalletAndPositions();
  await renderSessionStats(); // ✅ first render

  startScanner();

  // Allow scanner to warm up
  await new Promise(resolve => setTimeout(resolve, 120000));

  // const active = getActiveSymbols();
  // setActiveSymbols(active);

  const resultSet = [];
  for (const s of active) {
    try {
      const res = await analyzeAndTrigger(s.symbol || s);
      if (res) resultSet.push({ symbol: s.symbol || s, ...res });
    } catch (err) {
      console.warn(`[initPoseidon] Error for ${s.symbol || s}:`, err.message);
    }
  }

  setInterval(() => {
    loadWalletAndPositions();
    renderAutoStatus();
    renderSessionStats().catch(() => {}); // ✅ keep fresh
  }, 12000);

  // 🔧 PATCH: update memory per-item instead of passing an array
  for (const r of resultSet) {
    await updateMemoryFromResult(r.symbol, r);
  }
  renderMemoryPanel();

  if (tooltip) tooltip.textContent = 'Symbols loaded ✅';

  setTimeout(() => {
    const final = getActiveSymbols();
    if (final.length > 0) startSignalEngine();
    else console.warn('⚠️ No active tokens found');
  }, 35000);

  renderAutoStatus();
}

renderCapitalScore();
setInterval(renderCapitalScore, 15000);

document.addEventListener('DOMContentLoaded', initPoseidon);
window.initPoseidon = initPoseidon;
window.analyzeAndTrigger = analyzeAndTrigger;
window.getOpenPositions = getOpenPositions;