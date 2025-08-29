// routes/capitalRoute.js
const express = require('express');
const router = express.Router();
const { getCapitalStatus } = require('../handlers/capitalRiskEngine'); // path to your file

router.get('/capital-status', (_req, res) => {
  try {
    const status = getCapitalStatus();
    res.json({ success: true, ...status });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;