// === scannerPanel.js — Fully patched for Auto Status UI ===

import { setBotActive, isBotActive, startPoseidonAutonomousLoop, stopPoseidonAutonomousLoop } from './poseidonBotModule.js';
import { logSignalToFeed, logDetailedAnalysisFeed } from './liveFeedRenderer.js';
import { renderAutoStatus } from './autoStatusModule.js';  // ✅ PATCHED

function formatVolume(volume) {
  const n = Number(volume);
  if (isNaN(n)) return '0.00';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

function formatPrice(value) {
  const n = Number(value);
  return isNaN(n) ? '0.000000' : n.toFixed(6);
}

function formatChange(value) {
  const n = Number(value);
  return isNaN(n) ? '0.00' : n.toFixed(2);
}

function normalizeSymbol(symbol = '') {
  return symbol.replace(/[-_]/g, '').toUpperCase();
}

async function renderScanner(page = 1) {
  const ITEMS_PER_PAGE = 10;

  try {
    const res = await fetch('/api/scan-tokens');
    const data = await res.json();
    const tokens = data.top50 || [];

    const container = document.getElementById('scanner-panel');
    if (!container) {
      console.warn('[ScannerPanel] Top 50 container not found.');
      return;
    }

    const totalPages = Math.ceil(tokens.length / ITEMS_PER_PAGE);
    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const currentPageTokens = tokens.slice(start, end);

    container.innerHTML = `
      <h3 class="scanner-title">📊 Poseidon Top 50</h3>
      <div class="scanner-scroll-wrapper">
        <table class="scanner-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Price</th>
              <th>% Change</th>
              <th>Volume</th>
            </tr>
          </thead>
          <tbody id="scanner-table-body"></tbody>
        </table>
      </div>
      <div class="scanner-pagination">
        ${Array.from({ length: totalPages }, (_, i) =>
          `<button class="scanner-page-btn ${i + 1 === page ? 'active' : ''}" data-page="${i + 1}">${i + 1}</button>`
        ).join('')}
      </div>
    `;

    const tbody = container.querySelector('#scanner-table-body');

    currentPageTokens.forEach(token => {
      const symbol = token.symbol || '';
      const normSymbol = symbol.toUpperCase(); // Don't strip dashes
      const price = formatPrice(token.price);
      const change = formatChange(token.priceChgPct);
      const volume = formatVolume(token.quoteVolume || token.volume || 0);
      const changeValue = Number(token.priceChgPct);

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${normSymbol}</td>
        <td>$${price}</td>
        <td class="${changeValue >= 0 ? 'change-positive' : 'change-negative'}">${change}%</td>
        <td>${volume}</td>
      `;
      tbody.appendChild(row);

      if (token.confidence >= 35) {
        logSignalToFeed({
          symbol: normSymbol,
          confidence: token.confidence,
          signal: token.signal || 'neutral',
          delta: `${change}%`,
          volume,
          price
        });

        logDetailedAnalysisFeed({
          symbol: normSymbol,
          signal: token.signal || 'neutral',
          confidence: token.confidence,
          rsi: token.rsi || '-',
          macd: token.macd || '-',
          bb: token.bb || '-',
          price,
          notes: token.notes || '',
          volume
        });
      }
    });

    container.querySelectorAll('.scanner-page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pageNum = parseInt(btn.dataset.page, 10);
        renderScanner(pageNum);
      });
    });
  } catch (err) {
    console.error('Scanner fetch failed:', err);
  }
}

function setupPoseidonBotToggle() {
  const botPanel = document.getElementById('poseidon-bot');
  if (!botPanel) {
    console.warn('[ScannerPanel] Poseidon bot panel not found.');
    return;
  }

  botPanel.addEventListener('click', async () => {
    const current = isBotActive();
    setBotActive(!current);

    if (!current) {
      startPoseidonAutonomousLoop();
    } else {
      stopPoseidonAutonomousLoop();
    }

    await renderAutoStatus(); // ✅ PATCHED: live UI update
  });

  renderAutoStatus(); // ✅ Show correct status on load
}

function waitForDOMAndInit() {
  setupPoseidonBotToggle();
  renderScanner();
  setInterval(renderScanner, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  waitForDOMAndInit();
});