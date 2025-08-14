// utils/botStatus.js

let botStatus = {
    active: true
  };
  
  function isBotActive() {
    return botStatus.active;
  }
  
  function setBotActive(status) {
    botStatus.active = !!status;
  }
  
  module.exports = {
    isBotActive,
    setBotActive
  };