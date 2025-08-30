// handlers/decisionHelper.js  (patched for bot-driven execution)
/* eslint-disable no-console */

const axios = require('axios');
const { evaluatePoseidonDecision: coreEvaluate } =
  require('./evaluatePoseidonDecision.js');
const { recordTradeResult } = require('./data/tokenPatternMemory');
const { fetchTA } = require('./taClient.js');
let rescueManager = null;
try { rescueManager = require('./rescueManager'); } catch (_) {}
// 🔸 use your config loader path
const { getProfile } = require('../config/policyLoader');

// Optional: Learning Memory trace logger (soft import)
let recordDecisionTrace = null;
try { ({ recordDecisionTrace } = require('./learningMemory')); } catch (_) {}

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

/* ---------------- Symbol utils ---------------- */
function baseOf(sym = '') {
  return String(sym).toUpperCase().replace(/[-_]/g, '').replace(/USDTM?$/, '').replace(/USDT$/, '');
}
function toContract(any) {
  const b = baseOf(any);
  return b ? `${b}-USDTM` : '';
}
function toSpot(symbolOrContract = '') {
  const s = String(symbolOrContract).toUpperCase();
  if (s.endsWith('-USDTM')) return s.replace('-USDTM', 'USDT');
  if (s.endsWith('USDT')) return s;
  return `${baseOf(s)}USDT`;
}

/* ---------------- Exec gates (NOW bot-aware) ---------------- */
// Old env gate stays supported:
function envGate() {
  return String(process.env.POSEIDON_ALLOW_EXECUTION || 'false').toLowerCase() === 'true';
}
// New: backend bot toggle (set by /api/bot route or anywhere else):
function botGate() {
  try {
    if (globalThis && globalThis.__POSEIDON_BOT_ENABLED === true) return true;
  } catch {}
  try {
    if (global && global.__poseidonBotEnabled === true) return true;
  } catch {}
  return false;
}
// Single source of truth the helper uses:
function isExecEnvOpen() {
  return envGate() || botGate();
}

// ✅ Allow these sources to request execution (added PREDATOR_SCALP)
const APPROVED_SOURCES = new Set([
  'REVERSAL_WATCHER',
  'CYCLE_WATCHER',
  'PREDATOR_SCALP',   // <-- added so Predator trades can execute
  'FORCE_TRADE',
  'MANUAL',
  // tolerance for other emitters you might use:
  'AUTOPILOT',
  'SCANNER'
]);

function isExecutionAllowed(signal = {}) {
  const allowFlag = (signal.allowExecute === true) || false;
  const srcOK     = APPROVED_SOURCES.has(String(signal.source || '').toUpperCase());
  const gateOpen  = isExecEnvOpen();
  return allowFlag && srcOK && gateOpen;
}

/* ---------------- helper-level cooldown (anti-spam) ---------------- */
const HELPER_COOLDOWN_MS = Number(process.env.DECISION_HELPER_COOLDOWN_MS || 6000);
const lastHelperFireAt = new Map(); // contract -> ts
function isInHelperCooldown(contract) {
  const last = lastHelperFireAt.get(contract) || 0;
  return Date.now() - last < HELPER_COOLDOWN_MS;
}
function touchHelperCooldown(contract) { lastHelperFireAt.set(contract, Date.now()); }
function msLeft(contract) {
  const last = lastHelperFireAt.get(contract) || 0;
  const left = HELPER_COOLDOWN_MS - (Date.now() - last);
  return left > 0 ? left : 0;
}

