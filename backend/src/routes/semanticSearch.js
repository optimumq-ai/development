const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all } = require('../db');
const v = require('../services/voyageEmbed');

// POST /api/semantic-search/record-types  { query, topN? }
router.post('/record-types', requireAuth, async function (req, res) {
  var query = ((req.body && req.body.query) || '').trim();
  if (!query) return res.status(400).json({ error: 'query is required' });
  var topN = Math.min(parseInt((req.body && req.body.topN) || 10, 10) || 10, 25);
  var qv;
  try { var e = await v.embed(query, { inputType: 'query' }); qv = e[0]; }
  catch (err) { return res.status(502).json({ error: 'Embedding failed: ' + err.message }); }
  var rows = await all("SELECT e.owner_id, e.vec, rt.name, rt.code FROM embeddings e JOIN record_types rt ON rt.id = e.owner_id WHERE e.owner_type = 'record_type'", []);
  var scored = rows.map(function (r) {
    var vec; try { vec = JSON.parse(r.vec); } catch (x) { vec = []; }
    return { id: r.owner_id, name: r.name, code: r.code, score: v.cosine(qv, vec) };
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  res.json({ query: query, results: scored.slice(0, topN).map(function (r) {
    return { id: r.id, name: r.name, code: r.code, score: Math.round(r.score * 1000) / 1000 };
  }) });
});

module.exports = router;
