'use strict';
// Voyage AI embeddings. Reads VOYAGE_API_KEY from env. App-side similarity for now
// (pgvector is the documented scale-up). Model voyage-3.5-lite, 1024 dims.
var MODEL = 'voyage-3.5-lite';
var DIM = 1024;

async function embed(texts, opts) {
  opts = opts || {};
  var input = Array.isArray(texts) ? texts : [texts];
  input = input.map(function (t) { return (t == null ? '' : String(t)).slice(0, 16000); });
  if (input.length === 0) return [];
  var key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY not set');
  var body = { input: input, model: opts.model || MODEL };
  if (opts.inputType) body.input_type = opts.inputType; // 'query' | 'document'
  var res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify(body)
  });
  var j = await res.json();
  if (!res.ok || !j.data) throw new Error('Voyage error: ' + JSON.stringify(j).slice(0, 240));
  j.data.sort(function (a, b) { return a.index - b.index; });
  return j.data.map(function (d) { return d.embedding; });
}

// cosine similarity between two equal-length numeric arrays
function cosine(a, b) {
  var dot = 0, na = 0, nb = 0;
  for (var i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

module.exports = { embed: embed, cosine: cosine, MODEL: MODEL, DIM: DIM };
