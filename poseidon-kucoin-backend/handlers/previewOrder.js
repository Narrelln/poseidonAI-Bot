/**
 * File #03: handlers/previewOrder.js
 * Description:
 *   Backend preview for manual orders. Mirrors KuCoin flow:
 *   user inputs Quantity (USDT) → we return Contracts (lot/min rounded)
 *   and Cost (USDT = margin). Fully multiplier-aware so ADA/DOGE etc. size correctly.
 * Notes:
 *   - Uses TA price first, then KuCoin mark/ticker as fallback.
 *   - Returns both costUsd (modern) and marginUsd (legacy alias) for FE compatibility.
 *   - Contracts mode supported for legacy callers; derives notional with multiplier.
 *   - 🔵 Upgrades:
 *       • baseQty & exposure (for clearer UI/receipts)
 *       • optional passthrough of tpPercent/slPercent if provided by FE
 * Last Updated: 2025-08-10 + patches (baseQty/exposure, tp/sl passthrough)
 * Patch: 2025-08-18
 *   - TA fetch uses ?raw=1 to bypass volume gating (preview should always price)
 *   - Extra guards for specs/price; clearer 4xx messages
 */

const axios = require('axios');
const {
  parseToKucoinContractSymbol,
  toSpotSymbolForTA,
  getContractSpecs,
  calcOrderFromQuantityUsd,
  fetchKucoinTickerPrice,
} = require('../kucoinHelper');

const TA_BASE = process.env.TA_BASE_URL || 'http://localhost:3000';

// Resolve a fair preview price:
// 1) hinted price if valid
// 2) TA (spot symbol) — use raw=1 to bypass volume gate
// 3) KuCoin ticker mark/last
async function resolvePreviewPrice(contractHyphen, hintedPrice) {
  const p = Number(hintedPrice);
  if (Number.isFinite(p) && p > 0) return p;

  try {
    const spot = toSpotSymbolForTA(contractHyphen); // e.g. BTCUSDT (Bybit aliasing inside helper)
    const taUrl = `${TA_BASE}/api/ta/${encodeURIComponent(spot)}?raw=1`;
    const taRes = await axios.get(taUrl, { timeout: 8000 });
    const taPrice = Number(taRes.data?.price ?? taRes.data?.markPrice);
    if (Number.isFinite(taPrice) && taPrice > 0) return taPrice;
  } catch (_) {
    // fall through to exchange price
  }

  const ex = await fetchKucoinTickerPrice(contractHyphen);
  return (Number.isFinite(ex) && ex > 0) ? ex : null;
}

async function previewOrder(req, res) {
  try {
    const {
      symbol: rawSymbol,
      notionalUsd,           // preferred: Quantity (USDT)
      // legacy support:
      orderMode,             // 'USDT' | 'CONTRACTS'
      inputValue,            // qty(USDT) or contracts depending on mode
      leverage,
      price,
      // 🔵 optional passthrough for UI labels
      tpPercent,
      slPercent
    } = req.body || {};

    const lev = Math.max(1, Number(leverage || 0));
    if (!rawSymbol || !(lev > 0)) {
      return res.status(400).json({ ok: false, error: 'Missing symbol or leverage' });
    }

    const contract = parseToKucoinContractSymbol(rawSymbol);

    // Specs are required for lotSize/minSize/multiplier math
    const specs = await getContractSpecs(contract).catch(() => null);
    if (!specs || (!Number.isFinite(specs.multiplier) && specs.multiplier !== 1)) {
      return res.status(400).json({ ok: false, error: `Missing specs for ${contract}` });
    }

    const usePrice = await resolvePreviewPrice(contract, price);
    if (!Number.isFinite(usePrice) || usePrice <= 0) {
      return res.status(400).json({ ok: false, error: 'No price available for preview' });
    }

    // Resolve inputs
    let qtyUsd = Number(notionalUsd);
    let contractsInput = NaN;

    if (!(qtyUsd > 0)) {
      const mode = String(orderMode || '').toUpperCase();
      if (mode === 'USDT') {
        qtyUsd = Number(inputValue);
      } else if (mode === 'CONTRACTS') {
        contractsInput = Number(inputValue);
      }
    }

    let contracts = 0;
    let costUsd   = 0;
    let notional  = 0;

    // Path A: user inputs notional (USDT)
    if (qtyUsd > 0) {
      const out = calcOrderFromQuantityUsd({
        quantityUsd: qtyUsd,
        price: usePrice,
        leverage: lev,
        lotSize: specs.lotSize,
        minSize: specs.minSize,
        multiplier: specs.multiplier
      });
      contracts = out.contracts;
      costUsd   = out.costUsd;
      notional  = qtyUsd;
    }
    // Path B: user inputs contracts directly
    else if (contractsInput > 0) {
      const lot = specs.lotSize || 1;
      const min = specs.minSize || 0;
      let cRaw = Number(contractsInput);
      // round down to lot; then enforce min
      cRaw = Math.floor(cRaw / lot) * lot;
      if (cRaw < min) cRaw = min;

      contracts = cRaw;
      // Exposure = contracts × price × multiplier
      notional  = contracts * usePrice * (specs.multiplier || 1);
      costUsd   = notional / lev;
    } else {
      return res.status(400).json({ ok: false, error: 'Provide notionalUsd or inputValue' });
    }

    if (!(contracts > 0)) {
      return res.status(400).json({ ok: false, error: 'Contracts computed as 0 (check lotSize/minSize)' });
    }

    // 🔵 NEW: base units & exposure for UI clarity
    const baseQty  = contracts * (specs.multiplier || 1);
    const exposure = baseQty * usePrice;

    return res.json({
      ok: true,
      symbol: rawSymbol,
      contract,
      price: usePrice,
      leverage: lev,
      contracts,
      costUsd: Number(costUsd.toFixed(2)),        // Cost (margin)
      notionalUsd: Number(notional.toFixed(2)),   // Quantity (exposure)
      marginUsd: Number(costUsd.toFixed(2)),      // legacy alias
      baseQty: Number(baseQty.toFixed(6)),        // 🔵 NEW
      exposure: Number(exposure.toFixed(2)),      // 🔵 NEW
      lotSize: specs.lotSize,
      minSize: specs.minSize,
      multiplier: specs.multiplier,
      // 🔵 optional passthrough (for FE labels only; no backend effect)
      ...(Number.isFinite(+tpPercent) ? { tpPercent: +tpPercent } : {}),
      ...(Number.isFinite(+slPercent) ? { slPercent: +slPercent } : {})
    });
  } catch (e) {
    console.error('previewOrder error', e?.response?.data || e.message || e);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
}

module.exports = { previewOrder };