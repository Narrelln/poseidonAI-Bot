/**
 * Poseidon — Upgrade U03 UI: TP/SL Feed Renderer
 * ----------------------------------------------
 * Mount: <div id="tp-feed"></div>
 * Polls /api/tp-snapshots every 3s and renders recent lines.
 */

export function startTpFeedRenderer() {
    const root = document.getElementById('tp-feed');
    if (!root) return;
  
    async function pull() {
      try {
        const r = await fetch('/api/tp-snapshots');
        const j = await r.json();
        if (!j?.success) return;
  
        root.innerHTML = '';
        (j.feed || []).forEach(row => {
          const div = document.createElement('div');
          div.className = `tp-line ${row.state || ''}`;
          div.textContent = row.text;
          root.appendChild(div);
        });
  
        // autoscroll to latest
        root.scrollTop = root.scrollHeight;
      } catch (_) {}
    }
  
    pull();
    setInterval(pull, 3000);
  }