// utils/withTimeout.js
function withTimeout(promise, ms = 15000, msg = 'timeout') {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        const t = setTimeout(() => {
          clearTimeout(t);
          reject(new Error(msg));
        }, Number(ms) || 0);
      })
    ]);
  }
  
  module.exports = { withTimeout };