import React, { useState, useEffect } from 'react';
import api from '../lib/api';

function chip(bg, color){ return { display:'inline-block', background:bg, color:color, fontSize:'10px', fontWeight:'700', padding:'2px 8px', borderRadius:'20px' }; }

export default function WorkflowSimulatorPage(){
  var [model, setModel] = useState(null);
  var [desc, setDesc] = useState('I need the body-worn camera footage from the traffic stop on Main St last Tuesday.');
  var [feeWaiver, setFeeWaiver] = useState(false);
  var [sensitive, setSensitive] = useState(false);
  var [sim, setSim] = useState(null);
  var [starting, setStarting] = useState(false);
  var [current, setCurrent] = useState(null);
  var [trail, setTrail] = useState([]);
  var [done, setDone] = useState(null);

  useEffect(function(){ api.get('/workflow-model').then(function(r){ setModel(r.data); }).catch(function(){}); }, []);
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

  async function start(){
    setStarting(true); setDone(null); setTrail([]); setCurrent(null);
    try {
      var r = await api.post('/workflow-model/simulate', { description: desc, feeWaiver: feeWaiver, sensitive: sensitive });
      setSim(r.data); setCurrent(happyOrder[0]);
    } catch (e) { setSim({ error: (e.response && e.response.data && e.response.data.error) || 'Simulation failed' }); }
    setStarting(false);
  }
  function restart(){ setSim(null); setCurrent(null); setTrail([]); setDone(null); }

  function resolve(nodeId){
    if (!sim || sim.error) return null;
    var m = sim.match, sg = sim.signals, rl = sim.rule, as = sim.assess;
    switch (nodeId){
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

  function choose(node, outcome, label){
    setTrail(trail.concat([{ nodeId: node.id, label: node.label, outcome: label }]));
    var nx = nextFrom(node.id, outcome);
    if (nx && isTerminal(nx)) { setDone(terminal(nx) || { name: nx, notice: '' }); setCurrent(null); }
    else if (nx) { setCurrent(nx); }
    else { setDone({ name: 'End of the modeled path', notice: 'Further steps for this branch are not yet modeled.' }); setCurrent(null); }
  }
  function rewind(i){ var n = trail[i]; setTrail(trail.slice(0, i)); setCurrent(n.nodeId); setDone(null); }

  var inp = { width:'100%', padding:'10px 12px', border:'1px solid #E5E7EB', borderRadius:'8px', fontSize:'14px', fontFamily:'inherit', lineHeight:'1.5', boxSizing:'border-box', outline:'none', resize:'vertical' };
  var btn = { padding:'9px 18px', borderRadius:'8px', border:'none', background:'#1F4E79', color:'white', fontSize:'14px', fontWeight:'600', cursor:'pointer' };

  // ---- start screen ----
  if (!sim) {
    return (
      <div style={{ maxWidth:'760px', margin:'0 auto', padding:'24px' }}>
        <h1 style={{ fontSize:'22px', fontWeight:'700', color:'#111', margin:'0 0 4px' }}>Request Simulator</h1>
        <p style={{ fontSize:'14px', color:'#6B7280', margin:'0 0 18px', lineHeight:'1.6' }}>Walk a hypothetical request through the workflow one decision at a time. The built decisions run for real - the AI actually classifies the text, the routing rules actually fire, and the estimate is really assessed - so you can see exactly how a request would be handled, then backtrack and change an answer to explore a different path.</p>
        <label style={{ fontSize:'13px', fontWeight:'600', color:'#374151' }}>Hypothetical request</label>
        <textarea value={desc} onChange={function(e){ setDesc(e.target.value); }} rows={3} style={Object.assign({ marginTop:'6px', marginBottom:'12px' }, inp)} />
        <div style={{ display:'flex', gap:'18px', marginBottom:'16px' }}>
          <label style={{ fontSize:'13px', color:'#374151', display:'flex', alignItems:'center', gap:'6px', cursor:'pointer' }}><input type="checkbox" checked={feeWaiver} onChange={function(e){ setFeeWaiver(e.target.checked); }} /> Fee waiver requested</label>
          <label style={{ fontSize:'13px', color:'#374151', display:'flex', alignItems:'center', gap:'6px', cursor:'pointer' }}><input type="checkbox" checked={sensitive} onChange={function(e){ setSensitive(e.target.checked); }} /> Mark sensitive</label>
        </div>
        <button onClick={start} disabled={starting || !desc.trim()} style={Object.assign({}, btn, { opacity: (starting || !desc.trim()) ? 0.6 : 1 })}>{starting ? 'Classifying...' : 'Start walk'}</button>
      </div>
    );
  }

  var node = current ? model.nodes[current] : null;
  var res = node ? resolve(node.id) : null;
  var outs = node ? (node.outcomes && node.outcomes.length ? node.outcomes : [{ label:'Continue' }]) : [];
  var timeNode = node && node.trigger === 'time';

  return (
    <div style={{ maxWidth:'860px', margin:'0 auto', padding:'24px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'14px' }}>
        <h1 style={{ fontSize:'20px', fontWeight:'700', color:'#111', margin:0 }}>Request Simulator</h1>
        <button onClick={restart} style={{ padding:'6px 14px', borderRadius:'7px', border:'1px solid #E5E7EB', background:'white', color:'#6B7280', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>New request</button>
      </div>

      {sim.error ? <div style={{ color:'#9B1C1C', fontSize:'14px' }}>{sim.error}</div> : null}

      {trail.length ? (
        <div style={{ background:'#F8FAFF', border:'1px solid #DBEAFE', borderRadius:'10px', padding:'12px 14px', marginBottom:'16px' }}>
          <div style={{ fontSize:'11px', fontWeight:'700', color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'6px' }}>Path so far &middot; click a step to go back and change it</div>
          {trail.map(function(s, i){
            return (
              <div key={i} onClick={function(){ rewind(i); }} style={{ fontSize:'13px', color:'#374151', cursor:'pointer', padding:'3px 0', display:'flex', gap:'8px' }}>
                <span style={{ color:'#9CA3AF' }}>{i + 1}.</span>
                <span style={{ flex:1 }}>{s.label}</span>
                <span style={{ color:'#1F4E79', fontWeight:'600' }}>{s.outcome} &#8617;</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {node ? (
        <div style={{ background:'white', border:'1px solid #E5E7EB', borderRadius:'12px', padding:'20px' }}>
          <div style={{ display:'flex', gap:'6px', marginBottom:'8px', flexWrap:'wrap' }}>
            <span style={chip((D[node.decider]||{}).bg, (D[node.decider]||{}).color)}>{(D[node.decider]||{}).label}</span>
            <span style={chip('#F3F4F6', (S[node.status]||{}).color)}>{(S[node.status]||{}).label}</span>
            {timeNode ? <span style={chip('#FEF3C7','#92400E')}>&#9201; time-driven</span> : null}
          </div>
          <div style={{ fontSize:'18px', fontWeight:'700', color:'#111', marginBottom:'8px', lineHeight:'1.4' }}>{node.label}</div>
          {node.description ? <div style={{ fontSize:'14px', color:'#374151', lineHeight:'1.6', marginBottom:'12px' }}>{node.description}</div> : null}
          {node.criteria && node.criteria.length ? (
            <div style={{ marginBottom:'12px' }}>
              <div style={{ fontSize:'11px', fontWeight:'700', color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'4px' }}>What it checks</div>
              {node.criteria.map(function(c, i){ return <div key={i} style={{ fontSize:'13px', color:'#374151', lineHeight:'1.5' }}>&middot; {c}</div>; })}
            </div>
          ) : null}
          {res && res.banner ? <div style={{ background:'#EFF6FF', border:'1px solid #DBEAFE', borderRadius:'8px', padding:'9px 12px', fontSize:'13px', color:'#1F4E79', marginBottom:'12px' }}>{res.banner}</div> : null}

          <div style={{ fontSize:'11px', fontWeight:'700', color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'7px' }}>{timeNode ? 'Advance the clock' : 'Your answer'}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {outs.map(function(o, idx){
              var picked = res && res.idx === idx;
              return (
                <button key={idx} onClick={function(){ choose(node, o, o.label); }} style={{ textAlign:'left', padding:'10px 14px', borderRadius:'8px', border:'1px solid ' + (picked ? '#1F4E79' : '#E5E7EB'), background: picked ? '#F8FAFF' : 'white', color:'#111', fontSize:'13px', fontWeight: picked ? '600' : '500', cursor:'pointer' }}>
                  {o.label}{picked ? <span style={{ color:'#1F4E79', fontWeight:'700' }}> &middot; what the system does</span> : null}
                </button>
              );
            })}
          </div>
          {node.automatedBy ? <div style={{ marginTop:'12px', fontSize:'12px', color:'#6B7280' }}><b style={{ color:'#1F4E79' }}>Configure once:</b> {node.automatedBy}</div> : null}
        </div>
      ) : done ? (
        <div style={{ background:'white', border:'1px solid #E5E7EB', borderRadius:'12px', padding:'24px', textAlign:'center' }}>
          <div style={{ fontSize:'11px', fontWeight:'700', color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'.04em' }}>Request ends as</div>
          <div style={{ fontSize:'22px', fontWeight:'700', color:'#1F4E79', margin:'6px 0 8px' }}>{done.name}</div>
          {done.notice ? <div style={{ fontSize:'13px', color:'#6B7280' }}>{done.notice}</div> : null}
          <button onClick={restart} style={Object.assign({ marginTop:'18px' }, btn)}>Run another</button>
        </div>
      ) : null}
    </div>
  );
}
