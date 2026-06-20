import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';

var V_TYPES = [['face','Face'],['plate','License plate'],['manual','Manual area']];
var V_STYLES = [['black','Black box'],['pixel','Pixelate'],['mosaic','Mosaic']];
var A_STYLES = [['silence','Silence'],['tone','Tone (beep)'],['noise','Noise']];
var FACEAPI_LIB = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
var MODEL_URIS = ['https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model','https://vladmandic.github.io/face-api/model','https://justadudewhohacks.github.io/face-api.js/models'];

function fmt(s){ s=s||0; var m=Math.floor(s/60); var sec=(s%60); return m+':'+(sec<10?'0':'')+sec.toFixed(1); }
function rid(){ return 'z'+Math.random().toString(36).slice(2,9); }

export default function AvWorkbenchPage(){
  var params = useParams();
  var requestId = params.requestId, fileId = params.fileId;
  var navigate = useNavigate();
  var videoRef = useRef(null);
  var canvasRef = useRef(null);
  var draw = useRef({active:false,sx:0,sy:0,cx:0,cy:0});
  var faceReady = useRef(false);

  var [fileName, setFileName] = useState('');
  var [videoUrl, setVideoUrl] = useState('');
  var [loadErr, setLoadErr] = useState('');
  var [ready, setReady] = useState(false);
  var [dims, setDims] = useState({w:0,h:0});
  var [duration, setDuration] = useState(0);
  var [currentTime, setCurrentTime] = useState(0);
  var [playing, setPlaying] = useState(false);

  var [vType, setVType] = useState('face');
  var [vStyle, setVStyle] = useState('black');
  var [vReds, setVReds] = useState([]);
  var [aStyle, setAStyle] = useState('silence');
  var [aReds, setAReds] = useState([]);
  var [busy, setBusy] = useState(false);

  var [detecting, setDetecting] = useState(false);
  var [progress, setProgress] = useState(0);
  var [detectMsg, setDetectMsg] = useState('');

  useEffect(function(){
    var revoked=false, url='';
    (async function(){
      try {
        try { var meta = await api.get('/av-redaction/request/'+requestId); var f=(meta.data.files||[]).find(function(x){return x.id===fileId;}); if(f) setFileName(f.original_name); } catch(e){}
        var r = await api.get('/files/download/'+fileId, { responseType:'blob' });
        url = URL.createObjectURL(r.data); if(!revoked) setVideoUrl(url);
      } catch(e){ setLoadErr('Could not load the video file.'); }
    })();
    return function(){ revoked=true; if(url) URL.revokeObjectURL(url); };
  }, [requestId, fileId]);

  function toNative(e){
    var c=canvasRef.current; if(!c) return {x:0,y:0};
    var r=c.getBoundingClientRect();
    return { x:((e.clientX-r.left)/r.width)*c.width, y:((e.clientY-r.top)/r.height)*c.height };
  }
  function onDown(e){ if(!ready) return; var p=toNative(e); draw.current={active:true,sx:p.x,sy:p.y,cx:p.x,cy:p.y}; }
  function onMove(e){ if(!draw.current.active) return; var p=toNative(e); draw.current.cx=p.x; draw.current.cy=p.y; }
  function onUp(){
    if(!draw.current.active) return;
    var d=draw.current; draw.current={active:false,sx:0,sy:0,cx:0,cy:0};
    var rx=Math.min(d.sx,d.cx), ry=Math.min(d.sy,d.cy), rw=Math.abs(d.cx-d.sx), rh=Math.abs(d.cy-d.sy);
    if(rw>10 && rh>10){
      var v=videoRef.current; var t=v?v.currentTime:0; var dur=v?v.duration:0;
      var lbl = vType==='face'?'Face':vType==='plate'?'Plate':'Manual area';
      setVReds(function(prev){ return prev.concat([{ id:rid(), x:Math.round(rx),y:Math.round(ry),w:Math.round(rw),h:Math.round(rh), type:vType, style:vStyle, label:lbl, startTime:+t.toFixed(3), endTime:+Math.min(dur,t+5).toFixed(3), detected:false }]); });
    }
  }

  useEffect(function(){
    var raf;
    function tick(){
      var c=canvasRef.current, v=videoRef.current;
      if(c && v){
        var ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
        var t=v.currentTime;
        vReds.forEach(function(z){
          var active = t>=z.startTime && t<=z.endTime;
          ctx.lineWidth=Math.max(2,c.width/400);
          if(active){ ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fillRect(z.x,z.y,z.w,z.h); }
          ctx.strokeStyle = active?(z.auto?'#2563EB':'#16A34A'):'rgba(140,140,140,0.6)';
          ctx.strokeRect(z.x,z.y,z.w,z.h);
          if(active){ ctx.fillStyle=z.auto?'#2563EB':'#16A34A'; ctx.font='bold '+Math.max(12,c.width/55)+'px sans-serif'; ctx.fillText(z.label||z.type, z.x+3, Math.max(14,z.y-4)); }
        });
        if(draw.current.active){
          var d=draw.current; ctx.setLineDash([6,4]); ctx.strokeStyle='#1F4E79'; ctx.lineWidth=Math.max(2,c.width/400);
          ctx.strokeRect(Math.min(d.sx,d.cx),Math.min(d.sy,d.cy),Math.abs(d.cx-d.sx),Math.abs(d.cy-d.sy)); ctx.setLineDash([]);
        }
      }
      raf=requestAnimationFrame(tick);
    }
    raf=requestAnimationFrame(tick);
    return function(){ cancelAnimationFrame(raf); };
  }, [vReds]);

  function onLoaded(){
    var v=videoRef.current; if(!v) return; var c=canvasRef.current;
    var w=v.videoWidth||640, h=v.videoHeight||360;
    if(c){ c.width=w; c.height=h; }
    setDims({w:w,h:h}); setDuration(v.duration||0); setReady(true);
  }
  function togglePlay(){ var v=videoRef.current; if(!v) return; if(v.paused){ v.play(); setPlaying(true);} else { v.pause(); setPlaying(false);} }
  function onTime(){ var v=videoRef.current; if(v) setCurrentTime(v.currentTime); }
  function seek(val){ var v=videoRef.current; if(v){ v.currentTime=val; setCurrentTime(val);} }

  function clampT(val){ var n=parseFloat(val); if(isNaN(n)) n=0; if(n<0)n=0; if(duration&&n>duration)n=duration; return +n.toFixed(3); }
  function delV(id){ setVReds(function(p){return p.filter(function(z){return z.id!==id;});}); }
  function setVField(id,field,val){ setVReds(function(p){return p.map(function(z){ if(z.id!==id) return z; var o=Object.assign({},z); o[field]=val; return o; });}); }
  function delTrack(tid){ setVReds(function(p){return p.filter(function(z){return z.trackId!==tid;});}); }
  function setTrackStyle(tid,val){ setVReds(function(p){return p.map(function(z){ if(z.trackId!==tid) return z; var o=Object.assign({},z); o.style=val; return o; });}); }
  function clearAuto(){ setVReds(function(p){return p.filter(function(z){return !z.auto;});}); }
  function addAudio(){ var v=videoRef.current; var t=v?v.currentTime:0; var dur=v?v.duration:0; setAReds(function(p){return p.concat([{id:rid(),startTime:+t.toFixed(3),endTime:+Math.min(dur,t+3).toFixed(3),style:aStyle}]);}); }
  function delA(id){ setAReds(function(p){return p.filter(function(z){return z.id!==id;});}); }
  function setAField(id,field,val){ setAReds(function(p){return p.map(function(z){ if(z.id!==id) return z; var o=Object.assign({},z); o[field]=val; return o; });}); }

  function loadScript(src){ return new Promise(function(res,rej){ if(window.faceapi){res();return;} var s=document.createElement('script'); s.src=src; s.onload=function(){res();}; s.onerror=function(){rej(new Error('Could not load the face-detection library (network blocked?)'));}; document.body.appendChild(s); }); }
  async function ensureFaceApi(){
    if(window.faceapi && faceReady.current) return window.faceapi;
    await loadScript(FACEAPI_LIB);
    if(!window.faceapi) throw new Error('Face-detection library did not initialize');
    if(!faceReady.current){
      var ok=false, lastErr;
      for(var i=0;i<MODEL_URIS.length;i++){ try{ await window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URIS[i]); ok=true; break; }catch(e){ lastErr=e; } }
      if(!ok) throw (lastErr||new Error('Could not load the face model'));
      faceReady.current=true;
    }
    return window.faceapi;
  }
  function seekTo(v,t){ return new Promise(function(res){ var done=false; function on(){ if(done)return; done=true; v.removeEventListener('seeked',on); setTimeout(res,25); } v.addEventListener('seeked',on); try{ v.currentTime=t; }catch(e){ done=true; res(); } setTimeout(function(){ if(!done){ done=true; v.removeEventListener('seeked',on); res(); } },1500); }); }

  async function autoDetect(){
    var v=videoRef.current; if(!v||!ready){ alert('Load a video first.'); return; }
    setDetecting(true); setProgress(0); setDetectMsg('Loading detector...');
    var wasTime=v.currentTime;
    try {
      var faceapi=await ensureFaceApi();
      v.pause(); setPlaying(false);
      var dur=v.duration||0; var step = dur>90 ? 1.0 : (dur>30 ? 0.6 : 0.4);
      var opts=new faceapi.TinyFaceDetectorOptions({inputSize:416, scoreThreshold:0.4});
      var samples=[]; for(var t=0;t<dur;t+=step) samples.push(+t.toFixed(3));
      var prev=[]; var nextId=1; var out=[];
      for(var i=0;i<samples.length;i++){
        var st=samples[i];
        await seekTo(v, st);
        var dets=[]; try { dets=await faceapi.detectAllFaces(v, opts); } catch(e){ dets=[]; }
        setProgress(Math.round((i+1)/samples.length*100)); setDetectMsg('Scanning '+fmt(st)+' / '+fmt(dur)+'  ('+out.length+' so far)');
        var cur=[];
        dets.forEach(function(d){
          var b=d.box; var cx=b.x+b.width/2, cy=b.y+b.height/2;
          var match=null, best=1e9;
          prev.forEach(function(p){ var dx=p.cx-cx, dy=p.cy-cy; var dist=Math.sqrt(dx*dx+dy*dy); var tol=Math.max(b.width,b.height,p.w,p.h); if(dist<tol && dist<best){ best=dist; match=p; } });
          var tid = match ? match.tid : ('t'+(nextId++));
          var padX=b.width*0.12, padY=b.height*0.12;
          var x=Math.max(0,Math.round(b.x-padX)), y=Math.max(0,Math.round(b.y-padY));
          var w=Math.round(b.width+padX*2), h=Math.round(b.height+padY*2);
          out.push({ id:rid(), trackId:tid, auto:true, x:x, y:y, w:w, h:h, type:'face', style:'black', label:'Face '+tid.replace('t',''), startTime:st, endTime:+Math.min(dur, st+step).toFixed(3), detected:true });
          cur.push({tid:tid, cx:cx, cy:cy, w:b.width, h:b.height});
        });
        prev=cur;
      }
      setVReds(function(p){ return p.filter(function(z){return !z.auto;}).concat(out); });
      var nTracks = nextId-1;
      setDetectMsg(nTracks>0 ? ('Found '+nTracks+' face track(s), '+out.length+' segments.') : 'No faces detected. Try drawing boxes manually.');
      try { await seekTo(v, wasTime); } catch(e){}
    } catch(e){ alert('Auto-detect failed: '+e.message); setDetectMsg(''); }
    setDetecting(false); setProgress(0);
  }

  function buildPlan(){
    var v=videoRef.current;
    return {
      source:'optimumq-workbench', exported:new Date().toISOString(),
      videoWidth:dims.w, videoHeight:dims.h, videoDuration:v?v.duration:duration, fps:30,
      videoRedactions: vReds.map(function(z){ return {x:z.x,y:z.y,w:z.w,h:z.h,type:z.type,style:z.style,label:z.label,startTime:z.startTime,endTime:z.endTime,detected:z.detected}; }),
      audioRedactions: aReds.map(function(z){ return {startTime:z.startTime,endTime:z.endTime,style:z.style}; })
    };
  }
  function exportPlan(){
    var blob=new Blob([JSON.stringify(buildPlan(),null,2)],{type:'application/json'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='redaction_plan.json'; a.click();
  }
  async function applyNow(){
    if(vReds.length===0 && aReds.length===0){ alert('Add at least one redaction first.'); return; }
    if(!window.confirm('Apply '+vReds.length+' video and '+aReds.length+' audio redaction segment(s)? This creates a redacted copy; the original is kept.')) return;
    setBusy(true);
    try { await api.post('/av-redaction/request/'+requestId+'/apply-internal', { original_file_id:fileId, zones:buildPlan() }); navigate('/requests/'+requestId); }
    catch(e){ alert((e.response&&e.response.data&&e.response.data.error)||'Redaction failed.'); setBusy(false); }
  }

  var lbl={fontSize:'11px',fontWeight:'600',color:'#9CA3AF',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'6px'};
  var sel={padding:'7px 9px',border:'1px solid #D1D5DB',borderRadius:'8px',fontSize:'13px'};
  var num={width:'72px',padding:'5px 7px',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'12px'};
  var btnPri={padding:'10px 18px',borderRadius:'8px',border:'none',background:'#1F4E79',color:'white',fontSize:'14px',fontWeight:'700',cursor:'pointer'};
  var btn={padding:'8px 14px',borderRadius:'8px',border:'1px solid #D1D5DB',background:'white',color:'#374151',fontSize:'13px',fontWeight:'600',cursor:'pointer'};
  var card={background:'white',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'16px',marginBottom:'16px'};

  var manualReds = vReds.filter(function(z){ return !z.trackId; });
  var trackMap = {};
  vReds.forEach(function(z){ if(z.trackId){ if(!trackMap[z.trackId]) trackMap[z.trackId]={id:z.trackId,label:z.label,style:z.style,n:0,start:1e9,end:0}; var tr=trackMap[z.trackId]; tr.n++; tr.start=Math.min(tr.start,z.startTime); tr.end=Math.max(tr.end,z.endTime); tr.style=z.style; } });
  var tracks = Object.keys(trackMap).map(function(k){return trackMap[k];}).sort(function(a,b){return a.start-b.start;});

  return (
    <div style={{padding:'24px',maxWidth:'1100px',margin:'0 auto'}}>
      <div onClick={function(){navigate('/requests/'+requestId);}} style={{fontSize:'13px',color:'#1F4E79',cursor:'pointer',marginBottom:'10px'}}>&larr; Back to request</div>
      <div style={{fontSize:'20px',fontWeight:'800',color:'#111',marginBottom:'2px'}}>Redaction workbench</div>
      <div style={{fontSize:'13px',color:'#6B7280',marginBottom:'18px'}}>{fileName||'Video'} {dims.w?('\u00b7 '+dims.w+'x'+dims.h):''}</div>

      {loadErr ? <div style={{padding:'16px',color:'#9B1C1C',background:'#FDE8E8',borderRadius:'8px'}}>{loadErr}</div> : (
      <div style={{display:'flex',gap:'20px',flexWrap:'wrap',alignItems:'flex-start'}}>
        <div style={{flex:'1 1 520px',minWidth:'320px'}}>
          <div style={{position:'relative',width:'100%',background:'#000',borderRadius:'10px',overflow:'hidden'}}>
            {videoUrl ? <video ref={videoRef} src={videoUrl} onLoadedMetadata={onLoaded} onTimeUpdate={onTime} onEnded={function(){setPlaying(false);}} style={{width:'100%',display:'block'}}/> : <div style={{padding:'80px',textAlign:'center',color:'#9CA3AF'}}>Loading video...</div>}
            <canvas ref={canvasRef} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',cursor: ready?'crosshair':'default'}}/>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'10px',marginTop:'10px'}}>
            <button onClick={togglePlay} style={btn}>{playing?'Pause':'Play'}</button>
            <input type="range" min={0} max={duration||0} step={0.05} value={currentTime} onChange={function(e){seek(parseFloat(e.target.value));}} style={{flex:1}}/>
            <span style={{fontSize:'12px',color:'#6B7280',minWidth:'92px',textAlign:'right'}}>{fmt(currentTime)} / {fmt(duration)}</span>
          </div>

          <div style={{...card,marginTop:'12px',background:'#F8FAFF',borderColor:'#BFDBFE'}}>
            <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
              <button onClick={autoDetect} disabled={detecting||!ready} style={{...btnPri,opacity:(detecting||!ready)?0.6:1}}>{detecting?'Detecting...':'Auto-detect faces'}</button>
              {vReds.some(function(z){return z.auto;}) && <button onClick={clearAuto} disabled={detecting} style={btn}>Clear auto-detections</button>}
              {detectMsg && <span style={{fontSize:'12px',color:'#1F4E79'}}>{detectMsg}</span>}
            </div>
            {detecting && <div style={{height:'6px',background:'#DBEAFE',borderRadius:'3px',marginTop:'10px',overflow:'hidden'}}><div style={{height:'100%',width:progress+'%',background:'#1F4E79'}}></div></div>}
            <div style={{fontSize:'11px',color:'#6B7280',marginTop:'10px',lineHeight:'1.5'}}>Auto-detect finds <strong>candidate</strong> faces for you to confirm. It can miss faces (turned away, blurry, distant), so always review the whole clip yourself. It does not detect license plates.</div>
          </div>

          <div style={card}>
            <div style={{display:'flex',gap:'14px',alignItems:'flex-end',flexWrap:'wrap'}}>
              <div><div style={lbl}>Type</div><select value={vType} onChange={function(e){setVType(e.target.value);}} style={sel}>{V_TYPES.map(function(o){return <option key={o[0]} value={o[0]}>{o[1]}</option>;})}</select></div>
              <div><div style={lbl}>Style</div><select value={vStyle} onChange={function(e){setVStyle(e.target.value);}} style={sel}>{V_STYLES.map(function(o){return <option key={o[0]} value={o[0]}>{o[1]}</option>;})}</select></div>
              <div style={{fontSize:'12px',color:'#6B7280',paddingBottom:'8px'}}>Click and drag on the video to draw a box manually.</div>
            </div>
          </div>
        </div>

        <div style={{flex:'1 1 380px',minWidth:'300px'}}>
          <div style={card}>
            <div style={{fontSize:'14px',fontWeight:'700',marginBottom:'10px'}}>Detected faces ({tracks.length})</div>
            {tracks.length===0 ? <div style={{fontSize:'13px',color:'#9CA3AF'}}>None. Run auto-detect, or draw boxes manually below.</div> :
              tracks.map(function(tr){ return (
                <div key={tr.id} style={{border:'1px solid #DBEAFE',background:'#F8FAFF',borderRadius:'8px',padding:'10px',marginBottom:'8px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
                    <div style={{fontSize:'13px',fontWeight:'600',color:'#1F4E79'}}>{tr.label} <span style={{fontSize:'11px',color:'#6B7280'}}>{fmt(tr.start)}&ndash;{fmt(tr.end)} &middot; {tr.n} seg</span></div>
                    <div style={{display:'flex',gap:'6px'}}>
                      <button onClick={function(){seek(tr.start);}} style={{...btn,padding:'3px 8px',fontSize:'12px'}}>Jump</button>
                      <button onClick={function(){delTrack(tr.id);}} style={{...btn,padding:'3px 8px',fontSize:'12px',color:'#9B1C1C',borderColor:'#FDE8E8'}}>Keep visible</button>
                    </div>
                  </div>
                  <select value={tr.style} onChange={function(e){setTrackStyle(tr.id,e.target.value);}} style={{...sel,padding:'4px 7px',fontSize:'12px'}}>{V_STYLES.map(function(o){return <option key={o[0]} value={o[0]}>{o[1]}</option>;})}</select>
                </div>
              );})
            }
          </div>

          <div style={card}>
            <div style={{fontSize:'14px',fontWeight:'700',marginBottom:'10px'}}>Manual boxes ({manualReds.length})</div>
            {manualReds.length===0 ? <div style={{fontSize:'13px',color:'#9CA3AF'}}>None yet. Draw a box on the video.</div> :
              manualReds.map(function(z){ return (
                <div key={z.id} style={{border:'1px solid #F3F4F6',borderRadius:'8px',padding:'10px',marginBottom:'8px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
                    <div style={{fontSize:'13px',fontWeight:'600'}}>{z.label} <span style={{fontSize:'11px',color:'#9CA3AF'}}>({z.w}x{z.h})</span></div>
                    <button onClick={function(){delV(z.id);}} style={{...btn,padding:'3px 8px',fontSize:'12px',color:'#9B1C1C',borderColor:'#FDE8E8'}}>Remove</button>
                  </div>
                  <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                    <select value={z.style} onChange={function(e){setVField(z.id,'style',e.target.value);}} style={{...sel,padding:'4px 7px',fontSize:'12px'}}>{V_STYLES.map(function(o){return <option key={o[0]} value={o[0]}>{o[1]}</option>;})}</select>
                    <span style={{fontSize:'11px',color:'#6B7280'}}>from</span>
                    <input type="number" step="0.1" value={z.startTime} onChange={function(e){setVField(z.id,'startTime',clampT(e.target.value));}} style={num}/>
                    <span style={{fontSize:'11px',color:'#6B7280'}}>to</span>
                    <input type="number" step="0.1" value={z.endTime} onChange={function(e){setVField(z.id,'endTime',clampT(e.target.value));}} style={num}/>
                    <span style={{fontSize:'11px',color:'#6B7280'}}>s</span>
                  </div>
                </div>
              );})
            }
          </div>

          <div style={card}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
              <div style={{fontSize:'14px',fontWeight:'700'}}>Audio redactions ({aReds.length})</div>
              <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                <select value={aStyle} onChange={function(e){setAStyle(e.target.value);}} style={{...sel,padding:'4px 7px',fontSize:'12px'}}>{A_STYLES.map(function(o){return <option key={o[0]} value={o[0]}>{o[1]}</option>;})}</select>
                <button onClick={addAudio} style={{...btn,padding:'5px 10px',fontSize:'12px'}}>Add at {fmt(currentTime)}</button>
              </div>
            </div>
            {aReds.length===0 ? <div style={{fontSize:'13px',color:'#9CA3AF'}}>None. Add a window at the current time.</div> :
              aReds.map(function(z){ return (
                <div key={z.id} style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap',border:'1px solid #F3F4F6',borderRadius:'8px',padding:'8px',marginBottom:'6px'}}>
                  <select value={z.style} onChange={function(e){setAField(z.id,'style',e.target.value);}} style={{...sel,padding:'4px 7px',fontSize:'12px'}}>{A_STYLES.map(function(o){return <option key={o[0]} value={o[0]}>{o[1]}</option>;})}</select>
                  <input type="number" step="0.1" value={z.startTime} onChange={function(e){setAField(z.id,'startTime',clampT(e.target.value));}} style={num}/>
                  <span style={{fontSize:'11px',color:'#6B7280'}}>to</span>
                  <input type="number" step="0.1" value={z.endTime} onChange={function(e){setAField(z.id,'endTime',clampT(e.target.value));}} style={num}/>
                  <button onClick={function(){delA(z.id);}} style={{...btn,padding:'3px 8px',fontSize:'12px',color:'#9B1C1C',borderColor:'#FDE8E8',marginLeft:'auto'}}>Remove</button>
                </div>
              );})
            }
          </div>

          <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
            <button onClick={applyNow} disabled={busy} style={{...btnPri,opacity:busy?0.6:1}}>{busy?'Applying redaction...':'Apply redaction'}</button>
            <button onClick={exportPlan} style={btn}>Export plan</button>
          </div>
          <div style={{fontSize:'11px',color:'#9CA3AF',marginTop:'10px',lineHeight:'1.5'}}>Applying creates a redacted copy on the request and keeps the original. "Keep visible" removes a detected face from redaction (e.g. an officer).</div>
        </div>
      </div>
      )}
    </div>
  );
}
