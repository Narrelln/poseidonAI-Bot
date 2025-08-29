// const fs = require('fs');
// const path = require('path');
// const axios = require('axios');

// const { getOpenFuturesPositions } = require('../kucoinHelper');
// const { signKucoinV3Request } = require('../utils/signRequest');

// require('dotenv').config();

// const HISTORY_FILE = path.join(__dirname, 'data', 'tradeHistory.json');
// const dataDir = path.dirname(HISTORY_FILE);
// if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
// if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '[]');

// // ==============================
// // Config
// // ==============================
// const BASE_URL = process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com';
// const API_KEY = process.env.KUCOIN_KEY;
// const API_SECRET = process.env.KUCOIN_SECRET;
// const API_PASSPHRASE = process.env.KUCOIN_PASSPHRASE;

// // Local TA service (Poseidon)
// const LOCAL_API_BASE = process.env.LOCAL_API_BASE || 'http://localhost:3000';

// // ==============================
// // KuCoin helpers
// // ==============================
// async function kuGet(endpoint, query = '') {
//   const headers = signKucoinV3Request('GET', endpoint, query, '', API_KEY, API_SECRET, API_PASSPHRASE);
//   const url = BASE_URL + endpoint + (query ? `?${query}` : '');
//   const res = await axios.get(url, { headers });
//   if (res.data?.code !== '200000') throw new Error(res.data?.msg || 'KuCoin error');
//   return res.data?.data;
// }
// function hyphenize(sym) {
//   if (typeof sym !== 'string') return sym;
//   if (sym.endsWith('USDTM')) return sym.replace(/USDTM$/, '-USDTM');
//   return sym;
// }
// function dehyphenize(sym) {
//   // e.g. "APT-USDTM" -> "APTUSDTM" for /api/ta/:symbol
//   return String(sym || '').replace('-', '');
// }

// // ===================================
// // Local helpers (existing functionality)
// // ===================================
// function safeField(val) {
//   if (val === null || val === undefined) return '';
//   if (val === '-' || val === 'null' || val === 'undefined') return '';
//   if (typeof val === 'string' && val.trim() === '-') return '';
//   return val; // keep 0, '0.00', '0%'
// }

// function safeReadHistory() {
//   try {
//     const text = fs.readFileSync(HISTORY_FILE, 'utf-8');
//     const arr = JSON.parse(text) || [];
//     return arr.map(obj => {
//       Object.keys(obj).forEach(k => {
//         if (!obj[k] || obj[k] === '-' || obj[k] === 'null' || obj[k] === 'undefined' || (typeof obj[k] === 'string' && obj[k].trim() === '-')) {
//           obj[k] = '';
//         }
//       });
//       return obj;
//     });
//   } catch (err) {
//     console.error("⚠️ Trade history read error:", err);
//     return [];
//   }
// }

// function prettyDate(iso) {
//   if (!iso) return '';
//   const d = new Date(iso);
//   if (isNaN(d.getTime())) return '';
//   return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
// }

// function computePnL({ entry, exit, side, contracts, multiplier }) {
//   const e = Number(entry), x = Number(exit);
//   const c = Math.abs(Number(contracts));
//   const m = Number(multiplier) || 1;
//   if (!(isFinite(e) && isFinite(x) && e > 0 && c > 0)) return 0;
//   const baseQty = c * m;
//   const diff    = x - e;
//   return (String(side).toLowerCase() === 'sell') ? (-diff * baseQty) : (diff * baseQty);
// }

// function computeROI({ pnl, entry, contracts, multiplier, leverage }) {
//   const e = Number(entry);
//   const c = Math.abs(Number(contracts));
//   const m = Number(multiplier) || 1;
//   const lev = Math.max(1, Number(leverage) || 1);
//   if (!(isFinite(e) && e > 0 && c > 0 && isFinite(lev) && lev > 0 && isFinite(pnl))) return '';
//   const cost = (e * (c * m)) / lev; // initial margin
//   if (!(isFinite(cost) && cost > 0)) return '';
//   return ((pnl / cost) * 100).toFixed(2) + '%';
// }

