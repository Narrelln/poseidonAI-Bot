const scanningList = document.getElementById('scanning-list');
const gainersBtn = document.getElementById('toggle-gainers');
const losersBtn = document.getElementById('toggle-losers');
const hotBtn = document.getElementById('toggle-hot');

let gainers = [];
let losers = [];
let hotTokens = [];
let currentTab = 'gainers'; // Track active tab

// 🧠 Calculate Hot Tokens (change >= 8% and vol >= 500k), sorted by absolute % change
function computeHotTokens(allTokens = []) {
  return allTokens
    .filter(t => {
      const change = Math.abs(parseFloat(t.change || t.priceChgPct || 0));
      const vol = parseFloat(t.quoteVolume || 0);
      return change >= 8 && vol >= 500_000;
    })
    .sort((a, b) =>
      Math.abs(b.change || b.priceChgPct || 0) -
      Math.abs(a.change || a.priceChgPct || 0)
    )
    .slice(0, 5); // 🔥 Only show top 5 hot tokens
}

// 🎯 Fetch scan-tokens from backend
async function fetchScanTokens() {
  try {
    const res = await fetch('/api/scan-tokens');
    const data = await res.json();
    gainers = data.gainers || [];
    losers = data.losers || [];
    hotTokens = computeHotTokens([...gainers, ...losers]);

    // Auto-switch to hot if it has results, otherwise retain current tab
    if (currentTab === 'gainers' && hotTokens.length > 0) {
      setActiveTab(hotBtn);
      renderScanningList('hot');
    } else {
      renderScanningList(currentTab);
    }
  } catch (err) {
    scanningList.innerHTML = `<div class="log-entry error">⚠️ Failed to fetch scan tokens</div>`;
  }
}

// 🖼 Render scanner list by type
function renderScanningList(type) {
  currentTab = type;
  let entries = [];

  if (type === 'gainers') entries = gainers;
  else if (type === 'losers') entries = losers;
  else if (type === 'hot') entries = hotTokens;

  if (!entries.length) {
    scanningList.innerHTML = `<div class="log-entry">No ${type} found.</div>`;
    return;
  }

  scanningList.innerHTML = entries.map(entry => {
    const symbol = entry.symbol || '???';
    const pct = parseFloat(entry.change || entry.priceChgPct || 0) || 0;
    const color = pct > 0 ? 'change-positive' : 'change-negative';
    const price = entry.price?.toFixed?.(6) || '--';
    const volume = Number(entry.quoteVolume || 0);
    const volumeStr = isNaN(volume) ? '--' : volume.toLocaleString();

    return `
      <div class="log-entry scanner-entry" style="font-family: 'Fira Code', monospace; font-size: 14px; font-weight: 600;">
        <span class="symbol">${symbol}</span>
        <span class="price">@ ${price}</span>
        <span class="change ${color}">${pct.toFixed(2)}%</span>
        <span class="volume">${volumeStr} USDT</span>
      </div>
    `;
  }).join('');
}

// 🔘 Tab toggles
gainersBtn.addEventListener('click', () => {
  setActiveTab(gainersBtn);
  renderScanningList('gainers');
});
losersBtn.addEventListener('click', () => {
  setActiveTab(losersBtn);
  renderScanningList('losers');
});
hotBtn.addEventListener('click', () => {
  setActiveTab(hotBtn);
  renderScanningList('hot');
});

// ✨ Highlight active tab
function setActiveTab(activeBtn) {
  [gainersBtn, losersBtn, hotBtn].forEach(btn => btn.classList.remove('active-tab'));
  activeBtn.classList.add('active-tab');
}

// 🔄 Real-time update of price and volume every second
function refreshDisplayedScanner() {
  let entries = [];
  if (currentTab === 'gainers') entries = gainers;
  else if (currentTab === 'losers') entries = losers;
  else if (currentTab === 'hot') entries = hotTokens;

  const rows = document.querySelectorAll('.scanner-entry');
  rows.forEach((row, i) => {
    const entry = entries[i];
    if (!entry) return;

    const pct = parseFloat(entry.change || entry.priceChgPct || 0) || 0;
    const price = entry.price?.toFixed?.(6) || '--';
    const volume = Number(entry.quoteVolume || 0);
    const volumeStr = isNaN(volume) ? '--' : volume.toLocaleString();

    const changeSpan = row.querySelector('.change');
    const priceSpan = row.querySelector('.price');
    const volumeSpan = row.querySelector('.volume');

    if (changeSpan) {
      changeSpan.textContent = `${pct.toFixed(2)}%`;
      changeSpan.className = `change ${pct > 0 ? 'change-positive' : 'change-negative'}`;
    }

    if (priceSpan) priceSpan.textContent = `@ ${price}`;
    if (volumeSpan) volumeSpan.textContent = `${volumeStr} USDT`;
  });
}

// ⏱ Auto refresh every 3 minutes and update UI every 1 second
fetchScanTokens();
setInterval(fetchScanTokens, 3 * 60 * 1000);
setInterval(refreshDisplayedScanner, 1000);