/* ---------------- trace id ---------------- */
function ensureTraceId(signal) {
  if (signal && signal.traceId) return String(signal.traceId);
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------- profile picker ---------------- */
// Map sources to execution profiles (explicit map incl. Predator)
function pickProfileName(signal = {}) {
  if (signal.profile) return String(signal.profile);
  const src = String(signal.source || '').toUpperCase();
  if (src === 'CYCLE_WATCHER')    return 'cycle-24-48';
  if (src === 'PREDATOR_SCALP')   return 'range-revert';   // safe default profile for scalps
  if (src === 'REVERSAL_WATCHER') return 'range-revert';
  return 'range-revert';
}

/* ---------------- brewing detector ---------------- */
function looksLikeBrewing(signal = {}) {
  const src   = String(signal.source || '').toUpperCase();
  const phase = String(signal.phase || '').toLowerCase();
  const reasons = (Array.isArray(signal.reasons) ? signal.reasons : []).join(' ').toLowerCase();
  const explicit = signal.brewing === true;
  return explicit ||
         (src === 'CYCLE_WATCHER' && phase === 'impulse') ||
         reasons.includes('near24hlow') || reasons.includes('near24h') || reasons.includes('near 24h low');
}

/* ---------------- pretty confirmation helpers ---------------- */
const two = (n) => Number(n).toFixed(2);
function fmtPx(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return '—';
  return n < 1 ? n.toFixed(5) : n.toFixed(2);
}
function fmtUsd(x) {
  const n = Number(x);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '$0.00';
}
function prettySide(s) {
  const ss = String(s || '').toUpperCase();
  return ss === 'SELL' || ss === 'SHORT' ? 'SELL' : 'BUY';
}
function pickTpPercent(evaluatorResult, policyFromProfile, signal) {
  const d = evaluatorResult?.tx?.data || evaluatorResult?.data || evaluatorResult?.order || {};
  if (Number.isFinite(d.tpPercent)) return Number(d.tpPercent);
  if (Number.isFinite(evaluatorResult?.tpPercent)) return Number(evaluatorResult.tpPercent);
  if (Number.isFinite(signal?.tpPercent)) return Number(signal.tpPercent);
  if (Array.isArray(policyFromProfile?.tpPercents) && policyFromProfile.tpPercents.length) {
    const head = Number(policyFromProfile.tpPercents[0]);
    if (Number.isFinite(head)) return head;
  }
  return 30;
}
function calcTarget(entry, tpPercent, side) {
  const e = Number(entry);
  const t = Number(tpPercent);
  if (!(e > 0) || !(t >= 0)) return null;
  const isBuy = prettySide(side) === 'BUY';
  const mul = isBuy ? (1 + t/100) : (1 - t/100);
  return e * mul;
}
function logUnifiedConfirmation(contract, side, result, policy, signal) {
  try {
    if (!result?.executed) return;
    const d = result?.tx?.data || result?.data || result?.order || {};
    const entry =
      Number(d.entry) || Number(d.price) || Number(result.entry) || Number(signal?.price);
    const lev =
      Number(d.leverage) || Number(result.leverage) || Number(signal?.leverage) || 1;
    const notional =
      Number(d.notionalUsd) || Number(d.value) || Number(signal?.notionalUsd) || Number(signal?.margin) || 0;

    const tpPct  = pickTpPercent(result, policy, signal);
    const target = calcTarget(entry, tpPct, side);

    const line =
      `✅ ${result?.tx?.mode === 'ppda' ? 'PPDA' : 'AUTO'} ${prettySide(side)} ${contract} | ` +
      `${fmtPx(entry)} → ${fmtPx(target)} | ${fmtUsd(notional)} | ${two(lev)}x | TP ${two(tpPct)}%`;

    console.log(line);
  } catch {
    console.log('✅ Trade executed.');
  }
}

/* ---------------- public API ---------------- */
async function evaluatePoseidonDecision(symbol, signal = {}) {
  const contract = toContract(symbol || signal?.symbol || '');
  const normalized = contract || symbol;
  if (!normalized) return { ok: false, error: 'No symbol/contract provided' };

  const traceId = ensureTraceId(signal);

  // If caller didn’t set allowExecute but the bot gate is ON, enable it here.
  if (signal.allowExecute !== true && isExecEnvOpen()) {
    signal = { ...signal, allowExecute: true };
  }

  const allowed = isExecutionAllowed(signal);

  // --- Brewing confidence floor (profile gate only)
  const BREW_FLOOR = Number(process.env.BREWING_CONFIDENCE_FLOOR || 40);
  const rawConf    = Number(signal.confidence) || 0;
  const isBrewing  = looksLikeBrewing(signal);
  const effectiveConfidence = isBrewing ? Math.max(rawConf, BREW_FLOOR) : rawConf;

  // Helper cooldown (unless override)
  const overrideCooldown = signal.overrideCooldown === true;
  if (!overrideCooldown && isInHelperCooldown(normalized)) {
    const left = msLeft(normalized);
    try { console.log(`[DecisionHelper] ${normalized} • ⏱️ helper-cooldown ${left}ms left • trace=${traceId}`); } catch {}
    return { ok: true, success: false, skipped: 'helper_cooldown', cooldownMsLeft: left, traceId };
  }

  // Optional trace write (pre-evaluate)
  try {
    if (typeof recordDecisionTrace === 'function') {
      recordDecisionTrace(toSpot(normalized), {
        traceId,
        source: String(signal.source || '').toUpperCase() || null,
        phase:  signal.phase || null,
        side:   signal.sideHint || null,
        confidence: rawConf,
        price:  Number(signal.price) || null
      });
    }
  } catch {}

  try {
    const src  = String(signal.source || 'UNKNOWN').toUpperCase();
    const ph   = signal.phase || 'n/a';
    const side = signal.sideHint || 'n/a';
    const why  = Array.isArray(signal.reasons) ? signal.reasons.join(' | ') : '';
    console.log(
      `[DecisionHelper] ${normalized} • trace=${traceId} • src=${src} • conf=${rawConf}% (eff=${effectiveConfidence}%) • phase=${ph} • sideHint=${side}` +
      ` • allowExec=${allowed} • gate=${isExecEnvOpen() ? 'OPEN' : 'CLOSED'}${why ? ` • reasons=[${why}]` : ''}`
    );
  } catch {}

  // 🔸 Load adaptive profile
  const profileName = pickProfileName(signal);
  const profile = getProfile(profileName) || { open: true, minConfidence: 0 };

  // Gate with effective confidence (brewing floor applies here)
  if (profile.open === false) {
    return { ok: true, success: false, skipped: 'profile_closed', profile: profileName, traceId };
  }
  if (Number.isFinite(profile.minConfidence) && effectiveConfidence < Number(profile.minConfidence)) {
    return {
      ok: true, success: false, skipped: 'below_min_confidence',
      required: Number(profile.minConfidence), got: effectiveConfidence,
      profile: profileName, traceId
    };
  }

  // Build policy envelope for the core:
  const execPayload = {
    ...signal,
    // keep the original confidence visible to the evaluator
    confidence: rawConf,
    traceId,
    profile: profileName,
    policy: {
      ...(Array.isArray(profile.tpPercents) ? { tpPercents: profile.tpPercents.slice() } : {}),
      ...(Number.isFinite(profile.slPercent) ? { slPercent: profile.slPercent } : {}),
      ...(profile.dca ? { dca: profile.dca } : {}),
      ...(profile.trailing !== undefined ? { trailing: profile.trailing } : {}),
      ...(profile.lockOnRetest !== undefined ? { lockOnRetest: profile.lockOnRetest } : {}),
      ...(profile.strict75 !== undefined ? { strict75: profile.strict75 } : {}),
      ...(profile.cooldownMs !== undefined ? { cooldownMs: profile.cooldownMs } : {}),
      ...(Number.isFinite(profile.minConfidence) ? { minConfidence: Number(profile.minConfidence) } : {})
    }
  };

  if (allowed) {
    try {
      const result = await coreEvaluate(normalized, execPayload);
      touchHelperCooldown(normalized);

      // 🔔 If the trade actually executed, print the unified confirmation line
      if (result && result.executed) {
        const sideFinal =
          result.side ||
          (String(signal.sideHint || '').toLowerCase() === 'short' ? 'SELL' : 'BUY');
        logUnifiedConfirmation(normalized, sideFinal, result, execPayload.policy, signal);
      }

      await maybeRecordOutcome(normalized, signal, result);
      return result ?? { ok: true, success: true, traceId };
    } catch (err) {
      console.warn(`[DecisionHelper] evaluator failed for ${normalized} • trace=${traceId}:`, err?.message || err);
      return { ok: false, error: String(err?.message || err), traceId };
    }
  }

  // SAFE analysis path (no placement)
  try {
    const analyzed = await coreEvaluate(normalized, { ...execPayload, allowExecute: true, manual: true });
    touchHelperCooldown(normalized);
    return {
      ok: true, success: true, skipped: 'execution-disabled',
      reason: 'Execution disabled by gates; returned analysis only.',
      analyzed, traceId
    };
  } catch (err) {
    console.warn(`[DecisionHelper] safe-analysis failed for ${normalized} • trace=${traceId}:`, err?.message || err);
    return {
      ok: true, success: false, skipped: 'execution-disabled',
      reason: 'Execution disabled and analysis failed; check evaluator/TA service.',
      error: String(err?.message || err), traceId
    };
  }
}

async function maybeRecordOutcome(symbol, signal, result){
  try {
    if (result && result.success && result.outcome) {
      const { outcome, delta, tradeType, durationMs } = result;
      await recordTradeResult(symbol, {
        result: outcome === 'win' ? 'win' : 'loss',
        gain: Number(delta) || 0,
        duration: Number(durationMs) || 0,
        type: tradeType || (String(signal.sideHint||'').toLowerCase().includes('short') ? 'short' : 'long'),
        confidence: Number(signal.confidence) || 0,
        time: Date.now(),
      });
    }
  } catch (err) {
    console.warn(`[DecisionHelper] recordTradeResult failed for ${symbol}:`, err?.message || err);
  }
}

// Small helpers retained
async function getLatestPrice(symbol) {
  try {
    const ta = await fetchTA(symbol);
    const p = Number(ta?.price);
    return Number.isFinite(p) ? p : null;
  } catch (err) {
    console.warn(`[Price] Failed to fetch price for ${symbol}:`, err?.message || err);
    return null;
  }
}

async function listActiveSymbols() {
  try {
    const { data } = await axios.get(`${BASE}/api/scan-tokens`, { timeout: 6000 });
    const rows = Array.isArray(data?.top50) ? data.top50
               : Array.isArray(data?.data)  ? data.data
               : Array.isArray(data?.rows)  ? data.rows
               : Array.isArray(data)        ? data
               : [];
    const uniq = Array.from(new Set(
      rows.map(r => String(r?.symbol || r?.base || r || '').toUpperCase()).filter(Boolean)
    ));
    return uniq.slice(0, 50);
  } catch (err) {
    console.warn('[DecisionHelper] listActiveSymbols fallback (scan API failed):', err?.message || err);
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
  }
}

module.exports = {
  evaluatePoseidonDecision,
  getLatestPrice,
  listActiveSymbols,
};