// function computePriceMovePct({ entry, exit, side }) {
//   const e = Number(entry), x = Number(exit);
//   if (!(isFinite(e) && e > 0 && isFinite(x))) return '';
//   const move   = ((x - e) / e) * 100;
//   const signed = (String(side).toLowerCase() === 'sell') ? -move : move;
//   return signed.toFixed(2) + '%';
// }

// // ===================================
// // NEW: robust exit-price fetchers
// // ===================================
// async function fetchExitFromTA(symbol) {
//   try {
//     const clean = dehyphenize(symbol);
//     const url = `${LOCAL_API_BASE}/api/ta/${encodeURIComponent(clean)}`;
//     const { data } = await axios.get(url, { timeout: 3000 });
//     // accept any of these fields
//     const v = data?.markPrice ?? data?.price ?? data?.lastPrice ?? data?.ta?.markPrice ?? data?.ta?.price;
//     const num = Number(v);
//     if (isFinite(num) && num > 0) return num;
//   } catch (_) {}
//   return NaN;
// }

// async function fetchExitFromLivePositions(symbol) {
//   try {
//     const open = await getOpenFuturesPositions(); // contains markPrice
//     const key1 = String(symbol || '').toUpperCase();
//     const key2 = String(hyphenize(symbol) || '').toUpperCase();
//     const hit = open.find(p =>
//       String(p.contract || p.symbol || '').toUpperCase() === key1 ||
//       String(p.contract || p.symbol || '').toUpperCase() === key2
//     );
//     const num = Number(hit?.markPrice || hit?.lastPrice);
//     if (isFinite(num) && num > 0) return num;
//   } catch (_) {}
//   return NaN;
// }

// async function resolveExitPrice({ symbol, entry, providedExit }) {
//   const e = Number(entry);
//   const p = Number(providedExit);
//   const near = (a, b, tol = 1e-4) => (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)));

//   // If caller gave a price that's clearly different from entry, accept it.
//   if (Number.isFinite(p) && p > 0 && !near(p, e)) return p;

//   // Otherwise: prefer TA (handles LINK / LINK-USDTM / LINKUSDT / link)
//   const x2 = await fetchExitFromTA(symbol);
//   if (Number.isFinite(x2) && x2 > 0 && !near(x2, 0)) return x2;

//   // Then try live positions mark price
//   const x3 = await fetchExitFromLivePositions(symbol);
//   if (Number.isFinite(x3) && x3 > 0) return x3;

//   // Last resort: entry (but log it)
//   if (Number.isFinite(e) && e > 0) {
//     console.warn(`[tradeHistory] resolveExitPrice fallback → entry for ${symbol}`);
//     return e;
//   }
//   return 0;
// }

// // ==============================
// // Existing: record/open
// // ==============================
// function recordTrade({
//   symbol,
//   side,
//   entry,
//   exit = null,
//   pnl = null,
//   pnlPercent = null,
//   status = 'open',
//   timestamp,
//   orderId = null,
//   size = 1,
//   leverage = 5,
//   tpPercent = null,
//   slPercent = null
// }) {
//   let history = safeReadHistory();
//   const time = timestamp ? new Date(timestamp) : new Date();

//   symbol = safeField(typeof symbol === 'string' ? symbol.trim().toUpperCase() : symbol);
//   side = safeField(typeof side === 'string' ? side.trim().toLowerCase() : side);

//   if ((status || 'open').toUpperCase() === 'OPEN') {
//     const exists = history.find(t =>
//       t.symbol === symbol &&
//       t.side === side &&
//       t.status === 'OPEN' &&
//       (!orderId || t.orderId === orderId)
//     );
//     if (exists) {
//       console.warn(`⚠️ Duplicate OPEN trade for ${symbol} (${side}) with same orderId. Skipping record.`);
//       return;
//     }
//   }

//   const parsedEntry = (!isNaN(parseFloat(entry))) ? parseFloat(entry) : 0;
//   const parsedExit = (!isNaN(parseFloat(exit))) ? parseFloat(exit) : 0;
//   const safeSize = (!isNaN(size)) ? parseFloat(size) : 1;
//   const safeLeverage = (!isNaN(leverage)) ? parseInt(leverage) : 5;

