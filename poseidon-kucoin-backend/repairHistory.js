// utils/repairHistory.js
const fs = require('fs');
const path = require('path');
const HISTORY_FILE = path.join(__dirname, 'data', 'tradeHistory.json');
if (fs.existsSync(HISTORY_FILE)) {
  let history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  history = history.map(obj => {
    Object.keys(obj).forEach(k => {
      if (!obj[k] || obj[k] === '-' || obj[k] === 'null' || obj[k] === 'undefined' || (typeof obj[k] === 'string' && obj[k].trim() === '-')) obj[k] = '';
    });
    return obj;
  });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log('All dashes removed from tradeHistory.json!');
}