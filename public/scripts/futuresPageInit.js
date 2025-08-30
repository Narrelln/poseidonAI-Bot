// /public/scripts/futuresPageInit.js
import { getWalletBalance, getOpenPositions } from '/scripts/futuresApiClient.js';

// 1) Wallet painter (uses #wallet-total and #wallet-available from futures.html)
async function paintWallet() {
  try {
    const total = await getWalletBalance();
    const totalEl = document.getElementById('wallet-total');
    const availEl = document.getElementById('wallet-available');

    if (Number.isFinite(total)) {
      // If you later expose "available" from the API, fill it here; for now mirror total.
      if (totalEl)  totalEl.textContent  = total.toFixed(2);
      if (availEl)  availEl.textContent  = total.toFixed(2);
    } else {
      if (totalEl) totalEl.textContent = '⚠️';
      if (availEl) availEl.textContent = '⚠️';
    }
  } catch {
    const totalEl = document.getElementById('wallet-total');
    const availEl = document.getElementById('wallet-available');
    if (totalEl) totalEl.textContent = '⚠️';
    if (availEl) availEl.textContent = '⚠️';
  }
}

// 2) Positions broadcaster (let positionEnhancer own the DOM)
//    We just fetch and emit a browser event everyone can subscribe to.
async function broadcastPositions() {
  try {
    const positions = await getOpenPositions();
    window.dispatchEvent(new CustomEvent('poseidon:positions', { detail: { positions } }));
  } catch {}
}

// 3) Public refresh used by other widgets
export async function refreshAccountPanels() {
  await Promise.allSettled([paintWallet(), broadcastPositions()]);
}

// 4) Boot: first paint + periodic refresh
document.addEventListener('DOMContentLoaded', async () => {
  await refreshAccountPanels();
  setInterval(refreshAccountPanels, 12_000);
});