import React, { useEffect, useState } from 'react';
import api from '../lib/api';

var btnPrimary = {background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',padding:'9px 14px',fontSize:'13px',fontWeight:'600',cursor:'pointer'};
var btnGhost = {background:'#F3F4F6',color:'#374151',border:'none',borderRadius:'8px',padding:'8px 14px',fontSize:'13px',fontWeight:'600',cursor:'pointer'};
var btnGhostSm = {background:'#F3F4F6',color:'#374151',border:'none',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:'600',cursor:'pointer'};
var inp = {width:'100%',padding:'9px 11px',borderRadius:'8px',border:'1px solid #D1D5DB',fontSize:'14px',boxSizing:'border-box'};
var lbl = {display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'};
function badge(bg,fg){ return {background:bg,color:fg,fontSize:'11px',fontWeight:'700',padding:'2px 8px',borderRadius:'20px'}; }

export default function SourcesConfig() {
  const [sources, setSources] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ai, setAi] = useState(null);

  useEffect(function(){ load(); }, []);

  async function load() {
    setLoading(true);
    try {
      var sr = await api.get('/repositories'); setSources(sr.data.repositories);
      var cr = await api.get('/repositories/catalog'); setCatalog(cr.data.catalog);
    } catch(e){ console.error(e); }
    setLoading(false);
  }

  function typeMeta(key){ return catalog.find(function(c){ return c.key === key; }) || { label:key, fields:[], capabilities:[], description:'' }; }
  function setField(k,v){ setEditor(function(ed){ var d=Object.assign({},ed.data); d[k]=v; return Object.assign({},ed,{data:d}); }); }
  function setCfg(k,v){ setEditor(function(ed){ var c=Object.assign({},ed.data.config); c[k]=v; return Object.assign({},ed,{data:Object.assign({},ed.data,{config:c})}); }); }
  function openCreate(){ var first = catalog[0] || {key:''}; setEditor({ mode:'create', data:{ name:'', connector_type:first.key, status:'active', config:{}, description:'' } }); }
  function openEdit(s){ setEditor({ mode:'edit', data:{ id:s.id, name:s.name, connector_type:s.connector_type, status:s.status, config:Object.assign({}, s.config||{}), description:s.description||'' } }); }

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

  function openAi(){ setAi({ description:'', documentation:'', loading:false, error:'' }); }
  function setAiField(k,v){ setAi(function(a){ var n=Object.assign({},a); n[k]=v; return n; }); }
  async function proposeAi(){
    if (!ai.description.trim()) { setAiField('error','Describe the system first'); return; }
    setAiField('loading', true); setAiField('error','');
    try {
      var r = await api.post('/repositories/ai-configure', { description: ai.description, documentation: ai.documentation });
      var p = r.data.proposal;
      setAi(null);
      setEditor({ mode:'create', data:{ name:p.name||'', connector_type:p.connector_type, status:'active', config:p.config||{}, description:'', _ai:{ reasoning:p.reasoning||'', missing:p.missing||[] } } });
    } catch(e){ setAiField('loading', false); setAiField('error', (e.response&&e.response.data&&e.response.data.error)||'AI configuration failed'); }
  }

  function renderAiPanel(){
    return (
      <div style={{ background:'#F9FAFB', border:'1px solid #E5E7EB', borderRadius:'12px', padding:'16px', marginBottom:'16px' }}>
        <div style={{ fontWeight:'700', fontSize:'15px', marginBottom:'4px' }}>Configure with AI</div>
        <p style={{ color:'#6B7280', fontSize:'13px', margin:'0 0 12px' }}>Describe the system and where it lives. Optionally paste any documentation. The AI picks a connector type and proposes a configuration for you to review.</p>
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>System description / location</label>
          <textarea style={Object.assign({},inp,{minHeight:'70px',fontFamily:'inherit'})} value={ai.description} onChange={function(e){ setAiField('description', e.target.value); }} placeholder="e.g. A shared network folder of scanned permit PDFs, or our Tyler Munis ERP at https://..." />
        </div>
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>Documentation (optional)</label>
          <textarea style={Object.assign({},inp,{minHeight:'70px',fontFamily:'inherit'})} value={ai.documentation} onChange={function(e){ setAiField('documentation', e.target.value); }} placeholder="Paste any schema, data dictionary, or system docs that describe the records..." />
        </div>
        {ai.error ? <div style={{ color:'#DC2626', fontSize:'13px', marginBottom:'10px' }}>{ai.error}</div> : null}
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
      <div style={{ background:'#F9FAFB', border:'1px solid #E5E7EB', borderRadius:'12px', padding:'16px', marginBottom:'16px' }}>
        <div style={{ fontWeight:'700', fontSize:'15px', marginBottom:'12px' }}>{editor.mode==='create'?'Add source':'Edit source'}</div>
        {d._ai ? (
          <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:'8px', padding:'10px 12px', marginBottom:'12px', fontSize:'13px', color:'#1E40AF' }}>
            <strong>AI suggestion:</strong> {d._ai.reasoning}{(d._ai.missing && d._ai.missing.length) ? (' Still needed: ' + d._ai.missing.join(', ') + '.') : ''}
          </div>
        ) : null}
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>Name</label>
          <input style={inp} value={d.name} onChange={function(e){ setField('name', e.target.value); }} placeholder="e.g. HR Network Drive" />
        </div>
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>Public description <span style={{color:'#B45309'}}>(shown to requestors)</span></label>
          <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:'8px', padding:'10px 12px', marginBottom:'8px', fontSize:'12px', color:'#92400E', lineHeight:'1.5' }}>
            This text is <strong>public and citizen-facing</strong>. It appears in the self-service portal when a requestor is choosing which connected system to keyword-search. Write it for a member of the public, not staff: plainly state what kinds of records this system holds (for example, "Building permits, inspection reports, and certificates of occupancy"). Accuracy matters - a vague or wrong description sends people to the wrong system, or leads them to file requests they did not need to.
          </div>
          <textarea style={Object.assign({},inp,{minHeight:'72px',fontFamily:'inherit'})} value={d.description||''} onChange={function(e){ setField('description', e.target.value); }} placeholder="e.g. Building permits, inspection reports, and certificates of occupancy issued by the City." />
        </div>
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>Connector type</label>
          <select style={inp} value={d.connector_type} onChange={function(e){ setField('connector_type', e.target.value); }}>
            {catalog.map(function(c){ return <option key={c.key} value={c.key}>{c.label}</option>; })}
          </select>
          <div style={{ fontSize:'12px', color:'#9CA3AF', marginTop:'4px' }}>{meta.description}</div>
        </div>
        {(meta.fields||[]).map(function(f){
          return (
            <div key={f.key} style={{ marginBottom:'12px' }}>
              <label style={lbl}>{f.label}</label>
              <input style={inp} value={d.config[f.key]||''} onChange={function(e){ setCfg(f.key, e.target.value); }} placeholder={f.placeholder||''} />
            </div>
          );
        })}
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

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
        <div style={{ color:'#6B7280', fontSize:'14px' }}>Repositories and systems the platform can search and scan for record types.</div>
        {!editor && !ai ? (
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={openAi} style={btnGhost}>Configure with AI</button>
            <button onClick={openCreate} style={btnPrimary}>+ Add source</button>
          </div>
        ) : null}
      </div>
      {editor ? renderEditor() : null}
      {ai ? renderAiPanel() : null}
      {loading ? <div style={{ color:'#9CA3AF', fontSize:'14px' }}>Loading sources...</div> : (
        <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
          {sources.length===0 ? <div style={{ color:'#9CA3AF', fontSize:'14px' }}>No sources configured yet.</div> : null}
          {sources.map(function(s){
            var meta = typeMeta(s.connector_type);
            return (
              <div key={s.id} style={{ display:'flex', alignItems:'center', gap:'14px', background:'white', border:'1px solid #E5E7EB', borderRadius:'10px', padding:'12px 16px' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                    <span style={{ fontWeight:'700', fontSize:'14px', color:'#111' }}>{s.name}</span>
                    {(meta.capabilities||[]).indexOf('scan')>=0 ? <span style={badge('#ECFDF5','#065F46')}>Scannable</span> : null}
                    {(meta.capabilities||[]).indexOf('search')>=0 ? <span style={badge('#EFF6FF','#1E40AF')}>Searchable</span> : null}
                    {s.status!=='active' ? <span style={badge('#F3F4F6','#6B7280')}>Inactive</span> : null}
                  </div>
                  <div style={{ fontSize:'12px', color:'#9CA3AF', marginTop:'2px' }}>{meta.label}</div>
                  {s.description ? <div style={{ fontSize:'12px', color:'#6B7280', marginTop:'4px', lineHeight:'1.4' }}>{s.description}</div> : null}
                </div>
                <button onClick={function(){ openEdit(s); }} style={btnGhostSm}>Edit</button>
                <button onClick={function(){ del(s); }} style={Object.assign({},btnGhostSm,{color:'#DC2626'})}>Delete</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
