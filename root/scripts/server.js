const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', function connection(ws) {
  setInterval(() => {
    const tradeData = {
      token: "BTC/USDT",
      price: 67200.23421,
      pnl: "+$124.50",
      position: "LONG",
      status: "OPEN",
      time: new Date().toLocaleTimeString()
    };
    ws.send(JSON.stringify(tradeData));
  }, 3000);
});