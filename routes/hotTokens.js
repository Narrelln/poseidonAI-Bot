// const express = require('express');
// const router = express.Router();

// const { getHotTokenFeed } = require('../engines/hotTokenEngine');
// const { getCachedScannerData } = require('./scanTokens');

// // === GET /api/hot-tokens-data ===
// router.get('/hot-tokens-data', (req, res) => {
//   try {
//     const scannerData = getCachedScannerData(); // { gainers, losers }
//     const hotFeed = getHotTokenFeed();          // Hot tokens array

//     res.json({
//       success: true,
//       ...scannerData,
//       hotFeed
//     });
//   } catch (err) {
//     console.error('🔥 Hot tokens API error:', err.message);
//     res.status(500).json({ success: false, error: 'Internal error' });
//   }
// });

// // === GET /api/hot-tokens ===
// router.get('/hot-tokens', (req, res) => {
//   try {
//     const hotFeed = getHotTokenFeed(); // should return an array
//     res.json({ hot: hotFeed });
//   } catch (err) {
//     console.error('🔥 Hot tokens simple API error:', err.message);
//     res.status(500).json({ hot: [] });
//   }
// });
// module.exports = {
//   router
// };