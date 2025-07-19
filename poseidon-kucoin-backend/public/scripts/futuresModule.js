import { initBot } from './poseidonBotModule.js';
import { loadOpenPositions } from './openPositions.js';
import { refreshSymbols, getActiveSymbols } from './poseidonScanner.js';
import { initSessionStats } from './sessionStatsModule.js';
import { getHotColdPairs, importLearningMemory, exportLearningMemory } from './updateMemoryFromResult.js';
import { initFuturesStats } from './futuresStatsModule.js';
import { initStrategyStats } from './strategyStatsModule.js';
import { initPPDAMonitor } from './ppdaMonitor.js';
import { startSignalEngine } from './futuresSignalModule.js'; // ✅ New import


const socket = window.io ? window.io() : null;
let lastPnlValue = null;
let tooltip;

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
  pnlSpan.classList.remove('pulse-green', 'pulse-red');
  void pnlSpan.offsetWidth;
  pnlSpan.classList.add(num > 0 ? 'pulse-green' : 'pulse-red');
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
  if (!tooltip) return;
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
  if (tooltip) tooltip.style.display = 'none';
}

export function setFuturesConnectionStatus(status) {
  const statusDot = document.getElementById("futures-connection-dot");
  if (statusDot) statusDot.textContent = status === "connected" ? "🟢 Connected" : "🔴 Disconnected";
  const summaryStatus = document.getElementById("futures-connection");
  if (summaryStatus) summaryStatus.textContent = status === "connected" ? "Connected" : "Disconnected";
  const bot = document.getElementById("poseidon-bot");
  if (bot) {
    if (status === "connected") bot.classList.add("active");
    else bot.classList.remove("active");
  }
}

function renderLearningMemoryPanel() {
  const el = document.getElementById("learning-memory-content");
  if (!el) return;
  const pairs = getHotColdPairs();
  if (!pairs.length) {
    el.innerHTML = `<div class="log-entry">No memory data yet.</div>`;
    return;
  }
  const sorted = pairs.sort((a, b) => {
    const order = { hot: 0, cold: 1, neutral: 2 };
    return order[a.state] - order[b.state] || b.winrate - a.winrate;
  });

  let html = `<table class="memory-table" style="width:100%">`;
  html += `<tr><th>Symbol</th><th>Side</th><th>Winrate</th><th>Streak</th><th>State</th></tr>`;
  sorted.slice(0, 6).forEach(pair => {
    const color = pair.state === "hot" ? "#00ff7f" : pair.state === "cold" ? "#ff3860" : "#a0bbd6";
    html += `<tr style="color:${color};font-weight:600;">
      <td>${pair.symbol}</td>
      <td>${pair.side}</td>
      <td>${(pair.winrate * 100).toFixed(1)}%</td>
      <td>${pair.streak}</td>
      <td>${pair.state.toUpperCase()}</td>
    </tr>`;
  });
  html += `</table>`;
  el.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", () => {
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
  tooltip = document.getElementById("manual-preview-tooltip");

  ['size', 'leverage', 'tp', 'sl'].forEach(type => {
    const input = elements[`${type}Input`] || document.getElementById(`manual-${type}`);
    const valueSpan = elements[`${type}Value`] || document.getElementById(`manual-${type}-value`);
    if (input && valueSpan) {
      input.addEventListener("input", () => {
        valueSpan.textContent = type === "leverage" ? `${input.value}x` : `${input.value}${type === "tp" || type === "sl" ? '%' : ''}`;
      });
      valueSpan.textContent = type === "leverage" ? `${input.value}x` : `${input.value}${type === "tp" || type === "sl" ? '%' : ''}`;
    }
  });

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
    if (!symbol || !currentSide || isNaN(size) || isNaN(leverage)) {
      alert("Please fill all fields correctly.");
      return;
    }

    try {
      const res = await fetch(`/api/confirm-recovery?symbol=${symbol}`);
      const json = await res.json();
      if (!json || !json.ok) {
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
      const res = await fetch("/api/wallet");
      const data = await res.json();
      if (!data?.success || !data.balance) throw new Error("Invalid data");
      elements.walletTotal.textContent = parseFloat(data.balance.total).toFixed(2);
      elements.walletAvailable.textContent = parseFloat(data.balance.available).toFixed(2);
    } catch {
      elements.walletTotal.textContent = "N/A";
      elements.walletAvailable.textContent = "N/A";
    }
  }

  async function loadSymbolSuggestions() {
    try {
      const res = await fetch("/api/futures-symbols");
      const { symbols } = await res.json();
      if (!symbols || !elements.symbolList) return;
      elements.symbolList.innerHTML = "";
      symbols.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s;
        elements.symbolList.appendChild(opt);
      });
      if (!elements.symbolInput.value && symbols.length > 0) {
        elements.symbolInput.value = symbols[0];
      }
    } catch (err) {
      console.error("❌ Failed to load symbols:", err.message);
    }
  }

  ['manual-size', 'manual-leverage', 'manual-tp', 'manual-sl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("mousemove", updatePreviewTooltip);
      el.addEventListener("mouseleave", hidePreviewTooltip);
    }
  });

  document.querySelectorAll(".collapse-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const panel = btn.closest(".collapsible-panel");
      panel.classList.toggle("collapsed");
      btn.textContent = panel.classList.contains("collapsed") ? "+" : "−";
    });
  });

  function showPendingTrade({ contract, side, size, leverage, tpPercent, slPercent }) {
    const feed = document.getElementById("live-feed-body");
    const row = `<tr><td colspan='8'>⏳ Pending ${contract} (${side.toUpperCase()}) - ${size} (Lev: ${leverage}x, TP: ${tpPercent}%, SL: ${slPercent}%)</td></tr>`;
    if (feed) feed.innerHTML = row + feed.innerHTML;
  }

  loadPersistedMemory();
  initBot();
  loadSymbolSuggestions();
  refreshWalletBalance();
  loadOpenPositions();
  refreshSymbols();
  initSessionStats();
  initFuturesStats();
  initStrategyStats();
  renderLearningMemoryPanel();
  initPPDAMonitor();
  startSignalEngine(); // ✅ ADDED

  setInterval(refreshWalletBalance, 60000);
  setInterval(loadOpenPositions, 1000);
  setInterval(loadSymbolSuggestions, 120000);
  setInterval(renderLearningMemoryPanel, 20000);

  if (socket) {
    socket.on("trade-confirmed", loadOpenPositions);
    socket.on("trade-closed", () => {
      loadOpenPositions();
    });
  }

  window.__POSEIDON_DEBUG = {
    pairs: getHotColdPairs,
    mem: importLearningMemory,
    exp: exportLearningMemory
  };
});

