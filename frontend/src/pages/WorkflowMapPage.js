import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import SetupScreen from '../components/setup/SetupScreen';

// PROCESS MAP — the hub's `process_map` row (C15, Kevin 2026-08-30: the admin Process Map tab becomes this
// dedicated screen at /setup/process-map, on the shared SetupScreen strip). Body unchanged.

function chip(bg, color){ return { display:'inline-block', background:bg, color:color, fontSize:'10px', fontWeight:'700', padding:'2px 7px', borderRadius:'20px' }; }

export default function WorkflowMapPage(){
  var [model, setModel] = useState(null);
  var [sel, setSel] = useState(null);
  useEffect(function(){ api.get('/workflow-model').then(function(r){ setModel(r.data); }).catch(function(){}); }, []);
  var D = model ? model.legend.deciders : {}, S = model ? model.legend.statuses : {};
  function nodesIn(pid){ if (!model) return []; return Object.keys(model.nodes).map(function(k){ return model.nodes[k]; }).filter(function(n){ return n.phase === pid; }); }
  var counts = { built:0, partial:0, planned:0 };
  if (model) Object.keys(model.nodes).forEach(function(k){ var st = model.nodes[k].status; counts[st] = (counts[st]||0)+1; });
  var node = sel && model ? model.nodes[sel] : null;
  var phaseName = node ? (model.phases.filter(function(p){ return p.id === node.phase; })[0]||{}).name : '';

  return (
    <SetupScreen hubKey="process_map" laneLabel="Request Fulfillment Process Setup — Fees, Estimates and Routing" title="Process Map" maxWidth="1200px"
      intro="Every decision a request passes through, in order. Color shows who decides; the badge shows what is built today. Click any decision to see the criteria it uses and the one-time configuration that automates it.">
    {function () { if (!model) return <div style={{ color:'#9CA3AF' }}>Loading process map...</div>; return (
    <div>

      <div style={{ display:'flex', gap:'14px', flexWrap:'wrap', alignItems:'center', marginBottom:'8px' }}>
        {Object.keys(D).map(function(k){ return <span key={k} style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'#374151' }}><span style={{ width:'12px', height:'12px', borderRadius:'3px', background:D[k].color, display:'inline-block' }}></span>{D[k].label}</span>; })}
      </div>
      <div style={{ fontSize:'12px', color:'#9CA3AF', marginBottom:'18px' }}>{counts.built} built &middot; {counts.partial} partial &middot; {counts.planned} planned &middot; a clock marks time-driven decisions (the tickler)</div>

      <div style={{ display:'flex', gap:'20px', alignItems:'flex-start' }}>
        <div style={{ flex:1, minWidth:0 }}>
          {model.phases.map(function(ph){
            var ns = nodesIn(ph.id); if (!ns.length) return null;
            return (
              <div key={ph.id} style={{ marginBottom:'22px' }}>
                <div style={{ fontSize:'13px', fontWeight:'700', color:'#1F4E79', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'8px' }}>{ph.name}</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(230px, 1fr))', gap:'8px' }}>
                  {ns.map(function(n){
                    var d = D[n.decider]||{}, st = S[n.status]||{};
                    var on = sel === n.id;
                    return (
                      <div key={n.id} onClick={function(){ setSel(n.id); }} style={{ borderLeft:'4px solid '+(d.color||'#999'), background:on?'#F8FAFF':'white', border:'1px solid '+(on?'#1F4E79':'#E5E7EB'), borderLeft:'4px solid '+(d.color||'#999'), borderRadius:'8px', padding:'10px 12px', cursor:'pointer' }}>
                        <div style={{ fontSize:'13px', fontWeight:'600', color:'#111', lineHeight:'1.35' }}>{n.label}</div>
                        <div style={{ display:'flex', gap:'5px', marginTop:'7px', flexWrap:'wrap', alignItems:'center' }}>
                          <span style={chip(d.bg||'#F3F4F6', d.color||'#374151')}>{d.label}</span>
                          <span style={chip('#F3F4F6', st.color||'#6B7280')}>{st.label}</span>
                          {n.trigger==='time' ? <span title="Time-driven (tickler)" style={chip('#FEF3C7','#92400E')}>&#9201; time</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div style={{ marginTop:'10px', marginBottom:'22px' }}>
            <div style={{ fontSize:'13px', fontWeight:'700', color:'#1F4E79', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'8px' }}>Terminal states (how a request ends)</div>
            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
              {model.terminalStates.map(function(t){ return <span key={t.id} title={t.notice} style={{ fontSize:'12px', background:'#EFF6FF', color:'#1F4E79', border:'1px solid #DBEAFE', borderRadius:'20px', padding:'4px 12px' }}>{t.name}</span>; })}
            </div>
            <div style={{ fontSize:'11px', color:'#9CA3AF', marginTop:'6px' }}>Hover for the notice each one sends.</div>
          </div>
        </div>

        <div style={{ width:'340px', flexShrink:0, position:'sticky', top:'16px' }}>
          {node ? (
            <div style={{ background:'white', border:'1px solid #E5E7EB', borderRadius:'12px', padding:'18px' }}>
              <div style={{ fontSize:'11px', color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'.04em' }}>{phaseName}</div>
              <div style={{ fontSize:'16px', fontWeight:'700', color:'#111', margin:'4px 0 10px', lineHeight:'1.4' }}>{node.label}</div>
              <div style={{ display:'flex', gap:'5px', flexWrap:'wrap', marginBottom:'14px' }}>
                <span style={chip((D[node.decider]||{}).bg, (D[node.decider]||{}).color)}>{(D[node.decider]||{}).label}</span>
                <span style={chip('#F3F4F6', (S[node.status]||{}).color)}>{(S[node.status]||{}).label}</span>
                {node.trigger==='time' ? <span style={chip('#FEF3C7','#92400E')}>&#9201; time-driven</span> : null}
              </div>
              {node.description ? <div style={{ fontSize:'13px', color:'#374151', lineHeight:'1.6', marginBottom:'14px' }}>{node.description}</div> : null}
              {node.criteria && node.criteria.length ? (
                <div style={{ marginBottom:'14px' }}>
                  <div style={{ fontSize:'11px', fontWeight:'700', color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'5px' }}>What it checks</div>
                  {node.criteria.map(function(c,i){ return <div key={i} style={{ fontSize:'13px', color:'#374151', lineHeight:'1.5', marginBottom:'3px' }}>&middot; {c}</div>; })}
                </div>
              ) : null}
              {node.outcomes && node.outcomes.length ? (
                <div style={{ marginBottom:'14px' }}>
                  <div style={{ fontSize:'11px', fontWeight:'700', color:'#6B7280', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'5px' }}>Outcomes</div>
                  {node.outcomes.map(function(o,i){ return <div key={i} style={{ marginBottom:'5px' }}><div onClick={o.to?function(){ setSel(o.to); }:null} style={{ fontSize:'13px', color:o.to?'#1F4E79':'#374151', lineHeight:'1.5', cursor:o.to?'pointer':'default' }}>&middot; {o.label}</div>{o.note ? <div style={{ fontSize:'12px', color:'#9CA3AF', lineHeight:'1.45', marginLeft:'10px' }}>{o.note}</div> : null}</div>; })}
                </div>
              ) : null}
              {node.automatedBy ? (
                <div style={{ background:'#F8FAFF', border:'1px solid #DBEAFE', borderRadius:'8px', padding:'10px 12px', marginBottom:'12px' }}>
                  <div style={{ fontSize:'11px', fontWeight:'700', color:'#1F4E79', marginBottom:'3px' }}>Configure once &rarr; automatic next time</div>
                  <div style={{ fontSize:'13px', color:'#374151', lineHeight:'1.5' }}>{node.automatedBy}</div>
                </div>
              ) : null}
              {node.note ? <div style={{ fontSize:'12px', color:'#9CA3AF', lineHeight:'1.5', fontStyle:'italic' }}>{node.note}</div> : null}
            </div>
          ) : (
            <div style={{ background:'#F8FAFF', border:'1px dashed #DBEAFE', borderRadius:'12px', padding:'20px', fontSize:'13px', color:'#6B7280', lineHeight:'1.6' }}>Click any decision on the left to see how it is decided, the criteria it uses, where each answer leads, and what configuration would automate it.</div>
          )}
        </div>
      </div>
    </div>
    ); }}
    </SetupScreen>
  );
}
