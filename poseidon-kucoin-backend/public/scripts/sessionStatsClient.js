// // /public/scripts/sessionStatsClient.js — unified DOM IDs + dual history sources (patched)
// import { getActiveSymbols } from './poseidonScanner.js';

// const $ = (id) => document.getElementById(id);
// const pick = (...ids) => ids.map($).find(Boolean); // first existing node

// // number from nested keys
// function numFrom(obj, keys, d = NaN) {
//   for (const k of keys) {
//     const v = k.includes('.') ? k.split('.').reduce((o, kk) => (o || {})[kk], obj) : obj?.[k];
//     const n = Number(v);
//     if (Number.isFinite(n)) return n;
//   }
//   return d;
// }
// // value from nested keys
// function valFrom(obj, keys, d = undefined) {
//   for (const k of keys) {
//     const v = k.includes('.') ? k.split('.').reduce((o, kk) => (o || {})[kk], obj) : obj?.[k];
//     if (v !== undefined && v !== null) return v;
//   }
//   return d;
// }

// export async function renderSessionStats() {
//   // Support both the new and legacy IDs (prevents conflicts with other modules)
//   const elWallets    = pick('session-wallets', 'wallets-tracked');
//   const elTokens     = pick('session-tokens', 'tokens-monitored');
//   const elActive     = pick('session-active', 'active-trades');
//   const elPnl        = $('session-pnl');
//   const elWins       = $('session-wins');
//   const elLosses     = $('session-losses');
//   const elWinRate    = $('session-winrate');
//   const elTopTrade   = pick('session-toptrade', 'top-trade');
//   const elWinStreak  = pick('session-winstreak', 'win-streak');
//   const elLossStreak = pick('session-lossstreak', 'loss-streak');

//   try {
//     const res  = await fetch('/api/session-stats', { cache: 'no-store' });
//     const data = await res.json().catch(() => ({}));

//     // For quick console inspection
//     window.debugSessionStats = () => console.log('[session-stats raw]', data);

//     // Server → tolerant to older/newer shapes
//     const wallets = numFrom(data, ['wallets','walletsTracked','session.wallets'], 0);
//     const tokens  = numFrom(data, ['tokens','tokensMonitored','session.tokens'], getActiveSymbols()?.length || 0);
//     const active  = numFrom(data, ['active','activeTrades','trades','session.trades'], 0);

//     // PnL can be % or USDT
//     let pnlPercent = numFrom(data, ['pnlPercent','pnlScore','capitalScore'], NaN);
//     let pnlUsdt    = numFrom(data, ['pnl'], NaN);

//     // Wins / Losses / WinRate / Streaks / TopTrade
//     let wins       = numFrom(data, ['wins','session.wins'], NaN);
//     let losses     = numFrom(data, ['losses','session.losses'], NaN);
//     let winRate    = numFrom(data, ['winRate','session.winRate'], NaN);
//     let winStreak  = numFrom(data, ['winStreak','session.winStreak'], 0);
//     let lossStreak = numFrom(data, ['lossStreak','session.lossStreak'], 0);
//     let topTrade   = valFrom(data, ['topTrade','session.topTrade'], null);

//     // Fallback to trade history if needed
//     if (!Number.isFinite(wins) || !Number.isFinite(losses) || !Number.isFinite(winRate) || !topTrade) {
//       try {
//         const histRes  = await fetch('/api/trade-history', { cache: 'no-store' });
//         const histJson = histRes.ok ? await histRes.json().catch(() => ({})) : {};
//         const trades   = Array.isArray(histJson?.trades) ? histJson.trades : [];

