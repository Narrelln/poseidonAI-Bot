const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
const PORT = process.env.PORT || 3000;

// === Middleware & Static ===
app.use(express.static(path.join(__dirname, 'public')));
app.use('/scripts', express.static(path.join(__dirname, 'public', 'scripts')));
app.use('/styles', express.static(path.join(__dirname, 'styles')));
app.use(cors());
app.use(express.json());

// === Route Modules ===
const marketroutes = require('./routes/marketroutes');
const walletRoutes = require('./routes/walletRoutes');
const taRoutes = require('./routes/taRoutes');
const memoryRoutes = require('./routes/memoryRoutes');
const poseidonScannerRoutes = require('./routes/poseidonScannerRoutes');
const futuresSymbolsRoute = require('./routes/futuresSymbolsRoute');


const { registerOrderRoute } = require('./handlers/orderHandler');
const { registerCloseTradeRoute } = require('./handlers/closeTradeRoute');
const { registerConfirmRecoveryRoute } = require('./routes/confirmRecoveryRoute');
const { registerRSIReversalRoute } = require('./routes/rsiReversalRoute');

// === Register Routes ===
app.use('/api', marketroutes);
app.use('/api', walletRoutes);
app.use('/api', taRoutes);
app.use('/api', memoryRoutes);
app.use('/api', poseidonScannerRoutes);
app.use('/api', futuresSymbolsRoute);


registerOrderRoute(app, io);
registerCloseTradeRoute(app, io);
registerConfirmRecoveryRoute(app);
registerRSIReversalRoute(app);

// === KuCoin Utils ===
const {
  getKucoinFuturesSymbols,
  getOpenFuturesPositions
} = require('./kucoinHelper');
const { getRecentTrades } = require('./utils/tradeHistory');

// === WebSocket Events ===
io.on('connection', (socket) => {
  console.log('ð Client connected');
  socket.on('disconnect', () => console.log('â Client disconnected'));
});

// === Static Homepage ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'futures.html'));
});

// === Trading Data Routes ===
app.get('/api/futures-symbols', async (req, res) => {
  try {
    const symbols = await getKucoinFuturesSymbols();
    res.json({ success: true, symbols });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get('/api/positions', async (req, res) => {
  try {
    const positions = await getOpenFuturesPositions();
    const enriched = positions.map(pos => {
      const entry = parseFloat(pos.entryPrice);
      const mark = parseFloat(pos.markPrice || entry);
      const side = pos.side === "buy" ? "long" : "short";
      const size = Number(pos.size) || 1;
      const leverage = Number(pos.leverage) || 5;
      let pnlValue = 0, pnlPercent = "0.00%", roi = "0.00%";
      if (side === "long") {
        pnlValue = (mark - entry) * size;
        pnlPercent = (((mark - entry) / entry) * leverage * 100).toFixed(2) + "%";
        roi = pnlPercent;
      } else {
        pnlValue = (entry - mark) * size;
        pnlPercent = (((entry - mark) / entry) * leverage * 100).toFixed(2) + "%";
        roi = pnlPercent;
      }
      return {
        ...pos,
        symbol: pos.contract.replace("-USDTM", "USDT"),
        side,
        leverage,
        pnlValue: pnlValue.toFixed(2),
        pnlPercent,
        roi
      };
    });
    res.json({ success: true, positions: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get('/api/trade-history', (req, res) => {
  try {
    const trades = getRecentTrades();
    res.json({ success: true, trades });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Catch-All ===
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next(); // skip API calls
  res.sendFile(path.join(__dirname, 'public', 'futures.html'));
});

// === Launch Server ===
server.listen(PORT, () => {
  console.log(`ð Poseidon backend live at http://localhost:${PORT}`);
});
