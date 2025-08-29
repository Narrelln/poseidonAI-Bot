// handlers/poseidonSession.js
// ------------------------------------------------------------
// Time-of-day / session bias (CONFIGURABLE, CommonJS)
// Exports:
//   - getSessionInfo(date?) -> { session, hour, dow }
//   - sessionBiasPoints({ session, dow, dir, volumeSpike, rsi, price, range24h, headroomPct })
//   - POSEIDON_SESSION (runtime config tweaker)
// ------------------------------------------------------------

// ——— Config (safe defaults) ———
// Windows are [startHour, endHour] inclusive in "LOCALIZED UTC" per utcOffsetHours.
// Set utcOffsetHours to shift windows (e.g., -5 for NYC-like framing).
const SESSION_CONFIG = {
    utcOffsetHours: 0, // 0 = use pure UTC session windows
    windows: {
      ASIA:   [0, 7],    // 00:00–07:59
      EUROPE: [8, 12],   // 08:00–12:59
      US:     [13, 20],  // 13:00–20:59
      LATE:   [21, 23],  // 21:00–23:59
    },
    // Confidence point adjustments (added to final score)
    weights: {
      // Global
      weekendDamp: -2,
  
      // Per-session momentum/reversion biases
      US: {
        momentum: +3,        // continuation (esp. with volumeSpike)
        nearATHShort: +2,    // if dir='short' & price ≈ 24h ATH
      },
      EUROPE: {
        momentum: +1         // mild follow-through
      },
      ASIA: {
        meanRevLongATL: +3,  // if dir='long' & near 24h ATL with soft RSI
        overheatedTrim: -2   // if volumeSpike && RSI >= 72
      },
      LATE: {
        riskOff: -3,         // generally cautious late
        runwayBack: +2       // give some back if headroomPct >= 6
      }
    }
  };
  
  // ---- Runtime controls (safe to call from anywhere) ----
  const POSEIDON_SESSION = {
    setWindows(next) {
      if (!next) return;
      Object.assign(SESSION_CONFIG.windows, next);
    },
    setWeights(next) {
      if (!next) return;
      if (typeof next.weekendDamp === 'number') SESSION_CONFIG.weights.weekendDamp = next.weekendDamp;
      ['US','EUROPE','ASIA','LATE'].forEach(k => {
        if (next[k]) Object.assign(SESSION_CONFIG.weights[k], next[k]);
      });
    },
    setUTCOffset(hours = 0) {
      if (Number.isFinite(+hours)) SESSION_CONFIG.utcOffsetHours = +hours;
    },
    inspect() {
      const now = new Date();
      const s = getSessionInfo(now);
      return { nowUTC: now.toISOString(), ...s, config: JSON.parse(JSON.stringify(SESSION_CONFIG)) };
    }
  };
  
  // ---- Internals ----
  function hourWithOffset(date) {
    const h = date.getUTCHours();
    const off = SESSION_CONFIG.utcOffsetHours || 0;
    let out = (h + off) % 24;
    if (out < 0) out += 24;
    return out;
  }
  function inWindow(h, [start, end]) {
    if (!Array.isArray([start, end])) return false;
    if (start <= end) return h >= start && h <= end; // normal
    // wrap-around window (e.g., 21–02)
    return (h >= start && h <= 23) || (h >= 0 && h <= end);
  }
  
  // ---- Public API ----
  function getSessionInfo(date = new Date()) {
    const hour = hourWithOffset(date);
    const dow = date.getUTCDay(); // 0=Sun ... 6=Sat
  
    const W = SESSION_CONFIG.windows;
    let session = 'ASIA';
    if (inWindow(hour, W.EUROPE)) session = 'EUROPE';
    else if (inWindow(hour, W.US)) session = 'US';
    else if (inWindow(hour, W.LATE)) session = 'LATE';
    else if (inWindow(hour, W.ASIA)) session = 'ASIA';
  
    return { session, hour, dow };
  }
  
  function nearATL(price, range, pct = 0.02) {
    const p = Number(price), L = Number(range?.low);
    return Number.isFinite(p) && Number.isFinite(L) && L > 0 && (p - L) / L <= pct;
  }
  function nearATH(price, range, pct = 0.02) {
    const p = Number(price), H = Number(range?.high);
    return Number.isFinite(p) && Number.isFinite(H) && H > 0 && (H - p) / H <= pct;
  }
  
  /**
   * sessionBiasPoints
   * Adds/subtracts a few points to the final confidence score based on session/time.
   * @param {Object} params
   * @param {'ASIA'|'EUROPE'|'US'|'LATE'} params.session
   * @param {number} params.dow          0=Sun ... 6=Sat (UTC)
   * @param {'long'|'short'} params.dir
   * @param {boolean} params.volumeSpike
   * @param {number} params.rsi
   * @param {number} params.price
   * @param {{low:number,high:number}} params.range24h
   * @param {number} params.headroomPct
   * @returns {number} points (can be negative)
   */
  function sessionBiasPoints({ session, dow, dir, volumeSpike, rsi, price, range24h, headroomPct }) {
    const W = SESSION_CONFIG.weights;
    let pts = 0;
  
    // Weekends often quieter → slight damp
    if (dow === 0 || dow === 6) pts += (W.weekendDamp || 0);
  
    if (session === 'US') {
      if (volumeSpike) pts += (W.US.momentum || 0);
      if (dir === 'short' && nearATH(price, range24h, 0.012)) pts += (W.US.nearATHShort || 0);
    } else if (session === 'ASIA') {
      if (dir === 'long' && nearATL(price, range24h, 0.015) && Number(rsi) <= 45) {
        pts += (W.ASIA.meanRevLongATL || 0);
      }
      if (volumeSpike && Number(rsi) >= 72) pts += (W.ASIA.overheatedTrim || 0);
    } else if (session === 'EUROPE') {
      if (volumeSpike) pts += (W.EUROPE.momentum || 0);
    } else if (session === 'LATE') {
      pts += (W.LATE.riskOff || 0);
      if (Number(headroomPct) >= 6) pts += (W.LATE.runwayBack || 0);
    }
  
    return pts;
  }
  
  module.exports = {
    getSessionInfo,
    sessionBiasPoints,
    POSEIDON_SESSION
  };