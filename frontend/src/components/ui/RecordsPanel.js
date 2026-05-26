import React, { useState, useRef, useEffect } from 'react';
import api from '../../lib/api';

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

export default function RecordsPanel({ requestId, stage }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title:'', recordType:'Document / PDF', description:'', isNonDigital:false });
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  useEffect(function() { if (requestId) loadFiles(); }, [requestId]);

  async function loadFiles() {
    setLoading(true);
    try {
      var r = await api.get('/files/' + requestId);
      setRecords(r.data.files.map(function(f) {
        return { id: f.id, title: f.original_name, recordType: f.mimetype||'Document / PDF', description:'', isNonDigital: false, status: f.responsive ? 'responsive' : 'attached', size: f.size, mimetype: f.mimetype, uploadedAt: f.uploaded_at };
      }));
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  function setF(k,v){ setForm(function(f){ return Object.assign({},f,{[k]:v}); }); }

  async function uploadFile(file) {
    setUploading(true);
    try {
      var fd = new FormData();
      fd.append('file', file);
      var r = await api.post('/files/upload/' + requestId, fd, { headers: {'Content-Type':'multipart/form-data'} });
      await loadFiles();
    } catch(e) { console.error('Upload error:', e); }
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
      await api.post('/files/upload/' + requestId, fd, { headers: {'Content-Type':'multipart/form-data'} });
      await loadFiles();
      setForm({ title:'', recordType:'Document / PDF', description:'', isNonDigital:false });
      setShowAdd(false);
    } catch(e) { console.error(e); }
    setUploading(false);
  }

  async function updateStatus(fileId, responsive) {
    try {
      await api.patch('/files/' + fileId + '/status', { responsive: responsive });
      setRecords(function(prev){ return prev.map(function(r){ return r.id===fileId ? Object.assign({},r,{status:responsive?'responsive':'attached'}) : r; }); });
    } catch(e) {
      setRecords(function(prev){ return prev.map(function(r){ return r.id===fileId ? Object.assign({},r,{status:responsive?'responsive':'attached'}) : r; }); });
    }
  }

  async function deleteFile(fileId) {
    if (!window.confirm('Remove this record?')) return;
    try {
      await api.delete('/files/' + fileId);
      await loadFiles();
    } catch(e) { console.error(e); }
  }

  var responsiveCount = records.filter(function(r){ return r.status==='responsive'; }).length;
  var canAdvance = responsiveCount > 0;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <h3 style={{fontSize:'15px',fontWeight:'700',margin:'0 0 2px'}}>Records</h3>
          <p style={{fontSize:'12px',color:'#9CA3AF',margin:0}}>
            {loading ? 'Loading...' : records.length===0 ? 'No records attached yet' : records.length+' record'+(records.length!==1?'s':'')+' · '+responsiveCount+' responsive'}
            {stage==='record_search'&&!canAdvance&&records.length>0?' — mark at least one Responsive to advance':''}
          </p>
        </div>
        <button onClick={function(){setShowAdd(!showAdd);}} style={{padding:'8px 14px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
          + Attach Record
        </button>
      </div>

      {stage==='record_search'&&(
        <div style={{display:'flex',gap:'10px',padding:'12px',background:canAdvance?'#F0FDF4':'#FFFBEB',borderRadius:'8px',border:'1px solid '+(canAdvance?'#86EFAC':'#FDE68A')}}>
          <div style={{fontSize:'20px'}}>{canAdvance?'✅':'⚠️'}</div>
          <div style={{fontSize:'13px',color:canAdvance?'#166534':'#92400E'}}>
            {canAdvance?responsiveCount+' responsive record'+(responsiveCount!==1?'s':'')+' — ready to advance':'Attach records and mark at least one Responsive before advancing'}
          </div>
        </div>
      )}

      {showAdd&&(
        <div style={{background:'#F9FAFB',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'16px'}}>
          <h4 style={{fontSize:'14px',fontWeight:'700',margin:'0 0 12px'}}>Attach a Record</h4>
          <div style={{display:'flex',gap:'12px',marginBottom:'12px'}}>
            {[['📎 Upload File',false],['📝 Log Non-Digital',true]].map(function(item){
              var active=form.isNonDigital===item[1];
              return <button key={String(item[1])} type="button" onClick={function(){setF('isNonDigital',item[1]);}}
                style={{flex:1,padding:'10px',borderRadius:'8px',border:'2px solid '+(active?'#1F4E79':'#E5E7EB'),background:active?'#EBF3FB':'white',color:active?'#1F4E79':'#6B7280',fontSize:'13px',fontWeight:active?'700':'500',cursor:'pointer'}}>
                {item[0]}
              </button>;
            })}
          </div>
          {!form.isNonDigital ? (
            <div>
              <div onDragOver={function(e){e.preventDefault();setDragOver(true);}} onDragLeave={function(){setDragOver(false);}} onDrop={handleDrop}
                onClick={function(){fileRef.current.click();}}
                style={{border:'2px dashed '+(dragOver?'#1F4E79':'#D1D5DB'),borderRadius:'8px',padding:'24px',textAlign:'center',cursor:'pointer',background:dragOver?'#EBF3FB':'white',transition:'all .15s'}}>
                {uploading ? (
                  <div style={{color:'#1F4E79',fontSize:'14px',fontWeight:'600'}}>⏳ Uploading...</div>
                ) : (
                  <div>
                    <div style={{fontSize:'28px',marginBottom:'8px'}}>📁</div>
                    <div style={{fontSize:'14px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Drop files here or click to browse</div>
                    <div style={{fontSize:'12px',color:'#9CA3AF'}}>PDF, DOC, XLS, images, audio, video — up to 50MB</div>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" multiple onChange={handleFileSelect} style={{display:'none'}} accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.mp3,.mp4,.mov,.txt,.csv"/>
              <button type="button" onClick={function(){setShowAdd(false);}} style={{marginTop:'10px',padding:'8px 16px',background:'white',color:'#6B7280',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'13px',cursor:'pointer'}}>Cancel</button>
            </div>
          ) : (
            <form onSubmit={handleAddNonDigital} style={{display:'flex',flexDirection:'column',gap:'10px'}}>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Record Title *</label>
                <input value={form.title} onChange={function(e){setF('title',e.target.value);}} style={{width:'100%',padding:'8px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box'}} placeholder="e.g., Building inspection file box #3" required/>
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Record Type</label>
                <select value={form.recordType} onChange={function(e){setF('recordType',e.target.value);}} style={{width:'100%',padding:'8px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'13px',outline:'none'}}>
                  {RECORD_TYPES.map(function(t){return <option key={t} value={t}>{t}</option>;})}
                </select>
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Description</label>
                <textarea value={form.description} onChange={function(e){setF('description',e.target.value);}} style={{width:'100%',padding:'8px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'13px',outline:'none',minHeight:'60px',resize:'vertical',fontFamily:'inherit',boxSizing:'border-box'}} placeholder="Location, custodian, contents..."/>
              </div>
              <div style={{background:'#EBF3FB',borderRadius:'8px',padding:'10px',fontSize:'13px',color:'#1F4E79'}}>
                📷 <strong>Optional:</strong> Attach a photo of this record if possible
              </div>
              <div style={{display:'flex',gap:'8px'}}>
                <button type="button" onClick={function(){setShowAdd(false);}} style={{padding:'8px 16px',background:'white',color:'#6B7280',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'13px',cursor:'pointer'}}>Cancel</button>
                <button type="submit" disabled={uploading} style={{padding:'8px 16px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>{uploading?'Saving...':'Log Record'}</button>
              </div>
            </form>
          )}
        </div>
      )}

      {loading ? (
        <div style={{padding:'32px',textAlign:'center',color:'#9CA3AF',fontSize:'14px'}}>Loading records...</div>
      ) : records.length > 0 ? (
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {records.map(function(r){
            var isR=r.status==='responsive';
            var isNR=r.status==='non_responsive';
            return(
              <div key={r.id} style={{background:'white',border:'1px solid '+(isR?'#86EFAC':isNR?'#FCA5A5':'#E5E7EB'),borderRadius:'10px',padding:'14px',display:'flex',alignItems:'flex-start',gap:'12px'}}>
                <div style={{fontSize:'28px',flexShrink:0}}>{fileIcon(r.mimetype, r.isNonDigital)}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:'600',fontSize:'14px',color:'#111',marginBottom:'2px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.title}</div>
                  <div style={{fontSize:'12px',color:'#9CA3AF'}}>
                    {r.size ? formatSize(r.size) : 'Non-digital record'}
                    {r.uploadedAt ? ' · ' + new Date(r.uploadedAt).toLocaleDateString() : ''}
                  </div>
                </div>
                <div style={{display:'flex',gap:'6px',flexShrink:0,alignItems:'center'}}>
                  <button onClick={function(){updateStatus(r.id, true);}} style={{padding:'5px 10px',borderRadius:'6px',border:'1px solid '+(isR?'#16A34A':'#D1D5DB'),background:isR?'#F0FDF4':'white',color:isR?'#16A34A':'#6B7280',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                    {isR?'✓ Responsive':'Responsive'}
                  </button>
                  <button onClick={function(){updateStatus(r.id, false);}} style={{padding:'5px 10px',borderRadius:'6px',border:'1px solid '+(isNR?'#DC2626':'#D1D5DB'),background:isNR?'#FEF2F2':'white',color:isNR?'#DC2626':'#6B7280',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                    {isNR?'✗ Not Responsive':'Not Responsive'}
                  </button>
                  <button onClick={function(){deleteFile(r.id);}} style={{padding:'5px 8px',borderRadius:'6px',border:'1px solid #FCA5A5',background:'white',color:'#DC2626',fontSize:'11px',cursor:'pointer'}}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
