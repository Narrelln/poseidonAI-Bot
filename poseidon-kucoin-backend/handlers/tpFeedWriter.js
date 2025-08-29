// handlers/tpFeedWriter.js
const TpFeed = require('../models/tpFeed');

const { feed } = require('../core/feeder');

async function writeTpAndBroadcast({ contract, state, text, roi = null, peak = null }) {
  // persist
  await TpFeed.writeLine({ contract, state, text, roi, peak });
  // live bus (SSE/WebSocket)
  feed.tp(contract, text, { state, roi, peak });
}

module.exports = { writeTpAndBroadcast };