const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const model = require('../data/workflowModel');

// The whole decision model (phases, nodes, legend, terminal states, policy knobs).
router.get('/', requireAuth, function (req, res) { res.json(model); });
// A single node by id.
router.get('/node/:id', requireAuth, function (req, res) {
  var n = model.nodes[req.params.id];
  if (!n) return res.status(404).json({ error: 'Unknown node' });
  res.json(n);
});

// The read-only /simulate endpoint and the Simulator screen it served were DELETED 2026-08-01
// (Kevin's menu reorganization): the simulator was far from functional and its cost outweighed its
// value. If a future simulator is wanted, rebuild against the then-current engine rather than
// resurrecting this one — buildSignals/evaluate/assess are all still public on their services.

module.exports = router;
