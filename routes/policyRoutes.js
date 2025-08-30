// routes/policyRoutes.js — view current adaptive policy
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const POLICY_PATH = path.join(__dirname, '..', 'config', 'adaptivePolicy.json');

router.get('/policy', (_req, res) => {
  try {
    const raw = fs.readFileSync(POLICY_PATH, 'utf8');
    res.json({ ok:true, policy: JSON.parse(raw) });
  } catch {
    res.json({ ok:true, policy: { minConf: { major:70, meme:70, other:70 }, updatedAt: Date.now() } });
  }
});

module.exports = router;