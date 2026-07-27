'use strict';
// The canonical stage vocabulary, served. The frontend keeps a static mirror (frontend/src/lib/stages.js)
// so pages render without a round-trip; this endpoint is what a parity test compares that mirror against,
// so the two can never silently diverge again (they had — the frontend carried a ghost stage,
// `custodian_retrieval`, that exists nowhere in the backend, and drove live stage writes off it).
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const stages = require('../services/stages');

router.get('/', requireAuth, async function (req, res) {
  var nextMap = {};
  stages.ORDER.forEach(function (s) { nextMap[s] = stages.next(s); });
  // WS2: the VOCABULARY is universal and stays universal — `stages` / `order` / `sequence` / `branch` are
  // unchanged, so the frontend mirror's parity check still compares like with like. What a given state
  // actually HAS is a separate, additive fact: `unavailable` lists the stages this jurisdiction's imported
  // branch profile switches off (OH has no AG band), and `available` is the vocabulary minus those. A
  // jurisdiction with no branch profile reports nothing unavailable.
  var unavailable = [];
  try {
    var BP = require('../services/branchProfile');
    for (var i = 0; i < stages.ORDER.length; i++) {
      if (await BP.stageBlocked(null, stages.ORDER[i])) unavailable.push(stages.ORDER[i]);
    }
  } catch (e) { unavailable = []; }
  res.json({ stages: stages.STAGES, order: stages.ORDER, labels: stages.LABELS, next: nextMap,
             sequence: stages.SEQUENCE, branch: stages.BRANCH,
             unavailable: unavailable,
             available: stages.ORDER.filter(function (s) { return unavailable.indexOf(s) < 0; }) });
});

module.exports = router;
