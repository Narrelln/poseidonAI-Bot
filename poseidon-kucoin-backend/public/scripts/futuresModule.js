import { initBot } from './poseidonBotModule.js';
import { loadOpenPositions } from './openPositions.js';
import { refreshSymbols, getActiveSymbols } from './futuresSignalModule.js';
import { initSessionStats } from './sessionStatsModule.js';
import { getHotColdPairs, importLearningMemory, exportLearningMemory } from './updateMemoryFromResult.js';
import { initFuturesStats } from './futuresStatsModule.js';
import { initStrategyStats } from './strategyStatsModule.js';
import { updateScanningList } from './futuresSignalModule.js';

const socket = window.io ? window.io() : null;

async function loadPersistedMemory() {
  try {
    const res = await fetch('/api/memory');
    const json = await res.json();
    if (json && typeof json === "object") {
      importLearningMemory(json);
      console.log("✅ Poseidon Deep Learning memory loaded from backend.");
    }
  } catch (err) {
    console.error("❌ Failed to load backend memory:", err.message);
  }
}

function animateLivePnlChange(newValue) {
  const pnlSpan = document.getElementById('futures-live-pnl');
  if (!pnlSpan || newValue === lastPnlValue) return;

  const num = parseFloat(newValue);
  if (isNaN(num)) return;

  const isPositive = num > 0;
  pnlSpan.classList.remove('pulse-green', 'pulse-red');
  void pnlSpan.offsetWidth;
  pnlSpan.classList.add(isPositive ? 'pulse-green' : 'pulse-red');
  lastPnlValue = newValue;
}

export function updateLiveStats(data) {
  const livePnl = data?.livePnl;
  if (typeof livePnl !== 'undefined') {
    document.getElementById('futures-live-pnl').textContent = `${livePnl.toFixed(2)}%`;
    animateLivePnlChange(livePnl);
  }
}

function updatePreviewTooltip(e) {
  const size = parseFloat(document.getElementById('manual-size').value);
  const leverage = parseInt(document.getElementById('manual-leverage').value);
  const tp = parseInt(document.getElementById('manual-tp').value);
  const sl = parseInt(document.getElementById('manual-sl').value);
  const symbol = document.getElementById('manual-symbol').value.trim().toUpperCase();

  const estMargin = size / leverage;

  tooltip.innerHTML = `
    ${symbol || 'Symbol'}<br>
    Size: ${size.toFixed(2)}<br>
    Leverage: ${leverage}x<br>
    TP: ${tp}% | SL: ${sl}%<br>
    Margin: ~${estMargin.toFixed(2)} USDT
  `;

  tooltip.style.left = `${e.pageX + 12}px`;
  tooltip.style.top = `${e.pageY + 12}px`;
  tooltip.style.display = 'block';
}

function hidePreviewTooltip() {
  tooltip.style.display = 'none';
}

export function setFuturesConnectionStatus(status) {
  const statusDot = document.getElementById("futures-connection-dot");
  if (statusDot)
    statusDot.textContent = status === "connected" ? "🟢 Connected" : "🔴 Disconnected";

  const summaryStatus = document.getElementById("futures-connection");
  if (summaryStatus)
    summaryStatus.textContent = status === "connected" ? "Connected" : "Disconnected";

  const bot = document.getElementById("poseidon-bot");
  if (bot) {
    if (status === "connected") bot.classList.add("active");
    else bot.classList.remove("active");
  }
}

// export function updateScanningList(symbols = []) {
//   const listDiv = document.getElementById("scanning-list");
//   if (!listDiv) return;

//   if (!symbols.length) {
//     listDiv.innerHTML = '<div class="dimmed">No symbols being scanned...</div>';
//     return;
//   }

//   listDiv.innerHTML = symbols
//     .map(sym => `<div class="scanned-symbol">${sym}</div>`)
//     .join('');
// }

