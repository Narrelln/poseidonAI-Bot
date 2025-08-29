// /routes/feedRoutes.js
const express = require('express');
const router = express.Router();
const { getBuffer, subscribe } = require('../core/feedBus');

router.get('/feed/history', (req, res) => {
  const since = Number(req.query.since || 0);
  res.json({ items: getBuffer({ since }) });
});

router.get('/feed/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  const unsub = subscribe(feed => {
    res.write(`event: feed\n`);
    res.write(`data: ${JSON.stringify(feed)}\n\n`);
  });

  req.on('close', () => unsub());
});

module.exports = router;