import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import RecordsPanel from '../components/ui/RecordsPanel';
import FeeEstimatePanel from '../components/ui/FeeEstimatePanel';
import ObjectionPanel from '../components/ui/ObjectionPanel';
import FinancialProfilePanel from '../components/ui/FinancialProfilePanel';
import AvRedactionPanel from '../components/ui/AvRedactionPanel';
import DocSearchPanel from '../components/ui/DocSearchPanel';
import WorkflowDecisionPanel from '../components/ui/WorkflowDecisionPanel';
import FeeWaiverDecisionPanel from '../components/ui/FeeWaiverDecisionPanel';
import { useAuthStore } from '../store/authStore';
// ONE canonical stage vocabulary, mirroring backend/src/services/stages.js. The list that used to live here
// was in a different order from the backend, omitted exemption_review / ag_review / redaction, and contained
// a ghost stage (custodian_retrieval) that exists nowhere in the backend — and the Advance button below drove
// LIVE stage writes off it.
import { STAGE_ORDER as STAGES, STAGE_LABELS, STAGE_COLORS, nextStage, nextStageLabel } from '../lib/stages';


function prettyChannel(ch) {
  if (!ch) return 'Portal';
  var map = { chat_agent: 'Chat Agent', manual_form: 'Form', phone: 'Phone', email: 'Email', mail: 'Mail', walk_in: 'Walk-In', portal: 'Portal' };
  return map[ch] || ch.replace(/_/g,' ').replace(/\b\w/g, function(m){ return m.toUpperCase(); });
}

