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
  function openCreate(){ var first = catalog[0] || {key:''}; setEditor({ mode:'create', data:{ name:'', connector_type:first.key, status:'active', config:{} } }); }
  function openEdit(s){ setEditor({ mode:'edit', data:{ id:s.id, name:s.name, connector_type:s.connector_type, status:s.status, config:Object.assign({}, s.config||{}) } }); }

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

  function renderEditor() {
    var d = editor.data;
    var meta = typeMeta(d.connector_type);
    return (
      <div style={{ background:'#F9FAFB', border:'1px solid #E5E7EB', borderRadius:'12px', padding:'16px', marginBottom:'16px' }}>
        <div style={{ fontWeight:'700', fontSize:'15px', marginBottom:'12px' }}>{editor.mode==='create'?'Add source':'Edit source'}</div>
        <div style={{ marginBottom:'12px' }}>
          <label style={lbl}>Name</label>
          <input style={inp} value={d.name} onChange={function(e){ setField('name', e.target.value); }} placeholder="e.g. HR Network Drive" />
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
        {!editor ? <button onClick={openCreate} style={btnPrimary}>+ Add source</button> : null}
      </div>
      {editor ? renderEditor() : null}
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