let gainersList = [];
let losersList = [];

function renderScanningList(type = 'gainers') {
  const scanningList = document.getElementById('scanning-list');
  scanningList.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'log-entry';
  header.innerHTML = type === 'gainers'
    ? '📈 <strong>Top Gainers:</strong>'
    : '📉 <strong>Top Losers:</strong>';
  scanningList.appendChild(header);

  const list = type === 'gainers' ? gainersList : losersList;

  list.forEach(item => {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.style.color = type === 'gainers' ? '#00ff99' : '#ff4466';
    entry.innerHTML = `<strong>${item.symbol}</strong> — ${item.price} USDT <span style="margin-left: 6px;">(${item.changePercent > 0 ? '+' : ''}${item.changePercent.toFixed(2)}%)</span>`;
    scanningList.appendChild(entry);
  });
}

function setupScannerToggle() {
  const gainersBtn = document.getElementById('toggle-gainers');
  const losersBtn = document.getElementById('toggle-losers');

  gainersBtn.addEventListener('click', () => {
    gainersBtn.classList.add('active-tab');
    losersBtn.classList.remove('active-tab');
    renderScanningList('gainers');
  });

  losersBtn.addEventListener('click', () => {
    losersBtn.classList.add('active-tab');
    gainersBtn.classList.remove('active-tab');
    renderScanningList('losers');
  });
}

// Fetch and initialize scanner panel
fetch('/api/scan-tokens')
  .then(res => res.json())
  .then(data => {
    gainersList = data.topGainers || [];
    losersList = data.topLosers || [];
    setupScannerToggle();
    renderScanningList('gainers');
  })
  .catch(err => {
    console.error('Failed to load scan-tokens:', err);
  });