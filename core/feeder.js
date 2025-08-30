// /core/feeder.js
const { publish } = require('../server/feedBus');           // path ok
const { FEED_TYPES, makeFeed } = require('./feedTypes');

exports.feed = {
  scanner(symbol, msg, data = {}, level = 'info', tags = [], corr = null) {
    publish(makeFeed({ type: FEED_TYPES.SCANNER, symbol, level, msg, data, tags, corr }));
  },
  ta(symbol, msg, data = {}, level = 'info', tags = [], corr = null) {
    publish(makeFeed({ type: FEED_TYPES.TA, symbol, level, msg, data, tags, corr }));
  },
  decision(symbol, msg, data = {}, level = 'info', tags = [], corr = null) {
    publish(makeFeed({ type: FEED_TYPES.DECISION, symbol, level, msg, data, tags, corr }));
  },
  trade(symbol, msg, data = {}, level = 'success', tags = [], corr = null) {
    publish(makeFeed({ type: FEED_TYPES.TRADE, symbol, level, msg, data, tags, corr }));
  },
  // ✅ new: dedicated TP feed type (useful for partial TP, trailing updates, exits)
  tp(symbol, msg, data = {}, level = 'info', tags = ['tp'], corr = null) {
    publish(makeFeed({ type: FEED_TYPES.TP, symbol, level, msg, data, tags, corr }));
  },
  error(symbol, msg, data = {}, tags = [], corr = null) {
    publish(makeFeed({ type: FEED_TYPES.ERROR, symbol, level: 'error', msg, data, tags, corr }));
  },
};