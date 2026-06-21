'use strict';
require('dotenv').config();
var db = require('../src/db');
var v = require('../src/services/voyageEmbed');
var uuid = require('uuid');

(async function(){
  await db.initDb();
  var pages = await db.all("SELECT id, page_no, request_id, file_id, text FROM document_pages WHERE text IS NOT NULL AND length(trim(text)) > 0", []);
  console.log('pages to index:', pages.length);
  await db.run("DELETE FROM embeddings WHERE owner_type = 'document_page'", []);
  var BATCH = 16, done = 0;
  for (var i=0;i<pages.length;i+=BATCH){
    var slice = pages.slice(i, i+BATCH);
    var texts = slice.map(function(p){ return String(p.text||'').slice(0, 16000); });
    var vecs = await v.embed(texts, { inputType:'document' });
    for (var k=0;k<slice.length;k++){
      var vj = JSON.stringify(vecs[k]);
      await db.run("INSERT INTO embeddings (id, owner_type, owner_id, model, dim, vec, embedding, content, created_at) VALUES (?,?,?,?,?,?,?::vector,?,datetime('now'))",
        [uuid.v4(), 'document_page', slice[k].id, v.MODEL, v.DIM, vj, vj, String(slice[k].text||'').slice(0,400)]);
    }
    done += slice.length; console.log('indexed', done, '/', pages.length);
  }
  console.log('DONE');
  process.exit(0);
})().catch(function(e){ console.error('FAIL', e.message); process.exit(1); });
