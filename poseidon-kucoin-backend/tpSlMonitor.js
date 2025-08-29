/**
 * Poseidon — Module P01: TP/SL Monitor (ROI-based) + Persistence
 * --------------------------------------------------------------
 * Purpose:
 *   - Monitor open positions and manage exits using ROI (PnL / cost) instead of raw price %.
 *   - TP1 rule: when ROI >= 100%, take 40% partial once, then trail the remainder.
 *   - SL rule: when ROI <= -SL%, close fully.
 *   - Persist TP/Trail state in Mongo so restarts don’t lose context.
 *
 * Dependencies (patched):
 *   - utils/tradeLedger.list()  → derive open trades that have TP/SL set
 *   - utils/tradeLedger.reconcileAgainst(openSet)
 *   - GET /api/positions
 *   - POST /api/partial-close   (preferred for partial exits)
 *   - POST /api/close-trade     (fallback; ideally supports { fraction })
 *   - models/TpState.js (Mongoose model)
 *   - models/tpFeed.js (Mongo persistence for the live feed)
 *
 * Debugging:
 *   - Logs prefixed with [P01-TPMON]
 *   - Sections §1..§9 for quick navigation
 */

const axios = require('axios');
const { list, reconcileAgainst } = require('./utils/tradeLedger'); // ✅ ledger-based

const TpState = require('./models/tpState');
const TpFeedModel = require('./models/tpFeed');
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
 * API:
 *   - GET /api/tp-snapshots (see routes/tpStatusRoute.js)
 */
const FEED_MAX = 200;
const tpFeed = [];

/** Restore last FEED_MAX feed rows from Mongo into memory (oldest→newest). */
async function initTpFeed() {
  try {
    const rows = await TpFeedModel.find({})
      .sort({ ts: -1 })
      .limit(FEED_MAX)
      .lean()
      .exec();
    tpFeed.splice(0, tpFeed.length, ...rows.reverse());
    console.log(`[U03-TPFEED] restored ${tpFeed.length} lines from DB`);
  } catch (e) {
    console.warn('[U03-TPFEED] restore failed:', e.message);
  }
}

/* ---------- Pro feed formatting ---------- */

/** Map a state → styled message */
function renderFeedRow(row) {
  const c = (row.contract || '').toUpperCase();
  const S = (v) => (v === undefined || v === null ? '' : String(v));
  const pct = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}%` : S(v));
  const px  = (v) => (Number.isFinite(v) ? v.toFixed(4) : S(v));
  const bk  = (v) => (v ? `\`${v}\`` : '');

  switch (row.state) {
    case 'OPENED':
      return `✅ Entry Placed: ${bk(c)} • ${S(row.side)?.toUpperCase() || 'BUY/SELL'} • ${S(row.lev) ? `${row.lev}× Leverage` : ''}`.trim();

    case 'ORDER_ACCEPTED':
      return `✅ Order accepted for ${bk(c)} (${S(row.side)?.toUpperCase() || 'BUY/SELL'}) • lev ${S(row.lev) || '--'}x`;

    case 'CLOSE_REQ':
      return `🛑 Close Initiated: ${bk(c)} • Requested ${S(row.reqSide)?.toUpperCase() || 'CLOSE'} • Size: ${S(row.size) || '--'}`;

    case 'CLOSE_OK':
      return `✅ Position Closed: ${bk(c)} • ${S(row.side)?.toUpperCase() || '--'} • Size: ${S(row.size) || '--'} @ ${px(Number(row.price))}
  PnL: ${S(row.pnl)} USDT (${pct(Number(row.roi))})`;

    case 'CLOSE_FAIL':
      return `⚠️ Close Failed: ${bk(c)} — ${S(row.reason) || 'No position / exchange rejected'}`;

    case 'NO_POSITION':
      return `⚠️ No Position Found: ${bk(c)} — already closed on exchange`;

    case 'SL_HIT':
      return `🛑 Stop-Loss Hit: ${bk(c)} • ROI ${pct(Number(row.roi))} → Closing all`;

    case 'TP1_TAKEN':
      return `🎯 TP1 Reached: ${bk(c)} • ROI ${pct(Number(row.roi))} → Taking ${Math.round((row.takeFraction ?? 0.4) * 100)}%`;

    case 'TRAILING':
      return `🚀 Trailing: ${bk(c)} • ROI ${pct(Number(row.roi))} • Peak ${pct(Number(row.peak))} • Stop ≈ ${pct(Number(row.trailTrigger))}`;

    case 'TRAIL_EXIT':
      return `✅ Trailing Stop: ${bk(c)} • ROI ${pct(Number(row.roi))} ≤ stop → Closing remainder`;

    case 'PURSUIT':
      return `🎯 Pursuing TP1 (100%): ${bk(c)} • Progress ${S(row.progress) ?? '--'}% • ROI ${pct(Number(row.roi))}`;

    case 'ROI_WAIT':
      return `⏳ ROI Not Ready: ${bk(c)} • awaiting first snapshot`;

    case 'NO_SNAPSHOT':
      return `⏸️ ${bk(c)}: no snapshot yet`;

    case 'ROI_FAIL':
      return `❌ ROI Calc Error: ${bk(c)} • check pnl/cost fields`;

    default:
      return row.text || `${bk(c)} • ${S(row.state)}`;
  }
}

