// // === server.js — Minimal Poseidon Backend (Stable for Bybit Futures) ===

// import express from 'express';
// import cors from 'cors';
// import dotenv from 'dotenv';
// import { bybitSignedRequest } from './bybit.js';

// dotenv.config();

// const app = express();
// const PORT = process.env.PORT || 3000;

// app.use(cors());
// app.use(express.json());

// // === Health Check ===
// app.get('/', (req, res) => {
//   res.send('✅ Poseidon Backend Running');
// });

// // === Place Order ===
// app.post('/api/order', async (req, res) => {
//   try {
//     const { symbol, side, qty, orderType = 'Market', leverage = 10 } = req.body;
//     if (!symbol || !side || !qty) {
//       return res.status(400).json({ error: 'Missing required parameters' });
//     }

//     // Set leverage (always do first for safety)
//     await bybitSignedRequest('/v5/position/set-leverage', 'POST', {
//       category: 'linear',
//       symbol,
//       buyLeverage: leverage.toString(),
//       sellLeverage: leverage.toString(),
//     });

//     // Convert qty if <10 (assume it's USD size)
//     let orderQty = qty;
//     if (Number(qty) < 10) {
//       const priceRes = await bybitSignedRequest('/v5/market/tickers', 'GET', {
//         category: 'linear',
//         symbol,
//       });
//       const lastPrice = parseFloat(priceRes.result?.list?.[0]?.lastPrice || '0');
//       orderQty = lastPrice > 0 ? Math.max(1, Math.floor(Number(qty) / lastPrice)) : qty;
//     }

//     // Place order
//     const orderRes = await bybitSignedRequest('/v5/order/create', 'POST', {
//       category: 'linear',
//       symbol,
//       side: side.toUpperCase(),   // Buy or Sell
//       orderType,
//       qty: orderQty.toString(),
//       timeInForce: 'IOC',
//     });

//     if (orderRes.retCode !== 0) {
//       return res.status(500).json({ error: 'Order failed', details: orderRes });
//     }

//     res.json({ message: '✅ Order Placed', orderId: orderRes.result.orderId });
//   } catch (err) {
//     console.error('❌ /api/order error:', err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // === Close Order (Market Close Position) ===
// app.post('/api/close-order', async (req, res) => {
//   try {
//     const { symbol, side, qty } = req.body;
//     if (!symbol || !side || !qty) {
//       return res.status(400).json({ error: 'Missing required parameters' });
//     }

//     // To close: place an order in the opposite direction
//     const closeSide = side.toUpperCase() === 'BUY' ? 'SELL' : 'BUY';

//     const closeRes = await bybitSignedRequest('/v5/order/create', 'POST', {
//       category: 'linear',
//       symbol,
//       side: closeSide,
//       orderType: 'Market',
//       qty: qty.toString(),
//       timeInForce: 'IOC',
//       reduceOnly: true, // Only reduce position
//     });

//     if (closeRes.retCode !== 0) {
//       return res.status(500).json({ error: 'Close failed', details: closeRes });
//     }

//     res.json({ message: '✅ Position Closed', orderId: closeRes.result.orderId });
//   } catch (err) {
//     console.error('❌ /api/close-order error:', err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // === Get Wallet Balance ===
// app.get('/api/wallet-balance', async (req, res) => {
//   try {
//     const result = await bybitSignedRequest('/v5/account/wallet-balance', 'GET', {
//       accountType: 'UNIFIED',
//     });
//     if (result.retCode !== 0) throw new Error(result.retMsg || 'Balance fetch error');

//     const coins = result.result.list[0]?.coin || [];
//     const usdt = coins.find(c => c.coin === 'USDT');
//     if (!usdt) throw new Error('No USDT balance found');

//     res.json({
//       balance: parseFloat(usdt.walletBalance).toFixed(2),
//       available: parseFloat(usdt.availableToWithdraw || usdt.walletBalance).toFixed(2),
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // === Get Open Positions ===
// app.get('/api/positions', async (req, res) => {
//   try {
//     const symbol = req.query.symbol || 'DOGEUSDT';
//     const result = await bybitSignedRequest('/v5/position/list', 'GET', {
//       category: 'linear',
//       symbol,
//     });
//     if (result.retCode !== 0) throw new Error(result.retMsg || 'Position fetch error');
//     res.json(result.result?.list || []);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // === Native Fetch Test ===
// fetch('https://api.bybit.com/v5/market/time')
//   .then(res => res.json())
//   .then(json => console.log('✅ Native fetch test: Bybit time:', json))
//   .catch(err => console.error('❌ Native fetch test failed:', err));

// app.listen(PORT, () => {
//   console.log(`🟢 Poseidon Backend listening on port ${PORT}`);
// });