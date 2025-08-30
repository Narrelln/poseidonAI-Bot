/* eslint-disable no-console */
// jobs/adaptiveTuner.js — adjusts confidence floors per category using recent QA outcomes

const fs = require('fs');
const path = require('path');
const SignalAudit = require('../models/SignalAudit');

const MAJORS = new Set(['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC']);
const MEMES  = new Set(['WIF','TRUMP','MYRO','PEPE','FLOKI','BONK','SHIB']);

const POLICY_PATH = path.join(__dirname, '..', 'config', 'adaptivePolicy.json');

function baseOf(sym='') {
  return String(sym).toUpperCase().replace(/[^A-Z0-9-]/g,'').replace(/USDTM?$/,'').replace(/-.*$/,'');
}
function categoryOf(symbol) {
  const b = baseOf(symbol);
  if (MAJORS.has(b)) return 'major';
  if (MEMES.has(b))  return 'meme';
  return 'other';
}

function loadPolicy() {
  try { return JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8')); }
  catch { return { minConf: { major: 70, meme: 70, other: 70 }, updatedAt: Date.now() }; }
}
function savePolicy(p) {
  try { fs.mkdirSync(path.dirname(POLICY_PATH), { recursive: true }); } catch {}
  fs.writeFileSync(POLICY_PATH, JSON.stringify(p, null, 2));
}

// EWMA helper (more weight to recent)
function ewma(arr, alpha = 0.3) {
  let v = null;
  for (const x of arr) { v = v == null ? x : alpha * x + (1 - alpha) * v; }
  return v == null ? 0 : v;
}

/**
 * Adjust policy:
 *  - look at last N hours outcomes for horizons [4h,12h,1d]
 *  - compute win-rate per category (EWMA)
 *  - if < 45%: raise minConf by 2 (cap 85)
 *  - if > 60%: lower minConf by 2 (floor 60)
 */
async function tuneOnce(io, hours = 48) {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const docs = await SignalAudit.find({ createdAt: { $gte: since }, event: 'analysis' }).lean();

  const buckets = { major: [], meme: [], other: [] };

  for (const d of docs) {
    const cat = categoryOf(d.symbol);
    const results = Array.isArray(d.results) ? d.results : [];
    // Prefer longer-horizon signals for Poseidon (12h, 1d)
    const best = results
      .filter(r => Number.isFinite(r.horizonMs) && Number.isFinite(r.forwardRoiPct))
      .sort((a,b) => b.horizonMs - a.horizonMs)[0];

    if (best) {
      buckets[cat].push(best.correct ? 1 : 0);
    }
  }

  const policy = loadPolicy();
  const out = { ...policy, minConf: { ...policy.minConf } };

  for (const cat of Object.keys(buckets)) {
    const wr = ewma(buckets[cat], 0.25); // 0..1
    if (!Number.isFinite(wr) || buckets[cat].length < 10) continue;

    const cur = Number(out.minConf[cat] ?? 70);
    let next = cur;
    if (wr < 0.45) next = Math.min(85, cur + 2);
    if (wr > 0.60) next = Math.max(60, cur - 2);

    if (next !== cur) {
      out.minConf[cat] = next;
      console.log(`[Adaptive] ${cat}: winRate=${(wr*100).toFixed(1)}% → minConf ${cur} → ${next}`);
    } else {
      console.log(`[Adaptive] ${cat}: winRate=${(wr*100).toFixed(1)}% (no change) minConf=${cur}`);
    }
  }

  out.updatedAt = Date.now();
  savePolicy(out);

  // Broadcast to FE (optional)
  try { io?.emit?.('policy:update', { type: 'minConf', payload: out.minConf, updatedAt: out.updatedAt }); } catch {}
  return out;
}

function startAdaptiveTuner({ io, intervalMs = 5 * 60 * 1000 } = {}) {
  console.log('🧠 AdaptiveTuner starting…');
  // run soon, then interval
  tuneOnce(io, 48).catch(e => console.warn('[Adaptive] first run error:', e?.message || e));
  return setInterval(() => tuneOnce(io, 48).catch(e => console.warn('[Adaptive] run error:', e?.message || e)), intervalMs);
}

module.exports = { startAdaptiveTuner, tuneOnce, loadPolicy };