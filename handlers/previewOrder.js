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
 * Last Updated: 2025-08-10
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

async function resolvePreviewPrice(contractHyphen, hintedPrice) {
  const p = Number(hintedPrice);
  if (Number.isFinite(p) && p > 0) return p;

  try {
    const spot = toSpotSymbolForTA(contractHyphen);
    const taRes = await axios.get(`${TA_BASE}/api/ta/${spot}`);
    const taPrice = Number(taRes.data?.price ?? taRes.data?.markPrice);
    if (Number.isFinite(taPrice) && taPrice > 0) return taPrice;
  } catch {}

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
      price
    } = req.body || {};

    const lev = Math.max(1, Number(leverage || 0));
    if (!rawSymbol || !(lev > 0)) {
      return res.status(400).json({ ok: false, error: 'Missing symbol or leverage' });
    }

    const contract = parseToKucoinContractSymbol(rawSymbol);
    const specs = await getContractSpecs(contract);     // includes multiplier
    const usePrice = await resolvePreviewPrice(contract, price);
    if (!Number.isFinite(usePrice) || usePrice <= 0) {
      return res.status(400).json({ ok: false, error: 'No price available for preview' });
    }

    let qtyUsd = Number(notionalUsd);
    let contractsInput = NaN;

    if (!(qtyUsd > 0)) {
      if (String(orderMode).toUpperCase() === 'USDT') {
        qtyUsd = Number(inputValue);
      } else if (String(orderMode).toUpperCase() === 'CONTRACTS') {
        contractsInput = Number(inputValue);
      }
    }

    let contracts = 0;
    let costUsd   = 0;
    let notional  = 0;

    if (qtyUsd > 0) {
      const out = calcOrderFromQuantityUsd({
        quantityUsd: qtyUsd,
        price: usePrice,
        leverage: lev,
        lotSize: specs.lotSize,
        minSize: specs.minSize,
        multiplier: specs.multiplier      // ← important
      });
      contracts = out.contracts;
      costUsd   = out.costUsd;
      notional  = qtyUsd;
    } else if (contractsInput > 0) {
      const lot = specs.lotSize || 1;
      const min = specs.minSize || 0;
      let cRaw = Number(contractsInput);
      cRaw = Math.floor(cRaw / lot) * lot;
      if (cRaw < min) cRaw = min;

      contracts = cRaw;
      notional  = contracts * usePrice * (specs.multiplier || 1); // ← multiplier here too
      costUsd   = notional / lev;
    } else {
      return res.status(400).json({ ok: false, error: 'Provide notionalUsd or inputValue' });
    }

    if (!(contracts > 0)) {
      return res.status(400).json({ ok: false, error: 'Contracts computed as 0 (check lotSize/minSize)' });
    }

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
      lotSize: specs.lotSize,
      minSize: specs.minSize,
      multiplier: specs.multiplier
    });
  } catch (e) {
    console.error('previewOrder error', e?.response?.data || e.message || e);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
}

module.exports = { previewOrder };