//         let w = 0, l = 0, best = null;
//         for (const t of trades) {
//           if (String(t.status).toUpperCase() !== 'CLOSED') continue;
//           const p = Number(t.pnl);
//           if (!Number.isFinite(p)) continue;
//           if (p > 0) w++; else if (p < 0) l++;
//           if (!best || Math.abs(p) > Math.abs(Number(best.pnl || 0))) {
//             best = { symbol: t.symbol, pnl: Number(p.toFixed(2)), roi: t.roi ?? null };
//           }
//         }
//         if (!Number.isFinite(wins))   wins = w;
//         if (!Number.isFinite(losses)) losses = l;
//         if (!Number.isFinite(winRate)) {
//           const total = w + l;
//           winRate = total ? +(w * 100 / total).toFixed(1) : 0;
//         }
//         if (!topTrade) topTrade = best;
//       } catch (_) {}
//     }

//     // --- Render
//     if (elWallets) elWallets.textContent = String(wallets);
//     if (elTokens)  elTokens.textContent  = String(tokens);
//     if (elActive)  elActive.textContent  = String(active);

//     if (elPnl) {
//       if (Number.isFinite(pnlPercent)) {
//         elPnl.textContent = `${pnlPercent.toFixed(2)}%`;
//       } else if (Number.isFinite(pnlUsdt)) {
//         const s = pnlUsdt >= 0 ? '+' : '';
//         elPnl.textContent = `${s}${pnlUsdt.toFixed(2)} USDT`;
//       } else {
//         elPnl.textContent = '0.00%';
//       }
//     }

//     if (elWins)       elWins.textContent       = String(Number.isFinite(wins) ? wins : 0);
//     if (elLosses)     elLosses.textContent     = String(Number.isFinite(losses) ? losses : 0);
//     if (elWinRate)    elWinRate.textContent    = `${Number.isFinite(winRate) ? winRate.toFixed(1) : '0.0'}%`;

//     // Compact Top-Trade for layout; keep full in tooltip
//     if (elTopTrade) {
//       if (topTrade) {
//         const full = `${topTrade.symbol} (${(Number(topTrade.pnl) >= 0 ? '+' : '')}${Number(topTrade.pnl).toFixed(2)}${topTrade.roi ? ', ' + topTrade.roi : ''})`;
//         const roiCompact = topTrade.roi ? ` / ${String(topTrade.roi).replace(/[^0-9.\-x%]/g,'')}` : '';
//         const short = `${topTrade.symbol} ${(Number(topTrade.pnl) >= 0 ? '+' : '')}${Number(topTrade.pnl).toFixed(2)}${roiCompact}`;
//         elTopTrade.textContent = short;
//         elTopTrade.title = full;
//       } else {
//         elTopTrade.textContent = '--';
//         elTopTrade.title = '';
//       }
//     }

//     if (elWinStreak)  elWinStreak.textContent  = String(winStreak || 0);
//     if (elLossStreak) elLossStreak.textContent = String(lossStreak || 0);

//   } catch (err) {
//     // graceful fallback
//     if (elWallets)    elWallets.textContent    = '0';
//     if (elTokens)     elTokens.textContent     = String(getActiveSymbols()?.length || 0);
//     if (elActive)     elActive.textContent     = '0';
//     if (elPnl)        elPnl.textContent        = '0.00%';
//     if (elWins)       elWins.textContent       = '0';
//     if (elLosses)     elLosses.textContent     = '0';
//     if (elWinRate)    elWinRate.textContent    = '0.0%';
//     if (elTopTrade)   elTopTrade.textContent   = '--';
//     if (elWinStreak)  elWinStreak.textContent  = '0';
//     if (elLossStreak) elLossStreak.textContent = '0';
//     console.warn('[renderSessionStats] failed:', err?.message || err);
//   }
// }

// // Optional: simple poller so you don’t need multiple timers elsewhere
// let __statsTimer = null;
// export function initSessionStatsClient(intervalMs = 10_000) {
//   renderSessionStats();
//   if (__statsTimer) clearInterval(__statsTimer);
//   __statsTimer = setInterval(renderSessionStats, Math.max(2000, intervalMs | 0));
// }