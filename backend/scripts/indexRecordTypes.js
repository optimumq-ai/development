'use strict';
require('dotenv').config();
var db = require('../src/db');
var v = require('../src/services/voyageEmbed');
var uuid = require('uuid');

function arr(s){ try{ var a=JSON.parse(s); return Array.isArray(a)?a.join(', '):(s||''); }catch(e){ return s||''; } }
function txt(rt){
  return [rt.name, rt.description, rt.intent, rt.expected_content, rt.typical_request_reason, arr(rt.synonyms), arr(rt.keywords)]
    .filter(Boolean).join('. ');
}

(async function(){
  await db.initDb();
  var rts = await db.all("SELECT id, name, description, intent, expected_content, typical_request_reason, synonyms, keywords FROM record_types WHERE status IS NULL OR status <> 'archived'", []);
  console.log('record types to index:', rts.length);
  await db.run("DELETE FROM embeddings WHERE owner_type = 'record_type'", []);
  var BATCH = 40, done = 0;
  for (var i=0;i<rts.length;i+=BATCH){
    var slice = rts.slice(i, i+BATCH);
    var texts = slice.map(txt);
    var vecs = await v.embed(texts, { inputType:'document' });
    for (var k=0;k<slice.length;k++){
      await db.run("INSERT INTO embeddings (id, owner_type, owner_id, model, dim, vec, content, created_at) VALUES (?,?,?,?,?,?,?,datetime('now'))",
        [uuid.v4(), 'record_type', slice[k].id, v.MODEL, v.DIM, JSON.stringify(vecs[k]), texts[k].slice(0,400)]);
    }
    done += slice.length; console.log('indexed', done, '/', rts.length);
  }
  console.log('DONE');
  process.exit(0);
})().catch(function(e){ console.error('FAIL', e.message); process.exit(1); });
