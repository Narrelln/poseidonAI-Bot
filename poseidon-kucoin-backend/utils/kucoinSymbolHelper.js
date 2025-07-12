// utils/kucoinSymbolHelper.js

const specialMappings = {
  BTC: 'XBT',
};

function parseToKucoinContractSymbol(input) {
  if (!input) return '';

  const symbol = input.trim().toUpperCase();

  // ✅ PATCH: Return early if already valid KuCoin contract format (e.g. MAGIC-USDTM)
  if (/^[A-Z]+-USDTM$/.test(symbol)) return symbol;

  let raw = symbol.replace(/[-_ ]/g, '').replace(/USDTM?$/, '');

  if (specialMappings[raw]) raw = specialMappings[raw];

  return `${raw}-USDTM`; // ⬅️ Ensure KuCoin dash format
}

function isValidKucoinContractSymbol(contract, contractsList = []) {
  if (!Array.isArray(contractsList)) return false;
  return contractsList.includes(contract);
}

function getAllKucoinContractSymbols(apiContracts = []) {
  if (!Array.isArray(apiContracts)) return [];
  return apiContracts.map(c => c.symbol);
}

module.exports = {
  parseToKucoinContractSymbol,
  isValidKucoinContractSymbol,
  getAllKucoinContractSymbols
};