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
  internal: { label:'Internal', tone:{bg:'#EFF6FF',fg:'#1F4E79',bd:'#BFDBFE'}, desc:'Media is redacted inside Optimum Q. Mark the boxes, and the system writes the redactions permanently into a new copy. The original is always kept.' },
  external: { label:'External', tone:{bg:'#FEF3C7',fg:'#92400E',bd:'#FCD34D'}, desc:'Media is redacted in your agency\u2019s own tool (for example Axon or Veritone). The request is held while the file is out, then the redacted copy is checked back in here. The original is always kept.' },
  not_required: { label:'Not required', tone:{bg:'#DEF7EC',fg:'#03543F',bd:'#84E1BC'}, desc:'This media type is presumed releasable. A reviewer still confirms before anything goes out \u2014 nothing is released automatically.' }
};
var ORDER = ['external','internal','not_required'];

export default function AvRedactionPanel(props){
  var requestId = props.requestId;
  var [data, setData] = useState(null);
  var [loading, setLoading] = useState(true);
  var [err, setErr] = useState('');
  var [busy, setBusy] = useState(false);

  // external send-out
  var [extFile, setExtFile] = useState('');
  var [extNote, setExtNote] = useState('');
  // internal apply
  var [intFile, setIntFile] = useState('');
  var [zonesObj, setZonesObj] = useState(null);
  var [zonesName, setZonesName] = useState('');
  // not-required release
  var [nrFile, setNrFile] = useState('');
  var [nrNote, setNrNote] = useState('');
  var [nrAttest, setNrAttest] = useState(false);
  // per-task check-in
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
    try { await api.post('/av-redaction/request/'+requestId+'/start', { original_file_id: extFile||null, note: extNote||null }); setExtFile(''); setExtNote(''); await load(); }
    catch(e){ alert((e.response&&e.response.data&&e.response.data.error)||'Could not send out.'); }
    setBusy(false);
  }

  function onZonesFile(e){
    var f = e.target.files && e.target.files[0];
    if(!f){ setZonesObj(null); setZonesName(''); return; }
    var reader = new FileReader();
    reader.onload = function(){
      try { var obj = JSON.parse(reader.result); setZonesObj(obj); setZonesName(f.name); }
      catch(err){ alert('That file is not a valid redaction plan (expected JSON).'); setZonesObj(null); setZonesName(''); }
    };
    reader.readAsText(f);
  }

  async function applyInternal(){
    if(!intFile){ alert('Choose the original file to redact.'); return; }
    if(!zonesObj){ alert('Load the redaction plan (zones file) first.'); return; }
    setBusy(true);
    try { await api.post('/av-redaction/request/'+requestId+'/apply-internal', { original_file_id: intFile, zones: zonesObj }); setIntFile(''); setZonesObj(null); setZonesName(''); await load(); }
    catch(e){ alert((e.response&&e.response.data&&e.response.data.error)||'Redaction failed.'); }
    setBusy(false);
  }

  async function releaseAsIs(){
    if(!nrAttest){ alert('Please confirm the media can be released without redaction.'); return; }
    setBusy(true);
    try { await api.post('/av-redaction/request/'+requestId+'/release-as-is', { original_file_id: nrFile||null, note: nrNote||null, attested:true }); setNrFile(''); setNrNote(''); setNrAttest(false); await load(); }
    catch(e){ alert((e.response&&e.response.data&&e.response.data.error)||'Could not record release.'); }
    setBusy(false);
  }

  function setC(taskId, patch){ setCheckin(function(prev){ var n=Object.assign({},prev); n[taskId]=Object.assign({},prev[taskId]||{},patch); return n; }); }
  async function cancelTask(taskId){
    if(!window.confirm('Cancel this send-out? The hold will be removed.')) return;
    setBusy(true);
    try { await api.post('/av-redaction/task/'+taskId+'/cancel'); await load(); } catch(e){ alert('Cancel failed.'); }
    setBusy(false);
  }
  async function doCheckin(taskId){
    var c = checkin[taskId]||{};
    if(!c.file){ alert('Choose the redacted file first.'); return; }
    if(!c.attested){ alert('You must confirm the file is properly redacted before checking it in.'); return; }
    setBusy(true);
    try {
      var fd = new FormData(); fd.append('file', c.file); fd.append('attested','1');
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
  var inp = {width:'100%',padding:'8px 10px',border:'1px solid #D1D5DB',borderRadius:'8px',fontSize:'13px',boxSizing:'border-box'};
  var btn = {padding:'8px 14px',borderRadius:'8px',border:'1px solid #D1D5DB',background:'white',color:'#374151',fontSize:'13px',fontWeight:'600',cursor:'pointer'};
  var btnPri = {padding:'9px 16px',borderRadius:'8px',border:'none',background:'#1F4E79',color:'white',fontSize:'13px',fontWeight:'600',cursor:'pointer'};

  function fileSelect(val, set, optional){
    return <select value={val} onChange={function(e){set(e.target.value);}} style={Object.assign({},inp,{marginBottom:'12px'})}>
      <option value="">{optional?'Not stored in Optimum Q / select later':'Select the file...'}</option>
      {files.map(function(f){ return <option key={f.id} value={f.id}>{f.original_name}</option>; })}
    </select>;
  }

  function actionBody(key){
    if(key==='external'){
      return <div>
        <p style={{fontSize:'12px',color:'#6B7280',margin:'0 0 14px',lineHeight:'1.5'}}>Marks the request on hold. Redact the file in your agency tool, then check the redacted copy back in below.</p>
        <div style={lbl}>Original file</div>
        {fileSelect(extFile, setExtFile, true)}
        <div style={lbl}>Note (optional)</div>
        <input value={extNote} onChange={function(e){setExtNote(e.target.value);}} placeholder="e.g. body-cam clip, 00:00-04:30" style={Object.assign({},inp,{marginBottom:'14px'})}/>
        <button onClick={startOut} disabled={busy} style={Object.assign({},btnPri,{opacity:busy?0.6:1})}>Send out for redaction</button>
      </div>;
    }
    if(key==='internal'){
      return <div>
        <p style={{fontSize:'12px',color:'#6B7280',margin:'0 0 14px',lineHeight:'1.5'}}>Pick the original and load a redaction plan (the boxes-and-timestamps file exported from the workbench). The system burns the redactions into a new copy and keeps the original.</p>
        <div style={lbl}>Original file</div>
        {fileSelect(intFile, setIntFile, false)}
        <div style={lbl}>Redaction plan</div>
        <input type="file" accept="application/json,.json" onChange={onZonesFile} style={{fontSize:'13px',display:'block',marginBottom:zonesName?'6px':'14px'}}/>
        {zonesName && <div style={{fontSize:'12px',color:'#03543F',marginBottom:'14px'}}>Loaded: {zonesName}</div>}
        <button onClick={applyInternal} disabled={busy} style={Object.assign({},btnPri,{opacity:busy?0.6:1})}>{busy?'Applying redaction...':'Apply redaction'}</button>
        <div style={{fontSize:'11px',color:'#9CA3AF',marginTop:'10px',lineHeight:'1.5'}}>In-app drawing workbench is coming; for now this accepts a plan exported from the standalone tool.</div>
      </div>;
    }
    // not_required
    return <div>
      <p style={{fontSize:'12px',color:'#6B7280',margin:'0 0 14px',lineHeight:'1.5'}}>If you have reviewed the media and it can go out as-is, confirm below. This is recorded with your name and time \u2014 it is never automatic.</p>
      <div style={lbl}>File (optional)</div>
      {fileSelect(nrFile, setNrFile, true)}
      <div style={lbl}>Note (optional)</div>
      <input value={nrNote} onChange={function(e){setNrNote(e.target.value);}} placeholder="e.g. public council meeting, no PII present" style={Object.assign({},inp,{marginBottom:'12px'})}/>
      <label style={{display:'flex',alignItems:'flex-start',gap:'8px',fontSize:'12px',color:'#374151',marginBottom:'12px',cursor:'pointer'}}>
        <input type="checkbox" checked={nrAttest} onChange={function(e){setNrAttest(e.target.checked);}} style={{marginTop:'2px'}}/>
        <span>I have reviewed this media and confirm it can be released without redaction.</span>
      </label>
      <button onClick={releaseAsIs} disabled={busy} style={Object.assign({},btnPri,{opacity:busy?0.6:1})}>Confirm and release as-is</button>
    </div>;
  }

  var titles = { external:'Send out for external redaction', internal:'Redact in-system', not_required:'Release without redaction' };
  var ordered = [data.mode].concat(ORDER.filter(function(k){ return k!==data.mode; }));

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

      <div style={Object.assign({},card,{borderColor:m.tone.bd})}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'4px'}}>
          <div style={{fontSize:'14px',fontWeight:'700'}}>{titles[ordered[0]]}</div>
          <span style={{fontSize:'10px',fontWeight:'700',background:m.tone.bg,color:m.tone.fg,borderRadius:'8px',padding:'2px 8px'}}>AGENCY DEFAULT</span>
        </div>
        {actionBody(ordered[0])}
      </div>

      <div style={{marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#9CA3AF',textTransform:'uppercase',letterSpacing:'.05em',margin:'0 4px 10px'}}>Other handling options</div>
        {[ordered[1],ordered[2]].map(function(k){
          return <div key={k} style={Object.assign({},card,{background:'#FAFAFA'})}>
            <div style={{fontSize:'13px',fontWeight:'700',marginBottom:'4px',color:'#374151'}}>{titles[k]}</div>
            {actionBody(k)}
          </div>;
        })}
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
          <div style={{fontSize:'14px',fontWeight:'700',marginBottom:'12px'}}>Completed</div>
          {doneTasks.map(function(t){
            var isRelease = (t.mode==='not_required') || !t.redacted_file_id;
            return <div key={t.id} style={{border:'1px solid #84E1BC',background:'#F3FBF7',borderRadius:'8px',padding:'12px 14px',marginBottom:'8px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px'}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'#03543F'}}>{isRelease ? 'Released without redaction \u00b7 attested' : 'Redacted copy ready \u00b7 attested'} <span style={{fontSize:'10px',fontWeight:'700',color:'#6B7280'}}>({t.mode})</span></div>
                  <div style={{fontSize:'11px',color:'#6B7280',marginTop:'2px'}}>{isRelease ? (t.note||'No note') : (t.redacted_name||'file')} &middot; {t.checked_in_at}</div>
                </div>
                {!isRelease && t.redacted_file_id && <button onClick={function(){download(t.redacted_file_id, t.redacted_name);}} style={btn}>Download redacted</button>}
              </div>
            </div>;
          })}
        </div>
      )}
    </div>
  );
}
