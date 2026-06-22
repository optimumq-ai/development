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

const classifier = require('../services/classifier');
const engine = require('../services/workflowEngine');
const estimateProfile = require('../services/estimateProfile');

// Read-only simulation: run the REAL classifier + rule engine + estimate assessment on a
// hypothetical request, WITHOUT creating or persisting anything. The simulator uses this to
// resolve the built nodes with true behavior.
router.post('/simulate', requireAuth, async function (req, res) {
  try {
    var b = req.body || {};
    var description = (b.description || '').trim();
    if (!description) return res.status(400).json({ error: 'description is required' });
    var cls;
    try { cls = await classifier.classifyAndRoute(description); }
    catch (e) { cls = { classification: 'standard', recordTypeConfidence: 0, flags: [], departmentId: null, custodianDepartmentId: null, reasoning: 'Classifier unavailable.' }; }
    if (b.feeWaiver) cls.feeWaiverSignal = true;
    if (b.sensitive) { cls.flags = (cls.flags || []).concat(['SENSITIVE']); }
    var signals = await engine.buildSignals({ description: description, submission_channel: 'portal' }, cls);
    var hit = await engine.evaluate(signals);
    var assess = cls.recordTypeId ? await estimateProfile.assess(cls.recordTypeId) : null;
    res.json({
      match: { recordTypeId: cls.recordTypeId || null, recordTypeName: cls.recordTypeName || null, confidence: Math.round(cls.recordTypeConfidence || 0) },
      signals: { flags: signals.flags || [], hasOwnerTeam: !!signals.has_owner_team, classification: signals.classification, redactionFlag: !!signals.redaction_flag, mrr: !!signals.mrr_flag, feeWaiver: !!cls.feeWaiverSignal },
      rule: hit ? { id: hit.rule.id, name: hit.rule.name } : null,
      routedTeam: cls.teamName || null,
      reasoning: cls.reasoning || null,
      assess: assess ? { decision: assess.decision, confidence: assess.confidence, basis: assess.basis, estimatedTotal: assess.estimatedTotal } : null
    });
  } catch (e) { res.status(500).json({ error: 'Simulation failed: ' + (e && e.message) }); }
});

module.exports = router;
