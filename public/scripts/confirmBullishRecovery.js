// public/scripts/confirmBullishRecovery.js — Frontend Proxy

export async function confirmBullishRecovery(symbol) {
    try {
      const res = await fetch(`/api/confirm-recovery?symbol=${symbol}`);
      const data = await res.json();
      return !!data.bullishRecovery;
    } catch (err) {
      console.error('Confirm recovery failed', err);
      return false;
    }
  }