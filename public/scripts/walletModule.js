// === walletModule.js — handles wallet balance sync and capital health ===

export async function refreshWalletBalance() {
    try {
      const res = await fetch('/api/wallet');
  
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const fallback = await res.text();
        console.error('🧨 Wallet API returned non-JSON:', fallback.slice(0, 100));
        throw new Error('Wallet API returned HTML or invalid response');
      }
  
      const data = await res.json();
  
      if (!data || !data.balance || isNaN(parseFloat(data.balance.total))) {
        throw new Error('Invalid wallet data');
      }
  
      const total = parseFloat(data.balance.total);
      const used = parseFloat(data.balance.used || 0);
      const free = total - used;
  
      // ⬅️ These now match your HTML IDs
      const totalEl = document.getElementById('wallet-total');
      const freeEl = document.getElementById('wallet-available');
  
      if (totalEl) totalEl.textContent = `${total.toFixed(2)}`;
      if (freeEl) freeEl.textContent = `${free.toFixed(2)}`;
  
    } catch (err) {
      console.error('⚠️ Failed to refresh wallet balance:', err.message);
  
      const totalEl = document.getElementById('wallet-total');
      const freeEl = document.getElementById('wallet-available');
  
      if (totalEl) totalEl.textContent = 'N/A';
      if (freeEl) freeEl.textContent = 'N/A';
    }
  }
  
  // ✅ For backend or engine use
  export async function getWalletBalance() {
    try {
      const res = await fetch('/api/wallet');
      const json = await res.json();
      const total = parseFloat(json?.balance?.total || 0);
      const used = parseFloat(json?.balance?.used || 0);
      return {
        total,
        used,
        available: total - used
      };
    } catch (err) {
      console.warn('⚠️ getWalletBalance error:', err.message);
      return { total: 0, used: 0, available: 0 };
    }
  }
  
  // Auto-refresh every 60s
  setInterval(refreshWalletBalance, 60 * 1000);
  
  // Initial call
  refreshWalletBalance();