//   const trueExit = (exit && !isNaN(parsedExit) && parsedExit !== 0) ? parsedExit : parsedEntry;

//   const contracts = Number.isFinite(+safeSize) ? +safeSize : 1;
//   const mult = Number.isFinite(+arguments[0]?.multiplier) ? +arguments[0].multiplier : 1;

//   const computedPnl = computePnL({
//     entry: parsedEntry,
//     exit: trueExit,
//     side,
//     contracts,
//     multiplier: mult
//   });

//   const roi = computeROI({
//     pnl: computedPnl,
//     entry: parsedEntry,
//     contracts,
//     multiplier: mult,
//     leverage: safeLeverage
//   });

//   const priceMovePct = computePriceMovePct({ entry: parsedEntry, exit: trueExit, side });

//   const trade = {
//     symbol: safeField(symbol),
//     side: safeField(side),
//     entry: parsedEntry ? parsedEntry.toFixed(4) : '',
//     exit: trueExit ? trueExit.toFixed(4) : '',
//     pnl: (computedPnl === '' ? '' : computedPnl.toFixed(4)),
//     pnlPercent: pnlPercent || priceMovePct,
//     roi: roi || '',
//     size: contracts,
//     multiplier: mult || 1,
//     baseQty: (contracts * (mult || 1)) || '',
//     leverage: safeLeverage ? safeLeverage : '',
//     orderId: orderId || '',
//     status: (status || 'open').toUpperCase(),
//     timestamp: time.toISOString(),
//     date: prettyDate(time),
//     tpPercent: (!isNaN(tpPercent) && tpPercent !== null) ? parseFloat(tpPercent) : '',
//     slPercent: (!isNaN(slPercent) && slPercent !== null) ? parseFloat(slPercent) : ''
//   };

//   Object.keys(trade).forEach(k => {
//     trade[k] = safeField(trade[k]);
//   });

//   history.unshift(trade);
//   if (history.length > 100) history = history.slice(0, 100);
//   fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
//   console.log("📩 Trade recorded:", trade);
// }

// // ==============================
// // CLOSE: now async with TA fallback
// // ==============================
// async function closeTrade(symbol, closeSide, exit, pnl, pnlPercent) {
//   let history = safeReadHistory();
//   const normSide = (closeSide || '').toLowerCase();

//   let idx = history.findIndex(t =>
//     t.symbol === symbol &&
//     t.status === 'OPEN' &&
//     (t.side || '').toLowerCase() === normSide
//   );
//   if (idx === -1) {
//     idx = history.findIndex(t =>
//       t.symbol === symbol &&
//       t.status === 'OPEN'
//     );
//   }

//   if (idx !== -1) {
//     const parsedEntry = (!isNaN(parseFloat(history[idx].entry))) ? parseFloat(history[idx].entry) : 0;
//     const safeLeverage = (!isNaN(history[idx].leverage)) ? parseInt(history[idx].leverage) : 5;
//     const sideStr = String(history[idx].side || '').toLowerCase();
//     const contracts = Number.isFinite(+history[idx].size) ? +history[idx].size : 1;
//     const mult      = Number.isFinite(+history[idx].multiplier) ? +history[idx].multiplier : 1;

//     // 🔑 Get a real exit price (prefers TA)
//     const trueExit = await resolveExitPrice({
//       symbol: history[idx].symbol,
//       entry: parsedEntry,
//       providedExit: exit
//     });

//     const rawPnl = (!isNaN(pnl) && pnl !== null && pnl !== '' && pnl !== undefined && pnl !== '-')
//       ? parseFloat(pnl)
//       : computePnL({
//           entry: parsedEntry,
//           exit: trueExit,
//           side: sideStr,
//           contracts,
//           multiplier: mult
//         });

//     const roi = computeROI({
//       pnl: rawPnl,
//       entry: parsedEntry,
//       contracts,
//       multiplier: mult,
//       leverage: safeLeverage
//     });

