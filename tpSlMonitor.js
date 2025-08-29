/**
 * Poseidon — Module P01: TP/SL Monitor (ROI-based) + Persistence
 * --------------------------------------------------------------
 * Purpose:
 *   - Monitor open positions and manage exits using ROI (PnL / cost) instead of raw price %.
 *   - TP1 rule: when ROI >= 100%, take 40% partial once, then trail the remainder.
 *   - SL rule: when ROI <= -SL%, close fully.
 *   - Persist TP/Trail state in Mongo so restarts don’t lose context.
 *
 * Dependencies:
 *   - utils/tradeHistory.getOpenTradesWithTPSL()
 *   - GET /api/positions
 *   - POST /api/partial-close   (preferred for partial exits)
 *   - POST /api/close-trade     (fallback; ideally supports { fraction })
 *   - models/TpState.js (Mongoose model)
 *
 * Debugging:
 *   - Logs prefixed with [P01-TPMON]
 *   - Sections §1..§8 for quick navigation
 */

const axios = require('axios');
const { getOpenTradesWithTPSL } = require('./utils/tradeHistory');
const TpState = require('./models/tpState'); // ⬅️ NEW: persistence model
const { parseToKucoinContractSymbol } = require('./kucoinHelper');

/* ───────────────────────── §1. Config & constants ───────────────────────── */

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const LOG = (...a) => console.log('[P01-TPMON]', ...a);

const CFG = {
  tp1RoiPct: 100,         // TP1 at 100% ROI
  tp1TakeFraction: 0.40,  // take 40% once
  trailGivebackPct: 0.25, // give back 25% of post-TP1 peak ROI
  pollMs: 3000,
  closeLockMs: 2500
};

/* ───────────────────────── §2. In-memory caches ────────────────────────── */

const closingLocks = new Set(); // contractKey -> lock against double submits
// Cache mirrors DB row for low-latency loop; DB is source of truth across restarts.
const tpState = new Map();      // contractKey -> { tp1Done, peakRoi, trailArmed, lastSeenQty }
const lastLog = new Map();      // contractKey -> ts (throttle)
/**
 * Poseidon — Upgrade U03: TP/SL Live Status Feed (snapshots)
 * ----------------------------------------------------------
 * Purpose:
 *   - Provide read-only snapshots of TP/SL state for a UI feed.
 * Debug:
 *   - Look for [U03-TPFEED] logs
 * API:
 *   - GET /api/tp-snapshots (see routes/tpStatusRoute.js)
 */

// 🔵 U03 feed buffer (bounded ring)
const FEED_MAX = 200;
const tpFeed = []; // { ts, contract, text, roi, peak, state }

/** Internal helper: push one feed line, keep buffer bounded, and emit to UI */
function pushFeed(entry) {
  const row = { ts: Date.now(), ...entry };
  tpFeed.push(row);
  if (tpFeed.length > FEED_MAX) tpFeed.splice(0, tpFeed.length - FEED_MAX);

  // visible trace for backend logs
  console.log('[U03-TPFEED]', row.text || JSON.stringify(row));

  // emit to frontend if io was exposed globally by your server
  try {
    const io = globalThis.__POSEIDON_IO__;
    if (io) io.emit('tp-feed', row);
  } catch (_) { /* no-op */ }
}
/* ───────────────────────── §3. Helpers ─────────────────────────────────── */

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const pctToNum = (v) => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const n = parseFloat(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : NaN;
};
const toKey = (s) => String(s || '').trim().toUpperCase().replace(/[-_]/g, '');
const isLongFromSide = (side) => {
  const s = String(side || '').toLowerCase();
  if (s.includes('buy') || s.includes('long')) return true;
  if (s.includes('sell') || s.includes('short')) return false;
  return true;
};

/* ───────────────────────── §4. Snapshot (ROI/price/side/size) ──────────── */
//* ───────────────────────── §4. Snapshot (ROI/price/side/size) ──────────── */
/**
 * Pull the latest ROI/price/side/size for a contract from /api/positions.
 * Robust symbol matching: contract | symbol | instId | instrumentId | apiSymbol | symbolCode
 * Normalized to KuCoin contract style and compared hyphen-insensitively.
 */
