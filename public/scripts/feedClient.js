// /public/scripts/feedClient.js
const state = {
    items: [],
    filters: { types: new Set(), levels: new Set(), symbol: '', follow: true }
  };
  
  export async function initFeed() {
    // history
    const since = Date.now() - 60*60*1000;
    const hist = await fetch('/api/feed/history?since='+since).then(r=>r.json()).catch(()=>({items:[]}));
    state.items.push(...hist.items);
  
    // live
    const es = new EventSource('/api/feed/stream');
    es.addEventListener('feed', ev => {
      const item = JSON.parse(ev.data);
      state.items.push(item);
      trim(1200);
      render();
    });
  }
  
  function trim(n) { if (state.items.length > n) state.items.splice(0, state.items.length - n); }
  
  export function setFilter({ types, levels, symbol }) {
    if (types) state.filters.types = new Set(types);
    if (levels) state.filters.levels = new Set(levels);
    if (symbol !== undefined) state.filters.symbol = symbol.toUpperCase();
    render();
  }
  
  export function render() {
    const list = document.getElementById('live-feed');
    if (!list) return;
    list.innerHTML = '';
  
    const f = state.filters;
    const rows = state.items.filter(it => {
      if (f.types.size && !f.types.has(it.type)) return false;
      if (f.levels.size && !f.levels.has(it.level)) return false;
      if (f.symbol && it.symbol !== f.symbol) return false;
      return true;
    }).slice(-200);
  
    for (const it of rows) {
      const li = document.createElement('div');
      li.className = `feed-item ${it.level} ${it.type}`;
      li.textContent = `[${new Date(it.ts).toLocaleTimeString()}] ${it.symbol} • ${it.type} • ${it.msg}`;
      li.title = JSON.stringify(it.data);
      list.appendChild(li);
    }
  
    if (f.follow) list.scrollTop = list.scrollHeight;
  }