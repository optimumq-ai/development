// Structured-data (FIELDS) redaction endpoints.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const sr = require('../services/structuredRedaction');

// POST /preview { file_id } -> columns + sample rows for the field picker
router.post('/preview', requireAuth, async function (req, res) {
  try { res.json(await sr.preview((req.body || {}).file_id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /apply { file_id, field_map:[{field,rule_id}] } -> born-redacted released PDF
router.post('/apply', requireAuth, async function (req, res) {
  var b = req.body || {};
  if (!b.file_id) return res.status(400).json({ error: 'file_id is required' });
  try {
    var r = await sr.applyFieldMap(b.file_id, Array.isArray(b.field_map) ? b.field_map : [], req.user.name || 'Staff', req.user.sub);
    res.json(Object.assign({ success: true }, r));
  } catch (e) { console.error('[structured apply]', e.message); res.status(500).json({ error: e.message }); }
});

module.exports = router;
