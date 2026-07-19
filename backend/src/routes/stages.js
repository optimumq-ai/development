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
  // `order` is the full vocabulary (all ten). `sequence` is the linear walk, and `branch` the two stages
  // reachable only by asserting an exemption — see services/stages.js. Both are served so the frontend
  // mirror can be parity-checked on the distinction, not just on the stage list.
  res.json({ stages: stages.STAGES, order: stages.ORDER, labels: stages.LABELS, next: nextMap,
             sequence: stages.SEQUENCE, branch: stages.BRANCH });
});

module.exports = router;
