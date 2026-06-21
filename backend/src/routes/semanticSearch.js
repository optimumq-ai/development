const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all } = require('../db');
const v = require('../services/voyageEmbed');

// POST /api/semantic-search/record-types  { query, topN? }
// Uses native pgvector cosine distance (<=>) over an HNSW index.
router.post('/record-types', requireAuth, async function (req, res) {
  var query = ((req.body && req.body.query) || '').trim();
  if (!query) return res.status(400).json({ error: 'query is required' });
  var topN = Math.min(parseInt((req.body && req.body.topN) || 10, 10) || 10, 25);
  var qv;
  try { var e = await v.embed(query, { inputType: 'query' }); qv = e[0]; }
  catch (err) { return res.status(502).json({ error: 'Embedding failed: ' + err.message }); }
  if (!qv || !qv.length) return res.status(502).json({ error: 'Embedding returned empty' });
  var qlit = '[' + qv.join(',') + ']';
  var rows = await all(
    "SELECT e.owner_id AS id, rt.name, rt.code, 1 - (e.embedding <=> ?::vector) AS score " +
    "FROM embeddings e JOIN record_types rt ON rt.id = e.owner_id " +
    "WHERE e.owner_type = 'record_type' AND e.embedding IS NOT NULL " +
    "ORDER BY e.embedding <=> ?::vector LIMIT ?",
    [qlit, qlit, topN]
  );
  res.json({ query: query, results: rows.map(function (r) {
    return { id: r.id, name: r.name, code: r.code, score: Math.round(Number(r.score) * 1000) / 1000 };
  }) });
});

module.exports = router;
