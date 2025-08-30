/* backend/config/policyLoader.js */
const fs = require('fs');
const path = require('path');

const POLICY_PATH = process.env.POSEIDON_POLICY_PATH ||
  path.join(__dirname, 'adaptivePolicy.json');

let cache = null;
let mtime = 0;
let lastLoadError = null;

function getPolicyPath() {
  return POLICY_PATH;
}

function readJSONSafe(fp) {
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to read/parse policy JSON: ${e.message}`);
  }
}

function loadRaw() {
  try {
    const stat = fs.statSync(POLICY_PATH);
    if (!cache || stat.mtimeMs !== mtime) {
      cache = readJSONSafe(POLICY_PATH);
      mtime = stat.mtimeMs;
      lastLoadError = null;
      console.log('🧠 policyLoader: loaded', POLICY_PATH);
    }
  } catch (e) {
    // Only warn once until the situation changes
    if (!cache) {
      console.warn('🧠 policyLoader: using built‑in defaults (file missing or invalid):', e.message);
      cache = {
        defaults: {
          minConfidence: 35,
          maxLeverage: 5,
          sizeUSDT: 50,
          // legacy singletons (kept for compat)
          tpPct: 15,
          slPct: 5,
          allowLong: true,
          allowShort: true,
          // optional adaptive defaults:
          // tpPercents: [15], slPercent: 5, dca: { maxAdds: 0, ... }
        },
        profiles: {
          'breakout-momo': { open: true, minConfidence: 45, tpPct: 40, slPct: 6, sizeUSDT: 75 },
          'range-revert' : { open: true, minConfidence: 38, tpPct: 15, slPct: 5, sizeUSDT: 60 },
          // Cycle watcher rides 24–48h impulses; allow wider TP ladder + slightly looser minConfidence by default
          'cycle-24-48'  : {
            open: true, minConfidence: 42, sizeUSDT: 90,
            // prefer adaptive fields if your policy file defines them; we normalize below anyway
            tpPercents: [20, 40, 80], slPercent: 8,
            trailing: true,  // allow trailing if evaluator supports it
            lockOnRetest: true,
            cooldownMs: 6000
          }
        }
      };
      lastLoadError = e.message;
    } else if (lastLoadError !== e.message) {
      // policy changed on disk but still bad — log once per distinct message
      console.warn('🧠 policyLoader: keeping previous policy; latest read failed:', e.message);
      lastLoadError = e.message;
    }
  }
  return cache;
}

function getPolicy() {
  return loadRaw();
}

// ---------- helpers ----------
const toNum = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const toNumArr = (arr) =>
  Array.isArray(arr)
    ? arr.map(x => Number(x)).filter(Number.isFinite)
    : undefined;

// ---------- public API ----------
/**
 * getProfile(name)
 * Normalizes legacy fields (tpPct/slPct) into new adaptive fields:
 *  - tpPercents: array<number>
 *  - slPercent : number
 *  - dca       : object (if provided)
 * Also passes through optional flags (trailing, lockOnRetest, strict75, cooldownMs).
 */
function getProfile(name) {
  const p = loadRaw();
  const d = p.defaults || {};
  const x = (p.profiles && p.profiles[name]) || {};

  // Normalize numerics
  const minConfidence = toNum(
    ('minConfidence' in x) ? x.minConfidence : d.minConfidence,
    0
  );
  const maxLeverage = toNum(
    ('maxLeverage' in x) ? x.maxLeverage : d.maxLeverage,
    1
  );
  const sizeUSDT = toNum(
    ('sizeUSDT' in x) ? x.sizeUSDT : d.sizeUSDT,
    0
  );

  // legacy → adaptive normalization
  let tpPercents =
    toNumArr(x.tpPercents) ||
    toNumArr(d.tpPercents) ||
    (Number.isFinite(x.tpPct) ? [Number(x.tpPct)] : undefined) ||
    (Number.isFinite(d.tpPct) ? [Number(d.tpPct)] : undefined);

  let slPercent =
    toNum(x.slPercent,
      toNum(x.slPct,
        toNum(d.slPercent, toNum(d.slPct, undefined))
      )
    );

  // Ensure sane types (undefined if empty)
  if (tpPercents && !tpPercents.length) tpPercents = undefined;

  const dca = x.dca || d.dca || undefined;

  // Optional pass-through feature flags
  const passthrough = {};
  for (const k of ['trailing', 'lockOnRetest', 'strict75', 'cooldownMs']) {
    if (x[k] !== undefined) passthrough[k] = x[k];
    else if (d[k] !== undefined) passthrough[k] = d[k];
  }

  return {
    open: x.open !== false,
    minConfidence,
    maxLeverage,
    sizeUSDT,
    allowLong: ('allowLong' in x) ? !!x.allowLong : !!d.allowLong,
    allowShort: ('allowShort' in x) ? !!x.allowShort : !!d.allowShort,
    onlyUniverse: x.onlyUniverse || null,
    preferShortVolatile: !!x.preferShortVolatile,

    // adaptive fields
    tpPercents,
    slPercent,
    dca,

    // extras
    ...passthrough
  };
}

function getProfileNames() {
  const p = loadRaw();
  return Object.keys(p.profiles || {});
}
function hasProfile(name) {
  const p = loadRaw();
  return !!(p.profiles && p.profiles[name]);
}

module.exports = {
  getPolicy,
  getProfile,
  getProfileNames,
  hasProfile,
  getPolicyPath
};