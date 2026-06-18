import React, { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';

function fmtBytes(n){
  if(n===null||n===undefined||n==='') return '';
  if(n<1024) return n+' B';
  if(n<1048576) return (n/1024).toFixed(0)+' KB';
  if(n<1073741824) return (n/1048576).toFixed(1)+' MB';
  return (n/1073741824).toFixed(2)+' GB';
}

var MODE = {
  internal: { label:'Internal', tone:{bg:'#EFF6FF',fg:'#1F4E79',bd:'#BFDBFE'}, desc:'Default: media is redacted inside Optimum Q (annotate, review, then the system writes the redactions into a new copy). The in-system workbench is a later phase; for now you can still handle a clip externally below.' },
  external: { label:'External', tone:{bg:'#FEF3C7',fg:'#92400E',bd:'#FCD34D'}, desc:'Default: media is redacted in your agency\u2019s own tool (for example Axon or Veritone). The request is held while the file is out, then you check the redacted copy back in here. The original is always kept.' },
  not_required: { label:'Not required', tone:{bg:'#DEF7EC',fg:'#03543F',bd:'#84E1BC'}, desc:'Default: this media type is presumed releasable. A reviewer still confirms before release. The confirmation gate is a later phase; for now you can handle a clip externally below if needed.' }
};

export default function AvRedactionPanel(props){
  var requestId = props.requestId;
  var [data, setData] = useState(null);
  var [loading, setLoading] = useState(true);
  var [err, setErr] = useState('');
  var [selFile, setSelFile] = useState('');
  var [note, setNote] = useState('');
  var [busy, setBusy] = useState(false);
  var [checkin, setCheckin] = useState({});

  var load = useCallback(async function(){
    setLoading(true); setErr('');
    try { var r = await api.get('/av-redaction/request/'+requestId); setData(r.data); }
    catch(e){ setErr('Could not load redaction status.'); }
    setLoading(false);
  }, [requestId]);
  useEffect(function(){ load(); }, [load]);

  async function download(fileId, name){
    try {
      var r = await api.get('/files/download/'+fileId, { responseType:'blob' });
      var url = URL.createObjectURL(r.data);
      var a = document.createElement('a'); a.href=url; a.download=name||'download';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch(e){ alert('Download failed.'); }
  }

  async function startOut(){
    setBusy(true);
    try { await api.post('/av-redaction/request/'+requestId+'/start', { original_file_id: selFile||null, note: note||null }); setSelFile(''); setNote(''); await load(); }
    catch(e){ alert((e.response&&e.response.data&&e.response.data.error)||'Could not send out.'); }
    setBusy(false);
  }

  async function cancelTask(taskId){
    if(!window.confirm('Cancel this send-out? The hold will be removed.')) return;
    setBusy(true);
    try { await api.post('/av-redaction/task/'+taskId+'/cancel'); await load(); } catch(e){ alert('Cancel failed.'); }
    setBusy(false);
  }

  function setC(taskId, patch){ setCheckin(function(prev){ var n=Object.assign({},prev); n[taskId]=Object.assign({},prev[taskId]||{},patch); return n; }); }

  async function doCheckin(taskId){
    var c = checkin[taskId]||{};
    if(!c.file){ alert('Choose the redacted file first.'); return; }
    if(!c.attested){ alert('You must confirm the file is properly redacted before checking it in.'); return; }
    setBusy(true);
    try {
      var fd = new FormData();
      fd.append('file', c.file);
      fd.append('attested', '1');
      await api.post('/av-redaction/task/'+taskId+'/checkin', fd);
      setCheckin(function(prev){ var n=Object.assign({},prev); delete n[taskId]; return n; });
      await load();
    } catch(e){ alert((e.response&&e.response.data&&e.response.data.error)||'Check-in failed.'); }
    setBusy(false);
  }

  if(loading) return <div style={{padding:'32px',textAlign:'center',color:'#9CA3AF'}}>Loading...</div>;
  if(err) return <div style={{padding:'16px',color:'#9B1C1C',background:'#FDE8E8',borderRadius:'8px'}}>{err}</div>;

  var m = MODE[data.mode] || MODE.internal;
  var files = data.files || [];
  var openTasks = (data.tasks||[]).filter(function(t){ return t.status==='out'; });
  var doneTasks = (data.tasks||[]).filter(function(t){ return t.status==='checked_in'; });
  var lbl = {fontSize:'11px',fontWeight:'600',color:'#9CA3AF',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'6px'};
  var card = {background:'white',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'18px',marginBottom:'16px'};
  var btn = {padding:'8px 14px',borderRadius:'8px',border:'1px solid #D1D5DB',background:'white',color:'#374151',fontSize:'13px',fontWeight:'600',cursor:'pointer'};
  var btnPri = {padding:'8px 16px',borderRadius:'8px',border:'none',background:'#1F4E79',color:'white',fontSize:'13px',fontWeight:'600',cursor:'pointer'};

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'8px'}}>
        <div style={{fontSize:'16px',fontWeight:'700',color:'#111'}}>Audio / Video Redaction</div>
        <span style={{fontSize:'11px',fontWeight:'700',background:m.tone.bg,color:m.tone.fg,border:'1px solid '+m.tone.bd,borderRadius:'10px',padding:'3px 10px'}}>Agency default: {m.label}</span>
      </div>
      <p style={{fontSize:'13px',color:'#6B7280',lineHeight:'1.6',margin:'0 0 16px'}}>{m.desc}</p>

      {data.held && (
        <div style={{background:'#FEF3C7',border:'1px solid #FCD34D',color:'#92400E',borderRadius:'8px',padding:'12px 14px',marginBottom:'16px',fontSize:'13px',fontWeight:'600'}}>
          This request is on hold &mdash; media is currently out for external redaction. It resumes when the redacted copy is checked back in.
        </div>
      )}

      <div style={card}>
        <div style={{fontSize:'14px',fontWeight:'700',marginBottom:'12px'}}>Files on this request</div>
        {files.length===0 ? (
          <div style={{fontSize:'13px',color:'#9CA3AF'}}>No files uploaded to this request yet.</div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {files.map(function(f){
              return <div key={f.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',border:'1px solid #F3F4F6',borderRadius:'8px',padding:'10px 12px'}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'#111',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.original_name}{f.status==='redacted'?<span style={{marginLeft:'8px',fontSize:'10px',fontWeight:'700',background:'#DEF7EC',color:'#03543F',borderRadius:'8px',padding:'2px 7px'}}>REDACTED COPY</span>:null}</div>
                  <div style={{fontSize:'11px',color:'#9CA3AF',marginTop:'2px'}}>{(f.mimetype||'file')} &middot; {fmtBytes(f.size)}</div>
                </div>
                <button onClick={function(){download(f.id, f.original_name);}} style={btn}>Download</button>
              </div>;
            })}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{fontSize:'14px',fontWeight:'700',marginBottom:'4px'}}>Send media out for external redaction</div>
        <p style={{fontSize:'12px',color:'#6B7280',margin:'0 0 14px',lineHeight:'1.5'}}>Marks the request on hold. Redact the file in your agency tool, then check the redacted copy back in below.</p>
        <div style={lbl}>Original file (optional)</div>
        <select value={selFile} onChange={function(e){setSelFile(e.target.value);}} style={{width:'100%',padding:'8px 10px',border:'1px solid #D1D5DB',borderRadius:'8px',fontSize:'13px',marginBottom:'12px'}}>
          <option value="">Not stored in Optimum Q / select later</option>
          {files.map(function(f){ return <option key={f.id} value={f.id}>{f.original_name}</option>; })}
        </select>
        <div style={lbl}>Note (optional)</div>
        <input value={note} onChange={function(e){setNote(e.target.value);}} placeholder="e.g. body-cam clip, 00:00-04:30" style={{width:'100%',padding:'8px 10px',border:'1px solid #D1D5DB',borderRadius:'8px',fontSize:'13px',marginBottom:'14px',boxSizing:'border-box'}}/>
        <button onClick={startOut} disabled={busy} style={Object.assign({},btnPri,{opacity:busy?0.6:1})}>Send out for redaction</button>
      </div>

      {openTasks.length>0 && (
        <div style={card}>
          <div style={{fontSize:'14px',fontWeight:'700',marginBottom:'12px'}}>Out for redaction &mdash; check in the redacted copy</div>
          {openTasks.map(function(t){
            var c = checkin[t.id]||{};
            return <div key={t.id} style={{border:'1px solid #FCD34D',background:'#FFFBEB',borderRadius:'8px',padding:'14px',marginBottom:'10px'}}>
              <div style={{fontSize:'13px',color:'#92400E',marginBottom:'10px'}}>
                <strong>{t.original_name||'Media (not stored here)'}</strong>{t.note?(' \u2014 '+t.note):''}<br/>
                <span style={{fontSize:'11px',color:'#B45309'}}>Sent out {t.started_at}</span>
              </div>
              <div style={lbl}>Redacted file</div>
              <input type="file" onChange={function(e){ setC(t.id,{file:e.target.files&&e.target.files[0]}); }} style={{fontSize:'13px',marginBottom:'10px',display:'block'}}/>
              <label style={{display:'flex',alignItems:'flex-start',gap:'8px',fontSize:'12px',color:'#374151',marginBottom:'12px',cursor:'pointer'}}>
                <input type="checkbox" checked={!!c.attested} onChange={function(e){ setC(t.id,{attested:e.target.checked}); }} style={{marginTop:'2px'}}/>
                <span>I confirm this file has been reviewed and is properly redacted for release. The original, unredacted copy is preserved.</span>
              </label>
              <div style={{display:'flex',gap:'8px'}}>
                <button onClick={function(){doCheckin(t.id);}} disabled={busy} style={Object.assign({},btnPri,{opacity:busy?0.6:1})}>Check in redacted copy</button>
                <button onClick={function(){cancelTask(t.id);}} disabled={busy} style={btn}>Cancel send-out</button>
              </div>
            </div>;
          })}
        </div>
      )}

      {doneTasks.length>0 && (
        <div style={card}>
          <div style={{fontSize:'14px',fontWeight:'700',marginBottom:'12px'}}>Completed redactions</div>
          {doneTasks.map(function(t){
            return <div key={t.id} style={{border:'1px solid #84E1BC',background:'#F3FBF7',borderRadius:'8px',padding:'12px 14px',marginBottom:'8px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px'}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'#03543F'}}>Redacted copy checked in &middot; attested</div>
                  <div style={{fontSize:'11px',color:'#6B7280',marginTop:'2px'}}>{t.redacted_name||'file'} &middot; {t.checked_in_at}</div>
                </div>
                {t.redacted_file_id && <button onClick={function(){download(t.redacted_file_id, t.redacted_name);}} style={btn}>Download redacted</button>}
              </div>
            </div>;
          })}
        </div>
      )}
    </div>
  );
}
