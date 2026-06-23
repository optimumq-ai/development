const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// List reasons for a category (most-used first).
router.get('/', requireAuth, async function (req, res) {
  var cat = req.query.category;
  var rows = cat
    ? await all('SELECT * FROM decision_reasons WHERE category = ? AND is_active = 1 ORDER BY usage_count DESC, created_at ASC', [cat])
    : await all('SELECT * FROM decision_reasons WHERE is_active = 1 ORDER BY category, usage_count DESC');
  res.json({ reasons: rows });
});

// Add a reason to the library (or return the existing match).
router.post('/', requireAuth, requireRole('SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR', 'FEE_WAIVER_APPROVER'), async function (req, res) {
  var b = req.body || {};
  if (!b.category || !b.text || !b.text.trim()) return res.status(400).json({ error: 'category and text are required' });
  var t = b.text.trim();
  var existing = await get('SELECT * FROM decision_reasons WHERE category = ? AND lower(text) = lower(?)', [b.category, t]);
  if (existing) return res.json({ reason: existing, existed: true });
  var id = 'dr-' + uuidv4().substring(0, 8);
  await run('INSERT INTO decision_reasons (id, category, text, created_by) VALUES (?,?,?,?)', [id, b.category, t, (req.user && req.user.sub) || null]);
  res.json({ reason: await get('SELECT * FROM decision_reasons WHERE id = ?', [id]), existed: false });
});

// Soft-remove a reason (keeps it from future pickers without breaking history).
router.delete('/:id', requireAuth, requireRole('SYSTEM_ADMIN', 'DIRECTOR', 'SUPERVISOR'), async function (req, res) {
  await run('UPDATE decision_reasons SET is_active = 0 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