//     const priceMovePct = computePriceMovePct({ entry: parsedEntry, exit: trueExit, side: sideStr });

//     history[idx].exit = Number.isFinite(trueExit) && trueExit > 0 ? trueExit.toFixed(4) : '';
//     history[idx].pnl = Number.isFinite(rawPnl) ? rawPnl.toFixed(4) : '';
//     history[idx].pnlPercent = (typeof pnlPercent === 'string' && pnlPercent) ? pnlPercent : priceMovePct;
//     history[idx].roi = roi || '';
//     history[idx].status = 'CLOSED';
//     history[idx].closedAt = new Date().toISOString();
//     history[idx].date = prettyDate(history[idx].closedAt);

//     Object.keys(history[idx]).forEach(k => {
//       history[idx][k] = safeField(history[idx][k]);
//     });

//     fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
//     console.log("✅ Trade closed:", history[idx]);
//     return history[idx];
//   } else {
//     console.warn("❌ No matching open trade found for", symbol, "side:", closeSide);
//     return null;
//   }
// }

// async function getRecentTrades(limit = 10) {
//   const history = safeReadHistory().slice(0, limit);

//   let liveMap = new Map();
//   try {
//     const open = await getOpenFuturesPositions(); // has markPrice, pnlValue, roi, size, leverage
//     liveMap = new Map(open.map(p => [ String(p.contract || p.symbol).toUpperCase(), p ]));
//   } catch (e) {
//     console.warn('[tradeHistory] live enrich failed:', e.message);
//   }

//   return history.map(trade => {
//     const t = { ...trade };
//     const key = String((t.symbol || t.contract || '')).toUpperCase();

//     if (t.status === 'OPEN' && liveMap.has(key)) {
//       const live = liveMap.get(key);
//       t.exit       = live.markPrice ? Number(live.markPrice).toFixed(4) : t.exit;
//       t.pnl        = (live.pnlValue !== undefined && live.pnlValue !== null)
//                       ? Number(live.pnlValue).toFixed(4)
//                       : t.pnl;
//       t.roi        = live.roi || t.roi;        // already like '12.34%'
//       t.pnlPercent = t.pnlPercent || t.roi;    // prefer ROI as % view for futures
//       t.leverage   = live.leverage || t.leverage;
//       t.size       = live.size || t.size;
//       t.baseQty    = live.quantity || t.baseQty;
//       t.multiplier = t.multiplier || 1;
//     }

//     Object.keys(t).forEach(k => { t[k] = safeField(t[k]); });
//     return { ...t, date: t.date || prettyDate(t.timestamp) };
//   });
// }

// function getOpenTradesWithTPSL() {
//   const history = safeReadHistory();

//   return history
//     .filter(t => String(t.status).toUpperCase() === 'OPEN')
//     .map(t => {
//       const tp = parseFloat(t.tpPercent ?? t.tp);
//       const sl = parseFloat(t.slPercent ?? t.sl);
//       const entry = parseFloat(t.entry);
//       const size  = parseFloat(t.size || 1);

//       return {
//         contract: t.symbol,
//         side: String(t.side || '').toLowerCase(),
//         entry: Number.isFinite(entry) ? entry : NaN,
//         tpPercent: Number.isFinite(tp) ? tp : NaN,
//         slPercent: Number.isFinite(sl) ? sl : NaN,
//         size: Number.isFinite(size) ? size : 1
//       };
//     })
//     .filter(r =>
//       Number.isFinite(r.entry) &&
//       Number.isFinite(r.tpPercent) && r.tpPercent > 0 &&
//       Number.isFinite(r.slPercent) && r.slPercent > 0 &&
//       r.side
//     );
// }

// /**
//  * Reconcile OPEN trades in local history with the exchange's open contracts.
//  * Any OPEN trade whose symbol isn't in `openContractsSet` is marked CLOSED.
//  * Now resolves a real exit via TA → live mark → entry (last resort).
//  */
// async function reconcileOpenTrades(openContractsSet = new Set()) {
//   let history = safeReadHistory();
//   let changed = false;

