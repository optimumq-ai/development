const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all, get, run } = require('../db');

function nid(p){ return p + '-' + Math.random().toString(36).slice(2,10); }

router.get('/', requireAuth, async function(req, res) {
  var departments = await all('SELECT * FROM departments WHERE active = 1 ORDER BY sort_order, name');
  res.json({ departments: departments });
});

router.post('/', requireAuth, async function(req, res) {
  var b = req.body || {};
  if (!b.name || !b.code) return res.status(400).json({ error: 'name and code are required' });
  var kind = (b.kind === 'team') ? 'team' : 'department';
  var id = b.id || nid(kind === 'team' ? 'team' : 'dept');
  try {
    await run('INSERT INTO departments (id,name,code,color,kind,parent_id,processed_by,is_open_records,is_catch_all,sort_order,active) VALUES (?,?,?,?,?,?,?,?,?,?,1)', [id, b.name, b.code, b.color || '#2E75B6', kind, b.parent_id || null, b.processed_by || null, b.is_open_records?1:0, b.is_catch_all?1:0, b.sort_order || 99]);
  } catch (e) { return res.status(400).json({ error: String(e.message || e) }); }
  var row = await get('SELECT * FROM departments WHERE id = ?', [id]);
  res.json({ department: row });
});

router.patch('/:id', requireAuth, async function(req, res) {
  var b = req.body || {};
  var fields = ['name','code','color','kind','parent_id','processed_by','is_open_records','is_catch_all','sort_order','active','routing_specialization','auto_load_balancing'];
  var sets = [], vals = [];
  fields.forEach(function(f){
    if (b.hasOwnProperty(f)) {
      var v = b[f];
      if (f==='is_open_records'||f==='is_catch_all'||f==='active') v = v?1:0;
      sets.push(f + ' = ?'); vals.push(v);
    }
  });
  if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
  vals.push(req.params.id);
  await run('UPDATE departments SET ' + sets.join(', ') + ' WHERE id = ?', vals);
  var row = await get('SELECT * FROM departments WHERE id = ?', [req.params.id]);
  res.json({ department: row });
});

router.post('/:id/fulfills', requireAuth, async function(req, res) {
  var teamId = req.params.id;
  var ids = Array.isArray(req.body.departmentIds) ? req.body.departmentIds : [];
  await run('UPDATE departments SET processed_by = NULL WHERE processed_by = ?', [teamId]);
  for (var i = 0; i < ids.length; i++) { await run('UPDATE departments SET processed_by = ? WHERE id = ?', [teamId, ids[i]]); }
  res.json({ success: true });
});

module.exports = router;
