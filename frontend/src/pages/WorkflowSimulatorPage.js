import React, { useState, useEffect, useRef } from 'react';
import api from '../lib/api';

function chip(bg, color){ return { display:'inline-block', background:bg, color:color, fontSize:'10px', fontWeight:'700', padding:'2px 8px', borderRadius:'20px' }; }
var CARD = { background:'white', border:'1px solid #E5E7EB', borderRadius:'12px', boxShadow:'0 1px 2px rgba(0,0,0,0.04)' };

function Connector(){
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
      <div style={{ width:'2px', height:'22px', background:'#CBD5E1' }} />
      <div style={{ width:0, height:0, borderLeft:'5px solid transparent', borderRight:'5px solid transparent', borderTop:'6px solid #CBD5E1', marginTop:'-1px' }} />
    </div>
  );
}

export default function WorkflowSimulatorPage(){
  var [model, setModel] = useState(null);
  var [desc, setDesc] = useState('I need the body-worn camera footage from the traffic stop on Main St last Tuesday.');
  var [feeWaiver, setFeeWaiver] = useState(false);
  var [sensitive, setSensitive] = useState(false);
  var [verifyEmail, setVerifyEmail] = useState(false);
  var [sim, setSim] = useState(null);
  var [starting, setStarting] = useState(false);
  var [current, setCurrent] = useState(null);
  var [trail, setTrail] = useState([]);
  var [done, setDone] = useState(null);
  var activeRef = useRef(null);

  useEffect(function(){ api.get('/workflow-model').then(function(r){ setModel(r.data); }).catch(function(){}); }, []);
  useEffect(function(){ if (activeRef.current) activeRef.current.scrollIntoView({ behavior:'smooth', block:'center' }); }, [current, done]);

  if (!model) return <div style={{ padding:'24px', color:'#9CA3AF' }}>Loading simulator...</div>;
  var D = model.legend.deciders, S = model.legend.statuses;
  var happyOrder = Object.keys(model.nodes).filter(function(k){ var ph = model.nodes[k].phase; return ph !== 'stalls' && ph !== 'cross'; });

  function isTerminal(id){ return id && id.indexOf('t-') === 0; }
  function terminal(id){ return model.terminalStates.filter(function(t){ return t.id === id; })[0]; }
  function nextFrom(nodeId, outcome){
    if (outcome && outcome.to) return outcome.to;
    var i = happyOrder.indexOf(nodeId);
    if (i >= 0 && i + 1 < happyOrder.length) return happyOrder[i + 1];
    return null;
  }
  function defaultOuts(node){
    if (node.outcomes && node.outcomes.length) return node.outcomes;
    if (/^(Is|Does|Has|Have|Can|Are|Should|Was|Were|Do|Did)\b/i.test((node.label || '').trim())) return [{ label:'Yes' }, { label:'No' }];
    return [{ label:'Continue' }];
  }

  async function start(){
    setStarting(true); setDone(null); setTrail([]); setCurrent(null);
    try {
      var r = await api.post('/workflow-model/simulate', { description: desc, feeWaiver: feeWaiver, sensitive: sensitive, verifyEmail: verifyEmail });
      setSim(r.data); setCurrent(happyOrder[0]);
    } catch (e) { setSim({ error: (e.response && e.response.data && e.response.data.error) || 'Simulation failed' }); }
    setStarting(false);
  }
  function restart(){ setSim(null); setCurrent(null); setTrail([]); setDone(null); }
  function rewind(i){ var n = trail[i]; setTrail(trail.slice(0, i)); setCurrent(n.nodeId); setDone(null); }
  function choose(node, outcome, label){
    setTrail(trail.concat([{ nodeId: node.id, label: node.label, outcome: label, decider: node.decider }]));
    var nx = nextFrom(node.id, outcome);
    if (nx && isTerminal(nx)) { setDone(terminal(nx) || { name: nx, notice: '' }); setCurrent(null); }
    else if (nx) { setCurrent(nx); }
    else { setDone({ name: 'End of the modeled path', notice: 'Further steps for this branch are not yet modeled.' }); setCurrent(null); }
  }

  function resolve(nodeId){
    if (!sim || sim.error) return null;
    var m = sim.match, sg = sim.signals, rl = sim.rule, as = sim.assess;
    switch (nodeId){
      case 'verify-email': return { idx: sg.emailVerified ? 0 : 1, banner: sg.emailVerified ? 'You marked the email as verified on the start screen.' : 'Email not marked verified - the request would wait on verification.' };
      case 'classify-type': return { idx: m.confidence >= 70 ? 0 : 1, banner: 'AI matched "' + (m.recordTypeName || 'no type') + '" at ' + m.confidence + '% confidence.' };
      case 'sensitivity': return { idx: (sg.flags && sg.flags.length) ? 0 : 1, banner: (sg.flags && sg.flags.length) ? ('Flags detected: ' + sg.flags.join(', ') + '.') : 'No sensitivity flags.' };
      case 'dept-confidence': return { idx: m.confidence >= 70 ? 0 : 1, banner: 'Match confidence ' + m.confidence + '%.' };
      case 'route-sensitive': return { idx: rl && rl.id === 'wfr-sensitive' ? 0 : 1, banner: 'Rule that fired: ' + ((rl && rl.name) || 'none') + '.' };
      case 'route-confident': return { idx: rl && rl.id === 'wfr-confident' ? 0 : 1, banner: rl && rl.id === 'wfr-confident' ? ('Routed to ' + (sim.routedTeam || 'the owning team') + '.') : 'The confident-match rule did not fire.' };
      case 'route-uncertain': return { idx: rl && rl.id === 'wfr-uncertain' ? 0 : null, banner: rl && rl.id === 'wfr-uncertain' ? 'Low confidence - sent to Open Records.' : 'This rule did not fire here.' };
      case 'fee-waiver-requested': return { idx: sg.feeWaiver ? 0 : 1, banner: sg.feeWaiver ? 'A fee waiver was requested.' : 'No fee waiver requested.' };
      case 'estimate-auto-manual': return { idx: (as && as.decision === 'automated') ? 0 : 1, banner: as ? (as.decision === 'automated' ? ('Auto-estimated' + (as.basis ? ' (' + as.basis + ')' : '') + (as.estimatedTotal != null ? ' ~$' + Number(as.estimatedTotal).toFixed(2) : '') + '.') : 'Needs a human estimate - no reliable profile for this type yet.') : 'No record type to estimate.' };
      default: return null;
    }
  }

  var node = current ? model.nodes[current] : null;
  var dInfo = node ? (D[node.decider] || {}) : {};
  var res = node ? resolve(node.id) : null;
  var outs = node ? defaultOuts(node) : [];
  var timeNode = node && node.trigger === 'time';

  var inp = { width:'100%', padding:'10px 12px', border:'1px solid #E5E7EB', borderRadius:'8px', fontSize:'14px', fontFamily:'inherit', lineHeight:'1.5', boxSizing:'border-box', outline:'none', resize:'vertical' };
  var goBtn = { padding:'9px 18px', borderRadius:'8px', border:'none', background:'#1F4E79', color:'white', fontSize:'14px', fontWeight:'600', cursor:'pointer' };

  return (
    <div style={{ maxWidth:'700px', margin:'0 auto', padding:'24px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'18px' }}>
        <h1 style={{ fontSize:'20px', fontWeight:'700', color:'#111', margin:0 }}>Request Simulator</h1>
        {sim ? <button onClick={restart} style={{ padding:'6px 14px', borderRadius:'7px', border:'1px solid #E5E7EB', background:'white', color:'#6B7280', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>New request</button> : null}
      </div>

      <div style={{ background:'white', border:'2px solid #1F4E79', borderRadius:'12px', padding:'16px 18px' }}>
        <div style={{ fontSize:'11px', fontWeight:'700', color:'#1F4E79', letterSpacing:'.06em', marginBottom:'8px' }}>REQUEST</div>
        {!sim ? (
          <div>
            <textarea value={desc} onChange={function(e){ setDesc(e.target.value); }} rows={3} placeholder="Describe a hypothetical public records request..." style={inp} />
            <div style={{ margin:'10px 0 12px' }}>
              <div style={{ fontSize:'11px', fontWeight:'700', color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'8px' }}>Optional inputs &middot; reflected later in the walk</div>
              <div style={{ display:'flex', gap:'18px', flexWrap:'wrap' }}>
                <label style={{ fontSize:'13px', color:'#374151', display:'flex', alignItems:'center', gap:'6px', cursor:'pointer' }}><input type="checkbox" checked={verifyEmail} onChange={function(e){ setVerifyEmail(e.target.checked); }} /> Email address verified</label>
                <label style={{ fontSize:'13px', color:'#374151', display:'flex', alignItems:'center', gap:'6px', cursor:'pointer' }}><input type="checkbox" checked={feeWaiver} onChange={function(e){ setFeeWaiver(e.target.checked); }} /> Fee waiver requested</label>
                <label style={{ fontSize:'13px', color:'#374151', display:'flex', alignItems:'center', gap:'6px', cursor:'pointer' }}><input type="checkbox" checked={sensitive} onChange={function(e){ setSensitive(e.target.checked); }} /> Mark sensitive</label>
              </div>
              <div style={{ fontSize:'12px', color:'#374151', background:'#F8FAFF', border:'1px solid #DBEAFE', borderRadius:'8px', padding:'9px 11px', marginTop:'10px', lineHeight:'1.5' }}>These checkboxes have <b>no immediate effect</b>. Each one is simply carried into the simulation and surfaces at its matching decision later - email verification, the fee-waiver branch, and the sensitivity check. Leave one unchecked to walk the opposite path.</div>
            </div>
            <button onClick={start} disabled={starting || !desc.trim()} style={Object.assign({}, goBtn, { opacity: (starting || !desc.trim()) ? 0.6 : 1 })}>{starting ? 'Classifying...' : 'Start walk'}</button>
            <div style={{ fontSize:'12px', color:'#9CA3AF', marginTop:'10px', lineHeight:'1.5' }}>The built decisions run for real - the AI classifies the text, the routing rules fire, and the estimate is assessed - so the path reflects how this request would actually be handled. Click any earlier step to go back and try a different answer.</div>
          </div>
        ) : (
          <div style={{ fontSize:'14px', color:'#374151', lineHeight:'1.5' }}>&ldquo;{desc}&rdquo;</div>
        )}
      </div>

      {sim && sim.error ? <div style={{ color:'#9B1C1C', fontSize:'14px', marginTop:'12px' }}>{sim.error}</div> : null}

      {sim && !sim.error ? trail.map(function(step, i){
        var sc = D[step.decider] || {};
        return (
          <div key={i}>
            <Connector />
            <div onClick={function(){ rewind(i); }} title="Click to go back to this step" style={Object.assign({}, CARD, { padding:'12px 14px', display:'flex', alignItems:'center', gap:'10px', cursor:'pointer' })}>
              <span style={{ width:'10px', height:'10px', borderRadius:'50%', background: sc.color || '#999', flexShrink:0 }} />
              <span style={{ flex:1, fontSize:'13px', color:'#374151' }}>{step.label}</span>
              <span style={{ fontSize:'12px', fontWeight:'700', color:'#1F4E79', background:'#EFF6FF', borderRadius:'20px', padding:'3px 10px', whiteSpace:'nowrap', maxWidth:'45%', overflow:'hidden', textOverflow:'ellipsis' }}>{step.outcome}</span>
              <span style={{ color:'#9CA3AF', fontSize:'14px' }}>&#8617;</span>
            </div>
          </div>
        );
      }) : null}

      {sim && !sim.error && node ? (
        <div>
          <Connector />
          <div ref={activeRef} style={{ background:'white', border:'2px solid #1F4E79', borderLeft:'5px solid ' + (dInfo.color || '#1F4E79'), borderRadius:'12px', padding:'18px 20px', boxShadow:'0 4px 14px rgba(31,78,121,0.10)' }}>
            <div style={{ display:'flex', gap:'6px', marginBottom:'8px', flexWrap:'wrap' }}>
              <span style={chip(dInfo.bg, dInfo.color)}>{dInfo.label}</span>
              <span style={chip('#F3F4F6', (S[node.status] || {}).color)}>{(S[node.status] || {}).label}</span>
              {timeNode ? <span style={chip('#FEF3C7', '#92400E')}>&#9201; time-driven</span> : null}
            </div>
            <div style={{ fontSize:'18px', fontWeight:'700', color:'#111', marginBottom:'8px', lineHeight:'1.4' }}>{node.label}</div>
            {node.description ? <div style={{ fontSize:'14px', color:'#374151', lineHeight:'1.6', marginBottom:'12px' }}>{node.description}</div> : null}
            {node.criteria && node.criteria.length ? (
              <div style={{ marginBottom:'12px' }}>
                <div style={{ fontSize:'11px', fontWeight:'700', color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'4px' }}>What it checks</div>
                {node.criteria.map(function(c, i){ return <div key={i} style={{ fontSize:'13px', color:'#374151', lineHeight:'1.5' }}>&middot; {c}</div>; })}
              </div>
            ) : null}
            {res && res.banner ? <div style={{ background:'#EFF6FF', border:'1px solid #DBEAFE', borderRadius:'8px', padding:'9px 12px', fontSize:'13px', color:'#1F4E79', marginBottom:'14px' }}>{res.banner}</div> : null}
            <div style={{ fontSize:'11px', fontWeight:'700', color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'8px' }}>{timeNode ? 'Advance the clock' : 'Choose an answer'}</div>
            {outs.map(function(o, idx){
              var picked = res && res.idx === idx;
              return (
                <div key={idx} onClick={function(){ choose(node, o, o.label); }} style={{ display:'flex', alignItems:'flex-start', gap:'10px', padding:'11px 13px', borderRadius:'9px', border:'1px solid ' + (picked ? '#1F4E79' : '#E5E7EB'), background: picked ? '#F8FAFF' : 'white', cursor:'pointer', marginBottom:'7px' }}>
                  <span style={{ width:'16px', height:'16px', borderRadius:'50%', flexShrink:0, marginTop:'1px', border:'2px solid ' + (picked ? '#1F4E79' : '#CBD5E1'), background: picked ? '#1F4E79' : 'white', boxShadow: picked ? 'inset 0 0 0 2px #fff' : 'none' }} />
                  <div>
                    <div style={{ fontSize:'13px', color:'#111', fontWeight: picked ? '600' : '500', lineHeight:'1.45' }}>{o.label}{picked ? <span style={{ color:'#1F4E79', fontWeight:'700' }}> &middot; what the system does</span> : null}</div>
                    {o.note ? <div style={{ fontSize:'12px', color:'#6B7280', marginTop:'3px', lineHeight:'1.45' }}>{o.note}</div> : null}
                  </div>
                </div>
              );
            })}
            {res ? <div style={{ fontSize:'11px', color:'#9CA3AF', marginTop:'4px' }}>The highlighted answer is what the system does. Pick any option to branch a different way.</div> : null}
            {node.automatedBy ? <div style={{ marginTop:'12px', fontSize:'12px', color:'#6B7280', borderTop:'1px solid #F3F4F6', paddingTop:'10px' }}><b style={{ color:'#1F4E79' }}>Configure once:</b> {node.automatedBy}</div> : null}
          </div>
        </div>
      ) : null}

      {sim && !sim.error && done ? (
        <div>
          <Connector />
          <div ref={activeRef} style={{ background:'#1F4E79', borderRadius:'40px', padding:'18px 24px', textAlign:'center', color:'white' }}>
            <div style={{ fontSize:'11px', fontWeight:'700', opacity:0.8, letterSpacing:'.06em' }}>REQUEST ENDS AS</div>
            <div style={{ fontSize:'20px', fontWeight:'700', margin:'4px 0 6px' }}>{done.name}</div>
            {done.notice ? <div style={{ fontSize:'13px', opacity:0.9, lineHeight:'1.5' }}>{done.notice}</div> : null}
          </div>
          <div style={{ textAlign:'center', marginTop:'16px' }}>
            <button onClick={restart} style={goBtn}>Run another</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
