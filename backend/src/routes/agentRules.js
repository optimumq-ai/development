const express = require('express');
const router = express.Router();
// Portal Agent Rules is a LIST screen (approval model, SPEC_setup_hub §3e): adding, editing, switching off
// or deleting a rule is a change on the `agent_rules` row. Router-level finish hook — best effort.
router.use(function (req, res, next) {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].indexOf(req.method) !== -1) {
    res.on('finish', function () { if (res.statusCode < 300) { try { require('../services/setupHub').afterChange('agent_rules', req.user && (req.user.name || req.user.email)).catch(function () {}); } catch (e) {} } });
  }
  next();
});
const { get, all, run } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
// v3 (S2): portal agent rules are Lane 4 — the system_admin group (§8 row 5). Reads stay requireAuth.
const SYS = requirePermission('system_admin');
const { v4: uuidv4 } = require('uuid');

// List all rules
router.get('/', requireAuth, async function(req, res) {
  var rules = await all('SELECT id, rule_text, enabled, sort_order, created_at, created_by FROM agent_rules ORDER BY sort_order ASC, created_at ASC');
  res.json(rules);
});

// Create a new rule
router.post('/', requireAuth, SYS, async function(req, res) {
  var text = (req.body.rule_text || '').trim();
  if (!text) return res.status(400).json({ error: 'rule_text is required' });
  var maxRow = await get('SELECT MAX(sort_order) as m FROM agent_rules');
  var nextOrder = (maxRow && maxRow.m) ? maxRow.m + 10 : 10;
  var id = 'rule-' + uuidv4().substring(0, 8);
  await run('INSERT INTO agent_rules (id, rule_text, enabled, sort_order, created_by) VALUES (?,?,?,?,?)',
    [id, text, 1, nextOrder, req.user.email || 'admin']);
  res.json(await get('SELECT * FROM agent_rules WHERE id = ?', [id]));
});

// Update a rule (text and/or enabled)
router.patch('/:id', requireAuth, SYS, async function(req, res) {
  var rule = await get('SELECT * FROM agent_rules WHERE id = ?', [req.params.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  var newText = req.body.rule_text !== undefined ? String(req.body.rule_text).trim() : rule.rule_text;
  var newEnabled = req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : rule.enabled;
  await run('UPDATE agent_rules SET rule_text = ?, enabled = ? WHERE id = ?', [newText, newEnabled, rule.id]);
  res.json(await get('SELECT * FROM agent_rules WHERE id = ?', [rule.id]));
});

// Delete a rule
router.delete('/:id', requireAuth, SYS, async function(req, res) {
  var rule = await get('SELECT id FROM agent_rules WHERE id = ?', [req.params.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  await run('DELETE FROM agent_rules WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
