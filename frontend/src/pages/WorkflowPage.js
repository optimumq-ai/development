import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { STAGE_LABELS } from '../lib/stages';

var NAVY = '#1F4E79';
// Was a PRIVATE 4-stage label map — the same divergent-vocabulary defect verify_stages exists to prevent,
// simply on a page its private-copy check did not cover (it does now). It also named `fee_review`, which was
// deleted from the vocabulary on 2026-07-19 because nothing could ever set it. Uses the shared vocabulary,
// so a rule routing to any real stage renders its real label.
var STAGE_LABEL = STAGE_LABELS;
var OP_LABEL = { gte:'at least', gt:'over', lte:'at most', lt:'below', eq:'is', neq:'is not', in:'is in', contains:'contains', contains_any:'is any of', is_true:'is set', is_false:'is not set' };

function fieldLabel(f){ return (f||'').replace(/_/g,' '); }
function condText(c){
  var v = Array.isArray(c.value) ? c.value.join(', ') : c.value;
  if (c.op==='is_true'||c.op==='is_false') return fieldLabel(c.field)+' '+(OP_LABEL[c.op]||c.op);
  return fieldLabel(c.field)+' '+(OP_LABEL[c.op]||c.op)+' '+v;
}
function teamLabel(t){ return t==='matched'?'the matched team':(t==='open_records'?'Open Records':(t||'-')); }
function btn(disabled){ return {padding:'9px 18px',borderRadius:'8px',border:'none',background:disabled?'#9CA3AF':NAVY,color:'white',fontSize:'13px',fontWeight:'600',cursor:disabled?'default':'pointer'}; }
var btnGhost = {padding:'9px 16px',borderRadius:'8px',border:'1px solid #E5E7EB',background:'white',color:'#6B7280',fontSize:'13px',fontWeight:'600',cursor:'pointer'};
function chip(bg,color){ return {display:'inline-block',background:bg,color:color,fontSize:'10px',fontWeight:'700',padding:'2px 7px',borderRadius:'20px',marginLeft:'6px',verticalAlign:'middle'}; }

