// Classify + ingest every attachment on a request into the public-ready library.
// For each file: AI picks a record type from the live taxonomy + judges public-releasability;
// department derived from the type's owner; a library-OWNED copy is made; metadata is AI-extracted; embed.
const cp=require('child_process');
const fs=require('fs');
const Anthropic=require('@anthropic-ai/sdk');
const db=require('../src/db');
const rme=require('../src/services/recordMetaExtract');
const UP='/opt/optimumq/uploads/';
const LIBREQ='req-library-files';
const REQNO=process.argv[2]||'2026-0037';

async function classify(text, typesList){
  const client=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY});
  const prompt='You classify a government document for a public records system.\n\nRECORD TYPES (ID: Name):\n'+typesList+
    '\n\nRead the DOCUMENT TEXT and respond ONLY with JSON (no fences): {"recordTypeId": "<exact ID from the list>", "releasable": true|false, "reason": "<short>"}.\n'+
    'Set releasable=false ONLY if this kind of record is inherently confidential or inappropriate for a PUBLIC reading room '+
    '(e.g. personnel/medical/EMS records, ADA reasonable-accommodation requests, internal affairs, voter registration, or the document is itself a records REQUEST rather than a released record). '+
    'Routine permits, licenses, certificates, agendas, ordinances, contracts, inspections, plats are releasable=true. '+
    'recordTypeId MUST be exactly one ID from the list.\n\nDOCUMENT TEXT:\n'+text.slice(0,12000);
  const m=await client.messages.create({model:'claude-sonnet-4-5',max_tokens:300,messages:[{role:'user',content:prompt}]});
  const raw=(m.content[0]&&m.content[0].text?m.content[0].text:'').trim().replace(/```json|```/g,'').trim();
  const p=JSON.parse(raw); return p;
}

(async()=>{
  await db.initDb();
  const types=await db.all("SELECT id, name FROM record_types WHERE status='active' ORDER BY name");
  const typesList=types.map(t=>t.id+': '+t.name).join('\n');
  const validType={}; types.forEach(t=>validType[t.id]=true);
  if(!(await db.get("SELECT id FROM requests WHERE id=?",[LIBREQ]))){
    await db.run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, status) VALUES (?,?,?,?,?,'completed')",
      [LIBREQ,'LIBRARY','System','system@cityofautumnfalls.gov','Internal owner of published public-library document copies']);
  }
  const files=await db.all("SELECT rf.id, rf.filename, rf.original_name, rf.mimetype, rf.size FROM request_files rf JOIN requests r ON r.id=rf.request_id WHERE r.request_number=? ORDER BY rf.uploaded_at",[REQNO]);
  console.log('Processing '+files.length+' files from request '+REQNO);
  let ok=0, skipped=0, errs=0;
  for(const rf of files){
    try{
      const path=UP+rf.filename;
      if(!fs.existsSync(path)){ console.log('MISSING FILE:',rf.original_name); errs++; continue; }
      const text=cp.execSync("pdftotext '"+path+"' -",{encoding:'utf8'});
      const cls=await classify(text, typesList);
      const rtId=(cls&&validType[cls.recordTypeId])?cls.recordTypeId:null;
      if(!cls||cls.releasable===false||!rtId){
        console.log('SKIP ['+(rtId||'no-type')+']',rf.original_name,'->',(cls&&cls.reason)||'unclassified');
        skipped++; continue;
      }
      const own=await db.get("SELECT department_id FROM record_type_departments WHERE record_type_id=? AND role='owner' LIMIT 1",[rtId]);
      const dept=own?own.department_id:'dept-openrecords';
      await db.run("DELETE FROM document_pages WHERE file_id=?",[rf.id]);
      await db.run("INSERT INTO document_pages (id, file_id, page_no, text) VALUES (?,?,?,?)",['dp-'+rf.id.slice(0,10), rf.id, 1, text.slice(0,16000)]);
      const copyId='libfile-'+rf.id, copyDisk='lib-'+rf.id+'.pdf';
      fs.copyFileSync(path, UP+copyDisk);
      await db.run("DELETE FROM request_files WHERE id=?",[copyId]);
      await db.run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status) VALUES (?,?,?,?,?,?, 'released')",
        [copyId, LIBREQ, copyDisk, rf.original_name, rf.mimetype||'application/pdf', rf.size||0]);
      const frId='lib-'+rf.id;
      const crude=rf.original_name.replace(/\.[a-z0-9]+$/i,'').replace(/[_-]/g,' ');
      await db.run("DELETE FROM embeddings WHERE owner_id=?",[frId]);
      await db.run("DELETE FROM fulfilled_records WHERE id=?",[frId]);
      await db.run("INSERT INTO fulfilled_records (id, source_file_id, output_file_id, title, summary, record_type_id, department_id, status, page_count, released_by, released_at) VALUES (?,?,?,?,?,?,?,'released',1,'Library Seed',datetime('now'))",
        [frId, rf.id, copyId, crude, 'Released record '+rf.original_name, rtId, dept]);
      await rme.enrichFulfilledMeta(frId);
      const a=await db.get("SELECT title FROM fulfilled_records WHERE id=?",[frId]);
      console.log('OK ['+rtId+']',a.title);
      ok++;
    }catch(e){ console.log('ERR',rf.original_name,'->',e.message); errs++; }
  }
  const c=await db.get("SELECT count(*) AS n FROM fulfilled_records WHERE status='released'");
  console.log('=== DONE. ingested='+ok+' skipped='+skipped+' errors='+errs+' | total released='+c.n+' ===');
  process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(1);});
