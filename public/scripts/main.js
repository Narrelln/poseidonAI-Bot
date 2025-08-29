// public/scripts/main.js
// This script fetches TA results from the backend and logs them

async function analyzeFromFrontend(symbol) {
    try {
      const res = await axios.get(`/api/ta/${symbol}`);
      if (res.data.nodata) {
        console.warn(`No TA data for ${symbol}:`, res.data.error);
      } else {
        console.log(`TA for ${symbol}:`, res.data);
      }
    } catch (err) {
      console.error(`Error fetching TA for ${symbol}:`, err.message);
    }
  }
  
  // Example usage
  document.addEventListener('DOMContentLoaded', () => {
    const testSymbol = 'BTC-USDTM'; // Change as needed
    analyzeFromFrontend(testSymbol);
  });
  