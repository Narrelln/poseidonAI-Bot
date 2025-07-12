const express = require('express');
const router = express.Router();
const { getPositions } = require('../controllers/positionsController');

router.get('/', getPositions);

module.exports = router;
