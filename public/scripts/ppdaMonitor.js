// ppdaMonitor.js — Live PPDA Trade Monitor Panel

import { getPPDAStats } from './ppdaEngine.js';

export function initPPDAMonitor() {
  renderPPDAMonitor();
  setInterval(renderPPDAMonitor, 60 * 1000); // Refresh every 60s
}

function renderPPDAMonitor() {
  const panel = document.getElementById("ppda-monitor-panel");
  if (!panel) return;

  const stats = getPPDAStats();
  const entries = Object.entries(stats);

  if (!entries.length) {
    panel.innerHTML = `<div class="empty">No active PPDA trades yet.</div>`;
    return;
  }

  let html = `<table class="ppda-table">
    <thead>
      <tr>
        <th>Symbol</th>
        <th>Attempts</th>
        <th>Wins</th>
        <th>Fails</th>
        <th>Last ROI</th>
        <th>Last Time</th>
      </tr>
    </thead>
    <tbody>`;

  for (const [symbol, s] of entries) {
    html += `
      <tr>
        <td>${symbol}</td>
        <td>${s.attempts || 0}</td>
        <td>${s.success || 0}</td>
        <td>${s.fail || 0}</td>
        <td>${(s.recoveredROI?.slice(-1)[0] || '0.00')}%</td>
        <td>${s.lastResolutionTime || '--'}</td>
      </tr>`;
  }

  html += `</tbody></table>`;
  panel.innerHTML = html;
}