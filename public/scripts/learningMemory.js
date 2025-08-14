// public/scripts/learningMemory.js — Frontend module (patched)
// - Uses /api/learning-memory (not /api/memory)
// - Normalizes symbols to UPPERCASE, no hyphen (e.g., "ADAUSDT" / "BTCUSDTM")
// - Safe pagination & empty-state
// - Accepts single-result or array in updateMemoryFromResult

const MEMORY_API = '/api/learning-memory';

// -------- utils --------
function normalizeSymbolKey(sym) {
  if (!sym) return '';
  // Uppercase, strip spaces, collapse non-alnum; keep trailing USDT/USDTM if present
  let s = String(sym).trim().toUpperCase();
  // If it looks like futures "BASE-USDTM", drop hyphen → "BASEUSDTM"
  s = s.replace(/-/g, '');
  // Accept both spot/futures endings; if none, leave as-is
  return s;
}
function displaySymbol(symKey) {
  // Render as BASE/USDT or BASE/USDTM visually nice
  const s = String(symKey || '').toUpperCase();
  if (s.endsWith('USDTM')) return s.replace(/USDTM$/, '') + 'USDTM';
  if (s.endsWith('USDT'))  return s.replace(/USDT$/, '') + 'USDT';
  return s;
}

// -------- API helpers --------
async function loadMemoryStore() {
  try {
    const res = await fetch(MEMORY_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    console.error('[Memory] Load failed:', err.message);
    return {};
  }
}

async function saveMemoryStore(store, overwrite = false) {
  try {
    const method = overwrite ? 'PUT' : 'POST';
    const res = await fetch(MEMORY_API, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store)
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${t}`);
    }
  } catch (err) {
    console.error('[Memory] Save failed:', err.message);
  }
}

// -------- Public API (frontend) --------
export async function saveLearningMemory(symbol, data) {
  const key = normalizeSymbolKey(symbol);
  if (!key || !data || typeof data !== 'object') return;
  await saveMemoryStore({ [key]: data });
}

export async function getLearningMemory(symbol) {
  const store = await loadMemoryStore();
  const key = normalizeSymbolKey(symbol);
  return store[key] || {};
}

export async function getFullMemory() {
  return await loadMemoryStore();
}

// -------- Rendering (panel) --------
let currentPage = 1;
const rowsPerPage = 5;
let memoryData = [];

function renderPaginationControls() {
  const totalPages = Math.max(1, Math.ceil(memoryData.length / rowsPerPage));
  return `
    <div class="memory-pagination">
      <button ${currentPage === 1 ? 'disabled' : ''} onclick="prevMemoryPage()">⏪ Prev</button>
      <span>Page ${currentPage} of ${totalPages}</span>
      <button ${currentPage === totalPages ? 'disabled' : ''} onclick="nextMemoryPage()">Next ⏩</button>
    </div>
  `;
}

function renderMemoryTablePage() {
  const panel = document.getElementById('learning-memory-panel');
  if (!panel) return;

  if (!memoryData.length) {
    panel.innerHTML = `<div class="op-dimmed">No learning data yet.</div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(memoryData.length / rowsPerPage));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * rowsPerPage;
  const end = start + rowsPerPage;
  const pageData = memoryData.slice(start, end);

  let html = `<table class="memory-table"><thead><tr>
    <th>Symbol</th>
    <th>Side</th>
    <th>Wins</th>
    <th>Trades</th>
    <th>Win Rate</th>
    <th>Streak</th>
  </tr></thead><tbody>`;

  pageData.forEach(([symbolKey, stats]) => {
    ['LONG', 'SHORT'].forEach(side => {
      const sideStats = stats?.[side] || { wins: 0, trades: 0, currentStreak: 0 };
      const wrValue = sideStats.trades > 0 ? (sideStats.wins / sideStats.trades) * 100 : 0;
      const wr = wrValue.toFixed(1) + '%';

      const wrClass = wrValue > 50 ? 'green' : wrValue > 0 ? 'red' : 'gray';
      const streakValue = Number(sideStats.currentStreak || 0);
      const streakClass = streakValue > 0 ? 'green' : streakValue < 0 ? 'red' : 'gray';

      html += `<tr>
        <td><strong>${displaySymbol(symbolKey)}</strong></td>
        <td>${side}</td>
        <td>${Number(sideStats.wins || 0)}</td>
        <td>${Number(sideStats.trades || 0)}</td>
        <td class="${wrClass}">${wr}</td>
        <td class="${streakClass}">${streakValue}</td>
      </tr>`;
    });
  });

  html += `</tbody></table>`;
  html += renderPaginationControls();

  panel.innerHTML = html;
}

window.prevMemoryPage = () => {
  if (currentPage > 1) {
    currentPage--;
    renderMemoryTablePage();
  }
};

window.nextMemoryPage = () => {
  const totalPages = Math.max(1, Math.ceil(memoryData.length / rowsPerPage));
  if (currentPage < totalPages) {
    currentPage++;
    renderMemoryTablePage();
  }
};

export async function renderMemoryPanel() {
  const panel = document.getElementById('learning-memory-panel');
  if (!panel) return;

  const memory = await getFullMemory();
  // Sort by symbol asc for stable UI
  memoryData = Object.entries(memory).sort((a, b) => a[0].localeCompare(b[0]));
  currentPage = 1;
  renderMemoryTablePage();
}

/**
 * Update memory from TA/decision result(s).
 * Accepts:
 *  - (symbol: string, result: object)
 *  - ([{ symbol, confidence, trapWarning, allocationPct }, ...])  // batch
 */
export async function updateMemoryFromResult(arg1, arg2) {
  // Batch path
  if (Array.isArray(arg1) && arg2 === undefined) {
    const updates = {};
    for (const item of arg1) {
      if (!item || typeof item !== 'object') continue;
      const key = normalizeSymbolKey(item.symbol);
      if (!key) continue;
      const patch = {
        confidence: item.confidence ?? null,
        trapWarning: !!item.trapWarning,
        allocationPct: item.allocationPct ?? null
      };
      // Only enqueue if at least one useful field present
      if (Object.values(patch).some(v => v !== null && v !== undefined)) {
        updates[key] = { ...(updates[key] || {}), ...patch };
      }
    }
    if (Object.keys(updates).length) {
      await saveMemoryStore(updates); // single POST with all partials
    }
    return;
  }

  // Single item path
  const symbol = arg1;
  const result = arg2;
  if (!symbol || typeof symbol !== 'string' || !result || typeof result !== 'object' || Array.isArray(result)) {
    console.warn('[Memory] Skipped update — invalid args:', arg1, arg2);
    return;
  }

  const key = normalizeSymbolKey(symbol);
  const patch = {
    confidence: result.confidence ?? null,
    trapWarning: !!result.trapWarning,
    allocationPct: result.allocationPct ?? null
  };
  if (!Object.values(patch).some(v => v !== null && v !== undefined)) return;

  await saveMemoryStore({ [key]: patch }); // instead of saveLearningMemory(key, patch)
}