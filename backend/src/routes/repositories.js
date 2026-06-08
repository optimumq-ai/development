const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all, get, run } = require('../db');
const catalog = require('../services/connectors/registry');

function nid(){ return 'repo-' + Math.random().toString(36).slice(2, 10); }

router.get('/catalog', requireAuth, function(req, res){ res.json({ catalog: catalog }); });

router.get('/', requireAuth, async function(req, res){
  var rows = await all('SELECT * FROM record_repositories ORDER BY sort_order, name');
  rows.forEach(function(r){ try { r.config = r.config ? JSON.parse(r.config) : {}; } catch(e){ r.config = {}; } });
  res.json({ repositories: rows });
});

router.post('/', requireAuth, async function(req, res){
  var b = req.body || {};
  if (!b.name || !b.connector_type) return res.status(400).json({ error: 'name and connector_type are required' });
  var id = b.id || nid();
  var config = typeof b.config === 'string' ? b.config : JSON.stringify(b.config || {});
  try {
    await run('INSERT INTO record_repositories (id, name, connector_type, status, config, sort_order) VALUES (?,?,?,?,?,?)', [id, b.name, b.connector_type, b.status || 'active', config, b.sort_order || 50]);
  } catch(e){ return res.status(400).json({ error: String(e.message || e) }); }
  var row = await get('SELECT * FROM record_repositories WHERE id = ?', [id]);
  res.json({ repository: row });
});

router.patch('/:id', requireAuth, async function(req, res){
  var b = req.body || {};
  var sets = [], vals = [];
  ['name','connector_type','status','sort_order'].forEach(function(f){ if (b.hasOwnProperty(f)) { sets.push(f + ' = ?'); vals.push(b[f]); } });
  if (b.hasOwnProperty('config')) { sets.push('config = ?'); vals.push(typeof b.config === 'string' ? b.config : JSON.stringify(b.config || {})); }
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  vals.push(req.params.id);
  await run('UPDATE record_repositories SET ' + sets.join(', ') + ' WHERE id = ?', vals);
  res.json({ success: true });
});

router.delete('/:id', requireAuth, async function(req, res){
  await run('DELETE FROM record_repositories WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