function renderLearningMemoryPanel() {
  const el = document.getElementById("learning-memory-content");
  if (!el) return;
  const pairs = getHotColdPairs();
  if (!pairs.length) {
    el.innerHTML = `<div class="log-entry">No memory data yet.</div>`;
    return;
  }
  const sorted = pairs.sort((a, b) => {
    const stateOrder = { hot: 0, cold: 1, neutral: 2 };
    return stateOrder[a.state] - stateOrder[b.state] || b.winrate - a.winrate;
  });

  let html = `<table class="memory-table" style="width:100%">`;
  html += `<tr><th>Symbol</th><th>Side</th><th>Winrate</th><th>Streak</th><th>State</th></tr>`;
  sorted.slice(0, 6).forEach(pair => {
    let color = pair.state === "hot" ? "#00ff7f" : (pair.state === "cold" ? "#ff3860" : "#a0bbd6");
    html += `<tr style="color:${color};font-weight:600;">
      <td>${pair.symbol}</td>
      <td>${pair.side}</td>
      <td>${(pair.winrate*100).toFixed(1)}%</td>
      <td>${pair.streak}</td>
      <td>${pair.state.toUpperCase()}</td>
    </tr>`;
  });
  html += "</table>";
  el.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 Poseidon Futures Module Loaded");

  const elements = {
    longBtn: document.getElementById("manual-long"),
    shortBtn: document.getElementById("manual-short"),
    openBtn: document.getElementById("open-trade"),
    tpSlider: document.getElementById("manual-tp"),
    slSlider: document.getElementById("manual-sl"),
    tpValue: document.getElementById("manual-tp-value"),
    slValue: document.getElementById("manual-sl-value"),
    symbolInput: document.getElementById("manual-symbol"),
    sizeInput: document.getElementById("manual-size"),
    sizeValue: document.getElementById("manual-size-value"),
    leverageInput: document.getElementById("manual-leverage"),
    leverageValue: document.getElementById("manual-leverage-value"),
    walletTotal: document.getElementById("wallet-total"),
    walletAvailable: document.getElementById("wallet-available"),
    symbolList: document.getElementById("symbol-list"),
  };

  let currentSide = null;
  const tooltip = document.getElementById('manual-preview-tooltip');

  elements.sizeInput?.addEventListener("input", () => {
    if (elements.sizeValue) elements.sizeValue.textContent = elements.sizeInput.value;
  });
  elements.leverageInput?.addEventListener("input", () => {
    if (elements.leverageValue) elements.leverageValue.textContent = elements.leverageInput.value + "x";
  });
  elements.tpSlider?.addEventListener("input", () => {
    if (elements.tpValue) elements.tpValue.textContent = elements.tpSlider.value + "%";
  });
  elements.slSlider?.addEventListener("input", () => {
    if (elements.slValue) elements.slValue.textContent = elements.slSlider.value + "%";
  });

  elements.sizeValue.textContent = elements.sizeInput?.value || '1';
  elements.leverageValue.textContent = elements.leverageInput?.value + "x" || '5x';
  elements.tpValue.textContent = elements.tpSlider?.value + "%" || '35%';
  elements.slValue.textContent = elements.slSlider?.value + "%" || '20%';

  elements.longBtn?.addEventListener("click", () => {
    currentSide = "buy";
    elements.longBtn.classList.add("active-direction");
    elements.shortBtn.classList.remove("active-direction");
  });

  elements.shortBtn?.addEventListener("click", () => {
    currentSide = "sell";
    elements.shortBtn.classList.add("active-direction");
    elements.longBtn.classList.remove("active-direction");
  });

  elements.openBtn?.addEventListener("click", async () => {
    const symbol = elements.symbolInput.value.trim().toUpperCase();
    const size = parseFloat(elements.sizeInput.value);
    const leverage = parseInt(elements.leverageInput.value);
    const tp = parseFloat(elements.tpSlider.value);
    const sl = parseFloat(elements.slSlider.value);
  
    if (!symbol || !currentSide || isNaN(size) || size <= 0 || isNaN(leverage) || leverage < 1) {
      alert("Please fill all fields correctly.");
      return;
    }
  
    // ✅ Confirm Bullish Recovery check before trade
    try {
      const confirmRes = await fetch(`/api/confirm-recovery?symbol=${symbol}`);
      const confirmJson = await confirmRes.json();
  
      if (!confirmJson || !confirmJson.ok) {
        alert(`❌ Recovery not confirmed for ${symbol}. Trade blocked.`);
        return;
      }
    } catch (err) {
      alert(`⚠️ Recovery check failed: ${err.message}`);
      return;
    }
  
    const payload = {
      contract: symbol,
      side: currentSide,
      tpPercent: isNaN(tp) ? 0 : tp,
      slPercent: isNaN(sl) ? 0 : sl,
      size,
      leverage,
      clientOid: `manual-${Date.now()}`
    };
 // ✅ Confirm Bullish Recovery Check (only for SHORT entries)
// if (currentSide === 'sell') {
//   try {
//     const confirmRes = await fetch(`/api/confirm-recovery?symbol=${symbol}`);
//     const confirmJson = await confirmRes.json();

//     if (!confirmJson || !confirmJson.ok) {
//       const proceed = confirm(`⚠️ Recovery not confirmed for ${symbol}. Proceed with SHORT anyway?`);
//       if (!proceed) return;
//     }
//   } catch (err) {
//     console.warn("⚠️ Recovery check failed:", err.message);
//     const proceed = confirm(`⚠️ Could not verify bullish recovery for ${symbol}. Proceed with SHORT anyway?`);
//     if (!proceed) return;
//   }
// }

    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
  
      if (data.success || data.status === "success" || data.code === "200000") {
        alert(`Trade placed: ${symbol} (${currentSide.toUpperCase()})`);
        loadOpenPositions();
        showPendingTrade(payload);
      } else {
        alert("Trade failed: " + (data.message || data.msg || data.error || "Unknown error"));
      }
    } catch (err) {
      alert("Trade error: " + err.message);
    }
  });
  async function refreshWalletBalance() {
    try {
      const res = await fetch("/api/balance");
      const data = await res.json();
      if (!data || !data.success || !data.balance) throw new Error("Wallet data invalid");

      const { total, available } = data.balance;
      elements.walletTotal.textContent = `${parseFloat(total).toFixed(2)}`;
      elements.walletAvailable.textContent = `${parseFloat(available).toFixed(2)}`;
    } catch (err) {
      console.error("Wallet fetch failed:", err.message);
      elements.walletTotal.textContent = "N/A";
      elements.walletAvailable.textContent = "N/A";
    }
  }

  function showPendingTrade({ contract, side, size, leverage, tpPercent, slPercent }) {
    const feed = document.getElementById('live-feed-body');
    const row = `<tr><td colspan='8'>⏳ Pending ${contract} (${side.toUpperCase()}) - ${size} (Lev: ${leverage}x, TP: ${tpPercent}%, SL: ${slPercent}%)</td></tr>`;
    if (feed) feed.innerHTML = row + feed.innerHTML;
  }

  async function loadSymbolSuggestions() {
    try {
      const res = await fetch("/api/futures-symbols");
      const { symbols } = await res.json();
      if (!symbols || !elements.symbolList) return;
      elements.symbolList.innerHTML = "";
      symbols.forEach(symbol => {
        const option = document.createElement("option");
        option.value = symbol;
        elements.symbolList.appendChild(option);
      });
      if (!elements.symbolInput.value && symbols.length > 0) {
        elements.symbolInput.value = symbols[0];
      }
    } catch (err) {
      console.error("❌ Failed to load symbol suggestions:", err.message);
    }
  }

  async function loadTradeHistory() {
    const tbody = document.getElementById('trade-history-body');
    try {
      const res = await fetch('/api/trade-history');
      const json = await res.json();
      const trades = Array.isArray(json) ? json : json.trades || [];

      tbody.innerHTML = '';

      if (trades.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="11">No trade history yet.</td>`;
        tbody.appendChild(row);
        return;
      }

      trades.forEach(trade => {
        let pnlValue = '-';
        let roi = '-';
        if (trade.entry && trade.exit && trade.status !== "OPEN") {
          const entry = parseFloat(trade.entry);
          const exit = parseFloat(trade.exit);
          const side = (trade.side || '').toLowerCase();
          const size = Number(trade.size) || 1;
          const leverage = Number(trade.leverage) || 5;
          let pnl = 0;

          if (side === "buy" || side === "long") {
            pnl = (exit - entry) * size;
          } else if (side === "sell" || side === "short") {
            pnl = (entry - exit) * size;
          }
          pnlValue = pnl.toFixed(2);
          roi = entry > 0
            ? (((pnl / (entry * size)) * leverage * 100).toFixed(2) + '%')
            : '-';
        }
        const pnlClass = !isNaN(parseFloat(pnlValue)) && parseFloat(pnlValue) > 0
          ? 'positive'
          : (parseFloat(pnlValue) < 0 ? 'negative' : '');
        const roiClass = roi.includes('-')
          ? 'neutral'
          : (parseFloat(roi) > 0 ? 'positive' : 'negative');

        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${trade.symbol || '-'}</td>
          <td>${trade.side || '-'}</td>
          <td>${trade.entry || '-'}</td>
          <td>${trade.exit || '-'}</td>
          <td>${trade.size || '-'}</td>
          <td>${trade.leverage || '-'}</td>
          <td class="${pnlClass}">${pnlValue}</td>
          <td class="${roiClass}">${roi}</td>
          <td>${trade.status || '-'}</td>
          <td>${trade.date || '-'}</td>
        `;
        tbody.appendChild(row);
      });
    } catch (err) {
      console.error('Failed to load trade history:', err);
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="11">⚠️ Error loading history</td>`;
      tbody.appendChild(row);
    }
  }

  ['manual-size', 'manual-leverage', 'manual-tp', 'manual-sl'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('mousemove', updatePreviewTooltip);
    el.addEventListener('mouseleave', hidePreviewTooltip);
  });

  const collapseButtons = document.querySelectorAll('.collapse-btn');
  collapseButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.collapsible-panel');
      if (panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
        btn.textContent = '−';
      } else {
        panel.classList.add('collapsed');
        btn.textContent = '+';
      }
    });
  });

  loadPersistedMemory();
  initBot();
  loadSymbolSuggestions();
  refreshWalletBalance();
  loadOpenPositions();
  loadTradeHistory();
  refreshSymbols();
  initSessionStats();
  initFuturesStats();
  initStrategyStats();
  renderLearningMemoryPanel();

  setInterval(refreshWalletBalance, 20000);
  setInterval(loadOpenPositions, 1000);
  setInterval(loadSymbolSuggestions, 120000);
  setInterval(renderLearningMemoryPanel, 20000);

  if (socket) {
    socket.on('trade-confirmed', loadTradeHistory);
    socket.on('trade-closed', () => {
      loadTradeHistory();
      loadOpenPositions(); // ✅ also refresh open positions on close
    });
  }

  window.__POSEIDON_DEBUG = {
    pairs: getHotColdPairs,
    mem: importLearningMemory,
    exp: exportLearningMemory
  }; // ✅ you added this closing brace ✔️

let lastPnlValue = null;
});