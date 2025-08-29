// memoryPanel.js — Display Poseidon's Symbol Strategy Memory

import { getPreferredDirection, printMemory } from './strategyMemory.js';

export function initMemoryPanel() {
  const panel = document.getElementById("memory-panel");
  if (!panel) return;

  const memory = JSON.parse(localStorage.getItem('strategyMemory') || '{}');

  panel.innerHTML = `<h3>🧠 Strategy Memory Viewer</h3>`;

  const table = document.createElement("table");
  table.innerHTML = `
    <tr>
      <th>Symbol</th>
      <th>Preferred</th>
      <th>LONG Wins</th>
      <th>SHORT Wins</th>
      <th>LONG Losses</th>
      <th>SHORT Losses</th>
    </tr>
  `;

  Object.keys(memory).forEach(symbol => {
    const data = memory[symbol];
    const preferred = getPreferredDirection(symbol) || '—';
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${symbol}</td>
      <td>${preferred}</td>
      <td>${data.wins.LONG}</td>
      <td>${data.wins.SHORT}</td>
      <td>${data.losses.LONG}</td>
      <td>${data.losses.SHORT}</td>
    `;
    table.appendChild(row);
  });

  panel.appendChild(table);
}
// updated //

export async function renderMemoryPanel() {
  const panel = document.getElementById('learning-memory-panel');
  if (!panel) return;

  panel.innerHTML = '<div>Loading memory...</div>';

  try {
    const res = await window.axios.get('/api/memory');
    const memory = res.data || {};

    panel.innerHTML = '';

    const entries = Object.entries(memory);
    if (entries.length === 0) {
      panel.innerHTML = '<div>No memory saved yet.</div>';
      return;
    }

    entries.forEach(([symbol, data]) => {
      const row = document.createElement('div');
      row.className = 'memory-entry';
      row.innerHTML = `
        <strong>${symbol}</strong>: 
        ${Object.entries(data).map(([key, val]) => `${key}: ${val}`).join(', ')}
      `;
      panel.appendChild(row);
    });
  } catch (err) {
    panel.innerHTML = `<div>Error loading memory: ${err.message}</div>`;
  }
}