import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../lib/api';

const STAGES = { intake:'Intake Review', record_search:'Record Search', redaction_review:'Redaction Review', fee_review:'Fee Review', awaiting_payment:'Awaiting Payment', custodian_retrieval:'Custodian Retrieval', delivery:'Delivery' };
const SC = { intake:{bg:'#DBEAFE',color:'#1E40AF'}, record_search:{bg:'#EDE9FE',color:'#6D28D9'}, redaction_review:{bg:'#FEF3C7',color:'#92400E'}, fee_review:{bg:'#D1FAE5',color:'#065F46'}, awaiting_payment:{bg:'#FFEDD5',color:'#9A3412'}, custodian_retrieval:{bg:'#CCFBF1',color:'#0F766E'}, delivery:{bg:'#E0E7FF',color:'#3730A3'} };
const CC = { simple:{bg:'#F0FDF4',color:'#166534'}, standard:{bg:'#EFF6FF',color:'#1E40AF'}, complex:{bg:'#FFFBEB',color:'#92400E'}, redaction_required:{bg:'#FEF2F2',color:'#991B1B'} };

// Derive the queue's "Assigned To" cell from the request's current active task:
// a manually-owned request shows the owner; otherwise show whether the work is
// sitting in the team pool (awaiting claim) or on a specific person's My Tasks.
function workLabel(r) {
  if (r.assigned_to_name) return { text: r.assigned_to_name, tone: '#374151', bold: true };
  var st = r.active_task_status;
  if (st === 'in_progress') return { text: (r.active_task_assignee || 'Assignee') + ' \u00b7 working', tone: '#065F46', bold: true };
  if (st === 'assigned')    return { text: (r.active_task_assignee || 'Assignee') + ' \u00b7 assigned', tone: '#1F4E79', bold: true };
  if (st === 'open')        return { text: 'In pool \u00b7 ' + (r.department_name || 'team'), tone: '#92400E', bold: false };
  return { text: 'Awaiting assignment', tone: '#9CA3AF', bold: false };
}


function prettyChannel(ch) {
  if (!ch) return 'Portal';
  var map = { chat_agent: 'Chat Agent', manual_form: 'Form', phone: 'Phone', email: 'Email', mail: 'Mail', walk_in: 'Walk-In', portal: 'Portal' };
  return map[ch] || ch.replace(/_/g,' ').replace(/\b\w/g, function(m){ return m.toUpperCase(); });
}

