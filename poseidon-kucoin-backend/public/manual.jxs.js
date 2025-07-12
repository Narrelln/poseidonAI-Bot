










  // index.js — Poseidon KuCoin Backend (Patched/Stable+Memory+Safe Symbol Handling)

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const MEMORY_PATH = path.join(__dirname, 'utils', 'data', 'poseidonMemory.json');
const { parseToKucoinContractSymbol } = require('./kucoinHelper'); // <-- ADD THIS

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
const PORT = process.env.PORT || 3000;

// === STATIC ASSET SERVING ===
app.use(express.static(path.join(__dirname, 'public')));
app.use('/scripts', express.static(path.join(__dirname, 'scripts')));
app.use('/styles', express.static(path.join(__dirname, 'styles')));
app.use(cors());
app.use(express.json());

// === Proxy: KuCoin Market Stats (volume, OI, etc) ===
app.get('/api/kucoin/market-stats', async (req, res) => {
  try {
    let { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    // Always spot format for KuCoin: DOGE-USDT
    symbol = symbol
      .replace(/-USDTM$/i, '')
      .replace(/USDTM$/i, '')
      .replace(/-USDT$/i, '')
      .replace(/USDT$/i, '')
      .toUpperCase() + '-USDT';
    const statsRes = await axios.get(`https://api.kucoin.com/api/v1/market/stats?symbol=${symbol}`);
    res.json(statsRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Proxy: KuCoin Price (last price etc) ===
app.get('/api/kucoin/price', async (req, res) => {
  try {
    let { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    // Always spot format for KuCoin: DOGE-USDT
    symbol = symbol
      .replace(/-USDTM$/i, '')
      .replace(/USDTM$/i, '')
      .replace(/-USDT$/i, '')
      .replace(/USDT$/i, '')
      .toUpperCase() + '-USDT';
    const priceRes = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${symbol}`);
    res.json(priceRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Serve Top Gainers for Scanning (Using priceChgPct) ===
app.get('/api/top-gainers', async (req, res) => {
  try {
    const contractsRes = await axios.get('https://api-futures.kucoin.com/api/v1/contracts/active');
    const contracts = Array.isArray(contractsRes.data.data)
      ? contractsRes.data.data
      : Object.values(contractsRes.data.data);

    let filtered = contracts.filter(c =>
      c.symbol.endsWith('USDTM') &&
      c.status === 'Open' &&
      typeof c.priceChgPct === 'number'
    );

    const gainers = filtered
      .filter(c => c.priceChgPct > 0)
      .sort((a, b) => b.priceChgPct - a.priceChgPct)
      .slice(0, 21)
      .map(c => c.symbol.replace('-USDTM', 'USDT'));

    console.log('Top 21 gainers:', gainers);
    res.json(gainers);
  } catch (err) {
    console.error("❌ /api/top-gainers error:", err.message);
    res.json([]);
  }
});

// === Serve Top Losers for Scanning (Using priceChgPct) ===
app.get('/api/top-losers', async (req, res) => {
  try {
    const contractsRes = await axios.get('https://api-futures.kucoin.com/api/v1/contracts/active');
    const contracts = Array.isArray(contractsRes.data.data)
      ? contractsRes.data.data
      : Object.values(contractsRes.data.data);

    let filtered = contracts.filter(c =>
      c.symbol.endsWith('USDTM') &&
      c.status === 'Open' &&
      typeof c.priceChgPct === 'number'
    );

    const losers = filtered
      .filter(c => c.priceChgPct < 0)
      .sort((a, b) => a.priceChgPct - b.priceChgPct)
      .slice(0, 9)
      .map(c => c.symbol.replace('-USDTM', 'USDT'));

    console.log('Top 9 losers:', losers);
    res.json(losers);
  } catch (err) {
    console.error("❌ /api/top-losers error:", err.message);
    res.json([]);
  }
});

// === Real Technical Analysis Endpoint (MACD, BB, Volume Spike) ===
const ti = require('technicalindicators'); // npm install technicalindicators

app.get('/api/ta/:symbol', async (req, res) => {
  let symbol = req.params.symbol;
  if (!symbol.endsWith('USDTM')) symbol = symbol.replace('USDT', 'USDTM');
  // Always use SECONDS for KuCoin /kline/query (NOT ms!)
  const now = Math.floor(Date.now() / 1000);
  // Default: last 2 hours in seconds
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

    // MACD (12, 26, 9)
    const macd = ti.MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    // Bollinger Bands (20, 2)
    const bb = ti.BollingerBands.calculate({
      period: 20,
      stdDev: 2,
      values: closes
    });

    // Volume spike: compare latest volume to last 5 average
    const recentVol = candles.slice(-5).map(c => c.volume);
    const avgVol = recentVol.length ? recentVol.reduce((a, b) => a + b, 0) / recentVol.length : 0;
    const latestVol = candles.length ? candles[candles.length - 1].volume : 0;
    const volumeSpike = latestVol > avgVol * 1.8; // 80% higher than avg

    res.json({
      macd: macd[macd.length - 1] || {},
      bb: bb[bb.length - 1] || {},
      volumeSpike,
      latestVol,
      avgVol: avgVol ? avgVol.toFixed(2) : "0"
    });
  } catch (err) {
    let msg = err?.response?.data?.msg || err.message;
    res.json({ nodata: true, error: msg, symbol });
  }
});

// === MEMORY: Persistent Deep Learning Kernel (Final) ===
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
app.get('/api/memory', (req, res) => {
  res.json(loadMemory());
});
app.post('/api/memory', (req, res) => {
  const update = req.body || {};
  if (!update || typeof update !== 'object') {
    return res.status(400).json({ error: "Bad memory update" });
  }
  const mem = Object.assign({}, loadMemory(), update);
  saveMemory(mem);
  res.json({ success: true, memory: mem });
});
app.put('/api/memory', (req, res) => {
  const update = req.body || {};
  if (!update || typeof update !== 'object') {
    return res.status(400).json({ error: "Bad memory update" });
  }
  saveMemory(update);
  res.json({ success: true, memory: update });
});

// === MAIN ROUTES ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'futures.html'));
});

// === KuCoin Core Logic (Handlers) ===
const {
  getKucoinWalletBalance,
  getKucoinFuturesSymbols,
  getOpenFuturesPositions
} = require('./kucoinHelper');
const { placeFuturesOrder } = require('./handlers/placeTradeHandler');
const { closeFuturesPosition } = require('./handlers/closeTradeHandler');
const { getRecentTrades, recordTrade, closeTrade } = require('./utils/tradeHistory');

// === WebSocket ===
io.on('connection', (socket) => {
  console.log('🔌 Client connected');
  socket.on('disconnect', () => console.log('❌ Client disconnected'));
});

// === API ROUTES ===
app.get('/api/balance', async (req, res) => {
  try {
    const balance = await getKucoinWalletBalance();
    res.json({ success: true, balance });
  } catch (err) {
    console.error("/api/balance error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get('/api/futures-symbols', async (req, res) => {
  try {
    const symbols = await getKucoinFuturesSymbols();
    res.json({ success: true, symbols });
  } catch (err) {
    console.error("/api/futures-symbols error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post('/api/order', async (req, res) => {
  try {
    const body = req.body;
    if (!body.contract || !body.side || !body.size) {
      return res.status(400).json({ error: 'Missing required order parameters.' });
    }
    io.emit('trade-pending', { ...body, timestamp: Date.now() });
    const result = await placeFuturesOrder(body);
    const entry = result?.data?.dealPrice || body.entry || '-';
    await recordTrade({
      symbol: body.contract,
      side: body.side,
      entry,
      size: body.size,
      leverage: body.leverage || 5,
      status: 'OPEN',
      timestamp: Date.now()
    });
    io.emit('trade-confirmed', {
      ...result,
      symbol: body.contract,
      side: body.side
    });
    res.json(result);
  } catch (err) {
    console.error("/api/order error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post('/api/close-trade', async (req, res) => {
  try {
    const { contract, side } = req.body;
    if (!contract || !side) {
      return res.status(400).json({ error: 'Missing contract or side.' });
    }
    console.log(`[CLOSE TRADE] Request:`, req.body);
    const result = await closeFuturesPosition({ contract, side });
    console.log(`[CLOSE TRADE] Handler result:`, result);
    io.emit('trade-closed', {
      contract,
      side,
      timestamp: Date.now(),
      ...result
    });
    res.json(result);
  } catch (err) {
    console.error("/api/close-trade error:", err.message);
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
      let pnlValue = 0;
      let pnlPercent = "0.00%";
      let roi = "0.00%";
      if (side === "long") {
        pnlValue = (mark - entry) * size;
        const pnlRaw = ((mark - entry) / entry) * leverage * 100;
        pnlPercent = pnlRaw.toFixed(2) + "%";
        roi = pnlPercent;
      } else {
        pnlValue = (entry - mark) * size;
        const pnlRaw = ((entry - mark) / entry) * leverage * 100;
        pnlPercent = pnlRaw.toFixed(2) + "%";
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
    console.error("/api/positions error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get('/api/trade-history', (req, res) => {
  try {
    const trades = getRecentTrades();
    res.json({ success: true, trades });
  } catch (err) {
    console.error("/api/trade-history error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'futures.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 Poseidon backend live at http://localhost:${PORT}`);
});