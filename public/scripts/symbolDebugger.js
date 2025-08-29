// === /public/scripts/symbolDebugger.js ===
// Debug tool to detect malformed or unmatched symbols from scanner vs /api/futures-symbols

import { toKuCoinContractSymbol, fetchKuCoinFuturesSymbols } from './futuresApiClient.js';

async function debugSymbols() {
  try {
    const scanRes = await window.axios.get('/api/scan-tokens');
    const contracts = await fetchKuCoinFuturesSymbols();

    const allContracts = contracts.map(c => c.symbol.toUpperCase());
    const normalize = s => s.replace(/[-_]/g, '').toUpperCase();

    const tokens = [
      ...(scanRes.data.gainers || []),
      ...(scanRes.data.losers || [])
    ];

    console.log(`🧪 Running symbol debugger on ${tokens.length} scanner tokens...`);
    let matched = 0;
    let mismatched = 0;

    for (const token of tokens) {
      const original = token.symbol;
      const converted = toKuCoinContractSymbol(original);
      const normConverted = normalize(converted);

      const found = allContracts.some(c => normalize(c) === normConverted);

      if (found) {
        console.log(`✅ ${original} → ${converted} matches a valid contract.`);
        matched++;
      } else {
        console.warn(`❌ ${original} → ${converted} not found in /api/futures-symbols`);
        mismatched++;
      }
    }

    console.log(`✅ Done: ${matched} matched, ❌ ${mismatched} mismatched.`);
  } catch (err) {
    console.error('❌ Symbol debugger error:', err.message);
  }
}

// Expose to browser console
window.debugSymbols = debugSymbols;
