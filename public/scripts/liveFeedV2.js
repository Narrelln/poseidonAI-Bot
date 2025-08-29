// /public/scripts/liveFeedV2.js
import { feed } from '/scripts/core/feeder.js';

// Grab elements after DOM is ready
function qs(id) { return document.getElementById(id); }

let lfList, typeFilter, levelFilter, symbolFilter, clearBtn;
let items = []; // ring buffer in memory

function initDefaults() {
  // select all by default (if present)
  if (typeFilter)  Array.from(typeFilter.options).forEach(o => o.selected = true);
  if (levelFilter) Array.from(levelFilter.options).forEach(o => o.selected = true);
}

function selectedValues(sel) {
  if (!sel) return [];
  const arr = Array.from(sel.selectedOptions || []);
  return arr.length ? arr.map(o => o.value) : [];
}

function render() {
  if (!lfList) return;

  const types  = selectedValues(typeFilter);
  const levels = selectedValues(levelFilter);
  const symQ   = (symbolFilter?.value || '').trim().toUpperCase();

  lfList.innerHTML = '';

  // show last 300, newest first
  items.slice(-300).reverse().forEach(e => {
    // filters
    if (types.length  && !types.includes(e.type)) return;
    if (levels.length && !levels.includes(e.level)) return;
    if (symQ && !(e.symbol || '').toUpperCase().includes(symQ)) return;

    const row = document.createElement('div');
    row.className = `lf-row lf-${e.level} lf-${e.type}`;
    row.innerHTML = `
      <span class="lf-time">${new Date(e.ts).toLocaleTimeString()}</span>
      <span class="lf-type">${e.type}</span>
      <span class="lf-level">${e.level}</span>
      <span class="lf-symbol">${e.symbol || '--'}</span>
      <span class="lf-msg">${e.message}</span>
    `;
    // Optional: show a compact JSON tooltip
    row.title = e.data ? JSON.stringify(e.data) : '';
    lfList.appendChild(row);
  });
}

function wireFilters() {
  if (typeFilter)  typeFilter.addEventListener('change', render);
  if (levelFilter) levelFilter.addEventListener('change', render);
  if (symbolFilter) symbolFilter.addEventListener('input', render);
  if (clearBtn) clearBtn.addEventListener('click', () => { items = []; render(); });
}

function ensureContainer() {
  // Create a simple container if HTML didn’t include one
  if (!lfList) {
    const host = qs('live-feed') || qs('futures-log-feed') || document.body;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="feed-controls">
        <select id="lf-type" multiple>
          <option value="scanner" selected>scanner</option>
          <option value="ta" selected>ta</option>
          <option value="decision" selected>decision</option>
          <option value="trade" selected>trade</option>
          <option value="error" selected>error</option>
        </select>
        <select id="lf-level" multiple>
          <option value="debug" selected>debug</option>
          <option value="info" selected>info</option>
          <option value="warn" selected>warn</option>
          <option value="success" selected>success</option>
          <option value="error" selected>error</option>
        </select>
        <input id="lf-symbol" placeholder="Symbol e.g. WIF-USDTM" />
        <button id="lf-clear">Clear</button>
      </div>
      <div id="lf-list" class="feed-list"></div>
    `;
    host.appendChild(wrap);
  }
}

function boot() {
  lfList       = qs('lf-list');
  typeFilter   = qs('lf-type');
  levelFilter  = qs('lf-level');
  symbolFilter = qs('lf-symbol');
  clearBtn     = qs('lf-clear');

  initDefaults();
  wireFilters();

  // listen to ALL feed events
  feed.on('*', (entry) => {
    items.push(entry);
    render();
  });

  render();
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', () => { ensureContainer(); boot(); })
  : (ensureContainer(), boot());