// public/scripts/railsInspector.js
// Minimal frontend widget for inspecting extrema rails
// Mounts a simple panel with live fetch & refresh button.

(function () {
    const PANEL_ID = 'rails-inspector';
    if (document.getElementById(PANEL_ID)) return; // avoid dupes
  
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.position = 'fixed';
    panel.style.right = '20px';
    panel.style.bottom = '20px';
    panel.style.width = '360px';
    panel.style.maxHeight = '60vh';
    panel.style.overflowY = 'auto';
    panel.style.background = '#121212';
    panel.style.color = '#e7faff';
    panel.style.border = '1px solid #1e2a36';
    panel.style.borderRadius = '6px';
    panel.style.padding = '10px';
    panel.style.fontFamily = 'monospace';
    panel.style.fontSize = '12px';
    panel.style.zIndex = 99999;
  
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Symbol e.g. BTCUSDT';
    input.style.width = '60%';
    input.style.marginRight = '5px';
    input.value = 'BTCUSDT';
  
    const btn = document.createElement('button');
    btn.textContent = 'Check';
    btn.style.background = '#1976d2';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.padding = '4px 8px';
    btn.style.cursor = 'pointer';
  
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    pre.style.marginTop = '10px';
  
    panel.appendChild(input);
    panel.appendChild(btn);
    panel.appendChild(pre);
    document.body.appendChild(panel);
  
    async function fetchRails(sym) {
      pre.textContent = `🔄 Fetching rails for ${sym}...`;
      try {
        const res = await fetch(`/api/verify-rails/${encodeURIComponent(sym)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        pre.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        pre.textContent = `❌ Error: ${err.message}`;
      }
    }
  
    btn.addEventListener('click', () => {
      const sym = input.value.trim().toUpperCase();
      if (sym) fetchRails(sym);
    });
  
    // auto-load initial
    fetchRails(input.value.trim().toUpperCase());
  })();