const express = require('express');
const router = express.Router();
const { getOpenPositions } = require('../handlers/getOpenPositions_legacy');


router.get('/', getOpenPositions);

module.exports = router;