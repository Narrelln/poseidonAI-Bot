const WebSocket = require('ws');

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`✅ Poseidon WebSocket Server running at ws://localhost:${PORT}`);

const messages = [
  "🧠 Groovy bought $ZOOM at 9K MC",
  "⚠️ Cupsey exited $DOGEY with +45%",
  "🚀 Smart5 triggered $JUMP at 12K MC",
  "💣 Dev dumped $FURY after bonding 19%",
  "📉 $RAID dropped 27% in 1 minute"
];

wss.on('connection', (ws) => {
  console.log("🔌 New frontend connected to Poseidon");

  let i = 0;
  const interval = setInterval(() => {
    const msg = messages[i % messages.length];
    ws.send(msg);
    i++;
  }, 5000); // every 5 seconds

  ws.on('close', () => {
    console.log("❌ Frontend disconnected");
    clearInterval(interval);
  });
});