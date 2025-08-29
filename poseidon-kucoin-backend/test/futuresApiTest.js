const {
    fetchFuturesPrice,
    getOpenPositions,
    fetchVolumeAndOI,
    toKuCoinContractSymbol
  } = require('../handlers/futuresApi'); // ✅ Adjust path if different
  
  async function runTests() {
    const testSymbol = 'DOGEUSDT';
  
    console.log('\n🧪 Running Futures API Tests...\n');
  
    // Test 1: Symbol Conversion
    const contractSymbol = toKuCoinContractSymbol(testSymbol);
    console.log(`✔️ Converted Symbol: ${testSymbol} → ${contractSymbol}`);
  
    // Test 2: Price Fetch
    const { price, failed } = await fetchFuturesPrice(testSymbol);
    if (!failed && price > 0) {
      console.log(`✔️ Fetched price for ${testSymbol}: $${price}`);
    } else {
      console.warn(`❌ Failed to fetch price for ${testSymbol}`);
    }
  
    // Test 3: Volume and OI
    const { volume, openInterest } = await fetchVolumeAndOI(testSymbol);
    console.log(`✔️ Volume: ${volume}, OI: ${openInterest}`);
  
    // Test 4: Open Positions
    const positions = await getOpenPositions(testSymbol);
    console.log(`✔️ Open Positions:`, positions);
  
    console.log('\n✅ Futures API test completed.\n');
  }
  
  runTests();