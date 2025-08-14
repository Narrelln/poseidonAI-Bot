const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

const mockSymbols = [
  "DOGEUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "PEPEUSDT", "BONKUSDT"
];

let mockBalance = {
  total: "1000.00",
  available: "950.00"
};

let mockPositions = [
  {
    symbol: "DOGEUSDT",
    side: "buy",
    size: "10",
    leverage: 5,
    entryPrice: "0.068",
    unrealisedPnl: "2.50"
  }
];

app.get('/api/futures-symbols', (req, res) => {
  res.json({ success: true, symbols: mockSymbols });
});

app.get('/api/balance', (req, res) => {
  res.json({ success: true, balance: mockBalance });
});

app.post('/api/order', (req, res) => {
  const { symbol, side, leverage, size, type } = req.body;
  if (!symbol || !side || !size) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  res.json({
    code: "200000",
    data: {
      orderId: Math.floor(Math.random() * 1000000000).toString()
    }
  });
});

app.post('/api/close-trade', (req, res) => {
  const { symbol } = req.body;
  if (!symbol) {
    return res.status(400).json({ error: "Missing symbol" });
  }
  res.json({ status: "closed" });
});

app.get('/api/positions', (req, res) => {
  res.json(mockPositions);
});

app.listen(PORT, () => {
  console.log(`🛠️  Mock Poseidon API running at http://localhost:${PORT}`);
});