const { updateMemoryFromResult, getMemory } = require('./data/updateMemoryFromResult');
console.log('📦 Test script loaded'); // add this at top of testMemory.js
async function test() {
  const symbol = 'TESTUSDTM';
  const side = 'LONG';

  await updateMemoryFromResult(symbol, side, 'win', 12.5, 78, { testRun: true });

  const mem = getMemory(symbol);
  console.log(`🧠 Memory for ${symbol}:`, JSON.stringify(mem, null, 2));
}

test();