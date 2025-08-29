// handlers/tpFeedWriter.js
const TpFeed = require('../models/tpFeed');
const { feed } = require('../core/feeder');

async function writeTpAndBroadcast({ contract, state, text, roi, peak }) {
  await TpFeed.writeLine({ contract, state, text, roi, peak });
  feed.tp(contract, text, { state, roi, peak });
}

module.exports = { writeTpAndBroadcast };