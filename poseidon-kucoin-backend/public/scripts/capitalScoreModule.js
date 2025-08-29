// === /public/scripts/capitalScoreModule.js (robust, ledger-first) ===
async function fetchTrades(limit = 200) {
  const endpoints = [
    `/api/trade-ledger?limit=${limit}`,
    `/api/trade-history?limit=${limit}`,
    `/api/trades?limit=${limit}`,
    `/api/ledger?limit=${limit}`
  ];

  const tryFetch = async (url) => {
    try {
      const r = await fetch(url + `&t=${Date.now()}`, { cache: 'no-store' });
      if (r.status === 204) return [];
      if (!r.ok) throw new Error(`${url} -> ${r.status}`);
      const txt = await r.text();
      if (!txt) return [];
      let j;
      try { j = JSON.parse(txt); } catch { return []; }
      if (Array.isArray(j?.trades)) return j.trades;
      if (Array.isArray(j?.rows))   return j.rows;
      if (Array.isArray(j))         return j;
      return [];
    } catch {
      return null; // signal to try next
    }
  };

  for (const ep of endpoints) {
    const res = await tryFetch(ep);
    if (res) return res;
  }
  return [];
}

function toNum(v) {
  if (v == null) return NaN;
  if (typeof v === 'string' && v.trim().endsWith('%')) return parseFloat(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function isClosedLike(t) {
  const st = String(t.status || '').toLowerCase();
  if (['closed','settled','done','exit','exited'].includes(st)) return true;
  if (t.closedAt || t.exit || t.exitedAt) return true;
  // Some ledgers keep a nonzero exit/realized pnl when closed
  if (Number.isFinite(toNum(t.exitPrice)) || Number.isFinite(toNum(t.realizedPnl))) return true;
  return false;
}

export async function renderCapitalScore() {
  const el = document.getElementById('capital-score-display');
  if (!el) return;

  try {
    const trades = await fetchTrades(250);
    if (!Array.isArray(trades)) { el.textContent = '--'; return; }

    // Prefer truly closed/settled rows
    let sample = trades.filter(isClosedLike);

    // Fallback: if nothing closed yet, use recent live (cap at 30)
    let usedLiveFallback = false;
    if (sample.length === 0 && trades.length) {
      sample = trades.slice(0, 30);
      usedLiveFallback = true;
    }

    if (sample.length === 0) { el.textContent = '--'; return; }

    let wins = 0;
    let score = 0;  // accumulates signed ROI
    let denom = 0;  // total absolute ROI for normalization

    for (const t of sample) {
      // ROI priority order:
      //   closed: roi, pnlPercent, realizedRoi
      //   live  : roiLive, liveRoi, pnlPercent
      let roi =
        toNum(t.roi) ??
        toNum(t.pnlPercent) ??
        toNum(t.realizedRoi) ??
        toNum(t.roiLive) ??
        toNum(t.liveRoi);

      // If still missing, derive a tiny proxy from pnl (keeps early ledgers from being blank)
      if (!Number.isFinite(roi)) {
        const pnl     = toNum(t.pnl ?? t.realizedPnl);
        const margin  = toNum(t.margin);
        if (Number.isFinite(pnl) && Number.isFinite(margin) && margin > 0) {
          roi = (pnl / margin) * 100;
        } else if (Number.isFinite(pnl) && pnl !== 0) {
          roi = Math.sign(pnl) * 1; // 1% bucket proxy
        }
      }

      if (!Number.isFinite(roi)) continue;

      denom += Math.abs(roi);
      if (roi > 0) {
        wins++;
        score += roi;                 // reward winners fully
      } else {
        score -= Math.abs(roi) * 0.5; // penalize losers at 50% weight
      }
    }

    if (denom <= 0) { el.textContent = '0.0 (0%)'; return; }

    const accuracy     = (wins / sample.length) * 100;
    const capitalScore = Math.max(0, Math.min(100, (score / denom) * 100));
    el.textContent = `${capitalScore.toFixed(1)} (${accuracy.toFixed(0)}%)${usedLiveFallback ? ' ~' : ''}`;
    // The trailing "~" indicates live fallback was used (optional cue)

  } catch (err) {
    console.warn('⚠️ Failed to compute capital score:', err.message);
    el.textContent = '⚠️';
  }
}