export default function RequestQueuePage() {
  const [searchParams] = useSearchParams();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState(searchParams.get('stage') || '');

  useEffect(function() { load(); }, [stageFilter]);

  async function load() {
    setLoading(true);
    try {
      var url = '/requests?';
      if (stageFilter) url += 'stage=' + stageFilter + '&';
      var r = await api.get(url);
      setRequests(r.data.requests);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  var filtered = search ? requests.filter(function(r) {
    var s = search.toLowerCase();
    return r.request_number.toLowerCase().includes(s) || r.requestor_name.toLowerCase().includes(s) || r.requestor_email.toLowerCase().includes(s);
  }) : requests;

  var overdue = filtered.filter(function(r) { return r.deadline_date && new Date(r.deadline_date) < new Date(); }).length;
  var counts = {};
  requests.forEach(function(r) { counts[r.stage] = (counts[r.stage] || 0) + 1; });

  return (
    <div style={{maxWidth:'1400px',display:'flex',flexDirection:'column',gap:'20px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 4px'}}>Request Queue</h1>
          <p style={{color:'#9CA3AF',fontSize:'14px',margin:0}}>{filtered.length} active request{filtered.length!==1?'s':''}{overdue>0?' · '+overdue+' overdue':''}</p>
        </div>
        <Link to="/requests/new" style={{display:'inline-flex',alignItems:'center',gap:'8px',padding:'10px 18px',background:'#1F4E79',color:'white',borderRadius:'8px',textDecoration:'none',fontSize:'14px',fontWeight:'600'}}>+ Log New Request</Link>
      </div>
      <div style={{display:'flex',gap:'8px',overflowX:'auto',paddingBottom:'4px'}}>
        {[['','All']].concat(Object.entries(STAGES)).map(function(item) {
          var k=item[0]; var v=item[1];
          var active=stageFilter===k;
          var count=k===''?requests.length:(counts[k]||0);
          return <button key={k} onClick={function(){setStageFilter(k);}} style={{padding:'7px 16px',borderRadius:'20px',border:'1px solid '+(active?'#1F4E79':'#E5E7EB'),background:active?'#1F4E79':'white',color:active?'white':'#6B7280',fontSize:'13px',fontWeight:'500',cursor:'pointer',whiteSpace:'nowrap'}}>{v} ({count})</button>;
        })}
      </div>
      <div style={{display:'flex',gap:'8px'}}>
        <input type="text" value={search} onChange={function(e){setSearch(e.target.value);}} onKeyDown={function(e){if(e.key==='Enter')load();}}
          placeholder="Search by request number, name, or email..."
          style={{flex:1,padding:'10px 14px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',outline:'none'}}/>
        <button onClick={load} style={{padding:'10px 20px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>Search</button>
        {search&&<button onClick={function(){setSearch('');load();}} style={{padding:'10px 16px',background:'white',color:'#6B7280',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',cursor:'pointer'}}>Clear</button>}
      </div>
      <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',overflow:'hidden'}}>
        {loading?(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'48px',color:'#9CA3AF'}}>Loading requests...</div>
        ):filtered.length===0?(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'64px',color:'#9CA3AF',textAlign:'center'}}>
            <div style={{fontSize:'48px',marginBottom:'16px'}}>📭</div>
            <div style={{fontSize:'16px',fontWeight:'600',color:'#4B5563',marginBottom:'8px'}}>No requests found</div>
            <div style={{fontSize:'14px'}}>Try changing your filters or log a new request</div>
          </div>
        ):(
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#F9FAFB'}}>
                  {['Request #','Requestor','Stage','Classification','Request Fulfillment Team','Deadline','Assigned To',''].map(function(h){
                    return <th key={h} style={{textAlign:'left',fontSize:'11px',fontWeight:'600',color:'#6B7280',textTransform:'uppercase',letterSpacing:'.05em',padding:'10px 16px',whiteSpace:'nowrap'}}>{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map(function(r){
                  var od=r.deadline_date&&new Date(r.deadline_date)<new Date();
                  var sc=SC[r.stage];
                  var cc=CC[r.classification];
                  return(
                    <tr key={r.id} style={{borderTop:'1px solid #F3F4F6'}}
                      onMouseOver={function(e){e.currentTarget.style.background='#F9FAFB';}}
                      onMouseOut={function(e){e.currentTarget.style.background='white';}}>
                      <td style={{padding:'12px 16px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                          <span style={{fontFamily:'monospace',fontWeight:'700',color:'#1F4E79',fontSize:'13px'}}>{r.request_number}</span>
                          {r.is_mrr?<span style={{background:'#CCFBF1',color:'#0F766E',fontSize:'10px',fontWeight:'700',padding:'2px 6px',borderRadius:'20px'}}>MRR</span>:null}
                          {r.legal_flag?<span style={{background:'#FEF2F2',color:'#DC2626',fontSize:'10px',fontWeight:'700',padding:'2px 6px',borderRadius:'20px'}}>LEGAL</span>:null}
                          {od?<span style={{background:'#FEF2F2',color:'#DC2626',fontSize:'10px',fontWeight:'700',padding:'2px 6px',borderRadius:'20px'}}>OVERDUE</span>:null}
                        </div>
                        <div style={{fontSize:'11px',color:'#9CA3AF',marginTop:'2px',textTransform:'none'}}>{prettyChannel(r.submission_channel)}</div>
                      </td>
                      <td style={{padding:'12px 16px'}}>
                        <div style={{fontWeight:'500',fontSize:'14px',color:'#111'}}>{r.requestor_name}</div>
                        <div style={{fontSize:'12px',color:'#9CA3AF'}}>{r.requestor_email}</div>
                        {r.fee_waiver_requested?<div style={{fontSize:'11px',color:'#D97706',fontWeight:'600',marginTop:'2px'}}>Fee Waiver Requested</div>:null}
                      </td>
                      <td style={{padding:'12px 16px'}}>
                        {sc?<span style={{background:sc.bg,color:sc.color,fontSize:'12px',fontWeight:'500',padding:'4px 10px',borderRadius:'20px',whiteSpace:'nowrap'}}>{STAGES[r.stage]}</span>:<span style={{fontSize:'12px',color:'#6B7280'}}>{r.stage}</span>}
                      </td>
                      <td style={{padding:'12px 16px'}}>
                        {cc?<span style={{background:cc.bg,color:cc.color,fontSize:'11px',fontWeight:'600',padding:'3px 8px',borderRadius:'20px',whiteSpace:'nowrap',textTransform:'none'}}>{r.classification?r.classification.replace(/_/g,' '):'—'}</span>:<span style={{fontSize:'12px',color:'#9CA3AF'}}>—</span>}
                      </td>
                      <td style={{padding:'12px 16px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                          <div style={{width:'8px',height:'8px',borderRadius:'50%',background:r.department_color||'#9CA3AF',flexShrink:0}}/>
                          <span style={{fontSize:'13px',color:'#374151'}}>{r.department_name||'—'}</span>
                        </div>
                      </td>
                      <td style={{padding:'12px 16px'}}>
                        <span style={{fontSize:'13px',color:od?'#DC2626':'#6B7280',fontWeight:od?'700':'400'}}>{r.deadline_date||'—'}</span>
                      </td>
                      <td style={{padding:'12px 16px'}}>
                        {(function(){ var w = workLabel(r); return <span style={{fontSize:'13px',color:w.tone,fontWeight:w.bold?'600':'400'}}>{w.text}</span>; })()}
                      </td>
                      <td style={{padding:'12px 16px'}}>
                        <Link to={'/requests/'+r.id} style={{display:'inline-flex',alignItems:'center',fontSize:'13px',color:'#1F4E79',textDecoration:'none',fontWeight:'600',padding:'6px 12px',background:'#EBF3FB',borderRadius:'6px'}}>Open →</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
