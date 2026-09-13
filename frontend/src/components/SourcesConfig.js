import React, { useEffect, useState } from 'react';
import api from '../lib/api';

var btnPrimary = {background:'var(--oq-bg-1f4e79)',color:'var(--oq-fg-ffffff)',border:'none',borderRadius:'8px',padding:'9px 14px',fontSize:'13px',fontWeight:'600',cursor:'pointer'};
var btnGhost = {background:'var(--oq-bg-f3f4f6)',color:'var(--oq-fg-374151)',border:'none',borderRadius:'8px',padding:'8px 14px',fontSize:'13px',fontWeight:'600',cursor:'pointer'};
var btnGhostSm = {background:'var(--oq-bg-f3f4f6)',color:'var(--oq-fg-374151)',border:'none',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:'600',cursor:'pointer'};
var inp = {width:'100%',padding:'9px 11px',borderRadius:'8px',border:'1px solid var(--oq-ln-d1d5db)',fontSize:'14px',boxSizing:'border-box'};
var lbl = {display:'block',fontSize:'12px',fontWeight:'600',color:'var(--oq-fg-374151)',marginBottom:'5px'};
function badge(bg,fg){ return {background:bg,color:fg,fontSize:'11px',fontWeight:'700',padding:'2px 8px',borderRadius:'20px'}; }