async function fetchPositionSnapshot(contractOrSymbol) {
  // normalize our target to no-hyphen uppercase (e.g., ETHUSDTM)
  const want = toKey(parseToKucoinContractSymbol(contractOrSymbol));

  try {
    const { data } = await axios.get(`${BASE}/api/positions`, { timeout: 8000 });
    const list = (data && data.positions) || [];

    // try several common id fields
    const p = list.find(row => {
      const candidates = [
        row.contract,
        row.symbol,
        row.instId,
        row.instrumentId,
        row.apiSymbol,
        row.symbolCode,
      ].filter(Boolean).map(v => toKey(parseToKucoinContractSymbol(String(v))));
      return candidates.some(k => k === want);
    });

    if (!p) {
      // helpful debug once in a while if nothing matches
      console.warn('[TPMON] no match for', contractOrSymbol,
        'first candidates=', list.slice(0, 3).map(r => (r.contract || r.symbol || r.instId || r.instrumentId)));
      return null;
    }

    // ROI direct if provided; else compute from pnl / initial cost
    let roi =
      pctToNum(p.roi) ??
      pctToNum(p.roiPct) ??
      pctToNum(p.pnlPercent);

      if (!Number.isFinite(roi)) {
        const pnl  = num(p.pnlValue ?? p.pnl, NaN);
        const cost = num(p.posInit ?? p.initMargin ?? p.margin ?? p.costUsd ?? p.marginUsd, NaN);
      
        if (!Number.isFinite(pnl) || !Number.isFinite(cost)) {
          const contract = p.contract || p.symbol || p.instId || p.instrumentId || 'unknown';
          pushFeed({
            contract,
            state: 'ROI_FAIL',
            text: `❌ ROI fail on ${contract}: pnl=${pnl}, cost=${cost}`
          });
          console.warn('[TPMON][ROI FAIL]', contract, { pnl, cost });
        }
      
        if (Number.isFinite(pnl) && Number.isFinite(cost) && cost > 0) {
          roi = (pnl / cost) * 100;
        }
      }

    return {
      roi,
      price: num(p.markPrice ?? p.price ?? p.entryPrice, NaN),
      side:  (p.side || ''),                           // 'buy' | 'sell'
      size:  num(p.size ?? p.currentQty ?? p.quantity, 0),
      contract: p.contract || p.symbol || p.instId || p.instrumentId
    };
  } catch (e) {
    console.warn('[TPMON] positions fetch error:', e.message || e);
    return null;
  }
}

/* ───────────────────────── §5. Persistence (Mongo) ─────────────────────── */

async function loadState(contract) {
  const key = toKey(contract);
  // cache hit?
  if (tpState.has(key)) return tpState.get(key);

  // DB fetch
  const row = await TpState.findOne({ key }).lean().exec();
  const st = row
    ? {
        tp1Done: !!row.tp1Done,
        peakRoi: Number.isFinite(row.peakRoi) ? row.peakRoi : -Infinity,
        trailArmed: !!row.trailArmed,
        lastSeenQty: num(row.lastSeenQty, 0)
      }
    : { tp1Done: false, peakRoi: -Infinity, trailArmed: false, lastSeenQty: 0 };

  tpState.set(key, st);
  return st;
}

async function saveState(contract, st) {
  const key = toKey(contract);
  tpState.set(key, st);
  await TpState.updateOne(
    { key },
    {
      $set: {
        key,
        contract,
        tp1Done: !!st.tp1Done,
        peakRoi: Number.isFinite(st.peakRoi) ? st.peakRoi : -Infinity,
        trailArmed: !!st.trailArmed,
        lastSeenQty: num(st.lastSeenQty, 0),
        updatedAt: new Date()
      }
    },
    { upsert: true }
  ).exec();
}

async function deleteState(contract) {
  const key = toKey(contract);
  tpState.delete(key);
  await TpState.deleteOne({ key }).exec();
}

/* ───────────────────────── §6. Close helpers ───────────────────────────── */

