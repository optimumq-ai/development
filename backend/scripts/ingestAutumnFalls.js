const cp=require('child_process');
const fs=require('fs');
const db=require('../src/db');
const rme=require('../src/services/recordMetaExtract');
const UP='/opt/optimumq/uploads/';
const LIBREQ='req-library-files';
const FILES=[
  {disk:'6e41c94d-9054-49e4-812b-80f8aad264d0.pdf', rt:'rt-building-permits',  dept:'dept-building'},
  {disk:'0639ae08-c262-475d-bfbe-f7894dc65be1.pdf', rt:'rt-building-permits',  dept:'dept-building'},
  {disk:'b535fefd-23fd-4460-baef-04b56e645269.pdf', rt:'rt-building-permits',  dept:'dept-building'},
  {disk:'e240157e-48e5-4710-baaa-0e41d51134e2.pdf', rt:'rt-building-permits',  dept:'dept-building'},
  {disk:'90140109-5c83-4dcc-8163-15eca1e85f2d.pdf', rt:'rt-business-licenses', dept:'dept-finance'}
];
(async()=>{
  await db.initDb();
  // Internal system request that OWNS the library's published file copies (idempotent).
  const exists=await db.get("SELECT id FROM requests WHERE id=?",[LIBREQ]);
  if(!exists){
    await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, status) VALUES (?,?,?,?,?, 'completed')",
      [LIBREQ,'LIBRARY','System','system@cityofautumnfalls.gov','Internal owner of published public-library document copies (not a real request)']);
  }
  await db.run("DELETE FROM embeddings WHERE owner_type='fulfilled_record' AND owner_id LIKE 'demo-af-%'");
  await db.run("DELETE FROM fulfilled_records WHERE id LIKE 'demo-af-%'");
  for(const F of FILES){
    const rf=await db.get("SELECT id, original_name, mimetype, size FROM request_files WHERE filename=?",[F.disk]);
    if(!rf){ console.log('SKIP (source not found):',F.disk); continue; }
    const text=cp.execSync("pdftotext '"+UP+F.disk+"' -",{encoding:'utf8'}).slice(0,16000);
    await db.run("DELETE FROM document_pages WHERE file_id=?",[rf.id]);
    await db.run("INSERT INTO document_pages (id, file_id, page_no, text) VALUES (?,?,?,?)",['dp-af-'+rf.id.slice(0,8), rf.id, 1, text]);
    // library-OWNED copy of the file (so the record survives deletion of the upload)
    const copyId='libfile-'+rf.id;
    const copyDisk='lib-'+rf.id+'.pdf';
    fs.copyFileSync(UP+F.disk, UP+copyDisk);
    await db.run("DELETE FROM request_files WHERE id=?",[copyId]);
    await db.run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status) VALUES (?,?,?,?,?,?, 'released')",
      [copyId, LIBREQ, copyDisk, rf.original_name, rf.mimetype||'application/pdf', rf.size||0]);
    const frId='lib-'+rf.id;
    const crude=rf.original_name.replace(/\.[a-z0-9]+$/i,'').replace(/_/g,' ');
    await db.run("DELETE FROM embeddings WHERE owner_id=?",[frId]);
    await db.run("DELETE FROM fulfilled_records WHERE id=?",[frId]);
    await db.run("INSERT INTO fulfilled_records (id, source_file_id, output_file_id, title, summary, record_type_id, department_id, status, page_count, released_by, released_at) VALUES (?,?,?,?,?,?,?,'released',1,'Library Seed',datetime('now'))",
      [frId, rf.id, copyId, crude, 'Uploaded record '+rf.original_name, F.rt, F.dept]);
    await rme.enrichFulfilledMeta(frId);
    const a=await db.get("SELECT title FROM fulfilled_records WHERE id=?",[frId]);
    console.log('INGESTED ->', a.title);
  }
  const c=await db.get("SELECT count(*) AS n FROM fulfilled_records WHERE status='released'");
  console.log('DONE. released records:', c.n);
  process.exit(0);
})().catch(e=>{console.log('ERR',e.message,(e.stack||'').split('\n')[1]);process.exit(1);});
