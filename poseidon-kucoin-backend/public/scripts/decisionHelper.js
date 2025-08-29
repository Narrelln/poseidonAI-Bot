// === /public/scripts/decisionHelper.js — Frontend Poseidon Trade Evaluator (ES Module)
/* eslint-disable no-console */

import { getCachedScannerData } from './scannerCache.js';
import { getWalletBalance } from './walletModule.js';      // real or stubbed in your build
import { openDualEntry } from './ppdaEngine.js';           // safe: no-op if you stub it

// ------------------------------ small utils ------------------------------
const two = (n) => Number(n).toFixed(2);
const n   = (v) => { const x = Number(v); return Number.isFinite(x) ? x : NaN; };

function normalizeBase(sym='') {
  return String(sym).toUpperCase().replace(/[-_]/g,'').replace(/USDTM?$/,'').replace(/USDT$/,'');
}
function toContract(sym='') {
  let s = String(sym || '').toUpperCase();
  if (/^[A-Z0-9]+-USDTM$/.test(s)) return s;
  s = s.replace(/[-_]/g,'');
  if (s.endsWith('USDTM')) return s.replace(/USDTM$/,'') + '-USDTM';
  if (s.endsWith('USDT'))  return s.replace(/USDT$/,'')  + '-USDTM';
  return `${s}-USDTM`;
}
function sideFromSignal(sig='') {
  const s = String(sig).toLowerCase();
  if (s === 'bullish') return 'BUY';
  if (s === 'bearish') return 'SELL';
  return null;
}
function fmtPx(p) { const x=Number(p); if (!Number.isFinite(x)) return '—'; return x<1?x.toFixed(5):x.toFixed(4); }
function fmtUsd(x){ const v=Number(x); return Number.isFinite(v)?`$${v.toFixed(2)}`:'$0.00'; }

function getScannerToken(symbol, top50=[]) {
  const norm = normalizeBase(symbol);
  return top50.find(t => normalizeBase(t.symbol) === norm);
}

// ------------------------------ profiles ------------------------------
const PROFILES = {
  'cycle-24-48': {
    basePercent: (confidence) => (confidence >= 85 ? 0.30 : 0.20),
    tpPercent: 40,   // UI hint; backend TP ladder can override
    slPercent: 8,
  },
  'breakout-momo': {
    basePercent: (confidence) => (confidence >= 85 ? 0.25 : 0.12),
    tpPercent: 30,
    slPercent: 6,
  },
  'range-revert': {
    basePercent: (confidence) => (confidence >= 85 ? 0.18 : 0.10),
    tpPercent: 15,
    slPercent: 5,
  }
};
function pickProfileFromStrategy(strategy) {
  switch (String(strategy || '').toLowerCase()) {
    case 'cycle':    return 'cycle-24-48';
    case 'breakout': return 'breakout-momo';
    default:         return 'range-revert';
  }
}

// ------------------------------ gates & cooldowns ------------------------------
const APPROVED_SOURCES = new Set(['CYCLE_WATCHER','REVERSAL_WATCHER','FORCE_TRADE','MANUAL']);
function botEnabledSync() {
  try { return window.__poseidonBotActive === true; } catch { return false; }
}
async function botEnabledServer() {
  try { const r = await fetch('/api/bot', { cache: 'no-store' }); const j = await r.json(); return !!j?.enabled; }
  catch { return null; }
}
function isExecAllowed(signal) {
  if (signal.allowExecute !== true) return false;
  if (!APPROVED_SOURCES.has(String(signal.source || '').toUpperCase())) return false;
  return true;
}
const HELPER_COOLDOWN_MS = 6000;
const lastFire = new Map(); // contract -> ts
function inCooldown(contract){ return Date.now() - (lastFire.get(contract)||0) < HELPER_COOLDOWN_MS; }
function touchCooldown(contract){ lastFire.set(contract, Date.now()); }

// ------------------------------ PPDA / brewing ------------------------------
const BREW_FLOOR = 40;
function looksLikeBrewing(signal={}) {
  const src = String(signal.source || '').toUpperCase();
  const phase = String(signal.phase || '').toLowerCase();
  const reasons = (Array.isArray(signal.reasons) ? signal.reasons : []).join(' ').toLowerCase();
  return signal.brewing === true
      || (src === 'CYCLE_WATCHER' && phase === 'impulse')
      || reasons.includes('near24hlow') || reasons.includes('near 24h low');
}

// ------------------------------ voice/audit bridge ------------------------------
function emitAudit(event, detail) {
  try {
    if (!window.POSEIDON_SIGNAL_AUDIT) return;
    window.dispatchEvent(new CustomEvent('poseidon:signal', {
      detail: { event, at: Date.now(), ...detail }
    }));
  } catch {}
}

// ------------------------------ main entry ------------------------------
/**
 * evaluatePoseidonDecision (frontend)
 * @param {string} symbol   e.g., "ADA-USDTM" | "ADAUSDT"
 * @param {object} signal   fields from FSM: { signal, confidence, strategy, source, allowExecute, phase, rsi, price, quoteVolume, leverage, tpPercent, slPercent, manual }
 * @returns {object}        { success, executed?, reason?, tx? }
 */
