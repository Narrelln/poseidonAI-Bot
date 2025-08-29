// /public/scripts/feedClient.js (patched for categories + rich rows)

const state = {
  items: [],
  filters: {
    types: new Set(),
    levels: new Set(),
    symbol: '',
    categories: new Set(), // NEW: 'major' | 'meme' | 'mover-gainer' | 'mover-loser'
    follow: true
  }
};

// ---------- small formatters ----------
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : NaN; };

function formatCompactNumber(v) {
  const x = n(v);
  if (!Number.isFinite(x)) return '';
  if (x >= 1e12) return (x / 1e12).toFixed(2) + 'T';
  if (x >= 1e9)  return (x / 1e9 ).toFixed(2) + 'B';
  if (x >= 1e6)  return (x / 1e6 ).toFixed(2) + 'M';
  if (x >= 1e3)  return (x / 1e3 ).toFixed(1) + 'K';
  return x.toFixed(2);
}
function normalizePct(v) {
  let x = n(v);
  if (!Number.isFinite(x)) return null;
  if (Math.abs(x) <= 1 && Math.abs(x) > 0.0001) x *= 100;
  return x;
}
function badge(text, cls = '') {
  const span = document.createElement('span');
  span.className = `badge ${cls}`.trim();
  span.textContent = text;
  return span;
}

// ---------- init & ingest ----------
export async function initFeed() {
  // history
  const since = Date.now() - 60 * 60 * 1000;
  const hist = await fetch('/api/feed/history?since=' + since)
    .then(r => r.json())
    .catch(() => ({ items: [] }));

  state.items.push(...(hist.items || []));

  // live
  const es = new EventSource('/api/feed/stream');
  es.addEventListener('feed', ev => {
    try {
      const item = JSON.parse(ev.data);
      state.items.push(item);
      trim(1200);
      render();
    } catch { /* ignore malformed */ }
  });
}

function trim(nMax) {
  if (state.items.length > nMax) state.items.splice(0, state.items.length - nMax);
}

// ---------- filters ----------
/**
 * setFilter({ types, levels, symbol, categories, follow })
 * - types/levels/categories: Array<string> (replaces the sets)
 * - symbol: string (uppercased when filtering)
 * - follow: boolean (autoscroll)
 */
export function setFilter({ types, levels, symbol, categories, follow } = {}) {
  if (types) state.filters.types = new Set(types);
  if (levels) state.filters.levels = new Set(levels);
  if (categories) state.filters.categories = new Set(categories);
  if (symbol !== undefined) state.filters.symbol = String(symbol || '').toUpperCase();
  if (typeof follow === 'boolean') state.filters.follow = follow;
  render();
}

export function toggleFollow(on) {
  if (typeof on === 'boolean') state.filters.follow = on;
  else state.filters.follow = !state.filters.follow;
  render();
}

// ---------- render ----------
export function render() {
  const list = document.getElementById('live-feed');
  if (!list) return;
  list.innerHTML = '';

  const f = state.filters;

  const rows = state.items
    .filter(it => {
      // legacy fields still supported
      const sym = String(it.symbol || '').toUpperCase();
      const typeOk = !f.types.size || f.types.has(it.type);
      const levelOk = !f.levels.size || f.levels.has(it.level);
      const symbolOk = !f.symbol || sym === f.symbol;

      // NEW: category from top-level or nested data
      const cat = it.category || it.data?.category || '';
      const categoryOk = !f.categories.size || f.categories.has(cat);

      return typeOk && levelOk && symbolOk && categoryOk;
    })
    .slice(-200);

  for (const it of rows) {
    const li = document.createElement('div');
    li.className = `feed-item ${it.level || ''} ${it.type || ''}`;

    const ts = new Date(it.ts || Date.now()).toLocaleTimeString();
    const sym = String(it.symbol || '').toUpperCase();
    const cat = it.category || it.data?.category || ''; // 'major' | 'meme' | 'mover-gainer' | 'mover-loser'

    // Optional enriched bits if present
    const price = n(it.data?.price);
    const volUSDT = n(it.data?.volume);
    const deltaPct = normalizePct(it.data?.delta);
    const conf = n(it.data?.confidence);

    // Header line
    const header = document.createElement('div');
    header.className = 'feed-line';
    header.appendChild(document.createTextNode(`[${ts}] ${sym} • ${it.type}`));

    // Category badge (if any)
    if (cat) {
      const cls =
        cat === 'major' ? 'cat-major' :
        cat === 'meme'  ? 'cat-meme'  :
        cat === 'mover-gainer' ? 'cat-gainer' :
        cat === 'mover-loser'  ? 'cat-loser'  : '';
      header.appendChild(document.createTextNode(' • '));
      header.appendChild(badge(cat, cls));
    }

    // Confidence badge
    if (Number.isFinite(conf)) {
      header.appendChild(document.createTextNode(' '));
      header.appendChild(badge(`${Math.round(conf)}%`, 'conf'));
    }

    // Delta badge
    if (Number.isFinite(deltaPct)) {
      const cls = deltaPct >= 0 ? 'up' : 'down';
      header.appendChild(document.createTextNode(' '));
      header.appendChild(badge(`${deltaPct.toFixed(2)}%`, `delta ${cls}`));
    }

    // Volume badge
    if (Number.isFinite(volUSDT)) {
      header.appendChild(document.createTextNode(' '));
      header.appendChild(badge(formatCompactNumber(volUSDT), 'vol'));
    }

    // Price badge
    if (Number.isFinite(price)) {
      header.appendChild(document.createTextNode(' '));
      header.appendChild(badge(`$${price}`, 'price'));
    }

    // Message text (always shown)
    const msgLine = document.createElement('div');
    msgLine.className = 'feed-msg';
    msgLine.textContent = `• ${it.msg || ''}`;

    // Tooltip keeps the raw payload
    li.title = JSON.stringify(it.data || it, null, 0);

    li.appendChild(header);
    li.appendChild(msgLine);
    list.appendChild(li);
  }

  if (state.filters.follow) list.scrollTop = list.scrollHeight;
}