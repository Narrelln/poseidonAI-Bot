// handlers/taClient.js — minimal server helper (optional)
const { getTA } = require('./taHandler');

async function fetchTA(symbol) {
  const r = await getTA(symbol);
  if (!r || r.success === false) return null;
  return r;
}

module.exports = { fetchTA, analyzeSymbol: fetchTA };