async function maybeCloseTrade(contract) {
  const key = toKey(contract);
  if (closingLocks.has(key)) return;
  closingLocks.add(key);
  try {
    const { data } = await axios.post(`${BASE}/api/close-trade`, { contract }, { timeout: 15000 });
    if (data?.success) LOG(`✅ Full close submitted: ${contract}`);
    else LOG(`⚠️ Full close responded not success for ${contract}`, data || '');
  } catch (err) {
    LOG(`❌ Full close error for ${contract}:`, err.response?.data || err.message);
  } finally {
    setTimeout(() => closingLocks.delete(key), CFG.closeLockMs);
  }
}

async function maybePartialClose(contract, fraction) {
  const key = toKey(contract);
  if (closingLocks.has(key)) return;
  closingLocks.add(key);

  try {
    try {
      const { data } = await axios.post(
        `${BASE}/api/partial-close`,
        { contract, fraction },
        { timeout: 15000 }
      );
      if (data?.success) {
        LOG(`✅ Partial close ${Math.round(fraction * 100)}%: ${contract}`);
        return;
      }
      LOG('⚠️ /api/partial-close responded but not success:', data);
    } catch {
      try {
        const { data } = await axios.post(
          `${BASE}/api/close-trade`,
          { contract, fraction },
          { timeout: 15000 }
        );
        if (data?.success) {
          LOG(`✅ Partial (via close-trade) ${Math.round(fraction * 100)}%: ${contract}`);
          return;
        }
        LOG('⚠️ /api/close-trade (fraction) responded but not success:', data);
      } catch {
        LOG('⚠️ No partial-close API available. Skipping partial to avoid full exit.');
      }
    }
  } finally {
    setTimeout(() => closingLocks.delete(key), CFG.closeLockMs);
  }
}

/* ───────────────────────── §7. Main loop (singleton) ───────────────────── */