//   const norm = s => String(s || '').trim().toUpperCase();
//   const openSet = new Set([...openContractsSet].map(norm));

//   for (const t of history) {
//     if (String(t.status).toUpperCase() !== 'OPEN') continue;

//     const sym = norm(t.symbol);
//     if (openSet.has(sym)) continue; // still open on exchange

//     const parsedEntry = (!isNaN(parseFloat(t.entry))) ? parseFloat(t.entry) : 0;
//     const side        = String(t.side || '').toLowerCase();
//     const contracts   = Number.isFinite(+t.size) ? +t.size : 1;
//     const mult        = Number.isFinite(+t.multiplier) ? +t.multiplier : 1;
//     const lev         = Math.max(1, Number(t.leverage) || 1);

//     // 🔑 Resolve a real exit price (prefer TA; accept lots of symbol variants)
//     const trueExit = await (async () => {
//       const x2 = await fetchExitFromTA(sym);
//       if (Number.isFinite(x2) && x2 > 0) return x2;
//       const x3 = await fetchExitFromLivePositions(sym);
//       if (Number.isFinite(x3) && x3 > 0) return x3;
//       return parsedEntry; // last resort
//     })();

//     // Compute PnL/ROI with correct sign and size*multiplier
//     const pnl = computePnL({
//       entry: parsedEntry,
//       exit: trueExit,
//       side,
//       contracts,
//       multiplier: mult
//     });

//     const priceMovePct = computePriceMovePct({ entry: parsedEntry, exit: trueExit, side });
//     const roi = computeROI({
//       pnl,
//       entry: parsedEntry,
//       contracts,
//       multiplier: mult,
//       leverage: lev
//     });

//     t.exit       = Number.isFinite(trueExit) ? trueExit.toFixed(4) : t.exit;
//     t.pnl        = Number.isFinite(pnl) ? pnl.toFixed(4) : t.pnl;
//     t.pnlPercent = t.pnlPercent || priceMovePct;
//     t.roi        = t.roi || roi || '';
//     t.status     = 'CLOSED';
//     t.closedAt   = new Date().toISOString();
//     t.date       = t.date || prettyDate(t.closedAt);
//     t._syncNote  = 'external-close';

//     Object.keys(t).forEach(k => { t[k] = safeField(t[k]); });
//     changed = true;
//   }

//   if (changed) {
//     fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
//     console.log('🧹 tradeHistory reconciled with exchange open set (with TA exit)');
//   }
// }
// // ======================================
// // (Optional) Live KuCoin trade history (fills-first, paginated)
// // ======================================

// async function fetchFillsWindow({ startAt, endAt, pageSize = 200 }) {
//   const s = startAt ? Math.floor(startAt / 1000) : undefined;
//   const e = endAt   ? Math.floor(endAt   / 1000) : undefined;

//   let page = 1;
//   const all = [];

//   while (true) {
//     const params = new URLSearchParams({
//       pageSize: String(pageSize),
//       currentPage: String(page),
//     });
//     if (s) params.set('startAt', String(s));
//     if (e) params.set('endAt',   String(e));

//     const pageData = await kuGet('/api/v1/fills', params.toString());
//     const items = Array.isArray(pageData?.items) ? pageData.items : [];
//     all.push(...items);

//     const totalPage = Number(pageData?.totalPage || 1);
//     if (page >= totalPage || items.length === 0) break;
//     page += 1;
//   }

//   return all;
// }

// function buildHistoryFromFills(fills, { assumeLeverage = 5 } = {}) {
//   const legs = fills
//     .map(f => ({
//       symbol: hyphenize(String(f.symbol || '').toUpperCase()),
//       side:   String(f.side || '').toUpperCase(),       // BUY / SELL
//       qty:    Number(f.size || 0),                      // base units
//       price:  Number(f.price || 0),
//       time:   Number(f.tradeTime || f.createdAt || Date.now())
//     }))
//     .filter(x => x.symbol && x.qty > 0 && x.price > 0)
//     .sort((a,b) => a.time - b.time);

