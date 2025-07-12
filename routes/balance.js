// // routes/balance.js

// import express from 'express';
// import { getWalletBalance } from '../scriptsFutures/futuresApi.js'; // Adjust path if needed

// const router = express.Router();

// router.get('/api/balance', async (req, res) => {
//   try {
//     const balance = await getWalletBalance();
//     res.json({ success: true, balance });
//   } catch (err) {
//     console.error("❌ /api/balance error:", err.message);
//     res.status(500).json({
//       error: 'Balance fetch failed',
//       details: err.message || 'Unknown error'
//     });
//   }
// });

// // export default router;