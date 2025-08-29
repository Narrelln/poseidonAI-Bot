/**
 * File #08 (DEPRECATED wrapper): handlers/getOpenPositions.js
 * Description:
 *   Back-compat wrapper. Forwards to kucoinHelper.getOpenFuturesPositions()
 *   so any legacy imports still work without stale logic.
 *   Prefer calling /api/positions which already uses kucoinHelper directly.
 * Last Updated: 2025-08-11
 */

const { getOpenFuturesPositions } = require('../kucoinHelper');

async function getOpenPositions(req, res) {
  try {
    const positions = await getOpenFuturesPositions();
    return res.json({ success: true, positions });
  } catch (err) {
    console.error('❌ Failed to fetch positions:', err?.response?.data || err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch positions' });
  }
}

module.exports = { getOpenPositions };