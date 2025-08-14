// === Poseidon Backend Main Server ===
// [1] Express/bootstrap + single source of truth for /api/close-trade via handlers/closeTradeRoute
// [2] No direct app.post('/api/close-trade', closeFuturesPosition) mount anywhere else
// [3] /api/preview-order remains mounted directly (simple stateless preview)

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose'); // ✅ MongoDB

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
const PORT = process.env.PORT || 3000;



// === Middleware & Static ===
app.use(cors());
app.use(express.json());
app.use('/scripts', express.static(path.join(__dirname, 'public', 'scripts'), {
  setHeaders: (res, p) => { if (p.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript'); }
}));
app.use('/styles', express.static(path.join(__dirname, 'styles')));
app.use(express.static(path.join(__dirname, 'public')));

// === Route Modules ===
const marketroutes = require('./routes/marketroutes.js');
const walletRoutes = require('./routes/walletRoutes');
const taRoutes = require('./routes/taRoutes');
const memoryRoutes = require('./routes/memoryRoutes');
const { router: scanTokenRouter } = require('./routes/newScanTokens');
const positionNoteRoutes = require('./routes/positionNoteRoutes'); // ✅ Notes API
// const positionDetailsRoute = require('./routes/positionDetaillsRoute.js'); // optional
const learningMemoryRoutes = require('./routes/learningMemoryRoutes');
const tpStatusRoute = require('./routes/tpStatusRoute');

const { parseToKucoinContractSymbol } = require('./kucoinHelper.js');



const { registerOrderRoute } = require('./handlers/orderHandler');            // opens
const { registerCloseTradeRoute } = require('./handlers/closeTradeRoute');    // closes (wrapper → handler)
const { registerConfirmRecoveryRoute } = require('./routes/confirmRecoveryRoute');
const { registerRSIReversalRoute } = require('./routes/rsiReversalRoute');
const { analyzeSymbol } = require('./handlers/taClient.js');
const { loadLearningMemory } = require('./handlers/learningMemory');
// const { getOpenPositions } = require('./handlers/getOpenPositions');       // deprecated
const { previewOrder } = require('./handlers/previewOrder');
// top of file (with the other requires)
const { ensureSnapshot, pushTpFeed } = require('./tpSlMonitor'); // ← add this

// === Register Routes ===
app.use('/api', marketroutes);
app.use('/api', walletRoutes);
app.use('/api', taRoutes);
app.use('/api', memoryRoutes);
app.use('/api', scanTokenRouter);
app.use('/api', positionNoteRoutes);
app.use('/api', tpStatusRoute);
// app.use('/api', positionDetailsRoute); // optional
app.use('/api/learning-memory', learningMemoryRoutes);
app.use('/api', require('./routes/sessionStatsRoute'));
app.use('/api', require('./routes/tokenWhitelistRoute'));


// [4] Stateless preview
app.post('/api/preview-order', previewOrder);

// [5] Trade open/close mounts — close goes ONLY through the wrapper
registerOrderRoute(app, io);
registerCloseTradeRoute(app, io);
registerConfirmRecoveryRoute(app);
registerRSIReversalRoute(app);

// Load memory once server boots
loadLearningMemory();

// === Custom TA Route ===
app.get('/api/ta/:symbol', async (req, res) => {
  try {
    const raw = req.params.symbol || '';
    const result = await analyzeSymbol(raw);

    if (!result || !result.valid) {
      return res.status(400).json({
        nodata: true,
        error: result?.reason || 'Invalid TA result',
        ...(result?.volume && { volume: result.volume })
      });
    }
    res.json({ nodata: false, ...result });
  } catch (err) {
    console.error('❌ TA route error:', err.message);
    res.status(500).json({ nodata: true, error: 'Internal server error' });
  }
});

// === KuCoin Utils ===
const { getOpenFuturesPositions } = require('./kucoinHelper');
const { getRecentTrades } = require('./utils/tradeHistory');

// === WebSocket Events ===
io.on('connection', (socket) => {
  console.log('🔌 Client connected');
  socket.on('disconnect', () => console.log('❌ Client disconnected'));
});

// === Static Homepage ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'futures.html'));
});

// === Trading Data Routes ===
app.get('/api/positions', async (req, res) => {
  try {
    const positions = await getOpenFuturesPositions();
    res.json({ success: true, positions });
  } catch (err) {
    console.error('❌ /api/positions error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Trade History ===
app.get('/api/trade-history', (req, res) => {
  try {
    const trades = getRecentTrades();
    res.json({ success: true, trades });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// [6] Small health check (handy while debugging)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// === Catch-All ===
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'futures.html'));
});

// === MongoDB Connection + Safe TP Monitor Start ===
// mongoose.connect('mongodb://localhost:27017/poseidon', {})
//   .then(() => {
//     console.log('✅ MongoDB connected');

//     // ✅ Safe to start TP/SL Monitor after DB is ready
//     require('./tpSlMonitor');
//   })
//   .catch(err => {
//     console.error('❌ MongoDB connection failed:', err);
//     process.exit(1); // Optional: exit if DB fails
//   });

// ✅ Start TP/SL Monitor
require('./tpSlMonitor'); // auto close logic uses handler internally

// === Launch Server ===
server.listen(PORT, () => {
  console.log(`🚀 Poseidon backend live at http://localhost:${PORT}`);
});