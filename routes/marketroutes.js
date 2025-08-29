// routes/marketroutes.js
const express = require('express');
const router = express.Router();

// ✅ This file is now clean and does not duplicate scanner logic.
// All /api/scan-tokens, /top-gainers, /top-losers, and /futures-symbols
// are now handled exclusively by poseidonScannerRoutes.js

// You may add unrelated market-specific endpoints here as needed.

module.exports = router;