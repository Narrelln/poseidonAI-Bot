
const axios = require('axios');

async function getWalletBalance() {
  try {
    const res = await axios.get('http://localhost:3000/api/wallet');
    const json = res.data;

    const total = parseFloat(json?.balance?.total || 0);
    const available = parseFloat(json?.balance?.available || 0);
    const used = total - available;

    return {
      total,
      used,
      available
    };
  } catch (err) {
    console.warn('⚠️ getWalletBalance error:', err.message);
    return { total: 0, used: 0, available: 0 };
  }
}

module.exports = {
  getWalletBalance
};