//   const bySymbol = new Map();
//   const ensure = (sym) => {
//     if (!bySymbol.has(sym)) bySymbol.set(sym, { long: [], short: [], closed: [] });
//     return bySymbol.get(sym);
//   };

//   for (const leg of legs) {
//     const book = ensure(leg.symbol);

//     if (leg.side === 'BUY') {
//       let qty = leg.qty;
//       while (qty > 0 && book.short.length) {
//         const open = book.short[0];
//         const take = Math.min(open.qty, qty);
//         const pnl = (open.price - leg.price) * take; // short: entry - exit
//         book.closed.push({
//           symbol: leg.symbol, side: 'SELL',
//           entry: open.price, exit: leg.price,
//           qty: take, openedAt: open.time, closedAt: leg.time, pnl
//         });
//         open.qty -= take; qty -= take;
//         if (open.qty <= 0) book.short.shift();
//       }
//       if (qty > 0) book.long.push({ price: leg.price, qty, time: leg.time });
//     } else {
//       let qty = leg.qty;
//       while (qty > 0 && book.long.length) {
//         const open = book.long[0];
//         const take = Math.min(open.qty, qty);
//         const pnl = (leg.price - open.price) * take; // long: exit - entry
//         book.closed.push({
//           symbol: leg.symbol, side: 'BUY',
//           entry: open.price, exit: leg.price,
//           qty: take, openedAt: open.time, closedAt: leg.time, pnl
//         });
//         open.qty -= take; qty -= take;
//         if (open.qty <= 0) book.long.shift();
//       }
//       if (qty > 0) book.short.push({ price: leg.price, qty, time: leg.time });
//     }
//   }

//   const rows = [];
//   for (const [, book] of bySymbol) {
//     for (const c of book.closed) {
//       const margin = (c.entry * c.qty) / Math.max(1, assumeLeverage);
//       const roi = margin > 0 ? ((c.pnl / margin) * 100).toFixed(2) + '%' : '';
//       rows.push({
//         symbol: c.symbol,
//         side: c.side,
//         entry: Number(c.entry).toFixed(6),
//         exit:  Number(c.exit ).toFixed(6),
//         size:  Number(c.qty  ).toFixed(3),
//         pnl:   Number(c.pnl  ).toFixed(6),
//         roi,
//         openedAt: new Date(c.openedAt).toISOString(),
//         closedAt: new Date(c.closedAt).toISOString()
//       });
//     }
//   }

//   rows.sort((a,b) => new Date(b.closedAt) - new Date(a.closedAt));
//   return rows;
// }

// // Placeholder stubs kept for compatibility if you wired these elsewhere
// async function fetchClosedOrdersWithFills() { return []; }
// function buildHistoryFromOrders() { return []; }

// /**
//  * Public: fetch recent trades directly from KuCoin.
//  */
// async function getRecentTradesFromKucoin(limit = 100, windowMs = 30 * 24 * 60 * 60 * 1000) {
//   const now = Date.now();

//   try {
//     const enriched = await fetchClosedOrdersWithFills({
//       startAt: now - windowMs, endAt: now, limit
//     });
//     const rows = buildHistoryFromOrders(enriched, {
//       assumeLeverage: Number(process.env.DEFAULT_LEVERAGE || 5)
//     });
//     if (rows.length) return rows.slice(0, limit);
//   } catch (_) {}

//   const fills = await fetchFillsWindow({ startAt: now - windowMs, endAt: now, pageSize: 200 });
//   const rows2 = buildHistoryFromFills(fills, {
//     assumeLeverage: Number(process.env.DEFAULT_LEVERAGE || 5)
//   });
//   return rows2.slice(0, limit);
// }

// // ==============================
// // Exports
// // ==============================
// module.exports = {
//   recordTrade,
//   closeTrade,                    // now async
//   getOpenTradesWithTPSL,
//   getRecentTrades,               // existing local JSON source
//   getRecentTradesFromKucoin,     // optional
//   safeReadHistory,
//   reconcileOpenTrades            // now tries TA exit too
// };