export default function RequestWorkspacePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [request, setRequest] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedRecords, setSelectedRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [tab, setTab] = useState('details');
  const [stageNote, setStageNote] = useState('');
  const [showAdvance, setShowAdvance] = useState(false);
  const [err, setErr] = useState('');
  const [records, setRecords] = useState([]);
  const [staff, setStaff] = useState([]);
  const [assigning, setAssigning] = useState(false);
  const [teams, setTeams] = useState([]);
  const [rerouting, setRerouting] = useState(false);
  const [clocks, setClocks] = useState([]);
  const [exemptionNote, setExemptionNote] = useState('');
  const [agOutcome, setAgOutcome] = useState('partial');
  const [clockBusy, setClockBusy] = useState(false);
  const [reasonByClock, setReasonByClock] = useState({});
  const [escalating, setEscalating] = useState(false);
  const user = useAuthStore(function(s){ return s.user; });
  const isDirector = !!(user && user.functionRoles && (user.functionRoles.indexOf('DIRECTOR') !== -1 || user.functionRoles.indexOf('SYSTEM_ADMIN') !== -1));

  useEffect(function() { load(); loadStaff(); loadTeams(); loadRecords(); loadClocks(); }, [id]);

  async function loadStaff() {
    try { var r = await api.get('/staff'); setStaff(r.data.staff); } catch(e) {}
  }

  async function loadTeams() {
    try { var r = await api.get('/departments'); var ds = (r.data && r.data.departments) || []; setTeams(ds.filter(function(d){ return d.kind === 'team'; })); } catch(e) {}
  }

  async function loadRecords() {
    try { var r = await api.get('/files/' + id); setRecords((r.data.files||[]).map(function(f){ return { id: f.id, status: f.responsive ? 'responsive' : 'attached' }; })); } catch(e) {}
  }
  async function loadClocks() { try { var r = await api.get('/clocks/request/' + id); setClocks(r.data.clocks || []); } catch(e) {} }
  async function clockAction(promise) { setClockBusy(true); try { await promise; } catch(e) {} await loadClocks(); await load(); setClockBusy(false); }
  function tollClock(cid) { clockAction(api.post('/clocks/' + cid + '/toll', { reason: reasonByClock[cid] || 'clarification_pending' })); }
  function resumeClock(cid) { clockAction(api.post('/clocks/' + cid + '/resume')); }
  function satisfyClock(cid) { clockAction(api.post('/clocks/' + cid + '/satisfy')); }
  function startClocks() { clockAction(api.post('/clocks/request/' + id + '/start')); }
  function assertExemption() { clockAction(api.post('/requests/' + id + '/assert-exemption', { note: exemptionNote })); setExemptionNote(''); }
  function recordAgRuling() { clockAction(api.post('/requests/' + id + '/ag-ruling', { outcome: agOutcome, note: exemptionNote })); setExemptionNote(''); }

  async function load() {
    setLoading(true);
    try {
      var r = await api.get('/requests/' + id);
      setRequest(r.data.request);
      setHistory(r.data.history);
      setSelectedRecords(r.data.selectedRecords || []);
    } catch(e) { setErr('Request not found'); }
    setLoading(false);
  }

  function addRecord(rec) { setRecords(function(prev){ return prev.concat(rec); }); }
  function updateRecordStatus(recId, status) {
    setRecords(function(prev){ return prev.map(function(r){ return r.id===recId ? Object.assign({},r,{status:status}) : r; }); });
  }

  var responsiveCount = records.filter(function(r){ return r.status==='responsive'; }).length;
  var canAdvance = request && (request.stage !== 'record_search' || responsiveCount > 0);

  async function advanceStage() {
    if (!request || !canAdvance) return;
    setAdvancing(true);
    var next = nextStage(request.stage);
    try {
      await api.patch('/requests/' + request.id + '/stage', { stage: next, notes: stageNote });
      setStageNote(''); setShowAdvance(false);
      await load();
    } catch(e) { setErr('Failed to advance stage'); }
    setAdvancing(false);
  }

  async function assignRequest(userId) {
    
    setAssigning(true);
    try {
      await api.patch('/requests/' + request.id + '/assign', { assignTo: userId });
      await load();
    } catch(e) { console.error(e); }
    setAssigning(false);
  }

  async function rerouteRequest(teamId) {
    if (!teamId || teamId === request.department_id) return;
    setRerouting(true);
    try {
      await api.patch('/requests/' + request.id + '/route', { departmentId: teamId });
      await load();
    } catch(e) { setErr((e.response && e.response.data && e.response.data.error) || 'Failed to re-route'); }
    setRerouting(false);
  }

  async function closeRequest(reason) {
    setAdvancing(true);
    try {
      await api.patch('/requests/' + request.id + '/stage', { stage: 'closed', notes: reason });
      await load();
    } catch(e) { setErr('Failed to close request'); }
    setAdvancing(false);
  }

  async function escalateLegal() {
    if (!window.confirm('Escalate this request for legal (advanced) redaction? Redaction will route to legal staff, and any active redaction task is reassigned.')) return;
    setEscalating(true); setErr('');
    try {
      await api.post('/requests/' + request.id + '/legal-escalate', {});
      await load();
    } catch(e) { setErr((e.response && e.response.data && e.response.data.error) || 'Failed to escalate'); }
    setEscalating(false);
  }

  if (loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'256px',color:'#9CA3AF'}}>Loading request...</div>;
  if (!request) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'256px'}}><div style={{textAlign:'center'}}><div style={{fontSize:'48px',marginBottom:'16px'}}>⚠️</div><div style={{fontSize:'16px',color:'#4B5563'}}>{err||'Request not found'}</div></div></div>;

  var sc = STAGE_COLORS[request.stage];
  var stageIdx = STAGES.indexOf(request.stage);
  var isComplete = request.status === 'closed';
  var od = request.deadline_date && new Date(request.deadline_date) < new Date() && !isComplete;
  var showRecordsPanel = true;

  return (
    <div style={{maxWidth:'1200px',display:'flex',flexDirection:'column',gap:'20px'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'16px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
          <button onClick={function(){nav('/requests');}} style={{background:'none',border:'none',cursor:'pointer',color:'#6B7280',fontSize:'14px',padding:'8px 12px',borderRadius:'8px'}}>← Back</button>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
              <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0',fontFamily:'monospace'}}>{request.request_number}</h1>
              {sc&&<span style={{background:sc.bg,color:sc.color,fontSize:'12px',fontWeight:'600',padding:'4px 12px',borderRadius:'20px'}}>{STAGE_LABELS[request.stage]||request.stage}</span>}
              {request.is_mrr?<span style={{background:'#CCFBF1',color:'#0F766E',fontSize:'12px',fontWeight:'700',padding:'4px 10px',borderRadius:'20px'}}>MRR</span>:null}
              {request.legal_flag?<span style={{background:'#FEF2F2',color:'#DC2626',fontSize:'12px',fontWeight:'700',padding:'4px 10px',borderRadius:'20px'}}>⚖ LEGAL HOLD</span>:null}
              {od?<span style={{background:'#FEF2F2',color:'#DC2626',fontSize:'12px',fontWeight:'700',padding:'4px 10px',borderRadius:'20px'}}>⚠ OVERDUE</span>:null}
              {isComplete?<span style={{background:'#F0FDF4',color:'#166534',fontSize:'12px',fontWeight:'700',padding:'4px 10px',borderRadius:'20px'}}>✓ CLOSED</span>:null}
            </div>
            <p style={{color:'#9CA3AF',fontSize:'13px',margin:'4px 0 0'}}>Submitted {new Date(request.created_at).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} · {prettyChannel(request.submission_channel)}</p>
          </div>
        </div>
        {!isComplete&&nextStage(request.stage)&&(
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'6px'}}>
            <button onClick={function(){if(canAdvance)setShowAdvance(!showAdvance);}}
              disabled={!canAdvance}
              style={{padding:'10px 20px',background:canAdvance?'#1F4E79':'#9CA3AF',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:canAdvance?'pointer':'not-allowed',whiteSpace:'nowrap'}}>
              {nextStageLabel(request.stage)||'Advance Stage'} →
            </button>
            {!canAdvance&&request.stage==='record_search'&&(
              <div style={{fontSize:'11px',color:'#D97706',textAlign:'right'}}>Attach and mark at least one Responsive record first</div>
            )}
          </div>
        )}
      </div>

      {showAdvance&&(
        <div style={{background:'#EBF3FB',border:'2px solid #1F4E79',borderRadius:'12px',padding:'20px'}}>
          <h3 style={{margin:'0 0 12px',fontSize:'15px',fontWeight:'700',color:'#1F4E79'}}>Advance to: {STAGE_LABELS[nextStage(request.stage)]||'Closed'}</h3>
          <textarea value={stageNote} onChange={function(e){setStageNote(e.target.value);}}
            placeholder="Optional notes for the audit log..."
            style={{width:'100%',padding:'10px 12px',border:'1px solid #D6E4F0',borderRadius:'8px',fontSize:'14px',outline:'none',minHeight:'80px',resize:'vertical',boxSizing:'border-box',fontFamily:'inherit',marginBottom:'12px'}}/>
          <div style={{display:'flex',gap:'10px'}}>
            <button onClick={advanceStage} disabled={advancing} style={{padding:'10px 24px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>
              {advancing?'Advancing...':'Confirm Advance'}
            </button>
            <button onClick={function(){setShowAdvance(false);}} style={{padding:'10px 16px',background:'white',color:'#6B7280',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',cursor:'pointer'}}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'20px'}}>
        <div style={{fontSize:'12px',fontWeight:'600',color:'#9CA3AF',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'12px'}}>Processing Pipeline</div>
        <div style={{display:'flex',alignItems:'center',overflowX:'auto'}}>
          {STAGES.map(function(s,i){
            var done=stageIdx>i; var current=stageIdx===i;
            return(
              <div key={s} style={{display:'flex',alignItems:'center',flex:i<STAGES.length-1?'1':'none'}}>
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'6px',minWidth:'80px'}}>
                  <div style={{width:'32px',height:'32px',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'13px',fontWeight:'700',background:done?'#1F4E79':current?'#EBF3FB':'#F9FAFB',color:done?'white':current?'#1F4E79':'#D1D5DB',border:current?'2px solid #1F4E79':done?'none':'2px solid #E5E7EB'}}>
                    {done?'✓':i+1}
                  </div>
                  <div style={{fontSize:'10px',textAlign:'center',color:done||current?'#1F4E79':'#9CA3AF',fontWeight:current?'700':'400',lineHeight:'1.3'}}>{STAGE_LABELS[s]}</div>
                </div>
                {i<STAGES.length-1&&<div style={{flex:1,height:'2px',background:done?'#1F4E79':'#E5E7EB',margin:'0 4px',marginBottom:'20px'}}/>}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{display:'flex',borderBottom:'2px solid #E5E7EB',gap:'0'}}>
        {[['details','Request Details'],['routing','Routing'],['records','Records'],['documents','Search Documents'],['fees','Fees'],['financial','Financial Profile']].concat(request.av_applicable?[['redaction','Redaction for Audio/Video']]:[]).concat([['history','Audit History'],['actions','Actions']]).map(function(item){
          return <button key={item[0]} onClick={function(){setTab(item[0]);}} style={{padding:'12px 20px',background:'none',border:'none',borderBottom:tab===item[0]?'2px solid #1F4E79':'2px solid transparent',marginBottom:'-2px',fontSize:'14px',fontWeight:tab===item[0]?'700':'500',color:tab===item[0]?'#1F4E79':'#6B7280',cursor:'pointer'}}>{item[1]}</button>;
        })}
      </div>

      {tab==='details'&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px',display:'flex',flexDirection:'column',gap:'16px'}}>
            <div style={{fontSize:'15px',fontWeight:'700',paddingBottom:'12px',borderBottom:'1px solid #F3F4F6'}}>Requestor Information</div>
            {[['Name',request.requestor_name],['Email',request.requestor_email],['Phone',request.requestor_phone||'—'],['Type',request.requestor_type],['Delivery',request.delivery_method]].map(function(item){
              return <div key={item[0]}><div style={{fontSize:'11px',fontWeight:'600',color:'#9CA3AF',textTransform:'uppercase',letterSpacing:'.05em'}}>{item[0]}</div><div style={{fontSize:'14px',color:'#111',textTransform:'capitalize',marginTop:'2px'}}>{item[1]}</div></div>;
            })}
          </div>
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px',display:'flex',flexDirection:'column',gap:'16px'}}>
            <div style={{fontSize:'15px',fontWeight:'700',paddingBottom:'12px',borderBottom:'1px solid #F3F4F6'}}>Request Information</div>
            {[['Classification',request.classification?request.classification.replace(/_/g,' '):'—'],['Request Fulfillment Team',request.department_name||'Unassigned'],['Deadline',request.deadline_date||'—'],['Fee Waiver',request.fee_waiver_requested?'Yes — Requested':'No'],['MRR',request.is_mrr?'Yes — Multi-Record Request':'No']].map(function(item){
              return <div key={item[0]}><div style={{fontSize:'11px',fontWeight:'600',color:'#9CA3AF',textTransform:'uppercase',letterSpacing:'.05em'}}>{item[0]}</div><div style={{fontSize:'14px',color:'#111',textTransform:'capitalize',marginTop:'2px'}}>{item[1]}</div></div>;
            })}
          </div>
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px',gridColumn:'1/-1'}}>
            <div style={{fontSize:'15px',fontWeight:'700',paddingBottom:'12px',borderBottom:'1px solid #F3F4F6',marginBottom:'16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>Deadlines &amp; Clocks</span>
              {clocks.length===0?<button onClick={startClocks} disabled={clockBusy} style={{padding:'6px 14px',borderRadius:'8px',border:'1px solid #E5E7EB',background:'white',color:'#1F4E79',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Start clocks</button>:null}
            </div>
            {clocks.length===0?<p style={{fontSize:'13px',color:'#9CA3AF',margin:'0'}}>No statutory clocks on this request yet.</p>:(
              <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                {clocks.map(function(c){
                  var badge = c.state==='satisfied'?{bg:'#F0FDF4',color:'#166534',label:'Satisfied'}:c.state==='tolled'?{bg:'#FEF3C7',color:'#92400E',label:'Paused'}:c.state==='expired'?{bg:'#FDE8E8',color:'#9B1C1C',label:'Overdue'}:{bg:'#EBF3FB',color:'#1F4E79',label:'Running'};
                  return (
                    <div key={c.clockId} style={{border:'1px solid #E5E7EB',borderRadius:'8px',padding:'12px 14px',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
                      <span style={{background:badge.bg,color:badge.color,fontSize:'11px',fontWeight:'700',padding:'3px 10px',borderRadius:'20px',whiteSpace:'nowrap'}}>{badge.label}</span>
                      <div style={{flex:'1',minWidth:'180px'}}>
                        <div style={{fontSize:'14px',fontWeight:'600',color:'#111'}}>{c.label}{c.isPrimary?' · primary':''}</div>
                        <div style={{fontSize:'12px',color:'#6B7280'}}>due {c.dueDate} · {c.remainingDays>=0?(c.remainingDays+' day'+(c.remainingDays===1?'':'s')+' left'):(Math.abs(c.remainingDays)+' day'+(Math.abs(c.remainingDays)===1?'':'s')+' overdue')} · {String(c.basis).replace('_',' ')}{c.tolledDays?(' · '+c.tolledDays+' day'+(c.tolledDays===1?'':'s')+' paused'):''}</div>
                      </div>
                      {c.state!=='satisfied'&&(
                        <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                          {c.currentlyTolled?(
                            <button onClick={function(){resumeClock(c.clockId);}} disabled={clockBusy} style={{padding:'6px 13px',borderRadius:'8px',border:'none',background:'#1F4E79',color:'white',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Resume</button>
                          ):(
                            <span style={{display:'flex',gap:'6px',alignItems:'center'}}>
                              <select value={reasonByClock[c.clockId]||'clarification_pending'} onChange={function(e){var v=e.target.value;setReasonByClock(function(p){var n=Object.assign({},p);n[c.clockId]=v;return n;});}} style={{padding:'6px 8px',borderRadius:'8px',border:'1px solid #E5E7EB',fontSize:'12px'}}>
                                <option value="clarification_pending">Awaiting clarification</option>
                                <option value="payment_pending">Awaiting payment</option>
                                <option value="ag_ruling_pending">Awaiting AG ruling</option>
                                <option value="extension">Extension</option>
                              </select>
                              <button onClick={function(){tollClock(c.clockId);}} disabled={clockBusy} style={{padding:'6px 13px',borderRadius:'8px',border:'1px solid #E5E7EB',background:'white',color:'#92400E',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Pause</button>
                            </span>
                          )}
                          <button onClick={function(){satisfyClock(c.clockId);}} disabled={clockBusy} style={{padding:'6px 13px',borderRadius:'8px',border:'1px solid #E5E7EB',background:'white',color:'#166534',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Mark satisfied</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p style={{fontSize:'11px',color:'#9CA3AF',marginTop:'12px',lineHeight:'1.5'}}>Pausing a clock (awaiting clarification, payment, or an AG ruling) stops the count; the due date moves out by the paused time. The primary clock drives the request deadline date.</p>
          </div>

          {request.exemption_model ? (
          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px',gridColumn:'1/-1'}}>
            <div style={{fontSize:'15px',fontWeight:'700',paddingBottom:'12px',borderBottom:'1px solid #F3F4F6',marginBottom:'16px'}}>Exemptions &amp; AG Pre-clearance</div>
            {request.exemption_model==='pre_clearance'?(
              <p style={{fontSize:'13px',color:'#6B7280',margin:'0 0 16px',lineHeight:'1.5'}}>This jurisdiction requires an Attorney General ruling before records may be withheld. Submitting for pre-clearance pauses the response clock until the ruling is recorded.</p>
            ):(
              <p style={{fontSize:'13px',color:'#6B7280',margin:'0 0 16px',lineHeight:'1.5'}}>This jurisdiction reviews exemptions internally; the requestor’s recourse is appeal{request.exemption_model==='self_appeal_court'?' or court':''}. Asserting an exemption does not pause the response clock.</p>
            )}
            {request.stage==='ag_review'?(
              <div style={{border:'1px solid #FEF3C7',background:'#FFFBEB',borderRadius:'8px',padding:'14px 16px'}}>
                <div style={{fontSize:'14px',fontWeight:'600',color:'#92400E',marginBottom:'10px'}}>Awaiting Attorney General ruling — response clock paused.</div>
                <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                  <select value={agOutcome} onChange={function(e){setAgOutcome(e.target.value);}} style={{padding:'8px 10px',borderRadius:'8px',border:'1px solid #E5E7EB',fontSize:'13px'}}>
                    <option value="sustained">Ruling: withholding sustained</option>
                    <option value="partial">Ruling: partial release</option>
                    <option value="overruled">Ruling: must release</option>
                  </select>
                  <input value={exemptionNote} onChange={function(e){setExemptionNote(e.target.value);}} placeholder="Ruling note (optional)" style={{flex:'1',minWidth:'200px',padding:'8px 10px',borderRadius:'8px',border:'1px solid #E5E7EB',fontSize:'13px'}} />
                  <button onClick={recordAgRuling} disabled={clockBusy} style={{padding:'8px 16px',borderRadius:'8px',border:'none',background:'#1F4E79',color:'white',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Record AG ruling</button>
                </div>
              </div>
            ):(
              <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                <input value={exemptionNote} onChange={function(e){setExemptionNote(e.target.value);}} placeholder="Basis / records to withhold (optional)" style={{flex:'1',minWidth:'200px',padding:'8px 10px',borderRadius:'8px',border:'1px solid #E5E7EB',fontSize:'13px'}} />
                <button onClick={assertExemption} disabled={clockBusy} style={{padding:'8px 16px',borderRadius:'8px',border:'none',background:'#1F4E79',color:'white',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>{request.exemption_model==='pre_clearance'?'Submit for AG pre-clearance':'Assert exemption (internal review)'}</button>
              </div>
            )}
          </div>
          ):null}

          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px',gridColumn:'1/-1'}}>
            <div style={{fontSize:'15px',fontWeight:'700',paddingBottom:'12px',borderBottom:'1px solid #F3F4F6',marginBottom:'16px'}}>Description of Records Requested</div>
            <p style={{fontSize:'14px',color:'#374151',lineHeight:'1.7',margin:'0',whiteSpace:'pre-wrap'}}>{request.description}</p>
          </div>
          {selectedRecords.length > 0 && (
            <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px',gridColumn:'1/-1'}}>
              <div style={{fontSize:'15px',fontWeight:'700',paddingBottom:'12px',borderBottom:'1px solid #F3F4F6',marginBottom:'16px',display:'flex',alignItems:'center',gap:'10px'}}>
                <span>Records the Requestor Selected from Search Results</span>
                <span style={{fontSize:'12px',background:'#F0FDF4',color:'#166534',border:'1px solid #86EFAC',borderRadius:'10px',padding:'2px 8px',fontWeight:'600'}}>{selectedRecords.length}</span>
              </div>
              <p style={{fontSize:'13px',color:'#6B7280',margin:'0 0 16px',lineHeight:'1.5'}}>
                These are the specific records the requestor picked while submitting their request. They represent what the requestor explicitly identified — use them as a starting point for fulfillment.
              </p>
              <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                {selectedRecords.map(function(sr){
                  var restricted = sr.public_availability === 'restricted';
                  return (
                    <div key={sr.id} style={{border:'1px solid #E5E7EB',borderRadius:'8px',padding:'12px 14px',background: restricted ? '#FFFBEB' : 'white'}}>
                      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'12px'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:'14px',fontWeight:'600',color:'#111',marginBottom:'4px'}}>{sr.title || sr.record_id}</div>
                          <div style={{fontSize:'12px',color:'#6B7280'}}>
                            <span>Source: <strong style={{color:'#374151'}}>{sr.source_system || 'Unknown'}</strong></span>
                            <span style={{marginLeft:'12px'}}>Record ID: <code style={{background:'#F3F4F6',padding:'1px 5px',borderRadius:'3px',fontSize:'11px'}}>{sr.record_id}</code></span>
                          </div>
                        </div>
                        {restricted && (
                          <span style={{flexShrink:0,fontSize:'11px',fontWeight:'700',color:'#92400E',background:'#FEF3C7',border:'1px solid #FCD34D',borderRadius:'10px',padding:'3px 10px'}}>⚠ Redaction Review Required</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {tab==='records'&&(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px'}}>
          <RecordsPanel requestId={request.id} stage={request.stage} onChange={loadRecords}/>
        </div>
      )}

      {tab==='routing'&&(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px'}}>
          <WorkflowDecisionPanel requestId={request.id}/>
        </div>
      )}

      {tab==='documents'&&(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px'}}>
          <DocSearchPanel requestId={request.id}/>
        </div>
      )}

      {tab==='fees'&&(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px'}}>
          <FeeWaiverDecisionPanel request={request} onChange={load}/>
          <FeeEstimatePanel requestId={request.id}/>
          <ObjectionPanel requestId={request.id}/>
        </div>
      )}
      {tab==='financial'&&(
        <FinancialProfilePanel requestId={request.id}/>
      )}

      {tab==='redaction'&&(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px'}}>
          <AvRedactionPanel requestId={request.id}/>
        </div>
      )}

      {tab==='history'&&(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',overflow:'hidden'}}>
          {history.length===0?<div style={{padding:'48px',textAlign:'center',color:'#9CA3AF'}}>No history yet</div>:(
            <div style={{display:'flex',flexDirection:'column'}}>
              {history.map(function(h,i){
                return <div key={h.id} style={{display:'flex',gap:'16px',padding:'16px 20px',borderBottom:i<history.length-1?'1px solid #F3F4F6':'none'}}>
                  <div style={{width:'36px',height:'36px',borderRadius:'50%',background:'#EBF3FB',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'13px',fontWeight:'700',color:'#1F4E79',flexShrink:0}}>
                    {h.actor_name?h.actor_name[0].toUpperCase():'?'}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',flexWrap:'wrap'}}>
                      <span style={{fontSize:'13px',fontWeight:'600',color:'#111'}}>{h.actor_name}</span>
                      <span style={{background:'#F3F4F6',color:'#6B7280',fontSize:'11px',fontWeight:'600',padding:'2px 8px',borderRadius:'20px'}}>{h.action.replace(/_/g,' ')}</span>
                      {h.stage_from&&h.stage_to&&<span style={{fontSize:'12px',color:'#9CA3AF'}}>{STAGE_LABELS[h.stage_from]||h.stage_from} → {STAGE_LABELS[h.stage_to]||h.stage_to}</span>}
                    </div>
                    {h.notes&&<p style={{fontSize:'13px',color:'#6B7280',margin:'0',fontStyle:'italic'}}>{h.notes}</p>}
                    <div style={{fontSize:'12px',color:'#9CA3AF',marginTop:'4px'}}>{new Date(h.created_at).toLocaleString()}</div>
                  </div>
                </div>;
              })}
            </div>
          )}
        </div>
      )}

      {tab==='actions'&&(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'24px',display:'flex',flexDirection:'column',gap:'16px'}}>
          <div style={{fontSize:'15px',fontWeight:'700',paddingBottom:'12px',borderBottom:'1px solid #F3F4F6'}}>Request Actions</div>
          <div style={{marginBottom:'16px'}}>
            <div style={{fontSize:'13px',fontWeight:'600',color:'#374151',marginBottom:'8px'}}>Assign Request</div>
            <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
              <select onChange={function(e){if(e.target.value)assignRequest(e.target.value);}} value={request.assigned_to||''}
                style={{padding:'8px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',cursor:'pointer'}}>
                <option value="">— Unassigned —</option>
                {staff.filter(function(s){return s.status==='active';}).map(function(s){
                  return <option key={s.id} value={s.id}>{s.display_name}{s.title?' — '+s.title:''}</option>;
                })}
              </select>
              <button onClick={function(){try{var t=localStorage.getItem('oq_token');var p=JSON.parse(atob(t.split('.')[1]));assignRequest(p.sub);}catch(e){}}} disabled={assigning}
                style={{padding:'8px 14px',background:'#EBF3FB',color:'#1F4E79',border:'1px solid #D6E4F0',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
                Assign to Me
              </button>
              {request.assigned_to&&<button onClick={function(){assignRequest(null);}} disabled={assigning}
                style={{padding:'8px 14px',background:'white',color:'#9CA3AF',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'13px',cursor:'pointer'}}>
                Unassign
              </button>}
            </div>
            {request.assigned_to_name&&<div style={{fontSize:'12px',color:'#6B7280',marginTop:'6px'}}>Currently assigned to: <strong>{request.assigned_to_name}</strong></div>}
          </div>
          <div style={{marginBottom:'16px'}}>
            <div style={{fontSize:'13px',fontWeight:'600',color:'#374151',marginBottom:'8px'}}>Request Fulfillment Team</div>
            <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
              <select onChange={function(e){if(e.target.value)rerouteRequest(e.target.value);}} value={request.department_id||''} disabled={rerouting}
                style={{padding:'8px 12px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',cursor:'pointer'}}>
                <option value="">— Unrouted —</option>
                {teams.map(function(t){
                  return <option key={t.id} value={t.id}>{t.name}</option>;
                })}
              </select>
              {rerouting&&<span style={{fontSize:'12px',color:'#9CA3AF'}}>Re-routing...</span>}
            </div>
            <div style={{fontSize:'12px',color:'#6B7280',marginTop:'6px'}}>Currently routed to: <strong>{request.department_name||'Unrouted'}</strong>. Changing this moves the request to another team{request.assigned_to_name?' and may clear the current assignment':''}.</div>
          </div>
          {isDirector&&(
            <div style={{marginBottom:'16px'}}>
              <div style={{fontSize:'13px',fontWeight:'600',color:'#374151',marginBottom:'8px'}}>Legal Escalation</div>
              {request.legal_flag?(
                <div style={{fontSize:'13px',color:'#B91C1C',background:'#FEF2F2',border:'1px solid #FCA5A5',borderRadius:'8px',padding:'10px 12px'}}>
                  ⚖ Flagged for legal (advanced) redaction{request.legal_flag_type?' — '+request.legal_flag_type.replace(/_/g,' ').toLowerCase():''}. Redaction on this request routes to legal staff.
                </div>
              ):(
                <div>
                  <button onClick={escalateLegal} disabled={escalating}
                    style={{padding:'8px 16px',background:'white',color:'#B91C1C',border:'1px solid #FCA5A5',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:escalating?'default':'pointer'}}>
                    {escalating?'Escalating…':'⚖ Escalate for Legal Redaction'}
                  </button>
                  <div style={{fontSize:'12px',color:'#6B7280',marginTop:'6px'}}>Marks this request as needing legal (advanced) redaction. Any active redaction task is reassigned to legal staff; if redaction hasn't started, it will route to legal when it does.</div>
                </div>
              )}
            </div>
          )}
          {!isComplete&&(
            <div>
              <div style={{fontSize:'13px',fontWeight:'600',color:'#374151',marginBottom:'8px'}}>Close Request</div>
              <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
                {[['No Responsive Records','CLOSE_NO_RECORDS'],['Withdrawn by Requestor','CLOSE_WITHDRAWN'],['Denied','CLOSE_DENIED']].map(function(item){
                  return <button key={item[1]} onClick={function(){if(window.confirm('Close this request as: '+item[0]+'?'))closeRequest(item[0]);}}
                    style={{padding:'8px 16px',background:'white',color:'#DC2626',border:'1px solid #FCA5A5',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
                    {item[0]}
                  </button>;
                })}
              </div>
            </div>
          )}
          {isComplete&&<div style={{padding:'16px',background:'#F0FDF4',borderRadius:'8px',color:'#166534',fontSize:'14px'}}>This request is closed. Closure reason: {request.closure_reason||'Not specified'}</div>}
        </div>
      )}
    </div>
  );
}
