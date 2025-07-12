// index.js — Poseidon KuCoin Backend (Patched+Modular Market Routes)

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const MEMORY_PATH = path.join(__dirname, 'utils', 'data', 'poseidonMemory.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
const PORT = process.env.PORT || 3000;

// Static & Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/scripts', express.static(path.join(__dirname, 'public', 'scripts')));
app.use('/styles', express.static(path.join(__dirname, 'styles')));
app.use(cors());
app.use(express.json());

// === Modular Market Routes ===
const marketRoutes = require('./routes/marketRoutes');
app.use('/api', marketRoutes);


// === Technical Indicators ===
const ti = require('technicalindicators');
app.get('/api/ta/:symbol', async (req, res) => {
  let symbol = req.params.symbol;
  if (!symbol.endsWith('USDTM')) symbol = symbol.replace('USDT', 'USDTM');
  const now = Math.floor(Date.now() / 1000);
  const from = req.query.from ? Number(req.query.from) : now - (2 * 60 * 60);
  const to = req.query.to ? Number(req.query.to) : now;
  const candlesUrl = `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${symbol}&granularity=1&from=${from}&to=${to}`;
  console.log('TA QUERY:', candlesUrl);

  try {
    const candleRes = await axios.get(candlesUrl);
    const raw = candleRes.data.data || [];
    if (!Array.isArray(raw) || !raw.length) {
      return res.json({ nodata: true, msg: 'No candles found for symbol', symbol });
    }

    const candles = raw.map(r => ({
      open: parseFloat(r[1]),
      close: parseFloat(r[2]),
      high: parseFloat(r[3]),
      low: parseFloat(r[4]),
      volume: parseFloat(r[5])
    })).reverse();

    const closes = candles.map(c => c.close);
    const macd = ti.MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const bb = ti.BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });

    const recentVol = candles.slice(-5).map(c => c.volume);
    const avgVol = recentVol.reduce((a, b) => a + b, 0) / recentVol.length;
    const latestVol = candles[candles.length - 1].volume;
    const volumeSpike = latestVol > avgVol * 1.8;

    res.json({
      macd: macd[macd.length - 1] || {},
      bb: bb[bb.length - 1] || {},
      volumeSpike,
      latestVol,
      avgVol: avgVol ? avgVol.toFixed(2) : "0"
    });
  } catch (err) {
    res.json({ nodata: true, error: err.message, symbol });
  }
});

// === Memory APIs ===
function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_PATH)) return {};
    return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
  } catch (e) {
    console.error('[MEMORY] Load failed:', e.message);
    return {};
  }
}
function saveMemory(mem) {
  try {
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2));
    return true;
  } catch (e) {
    console.error('[MEMORY] Save failed:', e.message);
    return false;
  }
}
app.get('/api/memory', (req, res) => res.json(loadMemory()));
app.post('/api/memory', (req, res) => {
  const update = req.body || {};
  if (!update || typeof update !== 'object') return res.status(400).json({ error: "Bad memory update" });
  const mem = Object.assign({}, loadMemory(), update);
  saveMemory(mem);
  res.json({ success: true, memory: mem });
});
app.put('/api/memory', (req, res) => {
  const update = req.body || {};
  if (!update || typeof update !== 'object') return res.status(400).json({ error: "Bad memory update" });
  saveMemory(update);
  res.json({ success: true, memory: update });
});

// === Static Homepage ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'futures.html'));
});

// === KuCoin Handlers and Trade APIs ===
const {
  getKucoinWalletBalance,
  getKucoinFuturesSymbols,
  getOpenFuturesPositions
} = require('./kucoinHelper');

const { getRecentTrades } = require('./utils/tradeHistory');
const { registerOrderRoute } = require('./handlers/orderHandler');
const { registerCloseTradeRoute } = require('./handlers/closeTradeRoute');
const { registerConfirmRecoveryRoute } = require('./routes/confirmRecoveryRoute'); // ✅ line 85
const { registerRSIReversalRoute } = require('./routes/rsiReversalRoute');



// === Register Routes ===
registerOrderRoute(app, io);
registerCloseTradeRoute(app, io);
registerConfirmRecoveryRoute(app); // ✅ Newly added
registerRSIReversalRoute(app);

// === WebSocket Events ===
io.on('connection', (socket) => {
  console.log('🔌 Client connected');
  socket.on('disconnect', () => console.log('❌ Client disconnected'));
});

// === Trading Routes ===
app.get('/api/balance', async (req, res) => {
  try {
    const balance = await getKucoinWalletBalance();
    res.json({ success: true, balance });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
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
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'futures.html'));
});

// === Launch Server ===
server.listen(PORT, () => {
  console.log(`🚀 Poseidon backend live at http://localhost:${PORT}`);
});