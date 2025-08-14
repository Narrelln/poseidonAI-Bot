// sessionStatsClient.js
import { getActiveSymbols } from './poseidonScanner.js';
import { getWalletBalance } from './futuresApiClient.js';

const $ = (id) => document.getElementById(id);

export async function renderSessionStats() {
  // DOM targets (make sure these IDs exist in futures.html)
  const elWallets    = $('session-wallets');
  const elTokens     = $('session-tokens');
  const elActive     = $('session-active');
  const elPnl        = $('session-pnl');
  const elWins       = $('session-wins');
  const elLosses     = $('session-losses');
  const elWinRate    = $('session-winrate');
  const elTopTrade   = $('session-toptrade');
  const elWinStreak  = $('session-winstreak');
  const elLossStreak = $('session-lossstreak');

  try {
    // 1) Ask backend
    const res  = await fetch('/api/session-stats');
    const data = await res.json().catch(() => ({}));

    // 2) Frontend fallbacks
    const tokens  = getActiveSymbols()?.length || 0;        // scanner knows this
    const wallets = Number.isFinite(data.wallets) ? data.wallets : 0;
    const active  = Number.isFinite(data.active)  ? data.active  : 0;
    const pnl     = Number.isFinite(data.pnlScore)? data.pnlScore: 0;

    // Optional: recompute wins/losses if backend missing
    let wins = Number.isFinite(data.wins) ? data.wins : 0;
    let losses = Number.isFinite(data.losses) ? data.losses : 0;
    let winRate = Number.isFinite(data.winRate) ? data.winRate : null;
    let winStreak = Number.isFinite(data.winStreak) ? data.winStreak : 0;
    let lossStreak = Number.isFinite(data.lossStreak) ? data.lossStreak : 0;
    let topTrade = data.topTrade || null;

    if (!Number.isFinite(data.wins) || !Number.isFinite(data.losses)) {
      try {
        const th = await fetch('/api/trade-history').then(r => r.json());
        const list = th?.trades || [];
        wins = 0; losses = 0; topTrade = null;
        for (const t of list) {
          if (String(t.status).toUpperCase() !== 'CLOSED') continue;
          const p = Number(t.pnl);
          if (!Number.isFinite(p)) continue;
          if (p > 0) wins++; else if (p < 0) losses++;
          if (!topTrade || Math.abs(p) > Math.abs(Number(topTrade.pnl || 0))) {
            topTrade = { symbol: t.symbol, pnl: Number(p.toFixed(2)), roi: t.roi ?? null };
          }
        }
        const total = wins + losses;
        winRate = total ? +(wins * 100 / total).toFixed(1) : null;
      } catch {}
    }

    // 3) Render
    if (elWallets)    elWallets.textContent    = wallets;
    if (elTokens)     elTokens.textContent     = tokens || data.tokens || 0;
    if (elActive)     elActive.textContent     = active;
    if (elPnl)        elPnl.textContent        = `${pnl.toFixed(2)} USDT`;
    if (elWins)       elWins.textContent       = wins;
    if (elLosses)     elLosses.textContent     = losses;
    if (elWinRate)    elWinRate.textContent    = (winRate ?? 0) + '%';
    if (elTopTrade)   elTopTrade.textContent   = topTrade
      ? `${topTrade.symbol} (${(topTrade.pnl >= 0 ? '+' : '')}${topTrade.pnl}${topTrade.roi ? ', ' + topTrade.roi : ''})`
      : '--';
    if (elWinStreak)  elWinStreak.textContent  = winStreak;
    if (elLossStreak) elLossStreak.textContent = lossStreak;
  } catch (err) {
    // graceful fallback
    if (elWallets)    elWallets.textContent    = '0';
    if (elTokens)     elTokens.textContent     = String(getActiveSymbols()?.length || 0);
    if (elActive)     elActive.textContent     = '0';
    if (elPnl)        elPnl.textContent        = '0.00 USDT';
    if (elWins)       elWins.textContent       = '0';
    if (elLosses)     elLosses.textContent     = '0';
    if (elWinRate)    elWinRate.textContent    = '0%';
    if (elTopTrade)   elTopTrade.textContent   = '--';
    if (elWinStreak)  elWinStreak.textContent  = '0';
    if (elLossStreak) elLossStreak.textContent = '0';
    console.warn('[renderSessionStats] failed:', err.message);
  }
}