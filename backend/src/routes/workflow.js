const express = require('express');
const router = express.Router();
// Workflow Rules is a LIST screen (approval model, SPEC_setup_hub §3e): writing, editing, switching off or
// deleting a rule is a change on the `routing_rules` row. Router-level finish hook — best effort.
router.use(function (req, res, next) {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].indexOf(req.method) !== -1) {
    res.on('finish', function () { if (res.statusCode < 300) { try { require('../services/setupHub').afterChange('routing_rules', req.user && (req.user.name || req.user.email)).catch(function () {}); } catch (e) {} } });
  }
  next();
});
const { get, all, run } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');

const VOCAB = {
  fields: {
    record_type_confidence: '0-100 number: how confident the AI match to a record type is',
    record_type_code: 'string: the matched record type code',
    category: 'string: the matched record type category name',
    public_availability: 'string: releasable | review_required | restricted | confidential',
    classification: 'string: simple | standard | complex | redaction_required',
    redaction_flag: 'boolean: the request likely needs redaction',
    mrr_flag: 'boolean: multi-record request',
    origin: 'string: portal | manual',
    has_owner_team: 'boolean: an owning team was identified for the matched record type',
    flags: 'array of strings, any of: LEGAL_HOLD, ONGOING_INVESTIGATION, SENSITIVE'
  },
  ops: ['gte','gt','lte','lt','eq','neq','in','contains','contains_any','is_true','is_false'],
  // The AI rule builder was previously handed a 4-stage vocabulary, so it could only ever emit a quarter of
  // the pipeline (no exemption_review, ag_review, redaction, awaiting_payment...). One canonical list now.
  // 'closed' is excluded: a workflow RULE routes work, it does not close a request — that is a decision.
  stages: require('../services/stages').ORDER.filter(function (s) { return s !== 'closed'; }),
  teams: ['matched (the team that owns the matched record type)','open_records (the Open Records team)']
};

// ---- list / CRUD ----
router.get('/rules', requireAuth, async function(req, res) {
  var rules = await all('SELECT * FROM workflow_rules ORDER BY priority ASC, created_at ASC');
  res.json({ rules: rules.map(function(r){ return Object.assign({}, r, { conditions: safe(r.conditions, []), actions: safe(r.actions, {}) }); }) });
});

router.post('/rules', requireAuth, requirePermission('operations_config'), async function(req, res) {
  var b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name is required' });
  var id = 'wfr-' + uuidv4().substring(0,8);
  await run('INSERT INTO workflow_rules (id, name, description, enabled, priority, conditions, actions, source, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, b.name.trim(), b.description || '', b.enabled === 0 ? 0 : 1, Number(b.priority) || 50, JSON.stringify(b.conditions || []), JSON.stringify(b.actions || {}), b.source || 'manual', req.user.sub]);
  res.json({ rule: await get('SELECT * FROM workflow_rules WHERE id = ?', [id]) });
});

router.patch('/rules/:id', requireAuth, requirePermission('operations_config'), async function(req, res) {
  var b = req.body || {};
  var sets = [], vals = [];
  if (b.hasOwnProperty('name')) { sets.push('name = ?'); vals.push(b.name); }
  if (b.hasOwnProperty('description')) { sets.push('description = ?'); vals.push(b.description); }
  if (b.hasOwnProperty('enabled')) { sets.push('enabled = ?'); vals.push(b.enabled ? 1 : 0); }
  if (b.hasOwnProperty('priority')) { sets.push('priority = ?'); vals.push(Number(b.priority) || 50); }
  if (b.hasOwnProperty('conditions')) { sets.push('conditions = ?'); vals.push(JSON.stringify(b.conditions)); }
  if (b.hasOwnProperty('actions')) { sets.push('actions = ?'); vals.push(JSON.stringify(b.actions)); }
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  vals.push(req.params.id);
  await run('UPDATE workflow_rules SET ' + sets.join(', ') + ' WHERE id = ?', vals);
  res.json({ rule: await get('SELECT * FROM workflow_rules WHERE id = ?', [req.params.id]) });
});

router.delete('/rules/:id', requireAuth, requirePermission('operations_config'), async function(req, res) {
  await run('DELETE FROM workflow_rules WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ---- AI authoring: plain English -> structured draft rule (the human confirms before saving) ----
router.post('/rules/draft', requireAuth, requirePermission('operations_config'), async function(req, res) {
  var text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  var prompt = 'You translate a plain-English public-records routing rule into a STRICT JSON object the workflow engine can run. '
    + 'You do NOT invent capabilities. Only use the fields, operators, stages and teams listed. If the rule references anything not expressible, still produce your best structured attempt and add a clear item to "warnings".\n\n'
    + 'AVAILABLE CONDITION FIELDS (field: meaning):\n' + Object.keys(VOCAB.fields).map(function(k){ return '- ' + k + ': ' + VOCAB.fields[k]; }).join('\n') + '\n\n'
    + 'OPERATORS: ' + VOCAB.ops.join(', ') + '\n'
    + 'ACTION stage (one of): ' + VOCAB.stages.join(', ') + '\n'
    + 'ACTION team (one of): ' + VOCAB.teams.join(', ') + '\n\n'
    + 'Rule (plain English): "' + text + '"\n\n'
    + 'Return ONLY this JSON, no prose:\n{\n'
    + '  "name": "short rule name",\n'
    + '  "description": "one-sentence restatement in plain English",\n'
    + '  "conditions": [{"field":"...","op":"...","value": <number|string|boolean|array>}],\n'
    + '  "actions": {"stage":"...","team":"matched|open_records","note":"why, shown in the audit trail","stop":true},\n'
    + '  "priority": 50,\n'
    + '  "warnings": ["anything the system cannot actually observe or do, or ambiguity the author should confirm"]\n}';
  try {
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var msg = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 700, messages: [{ role:'user', content: prompt }] });
    var raw = require('../services/aiText').textOf(msg).replace(/```json|```/g,'').trim();
    var draft = JSON.parse(raw);
    res.json({ draft: draft });
  } catch(e) {
    res.status(502).json({ error: 'Could not draft the rule: ' + e.message });
  }
});

// ---- decision trail for a request (the "why this path" readout) ----
router.get('/decisions/:requestId', requireAuth, async function(req, res) {
  var rows = await all('SELECT * FROM workflow_decisions WHERE request_id = ? ORDER BY created_at DESC', [req.params.requestId]);
  res.json({ decisions: rows.map(function(r){ return Object.assign({}, r, { flags: safe(r.flags, []) }); }) });
});

function safe(s, dflt){ try { var v = JSON.parse(s); return v == null ? dflt : v; } catch(e){ return dflt; } }

module.exports = router;