/** Persist one feed row to DB and hard-cap to FEED_MAX docs. */
async function persistFeedRow(row) {
  try {
    await TpFeedModel.create(row);
    const extra = await TpFeedModel.find({}, { _id: 1 })
      .sort({ ts: -1 })
      .skip(FEED_MAX)
      .lean()
      .exec();
    if (extra.length) {
      await TpFeedModel.deleteMany({ _id: { $in: extra.map(x => x._id) } });
    }
  } catch (e) {
    console.warn('[U03-TPFEED] persist failed:', e.message);
  }
}

/** Push one feed line: format → ring buffer → emit → persist (single source) */
function pushFeed(entry) {
  const row = { ts: Date.now(), ...entry };

  // compute helpers for nicer messages
  if (row.state === 'TRAILING' && row.peak != null && row.givebackPct != null) {
    const gb = Number(row.givebackPct);
    if (Number.isFinite(gb) && Number.isFinite(row.peak)) {
      row.trailTrigger = row.peak - (row.peak * gb);
    }
  }
  if (row.state === 'PURSUIT' && row.roi != null) {
    const tpTarget = 100;
    const prog = Math.max(0, Math.min(100, (Number(row.roi) / tpTarget) * 100));
    row.progress = Math.round(prog);
  }

  // format text if not present
  row.text = row.text || renderFeedRow(row);

  // in-memory ring
  tpFeed.push(row);
  if (tpFeed.length > FEED_MAX) tpFeed.splice(0, tpFeed.length - FEED_MAX);

  // backend trace
  console.log('[U03-TPFEED]', row.text);

  // websocket
  try {
    const io = globalThis.__POSEIDON_IO__;
    if (io) io.emit('tp-feed', row);
  } catch (_) {}

  // async persist
  persistFeedRow(row);
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
// retained for clarity; not required elsewhere right now
const isLongFromSide = (side) => {
  const s = String(side || '').toLowerCase();
  if (s.includes('buy') || s.includes('long')) return true;
  if (s.includes('sell') || s.includes('short')) return false;
  return true;
};

/* ───────────────────────── §4. Snapshot (ROI/price/side/size) ──────────── */

async function fetchPositionSnapshot(contractOrSymbol) {
  const want = toKey(parseToKucoinContractSymbol(contractOrSymbol));

  try {
    const { data } = await axios.get(`${BASE}/api/positions`, { timeout: 8000 });
    const list = (data && data.positions) || [];

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
      console.warn('[TPMON] no match for', contractOrSymbol,
        'first candidates=', list.slice(0, 3).map(r => (r.contract || r.symbol || r.instId || r.instrumentId)));
      return null;
    }

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
      side:  (p.side || ''),
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
  if (tpState.has(key)) return tpState.get(key);

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
      // 0) Pull exchange truth and build a set of open contract keys
      const posRes  = await axios.get(`${BASE}/api/positions`, { timeout: 8000 }).catch(() => ({ data: {} }));
      const posList = (posRes?.data?.positions) || [];
      const openSet = new Set(
        posList.map(p => toKey(parseToKucoinContractSymbol(
          p.contract || p.symbol || p.instId || p.instrumentId || p.apiSymbol || p.symbolCode
        )))
      );

      // 0.1) Reconcile local OPEN trades with exchange (closes ghosts)
      try {
        await reconcileAgainst(openSet); // ✅ pass the live open set
      } catch (_) {}

      // 1) Iterate locally OPEN trades (after reconciliation)
      const all = await list(200).catch(() => []); // ✅ guard: never crash loop
      const trades = all.filter(t =>
        String(t.status).toUpperCase() === 'OPEN' &&
        (t.tpPercent !== '' || t.slPercent !== '')
      );

      for (const t of trades) {
        const contract = t.contract || t.symbol;
        const key = toKey(parseToKucoinContractSymbol(contract));

        // Skip + clear state if not really open on exchange
        if (!openSet.has(key)) {
          await deleteState(contract);
          continue;
        }

        const slPct     = num(t.slPercent, 0);
        const userTpPct = num(t.tpPercent, 0);

        const snap = await fetchPositionSnapshot(contract);
        if (!snap) {
          // ensure a single seed line exists; don't spam
          ensureSnapshot(contract);
          continue;
        }

        const { roi, price, side, size } = snap;
        if (!Number.isFinite(roi)) {
          throttleLog(key, `⏭️ Skip ${contract}: ROI not ready (price=${Number.isFinite(price) ? price : '--'})`);
          pushFeed({ contract, state: 'ROI_WAIT' });
          continue;
        }

        const st = await loadState(contract);

        // SL: close all if ROI <= -SL%
        const slHit = slPct > 0 && roi <= -slPct;
        if (slHit) {
          pushFeed({ contract, roi, state: 'SL_HIT' });
          LOG(`🛑 SL hit ${contract} | ROI=${roi.toFixed(2)}% ≤ -${slPct}% → close all`);
          await maybeCloseTrade(contract);
          await deleteState(contract);
          continue;
        }

        // TP1: once at 100% ROI → take 40% partial
        if (!st.tp1Done && roi >= CFG.tp1RoiPct) {
          pushFeed({ contract, roi, state: 'TP1_TAKEN', takeFraction: CFG.tp1TakeFraction });
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
            givebackPct: CFG.trailGivebackPct,
            trailTrigger
          });

          throttleLog(
            key,
            `🚀 Trail ${contract} | ROI=${roi.toFixed(2)}% • peak=${st.peakRoi.toFixed(2)}% • stop≈${trailTrigger.toFixed(2)}%`
          );

          if (roi <= trailTrigger) {
            pushFeed({ contract, roi, peak: st.peakRoi, state: 'TRAIL_EXIT' });
            LOG(`✅ Trailing stop ${contract}: ROI ${roi.toFixed(2)}% ≤ ${trailTrigger.toFixed(2)}% → close remainder`);
            await maybeCloseTrade(contract);
            await deleteState(contract);
            continue;
          }
        } else {
          // Pre-TP1 monitoring
          const progress = Math.max(0, Math.min(100, (roi / CFG.tp1RoiPct) * 100));
          pushFeed({ contract, roi, state: 'PURSUIT', progress });
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

function getTpSnapshots() {
  return { feed: tpFeed.slice(-100) };
}

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

function pushTpFeed(entry) { pushFeed(entry); }

module.exports = {
  ensureSnapshot,
  pushTpFeed,
  getTpSnapshots,
  initTpFeed,   // exported so you can hydrate explicitly on server start
};