// sessionStatsModule.js — Single owner for Account Overview & Session Stats
// - Merges "futuresStatsModule" (connection/last/live PnL) into this module
// - Ledger-first wins/losses/topTrade/streaks; capital from /api/capital-status
// - Debounced rendering with grace window to prevent flicker on brief API hiccups
// - Exposes setters so other modules can feed live data

import { getOpenPositions } from './futuresApiClient.js';

// ---------- live store (optional external feeders) ----------
export let activeSymbols = [];
export let trackedWallets = [];
export let activeTrades = [];

export function setActiveSymbols(symbols = []) { activeSymbols = symbols; }
export function setTrackedWallets(walletList = []) { trackedWallets = walletList; }
export function setActiveTrades(list = []) { activeTrades = list; }

// ---------- timing / debounce ----------
const REFRESH_MS = 10_000;
const GRACE_MS   = 30_000;   // keep last good values this long if a tick fails

let lastOkTs = 0;
let failCount = 0;

// cache of the last good render payload
let lastGood = null;

// ---------- helpers ----------
function toNum(v) {
  if (v == null) return NaN;
  const n = Number(String(v).replace(/[,%$]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

async function fetchCapitalStatus() {
  try {
    const j = await fetchJSON('/api/capital-status');
    return j && j.success ? j : null;
  } catch { return null; }
}

async function fetchSessionStats() {
  try { return await fetchJSON('/api/session-stats'); }
  catch { return null; }
}

async function fetchLedger(limit = 500) {
  try {
    const j = await fetchJSON(`/api/trade-ledger?limit=${Math.max(1, Math.min(Number(limit) || 100, 500))}`);
    if (j && j.success && Array.isArray(j.trades)) return j.trades;
    if (Array.isArray(j)) return j;
    if (Array.isArray(j?.rows)) return j.rows;
  } catch {}
  return [];
}

function tallyWinsLosses(rows) {
  let wins = 0, losses = 0;
  for (const t of rows) {
    if (String(t.status || '').toUpperCase() !== 'CLOSED') continue;
    const pnl = toNum(t.pnl);
    if (!Number.isFinite(pnl) || pnl === 0) continue;
    if (pnl > 0) wins++; else losses++;
  }
  return { wins, losses };
}

function computeTopTrade(rows) {
  let best = null;
  for (const t of rows) {
    if (String(t.status || '').toUpperCase() !== 'CLOSED') continue;
    const pnl = toNum(t.pnl);
    if (!Number.isFinite(pnl)) continue;
    if (!best || Math.abs(pnl) > Math.abs(best.pnl)) {
      best = { symbol: t.symbol || 'N/A', pnl, roi: t.roi ?? null };
    }
  }
  return best;
}

// Longest win/loss streaks across CLOSED trades (ordered by close time if present)
function computeStreaks(rows) {
  const sorted = rows
    .filter(t => String(t.status || '').toUpperCase() === 'CLOSED')
    .sort((a, b) => {
      const ta = toNum(a.closedAt ?? a.closeTime ?? a.updatedAt ?? a.time ?? 0);
      const tb = toNum(b.closedAt ?? b.closeTime ?? b.updatedAt ?? b.time ?? 0);
      return ta - tb;
    });

  let curW = 0, curL = 0, maxW = 0, maxL = 0;
  for (const t of sorted) {
    const pnl = toNum(t.pnl);
    if (!Number.isFinite(pnl) || pnl === 0) { curW = 0; curL = 0; continue; }
    if (pnl > 0) { curW++; curL = 0; if (curW > maxW) maxW = curW; }
    else         { curL++; curW = 0; if (curL > maxL) maxL = curL; }
  }
  return { winStreak: maxW, lossStreak: maxL };
}

// ---------- main entry ----------
export function initSessionStats() {
  updateSessionStats();
  setInterval(updateSessionStats, REFRESH_MS);
  console.log('📊 sessionStatsModule: running (interval', REFRESH_MS, 'ms; grace', GRACE_MS, 'ms)');
}

// ---------- renderer (pure; takes a payload and paints the DOM) ----------
function renderAll(payload, { fromCache = false } = {}) {
  const {
    scorePct, numWallets, numTokens, numTrades,
    wins, losses, winrate, topTrade, winStreak, lossStreak,
    connConnected, lastTradeText, livePnlNum
  } = payload;

  // Session + Strategy
  const pnlEl        = document.getElementById('session-pnl');
  const walletEl     = document.getElementById('wallets-tracked');
  const tokenEl      = document.getElementById('tokens-monitored');
  const tradeEl      = document.getElementById('active-trades');
  const winEl        = document.getElementById('session-wins');
  const lossEl       = document.getElementById('session-losses');
  const rateEl       = document.getElementById('session-winrate');
  const topTradeEl   = document.getElementById('top-trade');
  const winStreakEl  = document.getElementById('win-streak');
  const lossStreakEl = document.getElementById('loss-streak');

  if (pnlEl)        pnlEl.textContent        = `${Number(scorePct ?? 0).toFixed(2)}%`;
  if (walletEl)     walletEl.textContent     = numWallets ?? 0;
  if (tokenEl)      tokenEl.textContent      = numTokens ?? 0;
  if (tradeEl)      tradeEl.textContent      = numTrades ?? 0;
  if (winEl)        winEl.textContent        = wins ?? 0;
  if (lossEl)       lossEl.textContent       = losses ?? 0;
  if (rateEl)       rateEl.textContent       = `${Number(winrate ?? 0).toFixed(1)}%`;

  if (topTradeEl) {
    let shortTxt = '--', fullTxt = '--';
    if (topTrade) {
      const roiCompact = topTrade.roi ? ` / ${String(topTrade.roi).replace(/[^0-9.\-x%]/g,'')}` : '';
      shortTxt = `${topTrade.symbol} ${(topTrade.pnl >= 0 ? '+' : '')}${Number(topTrade.pnl).toFixed(2)}${roiCompact}`;
      fullTxt  = `${topTrade.symbol} (${(topTrade.pnl >= 0 ? '+' : '')}${Number(topTrade.pnl).toFixed(2)}${topTrade.roi ? ', ' + topTrade.roi : ''})`;
    }
    topTradeEl.textContent = shortTxt;
    topTradeEl.title = fullTxt;
  }
  if (winStreakEl)  winStreakEl.textContent  = Number(winStreak || 0).toString();
  if (lossStreakEl) lossStreakEl.textContent = Number(lossStreak || 0).toString();

  // Auto Status (merged)
  // const connEl    = document.getElementById('futures-connection');
  // const connDotEl = document.getElementById('futures-connection-dot');
  const lastEl    = document.getElementById('futures-last-trade');
  const livePnlEl = document.getElementById('futures-live-pnl');

  // if (connEl)    connEl.textContent    = connConnected ? 'Connected' : 'OFF';
  // if (connDotEl) connDotEl.textContent = connConnected ? '🟢' : '🔴';

  if (lastEl)    lastEl.textContent = lastTradeText || '--';

  if (livePnlEl) {
    const pnl = Number(livePnlNum ?? 0);
    livePnlEl.textContent = Number.isFinite(pnl) ? `${pnl.toFixed(2)} USDT` : '--';
    livePnlEl.className = Number.isFinite(pnl) ? (pnl >= 0 ? 'positive' : 'negative') : '';
  }

  if (!fromCache) lastGood = payload;  // update cache only on fresh data renders
}

// ---------- tick ----------
async function updateSessionStats() {
  let liveTrades = activeTrades;

  try {
    // refresh open positions if not injected
    if (!Array.isArray(liveTrades) || !liveTrades.length) {
      liveTrades = await getOpenPositions();
    }

    // counts
    const numWallets = Array.isArray(trackedWallets) ? trackedWallets.length : 0;
    const numTokens  = Array.isArray(activeSymbols)  ? activeSymbols.length  : 0;
    const numTrades  = Array.isArray(liveTrades)     ? liveTrades.length     : 0;

    // capital score
    let scorePct = 0;
    const cap = await fetchCapitalStatus();
    if (cap && typeof cap.score === 'number') {
      scorePct = cap.score;
    } else if (numTrades) {
      // fallback: crude sum of open PnL values
      scorePct = liveTrades.reduce((sum, pos) => {
        const v = toNum(pos.pnlValue ?? pos.pnl);
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0);
    }

    // session & ledger stats
    const session = await fetchSessionStats(); // optional for topTrade/streaks
    const ledgerRows = await fetchLedger(500);
    const { wins, losses } = tallyWinsLosses(ledgerRows);
    const total   = wins + losses;
    const winrate = total ? (wins * 100 / total) : 0;

    // Top trade
    let topTrade = session?.topTrade || null;
    if (!topTrade) {
      const best = computeTopTrade(ledgerRows);
      if (best) topTrade = { symbol: best.symbol, pnl: Number(best.pnl.toFixed(2)), roi: best.roi ?? null };
    }

    // Streaks
    let winStreak  = Number.isFinite(session?.winStreak) ? session.winStreak : null;
    let lossStreak = Number.isFinite(session?.lossStreak) ? session.lossStreak : null;
    if (winStreak == null || lossStreak == null) {
      const s = computeStreaks(ledgerRows);
      winStreak = s.winStreak; lossStreak = s.lossStreak;
    }

    // Auto status bits from positions
    const first = liveTrades[0];
    const livePnlNum = Number(toNum(first?.pnlValue ?? first?.pnl));
    const lastTradeText = liveTrades.length
      ? `${(first.symbol || 'N/A')} (${String(first.side || '').toUpperCase()})`
      : '--';

    // Build payload and render
    const payload = {
      scorePct, numWallets, numTokens, numTrades,
      wins, losses, winrate,
      topTrade, winStreak, lossStreak,
      connConnected: true,             // success → connected
      lastTradeText,
      livePnlNum: Number.isFinite(livePnlNum) ? livePnlNum : 0
    };

    renderAll(payload);
    lastOkTs = Date.now();
    failCount = 0;

  } catch (err) {
    console.warn('⚠️ Stats update failed:', err.message);
    failCount += 1;

    const withinGrace = (Date.now() - lastOkTs) < GRACE_MS;

    if (withinGrace && lastGood) {
      // keep showing the last good values, treat as connected
      renderAll({ ...lastGood, connConnected: true }, { fromCache: true });
      return;
    }

    // grace expired (or we never had a good tick) → render safe fallbacks
    renderAll({
      scorePct: 0, numWallets: 0, numTokens: 0, numTrades: 0,
      wins: 0, losses: 0, winrate: 0,
      topTrade: null, winStreak: 0, lossStreak: 0,
      connConnected: false,
      lastTradeText: '--',
      livePnlNum: 0
    }, { fromCache: true });
  }
}