export default function SourcesConfig() {
  const [sources, setSources] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ai, setAi] = useState(null);
  const [paperImport, setPaperImport] = useState(null);
  const [ingest, setIngest] = useState({});
  const [templates, setTemplates] = useState([]);
  const [staff, setStaff] = useState([]);
  const [me, setMe] = useState(null);
  const [recordTypes, setRecordTypes] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(function(){ load(); }, []);

  async function load() {
    setLoading(true);
    try {
      var sr = await api.get('/repositories'); setSources(sr.data.repositories);
      // #15: watched-folder cards show their last run without a click — load status up front.
      (sr.data.repositories || []).filter(function(s){ return s.connector_type === 'import'; }).forEach(function(s){ loadIngestStatus(s.id); });
      var cr = await api.get('/repositories/catalog'); setCatalog(cr.data.catalog);
      try { var tr = await api.get('/redaction-templates'); setTemplates((tr.data && tr.data.templates) || []); } catch(e){}
      try { var stf = await api.get('/staff'); setStaff((stf.data && stf.data.staff) || []); } catch(e){}
      try { var meR = await api.get('/auth/me'); setMe((meR.data && meR.data.user) || null); } catch(e){}
      try { var rtR = await api.get('/taxonomy/record-types'); setRecordTypes((rtR.data && rtR.data.record_types) || []); } catch(e){}
      try { var catR = await api.get('/taxonomy/categories'); setCategories((catR.data && catR.data.categories) || []); } catch(e){}
    } catch(e){ console.error(e); }
    setLoading(false);
  }

  var PURPOSE_LABELS = { live:'Live connection to a system or database', storage:'Document file storage', av:'Audio / video storage', import:'Import files (bring records in)', paper:'Paper records index', demo:'Demonstration' };
  var PURPOSE_ORDER = ['live','storage','av','import','paper','demo'];
  function typeMeta(key){ return catalog.find(function(c){ return c.key === key; }) || { label:key, fields:[], capabilities:[], description:'' }; }
  function setField(k,v){ setEditor(function(ed){ var d=Object.assign({},ed.data); d[k]=v; return Object.assign({},ed,{data:d}); }); }
  function setCfg(k,v){ setEditor(function(ed){ var c=Object.assign({},ed.data.config); c[k]=v; return Object.assign({},ed,{data:Object.assign({},ed.data,{config:c})}); }); }
  function scrollToEditor(){ setTimeout(function(){ var el=document.getElementById('source-editor'); if(el && el.scrollIntoView) el.scrollIntoView({behavior:'smooth', block:'start'}); }, 60); }
  function openCreate(){ var first = catalog[0] || {key:''}; setEditor({ mode:'create', data:{ name:'', connector_type:first.key, status:'active', config:{}, description:'' } }); scrollToEditor(); }
  function openEdit(s){ setEditor({ mode:'edit', data:{ id:s.id, name:s.name, connector_type:s.connector_type, status:s.status, config:Object.assign({}, s.config||{}), description:s.description||'' } }); scrollToEditor(); }
  function openCreatePaper(){ setEditor({ mode:'create', data:{ name:'', connector_type:'paper-index', status:'active', config:{}, description:'' } }); scrollToEditor(); }

  async function save() {
    var d = editor.data;
    if (!d.name) { alert('Name is required'); return; }
    setSaving(true);
    try {
      if (editor.mode === 'create') await api.post('/repositories', d);
      else await api.patch('/repositories/' + d.id, d);
      setEditor(null); await load();
    } catch(e){ alert('Save failed: ' + ((e.response && e.response.data && e.response.data.error) || e.message)); }
    setSaving(false);
  }

  async function del(s) {
    if (!window.confirm('Remove source "' + s.name + '"? This cannot be undone.')) return;
    try { await api.delete('/repositories/' + s.id); await load(); } catch(e){ alert('Delete failed'); }
  }

  function openAi(){ setAi({ description:'', documentation:'', loading:false, error:'' }); scrollToEditor(); }
  function setAiField(k,v){ setAi(function(a){ var n=Object.assign({},a); n[k]=v; return n; }); }
  async function proposeAi(){
    if (!ai.description.trim()) { setAiField('error','Describe the system first'); return; }
    setAiField('loading', true); setAiField('error','');
    try {
      var r = await api.post('/repositories/ai-configure', { description: ai.description, documentation: ai.documentation });
      var p = r.data.proposal;
      setAi(null);
      setEditor({ mode:'create', data:{ name:p.name||'', connector_type:p.connector_type, status:'active', config:p.config||{}, description:'', _ai:{ reasoning:p.reasoning||'', missing:p.missing||[] } } }); scrollToEditor();
    } catch(e){ setAiField('loading', false); setAiField('error', (e.response&&e.response.data&&e.response.data.error)||'AI configuration failed'); }
  }

  function openPaperImport(s){
    setPaperImport({ sourceId:s.id, name:s.name, csv:'', busy:false, error:'', count:null, imported:null }); scrollToEditor();
    api.get('/repositories/' + s.id + '/paper-index').then(function(r){ setPaperImport(function(p){ return (p && p.sourceId===s.id) ? Object.assign({},p,{count:r.data.count}) : p; }); }).catch(function(){});
  }
  function setPI(k,v){ setPaperImport(function(p){ if(!p) return p; var n=Object.assign({},p); n[k]=v; return n; }); }
  async function doPaperImport(){
    if(!paperImport.csv.trim()){ setPI('error','Paste a CSV first'); return; }
    setPI('busy', true); setPI('error','');
    try {
      var r = await api.post('/repositories/' + paperImport.sourceId + '/paper-index/import', { csv: paperImport.csv });
      setPI('busy', false); setPI('imported', r.data.imported); setPI('count', r.data.imported);
    } catch(e){ setPI('busy', false); setPI('error', (e.response&&e.response.data&&e.response.data.error)||'Import failed'); }
  }

  function renderPaperImport(){
    var p = paperImport;
    return (
      <div style={{ background:'var(--oq-bg-f9fafb)', border:'1px solid var(--oq-ln-e5e7eb)', borderRadius:'12px', padding:'16px', marginBottom:'16px' }}>
        <div style={{ fontWeight:'700', fontSize:'15px', marginBottom:'4px' }}>Import paper records index — {p.name}</div>
        <p style={{ color:'var(--oq-fg-6b7280)', fontSize:'13px', margin:'0 0 10px' }}>Paste a CSV of the physical files in this storage location. The first row is column headers. Recognized columns: title, description, location, box, folder, date, tags (only title is required). Re-importing replaces the current index.{p.count != null ? ' Currently ' + p.count + ' record(s) indexed.' : ''}</p>
        <textarea style={Object.assign({},inp,{minHeight:'120px',fontFamily:'monospace',fontSize:'12px'})} value={p.csv} onChange={function(e){ setPI('csv', e.target.value); }} placeholder={"title,description,location,box,date,tags\nBuilding Permit Files 1988-1995,Paper permit applications,Aisle 4 Shelf 2,47,1988-1995,permit building"} />
        {p.error ? <div style={{ color:'var(--oq-fg-dc2626)', fontSize:'13px', marginTop:'8px' }}>{p.error}</div> : null}
        {p.imported != null ? <div style={{ color:'var(--oq-fg-065f46)', fontSize:'13px', marginTop:'8px' }}>Imported {p.imported} record(s). They are now searchable in the portal.</div> : null}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px', marginTop:'10px' }}>
          <button onClick={function(){ setPaperImport(null); load(); }} style={btnGhost} disabled={p.busy}>Close</button>
          <button onClick={doPaperImport} style={btnPrimary} disabled={p.busy}>{p.busy?'Importing...':'Import index'}</button>
        </div>
      </div>
    );
  }

  function renderAiPanel(){
    return (
      <div style={{ background:'var(--oq-bg-f9fafb)', border:'1px solid var(--oq-ln-e5e7eb)', borderRadius:'12px', padding:'16px', marginBottom:'16px' }}>
        <div style={{ fontWeight:'700', fontSize:'15px', marginBottom:'4px' }}>Configure with AI</div>
        <p style={{ color:'var(--oq-fg-6b7280)', fontSize:'13px', margin:'0 0 12px' }}>Describe the system and where it lives. Optionally paste any documentation. The AI picks a connector type and proposes a configuration for you to review.</p>
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>System description / location</label>
          <textarea style={Object.assign({},inp,{minHeight:'70px',fontFamily:'inherit'})} value={ai.description} onChange={function(e){ setAiField('description', e.target.value); }} placeholder="e.g. A shared network folder of scanned permit PDFs, or our Tyler Munis ERP at https://..." />
        </div>
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>Documentation (optional)</label>
          <textarea style={Object.assign({},inp,{minHeight:'70px',fontFamily:'inherit'})} value={ai.documentation} onChange={function(e){ setAiField('documentation', e.target.value); }} placeholder="Paste any schema, data dictionary, or system docs that describe the records..." />
        </div>
        {ai.error ? <div style={{ color:'var(--oq-fg-dc2626)', fontSize:'13px', marginBottom:'10px' }}>{ai.error}</div> : null}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
          <button onClick={function(){ setAi(null); }} style={btnGhost} disabled={ai.loading}>Cancel</button>
          <button onClick={proposeAi} style={btnPrimary} disabled={ai.loading}>{ai.loading?'Analyzing...':'Propose configuration'}</button>
        </div>
      </div>
    );
  }

  function renderEditor() {
    var d = editor.data;
    var meta = typeMeta(d.connector_type);
    return (
      <div style={{ background:'var(--oq-bg-f9fafb)', border:'1px solid var(--oq-ln-e5e7eb)', borderRadius:'12px', padding:'16px', marginBottom:'16px' }}>
        <div style={{ fontWeight:'700', fontSize:'15px', marginBottom:'12px' }}>{editor.mode==='create'?'Add source':'Edit source'}</div>
        {d._ai ? (
          <div style={{ background:'var(--oq-bg-eff6ff)', border:'1px solid var(--oq-ln-bfdbfe)', borderRadius:'8px', padding:'10px 12px', marginBottom:'12px', fontSize:'13px', color:'var(--oq-fg-1e40af)' }}>
            <strong>AI suggestion:</strong> {d._ai.reasoning}{(d._ai.missing && d._ai.missing.length) ? (' Still needed: ' + d._ai.missing.join(', ') + '.') : ''}
          </div>
        ) : null}
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>Source name</label>
          <input style={inp} value={d.name} onChange={function(e){ setField('name', e.target.value); }} placeholder="Call it whatever your staff would - by system, content, or location" />
          <div style={{ fontSize:'12px', color:'var(--oq-fg-9ca3af)', marginTop:'4px' }}>A free-text label for your team (e.g. "Axon Evidence", "Payroll records", "Z Drive files"). It does not affect how records are processed - name it however makes sense.</div>
        </div>
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>Public description <span style={{color:'var(--oq-fg-b45309)'}}>(shown to requestors)</span></label>
          <div style={{ background:'var(--oq-bg-fffbeb)', border:'1px solid var(--oq-ln-fde68a)', borderRadius:'8px', padding:'10px 12px', marginBottom:'8px', fontSize:'12px', color:'var(--oq-fg-92400e)', lineHeight:'1.5' }}>
            This text is <strong>public and citizen-facing</strong>. It appears in the self-service portal when a requestor is choosing which connected system to keyword-search. Write it for a member of the public, not staff: plainly state what kinds of records this system holds (for example, "Building permits, inspection reports, and certificates of occupancy"). Accuracy matters - a vague or wrong description sends people to the wrong system, or leads them to file requests they did not need to.
          </div>
          <textarea style={Object.assign({},inp,{minHeight:'72px',fontFamily:'inherit'})} value={d.description||''} onChange={function(e){ setField('description', e.target.value); }} placeholder="e.g. Building permits, inspection reports, and certificates of occupancy issued by the City." />
        </div>
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>Access method <span style={{color:'var(--oq-fg-6b7280)',fontWeight:'400'}}>&mdash; how records here become available</span></label>
          <select style={inp} value={d.connector_type} onChange={function(e){ setField('connector_type', e.target.value); }}>
            {PURPOSE_ORDER.filter(function(pu){ return catalog.some(function(c){ return (c.purpose||'demo')===pu; }); }).map(function(pu){
              return (
                <optgroup key={pu} label={PURPOSE_LABELS[pu]}>
                  {catalog.filter(function(c){ return (c.purpose||'demo')===pu; }).map(function(c){ return <option key={c.key} value={c.key}>{c.label}</option>; })}
                </optgroup>
              );
            })}
          </select>
          <div style={{ fontSize:'12px', color:'var(--oq-fg-9ca3af)', marginTop:'4px' }}>{meta.description}</div>
          {d.connector_type==='import' ? (
            <div style={{ background:'var(--oq-bg-fffbeb)', border:'1px solid var(--oq-ln-fde68a)', borderRadius:'8px', padding:'9px 12px', marginTop:'8px', fontSize:'12px', color:'var(--oq-fg-92400e)', lineHeight:'1.5' }}>
              <strong>Import source.</strong> Place files in the drop folder, then use <strong>Check now</strong> on this source (in the list) to bring them in &mdash; each file is copied in, its text extracted, and indexed. Re-running picks up only new files; the source folder is never modified.
            </div>
          ) : null}
        </div>
        {(meta.fields||[]).map(function(f){
          return (
            <div key={f.key} style={{ marginBottom:'12px' }}>
              <label style={lbl}>{f.label}</label>
              <input style={inp} value={d.config[f.key]||''} onChange={function(e){ setCfg(f.key, e.target.value); }} placeholder={f.placeholder||''} />
            </div>
          );
        })}
        {d.connector_type==='import' ? (
          <div style={{ marginBottom:'12px' }}>
            <label style={lbl}>Delivery method</label>
            <select style={inp} value={d.config.mode||'push'} onChange={function(e){ setCfg('mode', e.target.value); }}>
              <option value="push">Push &mdash; the other system drops files into the folder below (recommended; no login for us to hold)</option>
              <option value="pull">Pull &mdash; we fetch from the other system (requires credentials; not yet available)</option>
            </select>
            {d.config.mode==='pull' ? (
              <div style={{ background:'var(--oq-bg-fffbeb)', border:'1px solid var(--oq-ln-fde68a)', borderRadius:'8px', padding:'9px 12px', marginTop:'8px', fontSize:'12px', color:'var(--oq-fg-92400e)', lineHeight:'1.5' }}>
                Pull is not yet available &mdash; it requires a per-system connection with stored credentials. For now use <strong>Push</strong>: schedule an export in the source system that writes files to the folder below.
              </div>
            ) : null}
          </div>
        ) : null}
        {d.connector_type==='import' ? (function(){ var sub = d.config.subdir!=null ? d.config.subdir : (d.config.path ? String(d.config.path).replace('/opt/optimumq/imports/','') : ''); return (
          <div style={{ marginBottom:'12px' }}>
            <label style={lbl}>Import folder</label>
            <div style={{ display:'flex', alignItems:'stretch' }}>
              <span style={{ fontSize:'13px', color:'var(--oq-fg-6b7280)', background:'var(--oq-bg-f3f4f6)', border:'1px solid var(--oq-ln-e5e7eb)', borderRight:'none', borderRadius:'8px 0 0 8px', padding:'9px 10px', whiteSpace:'nowrap', display:'flex', alignItems:'center' }}>/opt/optimumq/imports/</span>
              <input style={Object.assign({},inp,{borderRadius:'0 8px 8px 0'})} value={sub} onChange={function(e){ setCfg('subdir', e.target.value); }} placeholder="payroll-daily" />
            </div>
            <div style={{ fontSize:'12px', color:'var(--oq-fg-9ca3af)', marginTop:'4px' }}>The folder is created for you when you save. Point the other system's export job at: <strong>/opt/optimumq/imports/{sub || '\u2026'}</strong></div>
          </div>
        ); })() : null}
        {d.connector_type==='import' ? (function(){ var creatingNew = (typeof d.config.new_record_type_name === 'string'); return (
          <div style={{ marginBottom:'12px' }}>
            <label style={lbl}>Record type <span style={{color:'var(--oq-fg-6b7280)',fontWeight:'400'}}>&mdash; gives imported records a record type home (required)</span></label>
            <select style={inp} value={d.config.record_type_id ? d.config.record_type_id : (creatingNew ? '__new__' : '')} onChange={function(e){ var v=e.target.value; if(v==='__new__'){ setCfg('record_type_id',''); setCfg('new_record_type_name', d.config.new_record_type_name || ''); } else { setCfg('record_type_id', v); setCfg('new_record_type_name', null); } }}>
              <option value="">Select a record type&hellip;</option>
              {recordTypes.map(function(rt){ return <option key={rt.id} value={rt.id}>{rt.name}</option>; })}
              <option value="__new__">+ Create a new record type&hellip;</option>
            </select>
            {creatingNew ? (
              <div style={{ marginTop:'8px', paddingLeft:'10px', borderLeft:'2px solid var(--oq-ln-e5e7eb)' }}>
                <input style={inp} value={d.config.new_record_type_name||''} onChange={function(e){ setCfg('new_record_type_name', e.target.value); }} placeholder="Record type name (e.g. Payroll Records)" />
                <textarea style={Object.assign({},inp,{marginTop:'6px', minHeight:'48px'})} value={d.config.new_record_type_description||''} onChange={function(e){ setCfg('new_record_type_description', e.target.value); }} placeholder="Plain description of what these records are" />
                <select style={Object.assign({},inp,{marginTop:'6px'})} value={d.config.new_record_type_category||''} onChange={function(e){ setCfg('new_record_type_category', e.target.value); }}>
                  <option value="">Select a category&hellip;</option>
                  {categories.map(function(c){ return <option key={c.id} value={c.id}>{c.name}</option>; })}
                </select>
                <div style={{ fontSize:'12px', color:'var(--oq-fg-9ca3af)', marginTop:'4px' }}>You provide the name, description, and category. On the first import, AI suggests synonyms and keywords from the actual files.</div>
              </div>
            ) : null}
          </div>
        ); })() : null}
        {d.connector_type==='import' ? (
          <div style={{ marginBottom:'12px' }}>
            <label style={lbl}>Ingestion schedule</label>
            <select style={inp} value={d.config.schedule||'manual'} onChange={function(e){ setCfg('schedule', e.target.value); }}>
              <option value="manual">Manual only &mdash; run ingestion by hand (single / on-demand)</option>
              <option value="daily">Daily &mdash; automatically ingest new files once a day (repetitive)</option>
              <option value="watch">Watch &mdash; automatically ingest new files as they arrive</option>
            </select>
            {d.config.schedule==='daily' ? (
              <div style={{ marginTop:'8px' }}>
                <label style={lbl}>Run at hour (0&ndash;23, server time)</label>
                <input style={inp} type="number" min="0" max="23" value={d.config.hour!=null?d.config.hour:2} onChange={function(e){ setCfg('hour', e.target.value); }} placeholder="2" />
                <div style={{ fontSize:'12px', color:'var(--oq-fg-9ca3af)', marginTop:'4px' }}>Runs once daily at this hour (server local time), picking up only new files.</div>
              </div>
            ) : null}
          </div>
        ) : null}
        {d.connector_type==='import' ? (
          <div style={{ marginBottom:'12px' }}>
            <label style={lbl}>After ingesting a file</label>
            <select style={inp} value={d.config.post_ingest||'leave'} onChange={function(e){ setCfg('post_ingest', e.target.value); }}>
              <option value="leave">Leave it in the drop folder</option>
              <option value="archive">Move it to a processed/ subfolder (keeps the drop folder clean)</option>
              <option value="delete">Delete it (the system keeps the canonical copy)</option>
            </select>
            <div style={{ fontSize:'12px', color:'var(--oq-fg-9ca3af)', marginTop:'4px' }}>The system always keeps its own copy in secure storage. For scheduled or watch jobs, moving to processed/ keeps the drop folder tidy.</div>
          </div>
        ) : null}
        {d.connector_type==='import' ? (
          <div style={{ marginBottom:'12px', background:'var(--oq-bg-f0f9ff)', border:'1px solid var(--oq-ln-bae6fd)', borderRadius:'8px', padding:'12px' }}>
            <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer', fontWeight:'600', fontSize:'13px', color:'var(--oq-fg-0c4a6e)' }}>
              <input type="checkbox" checked={!!d.config.end_to_end} onChange={function(e){ var on=e.target.checked; setCfg('end_to_end', on); if(on && !d.config.review_assignee && me && me.id) setCfg('review_assignee', me.id); }} />
              Process end-to-end (import &rarr; auto-redact &rarr; review &rarr; publish)
            </label>
            {d.config.end_to_end ? (
              <div style={{ marginTop:'10px' }}>
                <label style={lbl}>Redaction template</label>
                <select style={inp} value={d.config.template_id||''} onChange={function(e){ setCfg('template_id', e.target.value); }}>
                  <option value="">None yet &mdash; build one from the first imported files</option>
                  {templates.map(function(t){ return <option key={t.id} value={t.id}>{t.name}</option>; })}
                </select>
                {!d.config.template_id ? (
                  <div style={{ background:'var(--oq-bg-fffbeb)', border:'1px solid var(--oq-ln-fde68a)', borderRadius:'8px', padding:'9px 12px', marginTop:'8px', fontSize:'12px', color:'var(--oq-fg-92400e)', lineHeight:'1.5' }}>
                    Auto-redaction needs a redaction template, and templates are built from a real sample file. So the first time files arrive, we&rsquo;ll create a setup task for the reviewer to build the template from those files. After that, every import runs end-to-end automatically.
                  </div>
                ) : null}
                <div style={{ marginTop:'10px' }}>
                  <label style={lbl}>Review assignee <span style={{color:'var(--oq-fg-6b7280)',fontWeight:'400'}}>&mdash; who reviews after auto-redaction</span></label>
                  <select style={inp} value={d.config.review_assignee||''} onChange={function(e){ setCfg('review_assignee', e.target.value); }}>
                    <option value="">(Review pool &mdash; anyone on the team can claim)</option>
                    {staff.map(function(u){ return <option key={u.id} value={u.id}>{u.display_name}{me&&u.id===me.id?' (you)':''}</option>; })}
                  </select>
                  <div style={{ fontSize:'12px', color:'var(--oq-fg-9ca3af)', marginTop:'4px' }}>Defaults to you. For a scheduled ongoing import, you can assign a different reviewer.</div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>Status</label>
          <select style={inp} value={d.status} onChange={function(e){ setField('status', e.target.value); }}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
          <button onClick={function(){ setEditor(null); }} style={btnGhost} disabled={saving}>Cancel</button>
          <button onClick={save} style={btnPrimary} disabled={saving}>{saving?'Saving...':'Save source'}</button>
        </div>
      </div>
    );
  }

  async function loadIngestStatus(id){
    try { var r = await api.get('/repositories/'+id+'/ingest/status'); setIngest(function(p){ var n=Object.assign({},p); n[id]=Object.assign({}, n[id]||{}, {status:r.data}); return n; }); } catch(e){}
  }
  async function runIngestNow(s){
    setIngest(function(p){ var n=Object.assign({},p); n[s.id]=Object.assign({}, n[s.id]||{}, {busy:true, msg:''}); return n; });
    try {
      var r = await api.post('/repositories/'+s.id+'/ingest/run');
      var d = r.data || {};
      var msg = d.error ? d.error : (d.ingested+' ingested'+(d.errors?(', '+d.errors+' error(s)'):'')+((d.newFound===0 && !d.error)?' (nothing new)':''));
      setIngest(function(p){ var n=Object.assign({},p); n[s.id]={busy:false, msg:msg, ok:!d.error}; return n; });
      loadIngestStatus(s.id);
    } catch(e){ setIngest(function(p){ var n=Object.assign({},p); n[s.id]={busy:false, msg:'Ingestion failed to run.', ok:false}; return n; }); }
  }
  // SOURCES REDESIGN (#15, approved by Kevin 2026-08-13 from the before/after mockups). Every card
  // answers "what does the system do with this place" in a sentence, says what it HOLDS, and shows
  // status as words. Same data, same buttons \u2014 only the presentation changed.
  function dotChip(label){
    return (
      <span style={Object.assign({}, badge('var(--oq-bg-e6f4ec)','var(--oq-fg-17803d)'), { display:'inline-flex', alignItems:'center', gap:'5px' })}>
        <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:'var(--oq-bg-17803d)', display:'inline-block' }} />{label}
      </span>
    );
  }
  function statusChip(s){
    if (s.status !== 'active') return <span style={badge('var(--oq-bg-f3f4f6)','var(--oq-fg-6b7280)')}>Inactive</span>;
    if (s.connector_type === 'import') {
      var sch = (s.config && s.config.schedule) || 'manual';
      return dotChip(sch === 'daily' ? 'Checked nightly' : (sch === 'watch' ? 'Watching for new files' : 'Checked by hand'));
    }
    if (s.connector_type === 'paper-index') {
      return s.paper_index_count > 0
        ? <span style={badge('var(--oq-bg-f0f2f5)','var(--oq-fg-5b6b7a)')}>{s.paper_index_count.toLocaleString()} entries indexed</span>
        : <span style={badge('var(--oq-bg-fbefd7)','var(--oq-fg-c77a0a)')}>No index yet</span>;
    }
    return dotChip('Connected');
  }
  function holdsLine(s){
    var names = s.linked_types || [];
    if (!names.length) return null;
    var shown = names.slice(0, 3).join(', ');
    var more = names.length - 3;
    return (
      <div style={{ fontSize:'12.5px', color:'var(--oq-fg-5b6b7a)', marginTop:'6px' }}>
        {s.connector_type === 'import' ? 'Feeds: ' : 'Holds: '}
        <span style={{ color:'var(--oq-fg-374151)', fontWeight:'600' }}>{shown}</span>
        {more > 0 ? ' + ' + more + ' more record type' + (more > 1 ? 's' : '') : ''}
      </div>
    );
  }
  function renderSourceRow(s){
    var meta = typeMeta(s.connector_type);
    var ig = ingest[s.id] || {};
    return (
      <div key={s.id} style={{ display:'flex', alignItems:'flex-start', gap:'16px', background:'var(--oq-bg-ffffff)', border:'1px solid var(--oq-ln-e5e7eb)', borderRadius:'12px', padding:'15px 18px' }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:'700', fontSize:'15px', color:'var(--oq-fg-111111)' }}>{s.name}</div>
          <div style={{ fontSize:'13px', color:'var(--oq-fg-4b5563)', marginTop:'3px', lineHeight:'1.4' }}>{s.description || meta.description || meta.label}</div>
          {holdsLine(s)}
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'7px', minWidth:'215px' }}>
          {statusChip(s)}
          {s.connector_type === 'import' ? (
            ig.msg ? <span style={{ fontSize:'11.5px', color: ig.ok ? 'var(--oq-fg-17803d)' : 'var(--oq-fg-dc2626)' }}>{ig.msg}</span>
              : (ig.status ? <span style={{ fontSize:'11.5px', color:'var(--oq-fg-8a97a5)' }}>
                  {ig.status.lastRun ? 'Last run ' + String(ig.status.lastRun).slice(0,16).replace('T',' ') + ' \u00b7 ' : ''}
                  {ig.status.ingested} file{ig.status.ingested === 1 ? '' : 's'} brought in{ig.status.errors ? ' \u00b7 ' + ig.status.errors + ' error' + (ig.status.errors > 1 ? 's' : '') : ' \u00b7 0 errors'}
                </span> : null)
          ) : null}
          <div style={{ display:'flex', gap:'6px' }}>
            {s.connector_type === 'import' ? <button onClick={function(){ runIngestNow(s); }} disabled={ig.busy} style={Object.assign({},btnGhostSm,{background:'var(--oq-bg-ebf3fb)',color:'var(--oq-fg-1f4e79)'})}>{ig.busy ? 'Checking\u2026' : 'Check now'}</button> : null}
            {s.connector_type === 'paper-index' ? <button onClick={function(){ openPaperImport(s); }} style={Object.assign({},btnGhostSm,{background:'var(--oq-bg-ebf3fb)',color:'var(--oq-fg-1f4e79)'})}>{s.paper_index_count > 0 ? 'Update index' : 'Import index'}</button> : null}
            <button onClick={function(){ openEdit(s); }} style={btnGhostSm}>Edit</button>
            <button onClick={function(){ del(s); }} style={Object.assign({},btnGhostSm,{color:'var(--oq-fg-dc2626)'})}>Delete</button>
          </div>
        </div>
      </div>
    );
  }

  function sectionHeader(title, subtitle, addLabel, addFn, canAdd){
    return (
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', margin:'4px 0 10px' }}>
        <div style={{ flex:1, minWidth:0, paddingRight:'12px' }}>
          <div style={{ fontSize:'15px', fontWeight:'700', color:'var(--oq-fg-111111)' }}>{title}</div>
          <div style={{ fontSize:'12px', color:'var(--oq-fg-9ca3af)', marginTop:'2px', lineHeight:'1.4' }}>{subtitle}</div>
        </div>
        {canAdd ? <button onClick={addFn} style={btnPrimary}>{addLabel}</button> : null}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
        <div style={{ color:'var(--oq-fg-6b7280)', fontSize:'14px' }}>Repositories and systems the platform can search and scan for record types.</div>
        {(!editor && !ai && !paperImport) ? <button onClick={openAi} style={btnGhost}>Configure with AI</button> : null}
      </div>
      <div id="source-editor">
        {editor ? renderEditor() : null}
        {ai ? renderAiPanel() : null}
        {paperImport ? renderPaperImport() : null}
      </div>
      {loading ? <div style={{ color:'var(--oq-fg-9ca3af)', fontSize:'14px' }}>Loading sources...</div> : (function(){
        var searched = sources.filter(function(s){ return ['import','paper-index','email'].indexOf(s.connector_type) < 0; });
        var watched  = sources.filter(function(s){ return s.connector_type === 'import'; });
        var counted  = sources.filter(function(s){ return s.connector_type === 'email'; });
        var paper    = sources.filter(function(s){ return s.connector_type === 'paper-index'; });
        var canAdd = (!editor && !ai && !paperImport);
        function group(title, subtitle, list, addLabel, addFn, empty){
          if (!list.length && !addFn) return null;
          return (
            <div style={{ marginBottom:'26px' }}>
              {sectionHeader(title + (list.length ? '' : ''), subtitle, addLabel, addFn, addFn ? canAdd : false)}
              <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                {list.length === 0 ? <div style={{ color:'var(--oq-fg-9ca3af)', fontSize:'14px', padding:'6px 0' }}>{empty}</div> : list.map(renderSourceRow)}
              </div>
            </div>
          );
        }
        return (
          <div>
            {group('Searched the moment someone asks',
              'Connected systems the portal and staff search instantly. If it’s in here, a citizen’s search can find it right away. Add one from the connector library, or let AI configure it for you.',
              searched, '+ Add connector', openCreate, 'No connected systems yet.')}
            {group('Watched folders — files brought in on a schedule',
              'The system checks these folders, copies new files in (originals are never touched), and routes them through redaction toward the public library.',
              watched, null, null, null)}
            {group('Counted only — never opened',
              'For privacy, the system only ever reports HOW MANY items match — never contents, subjects, or names. Staff review happens before anything is released.',
              counted, null, null, null)}
            {group('Paper & physical — findable, not fetchable',
              'Places where the city keeps physical records. The system can say WHERE a record is (building, room, box) so staff can go pull it — it can’t retrieve the paper itself.',
              paper, '+ Add paper location', openCreatePaper, 'No paper records locations yet — add one for each place the city stores paper records.')}
          </div>
        );
      })()}
    </div>
  );
}
