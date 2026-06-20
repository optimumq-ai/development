import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';

var V_TYPES = [['face','Face'],['plate','License plate'],['manual','Manual area']];
var V_STYLES = [['black','Black box'],['pixel','Pixelate'],['mosaic','Mosaic']];
var A_STYLES = [['silence','Silence'],['tone','Tone (beep)'],['noise','Noise']];

function fmt(s){ s=s||0; var m=Math.floor(s/60); var sec=(s%60); return m+':'+(sec<10?'0':'')+sec.toFixed(1); }
function rid(){ return 'z'+Math.random().toString(36).slice(2,9); }

export default function AvWorkbenchPage(){
  var params = useParams();
  var requestId = params.requestId, fileId = params.fileId;
  var navigate = useNavigate();
  var videoRef = useRef(null);
  var canvasRef = useRef(null);
  var draw = useRef({active:false,sx:0,sy:0,cx:0,cy:0});

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
          ctx.strokeStyle = active?'#16A34A':'rgba(140,140,140,0.7)';
          ctx.strokeRect(z.x,z.y,z.w,z.h);
          ctx.fillStyle = active?'#16A34A':'rgba(140,140,140,0.9)';
          ctx.font='bold '+Math.max(12,c.width/55)+'px sans-serif';
          ctx.fillText(z.label||z.type, z.x+3, Math.max(14,z.y-4));
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
  function addAudio(){ var v=videoRef.current; var t=v?v.currentTime:0; var dur=v?v.duration:0; setAReds(function(p){return p.concat([{id:rid(),startTime:+t.toFixed(3),endTime:+Math.min(dur,t+3).toFixed(3),style:aStyle}]);}); }
  function delA(id){ setAReds(function(p){return p.filter(function(z){return z.id!==id;});}); }
  function setAField(id,field,val){ setAReds(function(p){return p.map(function(z){ if(z.id!==id) return z; var o=Object.assign({},z); o[field]=val; return o; });}); }

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
    if(!window.confirm('Apply '+vReds.length+' video and '+aReds.length+' audio redaction(s)? This creates a redacted copy; the original is kept.')) return;
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
          <div style={{...card,marginTop:'12px'}}>
            <div style={{display:'flex',gap:'14px',alignItems:'flex-end',flexWrap:'wrap'}}>
              <div><div style={lbl}>Type</div><select value={vType} onChange={function(e){setVType(e.target.value);}} style={sel}>{V_TYPES.map(function(o){return <option key={o[0]} value={o[0]}>{o[1]}</option>;})}</select></div>
              <div><div style={lbl}>Style</div><select value={vStyle} onChange={function(e){setVStyle(e.target.value);}} style={sel}>{V_STYLES.map(function(o){return <option key={o[0]} value={o[0]}>{o[1]}</option>;})}</select></div>
              <div style={{fontSize:'12px',color:'#6B7280',paddingBottom:'8px'}}>Click and drag on the video to draw a box.</div>
            </div>
          </div>
        </div>

        <div style={{flex:'1 1 380px',minWidth:'300px'}}>
          <div style={card}>
            <div style={{fontSize:'14px',fontWeight:'700',marginBottom:'10px'}}>Video redactions ({vReds.length})</div>
            {vReds.length===0 ? <div style={{fontSize:'13px',color:'#9CA3AF'}}>None yet. Draw a box on the video.</div> :
              vReds.map(function(z){ return (
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
          <div style={{fontSize:'11px',color:'#9CA3AF',marginTop:'10px',lineHeight:'1.5'}}>Applying creates a redacted copy on the request and keeps the original. Boxes are stored in the video's native pixels.</div>
        </div>
      </div>
      )}
    </div>
  );
}