if (!globalThis.__POSEIDON_TP_MON_TIMER__) {
  globalThis.__POSEIDON_TP_MON_TIMER__ = setInterval(async () => {
    try {
      const trades = getOpenTradesWithTPSL();

      for (const t of trades) {
        const contract = t.contract || t.symbol;
        const key = toKey(contract);

        const slPct     = num(t.slPercent, 0);
        const userTpPct = num(t.tpPercent, 0);

        const snap = await fetchPositionSnapshot(contract);
        if (!snap) {
          throttleLog(key, `⏭️ Skip ${contract}: no snapshot`);
          pushFeed({ contract, state: 'NO_SNAPSHOT', text: `⏭️ ${contract}: no snapshot yet` });
          continue;
        }

        const { roi, price, side, size } = snap;
        if (!Number.isFinite(roi)) {
          throttleLog(key, `⏭️ Skip ${contract}: ROI not ready (price=${Number.isFinite(price) ? price : '--'})`);
          pushFeed({
            contract,
            state: 'ROI_WAIT',
            text: `⏳ ${contract}: ROI not ready (price=${Number.isFinite(price) ? price : '--'})`,
          });
          continue;
        }

        const isLong = isLongFromSide(side);
        const st = await loadState(contract);

        // SL: close all if ROI <= -SL%
        const slHit = slPct > 0 && roi <= -slPct;
        if (slHit) {
          pushFeed({
            contract,
            roi,
            state: 'SL_HIT',
            text: `🛑 SL hit on ${contract}: ROI ${roi.toFixed(2)}% ≤ -${slPct}% → closing all`,
          });
          LOG(`🛑 SL hit ${contract} | ROI=${roi.toFixed(2)}% ≤ -${slPct}% → close all`);
          await maybeCloseTrade(contract);
          await deleteState(contract);
          continue;
        }

        // TP1: once at 100% ROI → take 40% partial
        if (!st.tp1Done && roi >= CFG.tp1RoiPct) {
          pushFeed({
            contract,
            roi,
            state: 'TP1_TAKEN',
            text: `🎯 TP1 reached ${contract}: ROI ${roi.toFixed(2)}% ≥ ${CFG.tp1RoiPct}% → taking ${Math.round(CFG.tp1TakeFraction * 100)}%`,
          });
          LOG(`🎯 TP1 ${contract} | ROI=${roi.toFixed(2)}% ≥ ${CFG.tp1RoiPct}% → take ${Math.round(CFG.tp1TakeFraction*100)}%`);
          await maybePartialClose(contract, CFG.tp1TakeFraction);
          st.tp1Done = true;
          st.trailArmed = true;
          st.peakRoi = roi;
          st.lastSeenQty = size;
          await saveState(contract, st);
          continue;
        }

        // Trailing remainder after TP1
        if (st.trailArmed) {
          if (roi > st.peakRoi) st.peakRoi = roi;
          const giveBack = st.peakRoi * CFG.trailGivebackPct;
          const trailTrigger = st.peakRoi - giveBack;

          pushFeed({
            contract,
            roi,
            peak: st.peakRoi,
            state: 'TRAILING',
            text: `🚀 Trailing ${contract}: ROI ${roi.toFixed(2)}% • peak ${st.peakRoi.toFixed(2)}% • stop ≈ ${trailTrigger.toFixed(2)}%`,
          });

          throttleLog(
            key,
            `🚀 Trail ${contract} | ROI=${roi.toFixed(2)}% • peak=${st.peakRoi.toFixed(2)}% • stop≈${trailTrigger.toFixed(2)}%`
          );

          if (roi <= trailTrigger) {
            pushFeed({
              contract,
              roi,
              peak: st.peakRoi,
              state: 'TRAIL_EXIT',
              text: `✅ Trailing stop: ROI ${roi.toFixed(2)}% ≤ ${trailTrigger.toFixed(2)}% → closing remainder`,
            });
            LOG(`✅ Trailing stop ${contract}: ROI ${roi.toFixed(2)}% ≤ ${trailTrigger.toFixed(2)}% → close remainder`);
            await maybeCloseTrade(contract);
            await deleteState(contract);
            continue;
          }
        } else {
          // Pre-TP1 monitoring
          const progress = Math.max(0, Math.min(100, (roi / CFG.tp1RoiPct) * 100));
          pushFeed({
            contract,
            roi,
            state: 'PURSUIT',
            text: `🎯 Pursuing TP1 (100%) on ${contract}: progress ${progress.toFixed(0)}% (ROI ${roi.toFixed(2)}%)`,
          });

          throttleLog(
            key,
            `🟡 Hold ${contract} | ROI=${roi.toFixed(2)}%` + (userTpPct > 0 ? ` • userTP=${userTpPct}%` : '')
          );
        }

        st.lastSeenQty = size;
        await saveState(contract, st);
      }
    } catch (err) {
      LOG('❌ loop error:', err.message || err);
    }
  }, CFG.pollMs);
} else {
  LOG('⏭️ already running, skip starting a second timer');
}
/* ───────────────────────── §8. Log throttle ────────────────────────────── */

function throttleLog(key, msg, ms = 3000) {
  const t = Date.now();
  const last = lastLog.get(key) || 0;
  if (t - last >= ms) {
    LOG(msg);
    lastLog.set(key, t);
  }
}

/* ───────────────────────── §9. Public API (exports) ────────────────────── */

/** Return last 100 feed lines for the UI. */
function getTpSnapshots() {
  return { feed: tpFeed.slice(-100) };
}

/** Ensure a seed line exists when a trade opens (so UI doesn't show "no snapshot yet"). */
function ensureSnapshot(contract) {
  if (!contract) return;
  const exists = tpFeed.some(
    e => e.contract === contract && (e.state === 'OPENED' || e.state === 'PURSUIT' || e.state === 'TRAILING')
  );
  if (!exists) {
    pushFeed({
      contract,
      roi: null,
      state: 'OPENED',
      text: `🟢 Opened ${contract} — waiting for first ROI snapshot…`,
    });
  }
}

/** Allow other modules to push arbitrary TP feed entries. */
function pushTpFeed(entry) {
  pushFeed(entry);
}

module.exports = {
  ensureSnapshot,
  pushTpFeed,
  getTpSnapshots,
};