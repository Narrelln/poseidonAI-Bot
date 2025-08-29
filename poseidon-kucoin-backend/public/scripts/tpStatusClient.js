export function startTpFeedRenderer() {
  const root = document.getElementById('tp-feed');
  if (!root) return;

  let lastTs = 0; // remember last appended timestamp

  function renderRows(rows) {
    // rows must be ascending by ts
    for (const r of rows) {
      if (!r || typeof r.ts !== 'number') continue;
      if (r.ts <= lastTs) continue;        // only add new lines
      lastTs = r.ts;

      const div = document.createElement('div');
      div.className = `tp-line ${r.state || ''}`;
      div.textContent = r.text;
      root.appendChild(div);
    }

    // cap to 200 lines to avoid DOM bloat
    while (root.children.length > 200) {
      root.removeChild(root.firstChild);
    }

    root.scrollTop = root.scrollHeight;
  }

  async function pull() {
    try {
      const r = await fetch('/api/tp-snapshots');
      const j = await r.json();
      if (!j?.success) return;
      // server returns last N lines; append the ones we haven’t seen yet
      renderRows(j.feed || j.recent || []);
    } catch (_) {}
  }

  // initial fill then poll
  pull();
  setInterval(pull, 3000);
}