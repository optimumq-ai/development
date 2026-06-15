// Fee configuration API. Per-jurisdiction, per-context (FR/SS) fee policy stored as config_json,
// priced by the deterministic feeEngine. The /preview endpoint runs the engine on a posted config
// + sample quantities WITHOUT persisting - this is what lets the config screen show an itemized
// result that updates as you edit. AI extraction (later) will write into these same profiles.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { v4: uuidv4 } = require('uuid');
const engine = require('../services/feeEngine');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function parseConfig(row) { if (!row) return row; var c = {}; try { c = JSON.parse(row.config_json || '{}'); } catch (e) { c = {}; } row.config = c; delete row.config_json; return row; }

// jurisdictions for the selector
router.get('/jurisdictions', requireAuth, async function (req, res) {
  try {
    var rows = await all('SELECT id, code, name, status FROM jurisdiction_profiles ORDER BY name');
    res.json({ jurisdictions: rows || [] });
  } catch (e) { res.status(500).json({ error: 'Could not load jurisdictions.' }); }
});

// pure preview: { config, request } -> itemized feeContext (no persistence)
router.post('/preview', requireAuth, function (req, res) {
  try {
    var config = (req.body && req.body.config) || {};
    var request = (req.body && req.body.request) || { components: [] };
    res.json({ feeContext: engine.compute(config, request) });
  } catch (e) { res.status(400).json({ error: 'Preview failed: ' + (e && e.message) }); }
});

// list profiles (optionally by jurisdiction)
router.get('/', requireAuth, async function (req, res) {
  try {
    var jid = req.query.jurisdiction_id;
    var rows = jid
      ? await all('SELECT id, jurisdiction_id, context, version, status, name, updated_at FROM fee_profiles WHERE jurisdiction_id = ? ORDER BY context, version DESC', [jid])
      : await all('SELECT id, jurisdiction_id, context, version, status, name, updated_at FROM fee_profiles ORDER BY jurisdiction_id, context, version DESC');
    res.json({ profiles: rows || [] });
  } catch (e) { res.status(500).json({ error: 'Could not load fee profiles.' }); }
});

// get one (parsed)
router.get('/:id', requireAuth, async function (req, res) {
  try {
    var row = await get('SELECT * FROM fee_profiles WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Fee profile not found.' });
    res.json({ profile: parseConfig(row) });
  } catch (e) { res.status(500).json({ error: 'Could not load fee profile.' }); }
});

// create
router.post('/', requireAuth, async function (req, res) {
  try {
    var b = req.body || {};
    var context = (b.context === 'SS') ? 'SS' : 'FR';
    var id = 'feeprof-' + uuidv4().slice(0, 8);
    var now = nowStr();
    await run(
      'INSERT INTO fee_profiles (id, jurisdiction_id, context, version, status, name, config_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, b.jurisdiction_id || null, context, 1, 'draft', b.name || (context + ' fee profile'), JSON.stringify(b.config || {}), (req.user && req.user.name) || (req.user && req.user.sub) || 'system', now, now]
    );
    var row = await get('SELECT * FROM fee_profiles WHERE id = ?', [id]);
    res.json({ profile: parseConfig(row) });
  } catch (e) { res.status(500).json({ error: 'Could not create fee profile.' }); }
});

// update (name / status / config)
router.put('/:id', requireAuth, async function (req, res) {
  try {
    var b = req.body || {};
    var existing = await get('SELECT * FROM fee_profiles WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Fee profile not found.' });
    var sets = [], params = [];
    if (b.name != null) { sets.push('name = ?'); params.push(b.name); }
    if (b.status != null) { sets.push('status = ?'); params.push(b.status); }
    if (b.config != null) { sets.push('config_json = ?'); params.push(JSON.stringify(b.config)); }
    sets.push('updated_at = ?'); params.push(nowStr());
    params.push(req.params.id);
    await run('UPDATE fee_profiles SET ' + sets.join(', ') + ' WHERE id = ?', params);
    var row = await get('SELECT * FROM fee_profiles WHERE id = ?', [req.params.id]);
    res.json({ profile: parseConfig(row) });
  } catch (e) { res.status(500).json({ error: 'Could not update fee profile.' }); }
});

module.exports = router;