export async function evaluatePoseidonDecision(symbol, signal = {}) {
  const contract = toContract(symbol || signal.symbol || '');
  const base     = normalizeBase(contract);

  try {
    // --- scanner context
    const { top50 = [] } = await getCachedScannerData();
    const row = getScannerToken(contract, top50) || {};
    const livePrice  = n(signal.price ?? row.price);
    const quoteVol   = n(signal.quoteVolume ?? row.quoteVolume24h ?? row.quoteVolume ?? row.turnover ?? row.volume);
    const taSideHint = sideFromSignal(signal.signal);
    const sideHint   = (String(signal.sideHint || '').toLowerCase() === 'short') ? 'SELL'
                      : (String(signal.sideHint || '').toLowerCase() === 'long') ? 'BUY'
                      : taSideHint;

    // --- profile + confidence (brewing lift)
    const rawConf  = Number(signal.confidence) || 0;
    const effConf  = looksLikeBrewing(signal) ? Math.max(rawConf, BREW_FLOOR) : rawConf;
    const profileName = signal.profile || pickProfileFromStrategy(signal.strategy);
    const profile = PROFILES[profileName] || PROFILES['range-revert'];
    const allocPct = profile.basePercent(effConf);

    // --- execution gates
    if (!isExecAllowed(signal)) {
      emitAudit('analysis', { symbol: contract, side: sideHint || 'HOLD', price: livePrice, confidence: rawConf, reason: 'not_allowed' });
      return { success: true, executed: false, reason: 'not_allowed' };
    }

    // bot must be ON (frontend + server)
    let botOn = botEnabledSync();
    if (!botOn) {
      const s = await botEnabledServer();
      if (s === true) botOn = true;
    }
    if (!botOn && signal.source !== 'MANUAL') {
      emitAudit('analysis', { symbol: contract, side: sideHint || 'HOLD', price: livePrice, confidence: rawConf, reason: 'bot_off' });
      return { success: true, executed: false, reason: 'bot_off' };
    }

    // cooldown
    if (inCooldown(contract) && signal.overrideCooldown !== true) {
      return { success: true, executed: false, reason: 'helper_cooldown' };
    }

    // side selection (last resort HOLD)
    const side = sideHint || (rawConf >= 50 ? 'BUY' : 'HOLD');
    if (side === 'HOLD') {
      emitAudit('analysis', { symbol: contract, side: 'HOLD', price: livePrice, confidence: rawConf, reason: 'ambiguous_side' });
      touchCooldown(contract);
      return { success: true, executed: false, reason: 'ambiguous_side' };
    }

    // --- PPDA shortcut in nasty phases
    if (!signal.manual && ['peak','reversal'].includes(String(signal.phase||'').toLowerCase())) {
      try {
        openDualEntry?.({ symbol: contract, highConfidenceSide: 'SHORT', lowConfidenceSide: 'LONG', baseAmount: 1 });
        emitAudit('placed', { symbol: contract, side: 'PPDA', price: livePrice, confidence: rawConf, reason: `phase:${signal.phase}` });
        touchCooldown(contract);
        return { success: true, executed: true, tx: { mode: 'ppda' } };
      } catch {}
    }

    // --- wallet sizing (Quantity USDT model)
    let wallet = { total: 0, available: 0 };
    try {
      const w = await getWalletBalance();
      wallet = typeof w === 'number' ? { total: w, available: w } : (w || wallet);
    } catch {}

    const minNotional = Number(window.POSEIDON_MIN_NOTIONAL ?? 25);
    const riskBudget  = Math.max(minNotional, Number((Number(wallet.available || 0) * allocPct).toFixed(2)) || minNotional);

    // leverage clamp: majors allow more
    const MAJORS = new Set(['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOGE','LINK','LTC','XBT']);
    const reqLev = Number(signal.leverage) || (MAJORS.has(base) ? 10 : 5);
    const lev    = MAJORS.has(base) ? Math.max(1, Math.min(reqLev, 50)) : Math.max(1, Math.min(reqLev, 20));

    const tpPercent = Number.isFinite(Number(signal.tpPercent)) ? Number(signal.tpPercent) : profile.tpPercent;
    const slPercent = Number.isFinite(Number(signal.slPercent)) ? Number(signal.slPercent) : profile.slPercent;

    // --- unified confirmation preview (for logs/UI)
    const entry  = livePrice;
    const target = side === 'BUY' ? entry * (1 + tpPercent/100) : entry * (1 - tpPercent/100);
    console.log(`🎯 ${side} ${contract} | ${fmtPx(entry)} → ${fmtPx(target)} | ${fmtUsd(riskBudget)} | ${two(lev)}x | TP ${two(tpPercent)}%`);

    emitAudit('decision', {
      symbol: contract,
      side,
      confidence: rawConf,
      price: livePrice,
      reason: `candidate conf=${rawConf} profile=${profileName}`
    });

    // --- place trade (frontend → backend)
    const payload = {
      symbol: contract,
      contract,
      side,
      notionalUsd: riskBudget, // Quantity USDT
      leverage: lev,
      tpPercent,
      slPercent,
      manual: !!signal.manual
    };

    const res = await fetch('/api/place-trade', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    const ok =
      json?.success || json?.result?.success || json?.code === 'SUCCESS' || json?.code === 'SUCCESS_WITH_WARNING';

    if (!ok) {
      console.warn('❌ place-trade failed:', json?.error || json?.result?.error || json);
      touchCooldown(contract);
      return { success: false, executed: false, error: String(json?.error || json?.result?.error || 'execution_failed') };
    }

    emitAudit('executed', { symbol: contract, side, confidence: rawConf, price: livePrice, reason: `TP ${tpPercent}%` });

    // pretty success line
    console.log(`✅ AUTO ${side === 'BUY' ? 'BUY' : 'SELL'} ${contract} | ${fmtPx(entry)} → ${fmtPx(target)} | ${fmtUsd(riskBudget)} | ${two(lev)}x | TP ${two(tpPercent)}%`);

    touchCooldown(contract);
    return { success: true, executed: true, tx: json, side, confidence: rawConf };

  } catch (err) {
    console.warn(`[DecisionHelper] fatal for ${symbol}:`, err?.message || err);
    return { success: false, executed: false, error: String(err?.message || err) };
  }
}

export default { evaluatePoseidonDecision };