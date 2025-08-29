// // public/scripts/forceTradeHelper.js
// // -----------------------------------------------------
// // Helper to force-pass a token into Poseidon for a one-time test
// // - Runs the decision pipeline (manual, override) so the UI feed lights up
// // - Optionally places a LIVE order via /api/place-trade (use with care!)
// // -----------------------------------------------------

// import { evaluatePoseidonDecision } from './futuresDecisionEngine.js';
// import { toKuCoinContractSymbol } from './futuresApiClient.js';

// // ---------- small utils ----------
// const up = (s) => String(s || '').toUpperCase();
// const normBase = (s) => up(s).replace(/[-_]/g, '').replace(/USDTM?$/, '');
// const toBase = (maybeContract) => {
//   const B = normBase(maybeContract);
//   // keep as base (e.g., 'DOGE')
//   return B;
// };
// const toContract = (s) => toKuCoinContractSymbol(s); // e.g. DOGE -> DOGE-USDTM

// function mapSide(side) {
//   const S = up(side);
//   // Engine accepts LONG/SHORT in analysis; backend wants buy/sell
//   return {
//     forEngine: (S === 'SHORT' ? 'bearish' : 'bullish'),
//     forApi:    (S === 'SHORT' ? 'sell'    : 'buy')
//   };
// }

// async function tryFetchJSON(url, opts) {
//   const r = await fetch(url, opts);
//   const j = await r.json().catch(() => ({}));
//   return { ok: r.ok, status: r.status, data: j };
// }

// async function postPlaceTrade({ symbolBase, sideApi, notionalUsd, leverage, tpPercent, slPercent }) {
//   const body = {
//     symbol: symbolBase,     // backend expects base (e.g., 'DOGE')
//     side: sideApi,          // 'buy' | 'sell'
//     notionalUsd,
//     leverage,
//     tpPercent,
//     slPercent,
//     manual: true
//   };

//   const res = await fetch('/api/place-trade', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify(body)
//   });

//   // show error payload for quick diagnosis
//   if (!res.ok) {
//     const payload = await res.json().catch(() => ({}));
//     console.warn('[forceTrade] place-trade error payload:', payload);
//     const msg = payload?.error ? `: ${payload.error}` : '';
//     throw new Error(`/api/place-trade -> ${res.status}${msg}`);
//   }
//   return res.json();
// }

// async function inScannerTop50(base) {
//   try {
//     const r = await fetch('/api/scan-tokens', { cache: 'no-store' });
//     const j = await r.json();
//     const top50 = Array.isArray(j?.top50) ? j.top50 : [];
//     const nb = normBase(base);
//     return top50.some(t => normBase(t.symbol) === nb);
//   } catch {
//     return false;
//   }
// }

// /**
//  * forcePoseidonTrade(rawSymbol, opts)
//  * DevTools usage:
//  *   // observe-only (no order placed)
//  *   forcePoseidonTrade('LINK-USDTM', { side:'LONG', confidence:92 })
//  *
//  *   // place a tiny live order safely
//  *   forcePoseidonTrade('DOGE', { side:'SHORT', live:true, usdt:10, leverage:5, tp:20, sl:10 })
//  */
// export async function forcePoseidonTrade(rawSymbol, opts = {}) {
//   const contract = toContract(rawSymbol || 'BTC');     // e.g., 'DOGE-USDTM'
//   const base     = toBase(contract);                   // e.g., 'DOGE'

//   const sideIn   = up(opts.side || 'LONG');
//   const { forEngine, forApi } = mapSide(sideIn);

//   const conf     = Number.isFinite(+opts.confidence) ? +opts.confidence : 90;
//   const price    = Number.isFinite(+opts.price) ? +opts.price : 1.0; // hint only
//   const usdtRaw  = Number.isFinite(+opts.usdt) ? +opts.usdt : NaN;
//   const leverage = Number.isFinite(+opts.leverage) ? +opts.leverage : 5;

//   // ✅ default notional so contracts never round to 0
//   let notionalUsd = Number.isFinite(usdtRaw) ? usdtRaw : 50;

//   // Check scanner presence (not required, but helps engine resolve price)
//   const seen = await inScannerTop50(base);
//   if (!seen) {
//     console.warn(`[FORCE] ${base} not found in /api/scan-tokens top50. Prefer a major (BTC/ETH/SOL/DOGE/LINK).`);
//   }

//   // Fabricated analysis Poseidon will accept
//   const analysis = {
//     symbol: contract,
//     signal: forEngine,                     // 'bullish' | 'bearish'
//     macdSignal: (sideIn === 'SHORT' ? 'sell' : 'buy'),
//     bbSignal:   (sideIn === 'SHORT' ? 'lower' : 'upper'),
//     volumeSpike: true,
//     confidence: conf,
//     rsi: (sideIn === 'SHORT' ? 38 : 62),
//     trapWarning: false,
//     price,
//     manual: true,                          // allow trade path
//     override: true,                        // bypass volume cap
//     allocationPct: conf >= 85 ? 25 : 10,
//     corr: `FORCE-${Date.now()}`,
//     strategy: (sideIn === 'SHORT') ? 'trend-follow-short' : 'trend-follow-long',
//   };

//   // Run through the decision pipeline (observe feed + internal checks)
//   await evaluatePoseidonDecision(contract, analysis);

//   // Optional: place a live order
//   if (opts.live) {
//     // retry up to 2 times if backend says contracts = 0
//     for (let attempt = 1; attempt <= 3; attempt++) {
//       try {
//         const result = await postPlaceTrade({
//           symbolBase: base,
//           sideApi: forApi,               // 'buy' | 'sell'
//           notionalUsd,
//           leverage,
//           tpPercent: opts.tp ?? 20,
//           slPercent: opts.sl ?? 10
//         });
//         console.log('[FORCE] Live trade placed:', result);
//         return { ok: true, placed: true, result };
//       } catch (e) {
//         const msg = String(e?.message || '');
//         // Typical backend message: "Contracts computed as 0 for XXX (check minSize/lotSize)"
//         if (attempt < 3 && /Contracts computed as 0/i.test(msg)) {
//           notionalUsd = Math.ceil(notionalUsd * 2); // bump and retry
//           console.warn(`[FORCE] retry ${attempt} failed: ${msg}. Increasing notional to ${notionalUsd} USDT and retrying…`);
//           continue;
//         }
//         throw e;
//       }
//     }
//   }

//   console.log('[FORCE] Analysis dispatched (observe-only). Add { live:true } to place order.');
//   return { ok: true, placed: false };
// }

// // Expose for console usage
// window.forcePoseidonTrade = forcePoseidonTrade;