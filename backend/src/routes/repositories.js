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
    await run('INSERT INTO record_repositories (id, name, connector_type, status, config, sort_order, description) VALUES (?,?,?,?,?,?,?)', [id, b.name, b.connector_type, b.status || 'active', config, b.sort_order || 50, b.description || '']);
  } catch(e){ return res.status(400).json({ error: String(e.message || e) }); }
  var row = await get('SELECT * FROM record_repositories WHERE id = ?', [id]);
  res.json({ repository: row });
});

router.patch('/:id', requireAuth, async function(req, res){
  var b = req.body || {};
  var sets = [], vals = [];
  ['name','connector_type','status','sort_order','description'].forEach(function(f){ if (b.hasOwnProperty(f)) { sets.push(f + ' = ?'); vals.push(b[f]); } });
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

router.post('/ai-configure', requireAuth, async function(req, res) {
  var b = req.body || {};
  var desc = (b.description || '').toString().trim();
  if (!desc) return res.status(400).json({ error: 'description is required' });
  var docs = (b.documentation || '').toString().substring(0, 12000);
  var keys = catalog.map(function(c){ return c.key; });
  var catalogText = catalog.map(function(c){ return c.key + ': ' + c.label + ' - ' + c.description + ' | fields: ' + (c.fields||[]).map(function(f){ return f.key; }).join(', ') + ' | capabilities: ' + (c.capabilities||[]).join(','); }).join('\n');
  var prompt = 'You help configure a data-source connector for a public-records system. Based on the description and any documentation of the system, choose the best connector type from the catalog and propose a configuration. Return ONLY a JSON object, no other text.\n\nConnector catalog:\n' + catalogText + '\n\nReturn JSON: {"connector_type":"<key>","name":"<suggested name>","config":{},"reasoning":"<one or two sentences>","missing":[]}\n\nRules:\n- connector_type MUST be one of: ' + keys.join(', ') + '.\n- Fill config fields you can infer; leave unknown ones out and list their keys in missing.\n- NEVER invent credentials or secrets; leave api_key or password-like fields empty and list them in missing.\n\nSystem description:\n' + desc + (docs ? ('\n\nDocumentation:\n' + docs) : '');
  try {
    var Anthropic = require('@anthropic-ai/sdk');
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var message = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] });
    var raw = message.content[0].text.trim().replace(/```json|```/g, '').trim();
    var p = JSON.parse(raw);
    if (keys.indexOf(p.connector_type) < 0) p.connector_type = keys[0];
    if (!p.config || typeof p.config !== 'object') p.config = {};
    if (!Array.isArray(p.missing)) p.missing = [];
    res.json({ proposal: p });
  } catch (e) {
    res.status(500).json({ error: 'AI configuration failed', details: e.message });
  }
});

module.exports = router;