export default function WorkflowPage(){
  var [rules,setRules]=useState([]);
  var [loading,setLoading]=useState(true);
  var [text,setText]=useState('');
  var [drafting,setDrafting]=useState(false);
  var [draft,setDraft]=useState(null);
  var [err,setErr]=useState('');
  var [saving,setSaving]=useState(false);

  useEffect(function(){ load(); },[]);
  async function load(){ setLoading(true); try{ var r=await api.get('/workflow/rules'); setRules(r.data.rules||[]); }catch(e){} setLoading(false); }

  async function doDraft(){
    if(!text.trim()) return;
    setDrafting(true); setErr(''); setDraft(null);
    try{ var r=await api.post('/workflow/rules/draft',{text:text.trim()}); setDraft(r.data.draft); }
    catch(e){ setErr((e.response&&e.response.data&&e.response.data.error)||'Could not draft the rule'); }
    setDrafting(false);
  }
  async function saveDraft(){
    if(!draft) return;
    setSaving(true); setErr('');
    try{
      await api.post('/workflow/rules',{ name:draft.name, description:draft.description, conditions:draft.conditions||[], actions:draft.actions||{}, priority:draft.priority||50, source:'ai-authored' });
      setDraft(null); setText(''); await load();
    }catch(e){ setErr('Failed to save rule'); }
    setSaving(false);
  }
  async function toggle(rule){ try{ await api.patch('/workflow/rules/'+rule.id,{enabled:rule.enabled?0:1}); await load(); }catch(e){} }
  async function setPriority(rule,val){ var n=parseInt(val,10); if(isNaN(n))return; try{ await api.patch('/workflow/rules/'+rule.id,{priority:n}); await load(); }catch(e){} }
  async function del(rule){ if(!window.confirm('Delete rule "'+rule.name+'"?'))return; try{ await api.delete('/workflow/rules/'+rule.id); await load(); }catch(e){} }

  return (
    <div style={{maxWidth:'1000px',margin:'0 auto',padding:'24px'}}>
      <h1 style={{fontSize:'22px',fontWeight:'700',color:'#111',margin:'0 0 4px'}}>Workflow Rules</h1>
      <p style={{fontSize:'14px',color:'#6B7280',margin:'0 0 20px',lineHeight:'1.6'}}>The AI reads each incoming request and matches it to a record type. These rules then decide &mdash; in priority order, top to bottom, first match wins &mdash; where the request goes. The same inputs always produce the same routing, and every decision is recorded on the request's Routing tab.</p>

      <div style={{background:'white',border:'1px solid #DBEAFE',borderRadius:'12px',padding:'18px 20px',marginBottom:'20px'}}>
        <div style={{fontSize:'14px',fontWeight:'700',color:NAVY,marginBottom:'8px'}}>Add a rule in plain English</div>
        <textarea value={text} onChange={function(e){setText(e.target.value);}} rows={3}
          placeholder='e.g. "If a request is a multi-record request, keep it at intake so a coordinator can split it first, even if the match is confident."'
          style={{width:'100%',padding:'10px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',fontFamily:'inherit',lineHeight:'1.5',resize:'vertical',boxSizing:'border-box',outline:'none'}}/>
        <div style={{display:'flex',gap:'8px',marginTop:'10px'}}>
          <button onClick={doDraft} disabled={drafting||!text.trim()} style={btn(drafting||!text.trim())}>{drafting?'Drafting...':'Draft with AI'}</button>
        </div>
        {err&&<div style={{fontSize:'13px',color:'#9B1C1C',marginTop:'10px'}}>{err}</div>}
        {draft&&(
          <div style={{marginTop:'14px',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'14px',background:'#F8FAFF'}}>
            <div style={{fontSize:'13px',fontWeight:'700',color:'#111'}}>{draft.name}</div>
            <div style={{fontSize:'13px',color:'#374151',margin:'4px 0 10px',lineHeight:'1.5'}}>{draft.description}</div>
            <div style={{fontSize:'12px',color:'#6B7280'}}><b>When:</b> {(draft.conditions||[]).length? (draft.conditions||[]).map(condText).join('  AND  ') : 'always (catch-all)'}</div>
            <div style={{fontSize:'12px',color:'#6B7280',marginTop:'4px'}}><b>Then:</b> route to {STAGE_LABEL[draft.actions&&draft.actions.stage]||(draft.actions&&draft.actions.stage)||'-'} at {teamLabel(draft.actions&&draft.actions.team)}</div>
            {(draft.warnings&&draft.warnings.length>0)&&<div style={{fontSize:'12px',color:'#92400E',background:'#FEF3C7',borderRadius:'8px',padding:'8px 10px',marginTop:'10px'}}>{draft.warnings.map(function(w,i){return <div key={i}>&ndash; {w}</div>;})}</div>}
            <div style={{display:'flex',gap:'8px',marginTop:'12px'}}>
              <button onClick={saveDraft} disabled={saving} style={btn(saving)}>{saving?'Saving...':'Save rule'}</button>
              <button onClick={function(){setDraft(null);}} style={btnGhost}>Discard</button>
            </div>
          </div>
        )}
      </div>

      {loading? <div style={{color:'#9CA3AF'}}>Loading...</div> : (
        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          {rules.map(function(r){
            return (
              <div key={r.id} style={{background:'white',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'14px 16px',opacity:r.enabled?1:0.6}}>
                <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                  <input type="number" defaultValue={r.priority} onBlur={function(e){ if(Number(e.target.value)!==r.priority) setPriority(r,e.target.value); }} title="Priority (lower runs first)"
                    style={{width:'56px',padding:'4px 6px',border:'1px solid #E5E7EB',borderRadius:'6px',fontSize:'13px',textAlign:'center'}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:'14px',fontWeight:'700',color:'#111'}}>{r.name}{r.source==='seed'&&<span style={chip('#EFF6FF',NAVY)}>built-in</span>}{r.source==='ai-authored'&&<span style={chip('#F3E8FF','#6D28D9')}>AI-authored</span>}</div>
                    {r.description&&<div style={{fontSize:'12px',color:'#6B7280',marginTop:'2px',lineHeight:'1.5'}}>{r.description}</div>}
                  </div>
                  <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'#6B7280',cursor:'pointer'}}>
                    <input type="checkbox" checked={!!r.enabled} onChange={function(){toggle(r);}}/> {r.enabled?'On':'Off'}
                  </label>
                  <button onClick={function(){del(r);}} style={{padding:'4px 10px',background:'white',color:'#9B1C1C',border:'1px solid #FCA5A5',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>Delete</button>
                </div>
                <div style={{fontSize:'12px',color:'#6B7280',marginTop:'10px',paddingTop:'10px',borderTop:'1px solid #F3F4F6',lineHeight:'1.7'}}>
                  <span style={{fontWeight:'700'}}>When:</span> {(r.conditions||[]).length? (r.conditions||[]).map(condText).join('  AND  ') : 'always (catch-all)'}<br/>
                  <span style={{fontWeight:'700'}}>Then:</span> route to {STAGE_LABEL[r.actions&&r.actions.stage]||(r.actions&&r.actions.stage)||'-'} at {teamLabel(r.actions&&r.actions.team)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
