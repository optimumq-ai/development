import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { STAGE_LABELS as STAGE_LABEL } from '../../lib/stages';


export default function WorkflowDecisionPanel({ requestId }) {
  var [d, setD] = useState(null);
  var [loading, setLoading] = useState(true);

  useEffect(function(){
    var on = true;
    api.get('/workflow/decisions/' + requestId)
      .then(function(r){ if(on){ setD((r.data.decisions||[])[0]||null); setLoading(false); } })
      .catch(function(){ if(on) setLoading(false); });
    return function(){ on = false; };
  }, [requestId]);

  if (loading) return <div style={{fontSize:'13px',color:'#9CA3AF'}}>Loading routing decision...</div>;
  if (!d) return <div style={{fontSize:'13px',color:'#9CA3AF',lineHeight:'1.6'}}>No automated routing decision is recorded for this request. It may have been created before the workflow engine was enabled, or routed manually.</div>;

  var pct = Math.max(0, Math.min(100, Math.round(d.confidence||0)));
  var flags = Array.isArray(d.flags) ? d.flags : [];

  function field(label, value){
    return (
      <div style={{display:'flex',justifyContent:'space-between',gap:'16px',padding:'10px 0',borderBottom:'1px solid #F3F4F6'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#6B7280',textTransform:'uppercase',letterSpacing:'.04em',flexShrink:0}}>{label}</div>
        <div style={{fontSize:'14px',color:'#111',textAlign:'right'}}>{value}</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{fontSize:'15px',fontWeight:'700',color:'#1F4E79',marginBottom:'4px'}}>How this request was routed</div>
      <div style={{fontSize:'12px',color:'#6B7280',marginBottom:'14px'}}>The workflow engine read the request, matched it, applied the rulebook, and recorded the decision below. The same inputs always produce the same routing.</div>

      {field('Rule applied', <span style={{fontWeight:'600'}}>{d.rule_name||'-'}</span>)}
      {field('Matched record type', d.record_type_name || <span style={{color:'#9CA3AF'}}>No confident match</span>)}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'16px',padding:'10px 0',borderBottom:'1px solid #F3F4F6'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#6B7280',textTransform:'uppercase',letterSpacing:'.04em'}}>Match confidence</div>
        <div style={{width:'160px'}}>
          <div style={{height:'6px',background:'#E5E7EB',borderRadius:'3px',overflow:'hidden'}}>
            <div style={{width:pct+'%',height:'100%',background: pct>=70?'#1F4E79':'#D97706'}}></div>
          </div>
          <div style={{fontSize:'11px',color:'#6B7280',textAlign:'right',marginTop:'2px'}}>{pct}%</div>
        </div>
      </div>
      {field('Routed to', <span><span style={{fontWeight:'600'}}>{d.decided_team_name||'(unassigned)'}</span> &middot; {STAGE_LABEL[d.decided_stage]||d.decided_stage}</span>)}
      {flags.length>0 && field('Flags', <span>{flags.map(function(f){ return <span key={f} style={{display:'inline-block',background:'#FEF3C7',color:'#92400E',fontSize:'11px',fontWeight:'700',padding:'2px 8px',borderRadius:'20px',marginLeft:'6px'}}>{f.replace(/_/g,' ')}</span>; })}</span>)}

      <div style={{marginTop:'14px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#6B7280',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:'6px'}}>Why</div>
        <div style={{fontSize:'13px',color:'#374151',lineHeight:'1.6',background:'#F8FAFF',border:'1px solid #DBEAFE',borderRadius:'8px',padding:'12px 14px'}}>{d.reasoning||'-'}</div>
      </div>
    </div>
  );
}
