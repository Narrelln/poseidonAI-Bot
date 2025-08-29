import { fetchTradableSymbols } from './futuresApiClient.js';

document.addEventListener('DOMContentLoaded', async () => {
  const datalist = document.getElementById('symbol-options');
  const input = document.getElementById('manual-symbol');

  if (!datalist || !input) {
    console.warn('❌ Datalist or input not found.');
    return;
  }

  try {
    const symbols = await fetchTradableSymbols();
    console.log('🎯 Autofill Test Symbols:', symbols);

    datalist.innerHTML = '';

    symbols.forEach(token => {
      const option = document.createElement('option');
      option.value = token.symbol || token;
      datalist.appendChild(option);
    });

    console.log(`✅ Loaded ${datalist.children.length} symbols into datalist`);
  } catch (err) {
    console.error('❌ Autofill test failed:', err);
  }
});