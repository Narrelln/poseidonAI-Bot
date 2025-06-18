const socket = new WebSocket("ws://localhost:8080");

socket.onmessage = function (event) {
  const message = event.data;
  addWalletActivity(message); // already defined in dashboard.js
};