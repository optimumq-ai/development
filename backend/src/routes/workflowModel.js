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

module.exports = router;
