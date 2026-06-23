import React, { useState, useEffect, useRef } from 'react';
import api from '../lib/api';

function chip(bg, color){ return { display:'inline-block', background:bg, color:color, fontSize:'10px', fontWeight:'700', padding:'2px 8px', borderRadius:'20px' }; }
var CARD = { background:'white', border:'1px solid #E5E7EB', borderRadius:'12px', boxShadow:'0 1px 2px rgba(0,0,0,0.04)' };
var DECIDER_EXPLAIN = {
  ai: "An AI step - the system reads the request and proposes an answer.",
  code: "An automated step - the software applies a fixed rule to the request's data and computes the answer, with no human or AI judgment.",
  human: "A human step - a person makes this judgment call; the software records and enforces it but does not decide it.",
  policy: "A policy step - the answer comes from a setting your agency configures once, rather than a per-request decision.",
  hybrid: "A combined step - an AI proposes the answer and a person confirms it."
};

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
    var m = sim.match || {}, sg = sim.signals || {}, rl = sim.rule, as = sim.assess;
    var conf = (m.confidence != null) ? m.confidence : 0;
    var hasF = sg.flags && sg.flags.length;
    switch (nodeId){
      case 'verify-email': return { idx: sg.emailVerified ? 0 : 1,
        rule: ['Requestor email confirmed as valid before delivery'],
        values: [{ k:'Email verified', v: sg.emailVerified ? 'Yes' : 'No' }],
        verdict: sg.emailVerified ? 'Verified - the request proceeds.' : 'Not verified - staff should reach out to confirm a valid email.' };
      case 'classify-type': return { idx: conf >= 70 ? 0 : 1,
        rule: ['Semantic + AI match of the request against the taxonomy', 'Returns a record type with a 0-100 confidence score'],
        values: [{ k:'Matched type', v: m.recordTypeName || 'none' }, { k:'Confidence', v: conf + '%' }],
        verdict: conf >= 70 ? 'Confident match.' : 'No confident match.' };
      case 'sensitivity': return { idx: hasF ? 0 : 1,
        rule: ['Any sensitivity flag present (legal hold, open investigation, sealed, etc.)'],
        values: [{ k:'Flags found', v: hasF ? sg.flags.join(', ') : 'None' }],
        verdict: hasF ? 'Sensitive - diverts for special handling.' : 'No flags - normal handling.' };
      case 'dept-confidence': return { idx: conf >= 70 ? 0 : 1,
        rule: ['AI proposes a department', 'Code applies the 70% confidence threshold'],
        values: [{ k:'Confidence', v: conf + '%' }],
        verdict: conf >= 70 ? 'Confident enough to auto-assign.' : 'Not confident - needs a person.' };
      case 'route-sensitive': var sf = rl && rl.id === 'wfr-sensitive'; return { idx: sf ? 0 : 1,
        rule: ['Rule: flags contains LEGAL_HOLD / ONGOING_INVESTIGATION / SENSITIVE'],
        values: [{ k:'Rule that fired', v: (rl && rl.name) || 'none' }],
        verdict: sf ? 'Sensitivity rule fired - held at Intake.' : 'No sensitivity hold.' };
      case 'route-confident':
        var cf = rl && rl.id === 'wfr-confident'; var sens = rl && rl.id === 'wfr-sensitive';
        var rcVals = [{ k:'Confidence', v: conf + '%' }, { k:'Has owning team', v: sg.hasOwnerTeam ? 'Yes' : 'No' }];
        if (hasF) rcVals.push({ k:'Sensitivity flags', v: sg.flags.join(', ') });
        return { idx: cf ? 0 : 1,
          rule: ['Rule: confidence >= 70 AND a team is known', 'A sensitivity flag, if present, takes priority and holds the request'],
          values: rcVals,
          verdict: cf ? ('Assigned to ' + (sim.routedTeam || 'the owning team') + '.') : (sens ? 'A sensitivity flag took priority - held at Open Records for special handling.' : 'Cannot confidently assign a team - goes to Open Records for manual assignment.') };
      case 'fee-waiver-requested': return { idx: sg.feeWaiver ? 0 : 1,
        rule: ['Requestor asked for the fees to be waived'],
        values: [{ k:'Fee waiver requested', v: sg.feeWaiver ? 'Yes' : 'No' }],
        verdict: sg.feeWaiver ? 'Waiver requested - goes to the waiver decision.' : 'No waiver - goes to the estimate.' };
      case 'estimate-auto-manual': var auto = as && as.decision === 'automated'; return { idx: auto ? 0 : 1,
        rule: ['Does the matched record type have a reliable estimation profile?', 'Is the request within normal size and dollar bounds?'],
        values: as ? [{ k:'Decision', v: as.decision }, { k:'Basis', v: as.basis || '-' }].concat(as.estimatedTotal != null ? [{ k:'Estimated total', v: '$' + Number(as.estimatedTotal).toFixed(2) }] : []) : [{ k:'Note', v: 'no record type to estimate' }],
        verdict: auto ? 'Auto-estimated from the profile.' : 'Needs a human estimate.' };
      default: return null;
    }
  }

  var node = current ? model.nodes[current] : null;
  var dInfo = node ? (D[node.decider] || {}) : {};
  var res = node ? resolve(node.id) : null;
  var outs = node ? defaultOuts(node) : [];
  var timeNode = node && node.trigger === 'time';
  var takenIdx = res && res.idx != null ? res.idx : 0;
  if (takenIdx >= outs.length) takenIdx = 0;
  var leftRule = (res && res.rule) ? res.rule : (node && node.criteria ? node.criteria : []);
  var rightVals = (res && res.values) ? res.values : null;
  var illustrative = node && !res;

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
            {DECIDER_EXPLAIN[node.decider] ? <div style={{ fontSize:'12px', color:'#6B7280', fontStyle:'italic', marginBottom:'10px', lineHeight:'1.5' }}>{DECIDER_EXPLAIN[node.decider]}</div> : null}
            <div style={{ fontSize:'18px', fontWeight:'700', color:'#111', marginBottom:'8px', lineHeight:'1.4' }}>{node.label}</div>
            {node.description ? <div style={{ fontSize:'14px', color:'#374151', lineHeight:'1.6', marginBottom:'14px' }}>{node.description}</div> : null}
            {(leftRule.length || rightVals) ? (
              <div style={{ display:'flex', gap:'16px', flexWrap:'wrap', marginBottom:'14px', background:'#F9FAFB', border:'1px solid #F3F4F6', borderRadius:'10px', padding:'12px 14px' }}>
                <div style={{ flex:'1 1 240px', minWidth:'200px' }}>
                  <div style={{ fontSize:'11px', fontWeight:'700', color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'6px' }}>What it checks</div>
                  {leftRule.length ? leftRule.map(function(c, ci){ return <div key={ci} style={{ fontSize:'13px', color:'#374151', lineHeight:'1.55' }}>&middot; {c}</div>; }) : <div style={{ fontSize:'13px', color:'#9CA3AF' }}>&mdash;</div>}
                </div>
                {rightVals ? (
                  <div style={{ flex:'1 1 200px', minWidth:'180px', borderLeft:'1px solid #E5E7EB', paddingLeft:'16px' }}>
                    <div style={{ fontSize:'11px', fontWeight:'700', color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'6px' }}>This request</div>
                    {rightVals.map(function(pv, vi){ return <div key={vi} style={{ fontSize:'13px', color:'#374151', lineHeight:'1.55' }}>{pv.k}: <b style={{ color:'#111' }}>{pv.v}</b></div>; })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {res && res.verdict ? <div style={{ fontSize:'13px', color:'#1F4E79', fontWeight:'600', marginBottom:'12px', lineHeight:'1.5' }}>{res.verdict}</div> : null}
            {illustrative ? <div style={{ fontSize:'12px', color:'#92400E', background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:'8px', padding:'8px 11px', marginBottom:'12px', lineHeight:'1.5' }}>This step is not built yet, so there is no live computation. The highlighted path below is the typical one, shown to illustrate the flow.</div> : null}
            <div style={{ fontSize:'11px', fontWeight:'700', color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'8px' }}>{outs.length > 1 ? 'Possible paths' : 'Next'}</div>
            <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginBottom:'16px' }}>
              {outs.map(function(o, oi){
                var taken = oi === takenIdx;
                return (
                  <div key={oi} style={{ flex: outs.length === 2 ? '1 1 44%' : '1 1 100%', minWidth:'200px', border:'1.5px solid ' + (taken ? '#1F4E79' : '#E5E7EB'), background: taken ? '#F8FAFF' : '#FCFCFD', borderRadius:'10px', padding:'12px 13px', opacity: taken ? 1 : 0.65 }}>
                    <div style={{ fontSize:'10px', fontWeight:'700', letterSpacing:'.05em', marginBottom:'4px', color: taken ? '#1F4E79' : '#9CA3AF' }}>{taken ? (illustrative ? 'PATH SHOWN' : 'SYSTEM PATH') : 'NOT TAKEN'}</div>
                    <div style={{ fontSize:'13px', color: taken ? '#111' : '#6B7280', fontWeight: taken ? '600' : '500', lineHeight:'1.45' }}>{o.label}</div>
                    {o.note ? <div style={{ fontSize:'12px', color:'#6B7280', marginTop:'4px', lineHeight:'1.45' }}>{o.note}</div> : null}
                  </div>
                );
              })}
            </div>
            <button onClick={function(){ choose(node, outs[takenIdx], outs[takenIdx].label); }} style={goBtn}>Continue &rarr;</button>
            {node.automatedBy ? <div style={{ marginTop:'14px', fontSize:'12px', color:'#6B7280', borderTop:'1px solid #F3F4F6', paddingTop:'10px' }}><b style={{ color:'#1F4E79' }}>Configure once:</b> {node.automatedBy}</div> : null}
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
