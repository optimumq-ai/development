import React, { useState, useRef, useEffect } from 'react';
import api from '../../lib/api';
import { useNavigate } from 'react-router-dom';

const RECORD_TYPES = ['Document / PDF','Email','Photo / Image','Audio Recording','Video Recording','Spreadsheet','Paper Record (Scanned)','Physical Record (Non-Digital)','External Reference'];

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return Math.round(bytes/1024) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

function fileIcon(mimetype, isNonDigital) {
  if (isNonDigital) return '📝';
  if (!mimetype) return '📄';
  if (mimetype.includes('pdf')) return '📕';
  if (mimetype.includes('image')) return '🖼️';
  if (mimetype.includes('video')) return '🎥';
  if (mimetype.includes('audio')) return '🎵';
  if (mimetype.includes('spreadsheet') || mimetype.includes('excel')) return '📊';
  if (mimetype.includes('word')) return '📝';
  return '📄';
}

export default function RecordsPanel({ requestId, stage, onChange }) {
  const nav = useNavigate();
  const [records, setRecords] = useState([]);
  const [matches, setMatches] = useState({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title:'', recordType:'Document / PDF', description:'', isNonDigital:false });
  const [dragOver, setDragOver] = useState(false);
  // Server refusals (e.g. the request-work role gate on file mutations) must be SEEN, not console-logged.
  const [err, setErr] = useState('');
  function failed(e, fallback) { setErr((e && e.response && e.response.data && e.response.data.error) || fallback); }
  const fileRef = useRef();

  useEffect(function() { if (requestId) loadFiles(); }, [requestId]);

  async function loadFiles() {
    setLoading(true);
    try {
      var r = await api.get('/files/' + requestId);
      setRecords(r.data.files.map(function(f) {
        return { id: f.id, title: f.original_name, recordType: f.mimetype||'Document / PDF', description:'', isNonDigital: false, status: f.responsive ? 'responsive' : 'attached', size: f.size, mimetype: f.mimetype, uploadedAt: f.uploaded_at };
      }));
      var pdfIds = r.data.files.filter(function(f){ return f.mimetype && f.mimetype.indexOf('pdf') >= 0; }).map(function(f){ return f.id; });
      if (pdfIds.length) { api.post('/redaction-templates/match-batch', { file_ids: pdfIds }).then(function(mr){ setMatches(mr.data.matches || {}); }).catch(function(){}); }
      if (onChange) onChange();
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  function setF(k,v){ setForm(function(f){ return Object.assign({},f,{[k]:v}); }); }

  async function uploadFile(file) {
    setUploading(true);
    try {
      var fd = new FormData();
      fd.append('file', file);
      setErr('');
      var r = await api.post('/files/upload/' + requestId, fd, { headers: {'Content-Type':'multipart/form-data'} });
      await loadFiles();
    } catch(e) { failed(e, 'Upload failed'); }
    setUploading(false);
  }

  async function handleFileSelect(e) {
    var files = Array.from(e.target.files);
    for (var i = 0; i < files.length; i++) { await uploadFile(files[i]); }
    e.target.value = '';
  }

  async function handleDrop(e) {
    e.preventDefault(); setDragOver(false);
    var files = Array.from(e.dataTransfer.files);
    for (var i = 0; i < files.length; i++) { await uploadFile(files[i]); }
  }

  async function handleAddNonDigital(e) {
    e.preventDefault();
    if (!form.title) return;
    setUploading(true);
    try {
      var blob = new Blob([JSON.stringify({title:form.title,type:form.recordType,description:form.description,nonDigital:true})], {type:'application/json'});
      var file = new File([blob], form.title + '.json', {type:'application/json'});
      var fd = new FormData();
      fd.append('file', file);
      setErr('');
      await api.post('/files/upload/' + requestId, fd, { headers: {'Content-Type':'multipart/form-data'} });
      await loadFiles();
      setForm({ title:'', recordType:'Document / PDF', description:'', isNonDigital:false });
      setShowAdd(false);
    } catch(e) { failed(e, 'Upload failed'); }
    setUploading(false);
  }

  async function updateStatus(fileId, responsive) {
    try {
      await api.patch('/files/' + fileId + '/status', { responsive: responsive });
      setRecords(function(prev){ return prev.map(function(r){ return r.id===fileId ? Object.assign({},r,{status:responsive?'responsive':'attached'}) : r; }); });
      if (onChange) onChange();
    } catch(e) {
      // Refused: say so and leave the row as it was (it previously applied the change on failure too).
      failed(e, 'Could not update the record');
    }
  }

  async function deleteFile(fileId) {
    if (!window.confirm('Remove this record?')) return;
    try {
      setErr('');
      await api.delete('/files/' + fileId);
      await loadFiles();
    } catch(e) { failed(e, 'Could not remove the record'); }
  }

  var responsiveCount = records.filter(function(r){ return r.status==='responsive'; }).length;
  var canAdvance = responsiveCount > 0;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <h3 style={{fontSize:'15px',fontWeight:'700',margin:'0 0 2px'}}>Records</h3>
          <p style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)',margin:0}}>
            {loading ? 'Loading...' : records.length===0 ? 'No records attached yet' : records.length+' record'+(records.length!==1?'s':'')+' · '+responsiveCount+' to include'}
            {stage==='record_search'&&!canAdvance&&records.length>0?' — include at least one record in the response to advance':''}
          </p>
          {err ? <p style={{fontSize:'12px',color:'var(--oq-fg-dc2626)',margin:'4px 0 0'}}>{err}</p> : null}
        </div>
        <button onClick={function(){setShowAdd(!showAdd);}} style={{padding:'8px 14px',background:'var(--oq-bg-1f4e79)',color:'var(--oq-fg-ffffff)',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
          + Attach Record
        </button>
      </div>

      {stage==='record_search'&&(
        <div style={{display:'flex',gap:'10px',padding:'12px',background:canAdvance?'var(--oq-bg-f0fdf4)':'var(--oq-bg-fffbeb)',borderRadius:'8px',border:'1px solid '+(canAdvance?'var(--oq-ln-86efac)':'var(--oq-ln-fde68a)')}}>
          <div style={{fontSize:'20px'}}>{canAdvance?'✅':'⚠️'}</div>
          <div style={{fontSize:'13px',color:canAdvance?'var(--oq-fg-166534)':'var(--oq-fg-92400e)'}}>
            {canAdvance?responsiveCount+' record'+(responsiveCount!==1?'s':'')+' to include — ready to advance':'Attach records and include at least one in the response before advancing'}
          </div>
        </div>
      )}

      {showAdd&&(
        <div style={{background:'var(--oq-bg-f9fafb)',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'10px',padding:'16px'}}>
          <h4 style={{fontSize:'14px',fontWeight:'700',margin:'0 0 12px'}}>Attach a Record</h4>
          <div style={{display:'flex',gap:'12px',marginBottom:'12px'}}>
            {[['📎 Upload File',false],['📝 Log Non-Digital',true]].map(function(item){
              var active=form.isNonDigital===item[1];
              return <button key={String(item[1])} type="button" onClick={function(){setF('isNonDigital',item[1]);}}
                style={{flex:1,padding:'10px',borderRadius:'8px',border:'2px solid '+(active?'var(--oq-ln-1f4e79)':'var(--oq-ln-e5e7eb)'),background:active?'var(--oq-bg-ebf3fb)':'var(--oq-bg-ffffff)',color:active?'var(--oq-fg-1f4e79)':'var(--oq-fg-6b7280)',fontSize:'13px',fontWeight:active?'700':'500',cursor:'pointer'}}>
                {item[0]}
              </button>;
            })}
          </div>
          {!form.isNonDigital ? (
            <div>
              <div onDragOver={function(e){e.preventDefault();setDragOver(true);}} onDragLeave={function(){setDragOver(false);}} onDrop={handleDrop}
                onClick={function(){fileRef.current.click();}}
                style={{border:'2px dashed '+(dragOver?'var(--oq-ln-1f4e79)':'var(--oq-ln-d1d5db)'),borderRadius:'8px',padding:'24px',textAlign:'center',cursor:'pointer',background:dragOver?'var(--oq-bg-ebf3fb)':'var(--oq-bg-ffffff)',transition:'all .15s'}}>
                {uploading ? (
                  <div style={{color:'var(--oq-fg-1f4e79)',fontSize:'14px',fontWeight:'600'}}>⏳ Uploading...</div>
                ) : (
                  <div>
                    <div style={{fontSize:'28px',marginBottom:'8px'}}>📁</div>
                    <div style={{fontSize:'14px',fontWeight:'600',color:'var(--oq-fg-374151)',marginBottom:'4px'}}>Drop files here or click to browse</div>
                    <div style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)'}}>PDF, DOC, XLS, images, audio, video — up to 50MB</div>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" multiple onChange={handleFileSelect} style={{display:'none'}} accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.mp3,.mp4,.mov,.txt,.csv"/>
              <button type="button" onClick={function(){setShowAdd(false);}} style={{marginTop:'10px',padding:'8px 16px',background:'var(--oq-bg-ffffff)',color:'var(--oq-fg-6b7280)',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'8px',fontSize:'13px',cursor:'pointer'}}>Cancel</button>
            </div>
          ) : (
            <form onSubmit={handleAddNonDigital} style={{display:'flex',flexDirection:'column',gap:'10px'}}>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'var(--oq-fg-374151)',marginBottom:'4px'}}>Record Title *</label>
                <input value={form.title} onChange={function(e){setF('title',e.target.value);}} style={{width:'100%',padding:'8px 12px',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box'}} placeholder="e.g., Building inspection file box #3" required/>
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'var(--oq-fg-374151)',marginBottom:'4px'}}>Record Type</label>
                <select value={form.recordType} onChange={function(e){setF('recordType',e.target.value);}} style={{width:'100%',padding:'8px 12px',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'8px',fontSize:'13px',outline:'none'}}>
                  {RECORD_TYPES.map(function(t){return <option key={t} value={t}>{t}</option>;})}
                </select>
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'var(--oq-fg-374151)',marginBottom:'4px'}}>Description</label>
                <textarea value={form.description} onChange={function(e){setF('description',e.target.value);}} style={{width:'100%',padding:'8px 12px',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'8px',fontSize:'13px',outline:'none',minHeight:'60px',resize:'vertical',fontFamily:'inherit',boxSizing:'border-box'}} placeholder="Location, custodian, contents..."/>
              </div>
              <div style={{background:'var(--oq-bg-ebf3fb)',borderRadius:'8px',padding:'10px',fontSize:'13px',color:'var(--oq-fg-1f4e79)'}}>
                📷 <strong>Optional:</strong> Attach a photo of this record if possible
              </div>
              <div style={{display:'flex',gap:'8px'}}>
                <button type="button" onClick={function(){setShowAdd(false);}} style={{padding:'8px 16px',background:'var(--oq-bg-ffffff)',color:'var(--oq-fg-6b7280)',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'8px',fontSize:'13px',cursor:'pointer'}}>Cancel</button>
                <button type="submit" disabled={uploading} style={{padding:'8px 16px',background:'var(--oq-bg-1f4e79)',color:'var(--oq-fg-ffffff)',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>{uploading?'Saving...':'Log Record'}</button>
              </div>
            </form>
          )}
        </div>
      )}

      {loading ? (
        <div style={{padding:'32px',textAlign:'center',color:'var(--oq-fg-9ca3af)',fontSize:'14px'}}>Loading records...</div>
      ) : records.length > 0 ? (
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {records.map(function(r){
            var isR=r.status==='responsive';
            var isNR=r.status==='non_responsive';
            return(
              <div key={r.id} style={{background:'var(--oq-bg-ffffff)',border:'1px solid '+(isR?'var(--oq-ln-86efac)':isNR?'var(--oq-ln-fca5a5)':'var(--oq-ln-e5e7eb)'),borderRadius:'10px',padding:'14px',display:'flex',alignItems:'flex-start',gap:'12px'}}>
                <div style={{fontSize:'28px',flexShrink:0}}>{fileIcon(r.mimetype, r.isNonDigital)}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:'600',fontSize:'14px',color:'var(--oq-fg-111111)',marginBottom:'2px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.title}</div>
                  {matches[r.id] && matches[r.id].matched ? <div style={{marginBottom:'4px'}}><span style={{fontSize:'11px',fontWeight:'700',color:'var(--oq-fg-1e40af)',background:'var(--oq-bg-eff6ff)',border:'1px solid var(--oq-ln-bfdbfe)',borderRadius:'999px',padding:'2px 9px'}}>Template match: {matches[r.id].template.name} ({matches[r.id].template.score}%)</span></div> : null}
                  <div style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)'}}>
                    {r.size ? formatSize(r.size) : 'Non-digital record'}
                    {r.uploadedAt ? ' · ' + new Date(r.uploadedAt).toLocaleDateString() : ''}
                  </div>
                </div>
                <div style={{display:'flex',gap:'6px',flexShrink:0,alignItems:'center'}}>
                  <button onClick={function(){updateStatus(r.id, true);}} style={{padding:'5px 10px',borderRadius:'6px',border:'1px solid '+(isR?'var(--oq-ln-16a34a)':'var(--oq-ln-d1d5db)'),background:isR?'var(--oq-bg-f0fdf4)':'var(--oq-bg-ffffff)',color:isR?'var(--oq-fg-16a34a)':'var(--oq-fg-6b7280)',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                    {isR?'✓ Included in Response':'Include in Response'}
                  </button>
                  <button onClick={function(){updateStatus(r.id, false);}} style={{padding:'5px 10px',borderRadius:'6px',border:'1px solid '+(isNR?'var(--oq-ln-dc2626)':'var(--oq-ln-d1d5db)'),background:isNR?'var(--oq-bg-fef2f2)':'var(--oq-bg-ffffff)',color:isNR?'var(--oq-fg-dc2626)':'var(--oq-fg-6b7280)',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                    {isNR?'✗ Excluded':'Exclude from Response'}
                  </button>
                  {/* The per-record `Redact` button was RETIRED 2026-07-19 (brief §5.5). It opened the
                      task-less v1 canvas (/redact/:fileId), which carries no work timer — so redaction
                      labour on a citizen record went unmeasured and the city under-billed for it — and no
                      task ceremony. Redaction happens on the task screen (/redaction/:taskId), reached from
                      My Tasks. The template-match badge above stays: it is information, not a way in. */}
                  {((r.mimetype && r.mimetype.indexOf('csv') >= 0) || (r.title && /\.csv$/i.test(r.title))) ? <button onClick={function(){nav('/redact-fields/' + r.id);}} style={{padding:'5px 10px',borderRadius:'6px',border:'1px solid var(--oq-ln-1f4e79)',background:'var(--oq-bg-ffffff)',color:'var(--oq-fg-1f4e79)',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>Redact fields</button> : null}
                  <button onClick={function(){deleteFile(r.id);}} style={{padding:'5px 8px',borderRadius:'6px',border:'1px solid var(--oq-ln-fca5a5)',background:'var(--oq-bg-ffffff)',color:'var(--oq-fg-dc2626)',fontSize:'11px',cursor:'pointer'}}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
