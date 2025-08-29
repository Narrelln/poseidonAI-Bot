// services/predatorScorer.js
/* Predator score (0..100) + sidePref (BUY/SELL) + reasons[]
 * Favor: early long near supports with fresh momentum; early short near resistance/exhaustion.
 */
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pctDiff = (a, b) => {
  const A = Number(a), B = Number(b);
  if (!(A > 0) || !(B > 0)) return Infinity;
  return Math.abs((A - B) / B) * 100;
};

const STRUCT_NEAR_BAND = 1.2; // % distance to count as "near"
const H_ORDER = ['12h','24h','36h','48h','7d','14d','30d'];
const H_WEIGHTS = { '12h':0.06,'24h':0.08,'36h':0.08,'48h':0.10,'7d':0.22,'14d':0.22,'30d':0.24 };

function closeness01(price, ref){
  if (!Number.isFinite(ref) || !(price > 0)) return 0;
  const d = pctDiff(price, ref);
  return d <= STRUCT_NEAR_BAND ? clamp(1 - (d / STRUCT_NEAR_BAND), 0, 1) : 0;
}

function structureBias(price, railsByH, fallbackAtl30, fallbackAth30, reasons) {
  let buyAccum=0, sellAccum=0;
  if (railsByH && Object.keys(railsByH).length) {
    for (const h of H_ORDER) {
      const r = railsByH[h]; if (!r) continue;
      const w = H_WEIGHTS[h] || 0;
      const atlC = closeness01(price, r.atl);
      const athC = closeness01(price, r.ath);
      if (atlC>0) { buyAccum += w*atlC; reasons.push(`struct:${h}:ATL*x${(w*atlC).toFixed(3)}`); }
      if (athC>0) { sellAccum+= w*athC; reasons.push(`struct:${h}:ATH*x${(w*athC).toFixed(3)}`); }
    }
  } else {
    const a = closeness01(price, fallbackAtl30);
    const b = closeness01(price, fallbackAth30);
    if (a>0) { buyAccum += a; reasons.push(`struct:30d:ATL*x${a.toFixed(3)}`); }
    if (b>0) { sellAccum+= b; reasons.push(`struct:30d:ATH*x${b.toFixed(3)}`); }
  }
  const pts = Math.round(40 * clamp(Math.max(buyAccum, sellAccum), 0, 1));
  const sidePref = buyAccum > sellAccum + 0.03 ? 'BUY' : (sellAccum > buyAccum + 0.03 ? 'SELL' : null);
  const tag = sidePref === 'BUY' ? 'nearATL' : sidePref === 'SELL' ? 'nearATH' : 'none';
  reasons.push(`structure:${tag}+${pts}`);
  return { pts, sidePref, tag };
}

function momentumBlock(ta, sidePref, reasons) {
  const m01 = clamp(Number(ta?.momentumScore ?? ta?.momentum ?? ta?.momo ?? 0), 0, 1);
  let pts = Math.round(30 * m01);
  const sig = String(ta?.signal || '').toLowerCase();
  const aligned = (sidePref==='BUY' && sig==='bullish') || (sidePref==='SELL' && sig==='bearish');
  if (aligned) pts = Math.min(30, pts + 4);
  reasons.push(`momentum:${m01.toFixed(2)}${aligned?'+aligned':''}+${pts}`);
  return pts;
}

function volatilityBlock(ta, reasons) {
  const bbWidth = Number(ta?.bbWidth);
  const atr = Number(ta?.atr14);
  let pts = 0;
  if (Number.isFinite(bbWidth)) {
    pts += Math.max(0, Math.min(8, Math.round(bbWidth * 80))); // ~up to 8
  }
  if (Number.isFinite(atr)) {
    pts += Math.max(0, Math.min(6, Math.round(atr * 600))); // ~up to 6 (scale harmlessly)
  }
  reasons.push(`volatility+${pts}`);
  return pts;
}

function liquidityBlock(qv, reasons) {
  let pts = 0;
  if (Number.isFinite(qv)) {
    if (qv >= 100_000 && qv <= 20_000_000) pts = 10;         // sweet spot
    else if (qv > 20_000_000 && qv <= 1_500_000_000) pts = 6; // still fine
    else if (qv >= 50_000 && qv < 100_000) pts = 4;           // thin, but ok
  }
  reasons.push(`liquidity:${qv||0}+${pts}`);
  return pts;
}

function trapRiskBlock(ta, reasons) {
  let malus = 0;
  if (ta?.trapWarning) malus -= 6;
  const rsi = Number(ta?.rsi);
  if (Number.isFinite(rsi)) {
    if (rsi >= 80 && String(ta?.bbSignalCompat).includes('breakout')) malus -= 6;
    if (rsi <= 20 && String(ta?.bbSignalCompat).includes('breakdown')) malus -= 4;
  }
  reasons.push(`trapRisk${malus}`);
  return malus;
}

function catalystBlock(ta, reasons) {
  // small nudges for Fib context + BB breakout alignment
  let pts = 0;
  const ctx = String(ta?.fibContext || '').toLowerCase();
  const bb  = String(ta?.bbSignalCompat || '').toLowerCase();
  if (ctx === 'extension' && bb.includes('breakout')) pts += 4;
  if (ctx === 'retracement' && bb.includes('mean')) pts += 2;
  reasons.push(`catalyst:${ctx}/${bb}+${pts}`);
  return pts;
}

function buildSideRefine(sidePref, ta) {
  // If no structure preference, fall back to TA signal
  if (sidePref) return sidePref;
  const sig = String(ta?.signal || '').toLowerCase();
  if (sig === 'bullish') return 'BUY';
  if (sig === 'bearish') return 'SELL';
  return null;
}

function computePredatorScore({ price, railsByH, ta, qv, fallbackAtl30, fallbackAth30 }) {
  const reasons = [];
  const { pts: structPts, sidePref: structSide, tag } =
    structureBias(price, railsByH, fallbackAtl30, fallbackAth30, reasons);

  const momentumPts  = momentumBlock(ta, structSide, reasons);      // 0..34 max (with align bonus)
  const volPts       = volatilityBlock(ta, reasons);                // 0..14-ish
  const liqPts       = liquidityBlock(qv, reasons);                 // 0..10
  const trapMalus    = trapRiskBlock(ta, reasons);                  // 0..-12
  const catalystPts  = catalystBlock(ta, reasons);                  // 0..4

  let raw = structPts + momentumPts + volPts + liqPts + trapMalus + catalystPts;
  raw = clamp(Math.round(raw), 0, 100);

  const finalSide = buildSideRefine(structSide, ta);
  reasons.push(`total:${raw}`);
  return { score: raw, sidePref: finalSide, arrivedTag: tag, reasons };
}

module.exports = { computePredatorScore };