'use strict';
// The canonical stage vocabulary, served. The frontend keeps a static mirror (frontend/src/lib/stages.js)
// so pages render without a round-trip; this endpoint is what a parity test compares that mirror against,
// so the two can never silently diverge again (they had — the frontend carried a ghost stage,
// `custodian_retrieval`, that exists nowhere in the backend, and drove live stage writes off it).
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const stages = require('../services/stages');

router.get('/', requireAuth, function (req, res) {
  var nextMap = {};
  stages.ORDER.forEach(function (s) { nextMap[s] = stages.next(s); });
  res.json({ stages: stages.STAGES, order: stages.ORDER, labels: stages.LABELS, next: nextMap });
});

module.exports = router;
