// routes/autoplace.js
const express = require('express');
const router = express.Router();

// default from env, but the POST below becomes source of truth
if (typeof globalThis.__POSEIDON_AUTO_PLACE === 'undefined') {
  const envDefault = String(process.env.AUTOPLACE_DEFAULT || 'true').toLowerCase() === 'true';
  globalThis.__POSEIDON_AUTO_PLACE = envDefault;
  console.log(`[autoplace] default -> ${envDefault ? 'ON' : 'OFF'} (AUTOPLACE_DEFAULT)`);
}

router.get('/autoplace', (_req, res) => {
  const on = !!globalThis.__POSEIDON_AUTO_PLACE;
  res.json({ ok: true, autoplace: on });
});

router.post('/autoplace', (req, res) => {
  try {
    const on = req?.body?.enable === true;
    globalThis.__POSEIDON_AUTO_PLACE = on;
    console.log(`[autoplace] set -> ${on ? 'ON' : 'OFF'} (client)`);
    res.json({ ok: true, autoplace: on });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

module.exports = router;