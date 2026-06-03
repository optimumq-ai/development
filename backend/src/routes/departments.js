const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all } = require('../db');

router.get('/', requireAuth, async function(req, res) {
  var departments = await all('SELECT * FROM departments WHERE active = 1 ORDER BY sort_order, name');
  res.json({ departments: departments });
});

module.exports = router;
