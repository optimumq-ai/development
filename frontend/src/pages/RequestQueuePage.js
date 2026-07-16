import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { STAGE_LABELS as STAGES, STAGE_COLORS as SC, isTerminal } from '../lib/stages';

const CC = { simple:{bg:'#F0FDF4',color:'#166534'}, standard:{bg:'#EFF6FF',color:'#1E40AF'}, complex:{bg:'#FFFBEB',color:'#92400E'}, redaction_required:{bg:'#FEF2F2',color:'#991B1B'} };

// Derive the queue's "Assigned To" cell from the request's current active task:
// a manually-owned request shows the owner; otherwise show whether the work is
// sitting in the team pool (awaiting claim) or on a specific person's My Tasks.
function workLabel(r) {
  if (r.assigned_to_name) return { text: r.assigned_to_name, tone: '#374151', bold: true };
  var st = r.active_task_status;
  if (st === 'in_progress') return { text: (r.active_task_assignee || 'Assignee') + ' · working', tone: '#065F46', bold: true };
  if (st === 'assigned')    return { text: (r.active_task_assignee || 'Assignee') + ' · assigned', tone: '#1F4E79', bold: true };
  if (st === 'open')        return { text: 'In pool · ' + (r.department_name || 'team'), tone: '#92400E', bold: false };
  return { text: 'Awaiting assignment', tone: '#9CA3AF', bold: false };
}


function prettyChannel(ch) {
  if (!ch) return 'Portal';
  var map = { chat_agent: 'Chat Agent', manual_form: 'Form', phone: 'Phone', email: 'Email', mail: 'Mail', walk_in: 'Walk-In', portal: 'Portal' };
  return map[ch] || ch.replace(/_/g,' ').replace(/\b\w/g, function(m){ return m.toUpperCase(); });
}

// GROUP THE WORK ROWS BACK INTO REQUESTS (SPEC_parent_child_lifecycle.md §7).
//
// The API returns CHILD rows — that is deliberate and is the requirement that decided the whole model: "a report
// of all requests in redaction should include single-request child records as well as MRR child records". Filters
// therefore run over children, and the queue reassembles them into the citizen's request for display.
//
// Order is the SERVER's (parent recency, then child_no ascending); a Map preserves insertion order, so grouping
// never reshuffles what the ORDER BY decided.
function groupByParent(rows) {
  var groups = new Map();
  rows.forEach(function (r) {
    var key = r.parent_id || r.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  return Array.from(groups.values());
}

// §6.1: a parent has NO stage — `stage` is a child concept, and an MRR's children sit at different stages at
// once, so a single parent-level stage would have to lie about all but one of them. The parent gets a two-value
// PROCESS STATUS instead, derived and never stored: `Complete` once every child is terminal, else `In Process`.
//
// NOTE: the queue filters out `status = 'closed'`, so a genuinely Complete request is normally not on this
// screen at all. The cell still computes honestly rather than hardcoding "In Process" — a filtered view (?status=)
// can surface one, and a hardcoded label would then be a lie.
function parentState(kids) {
  return kids.every(function (k) { return isTerminal(k.stage); }) ? 'Complete' : 'In Process';
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
      if (stageFilter === 'triage') url += 'triage=1&';
      else if (stageFilter === 'objections') url += 'objections=1&';
      else if (stageFilter) url += 'stage=' + stageFilter + '&';
      var r = await api.get(url);
      setRequests(r.data.requests);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  var filtered = search ? requests.filter(function(r) {
    var s = search.toLowerCase();
    return (r.request_number || '').toLowerCase().includes(s)
      || (r.requestor_name || '').toLowerCase().includes(s)
      || (r.requestor_email || '').toLowerCase().includes(s);
  }) : requests;

  var groups = groupByParent(filtered);

  // Counts are of REQUESTS, not work rows — the citizen filed one request, and a 3-record MRR must not read as
  // three. (Stage counts below stay per-child on purpose: "how much work is in redaction" is a child question.)
  var overdue = groups.filter(function(g) { return g[0].deadline_date && new Date(g[0].deadline_date) < new Date(); }).length;
  var counts = {};
  requests.forEach(function(r) { counts[r.stage] = (counts[r.stage] || 0) + 1; });

  var COLS = ['','Request #','Requestor','Stage','Classification','Request Fulfillment Team','Deadline','Assigned To'];
  var th = {textAlign:'left',fontSize:'11px',fontWeight:'600',color:'#6B7280',textTransform:'uppercase',letterSpacing:'.05em',padding:'10px 16px',whiteSpace:'nowrap'};
  var td = {padding:'12px 16px'};

  function openBtn(to, label, title) {
    return <Link to={to} title={title} style={{display:'inline-flex',alignItems:'center',fontSize:'13px',color:'#1F4E79',textDecoration:'none',fontWeight:'600',padding:'6px 12px',background:'#EBF3FB',borderRadius:'6px',whiteSpace:'nowrap'}}>{label}</Link>;
  }

  // One WORK row's cells — shared by the collapsed single-record line and each child line of an MRR, because
  // they are the same thing: a child. Only the leading Request # cell differs.
  function workCells(r) {
    var od = r.deadline_date && new Date(r.deadline_date) < new Date();
    var sc = SC[r.stage];
    var cc = CC[r.classification];
    var w = workLabel(r);
    return [
      <td key="stage" style={td}>
        {sc?<span style={{background:sc.bg,color:sc.color,fontSize:'12px',fontWeight:'500',padding:'4px 10px',borderRadius:'20px',whiteSpace:'nowrap'}}>{STAGES[r.stage]}</span>:<span style={{fontSize:'12px',color:'#6B7280'}}>{r.stage}</span>}
      </td>,
      <td key="class" style={td}>
        {cc?<span style={{background:cc.bg,color:cc.color,fontSize:'11px',fontWeight:'600',padding:'3px 8px',borderRadius:'20px',whiteSpace:'nowrap',textTransform:'none'}}>{r.classification?r.classification.replace(/_/g,' '):'—'}</span>:<span style={{fontSize:'12px',color:'#9CA3AF'}}>—</span>}
      </td>,
      <td key="team" style={td}>
        <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
          <div style={{width:'8px',height:'8px',borderRadius:'50%',background:r.department_color||'#9CA3AF',flexShrink:0}}/>
          {r.department_name ? <span style={{fontSize:'13px',color:'#374151'}}>{r.department_name}</span> : <span style={{fontSize:'13px',color:'#92400E',fontWeight:'600'}}>{r.routing_basis==='unassigned'?'Unassigned · needs triage':'—'}</span>}
        </div>
      </td>,
      <td key="due" style={{...td, whiteSpace:'nowrap'}}>
        <span style={{fontSize:'13px',color:od?'#DC2626':'#6B7280',fontWeight:od?'700':'400'}}>{r.deadline_date||'—'}</span>
      </td>,
      <td key="who" style={{...td, whiteSpace:'nowrap'}}>
        <span style={{fontSize:'13px',color:w.tone,fontWeight:w.bold?'600':'400'}}>{w.text}</span>
      </td>
    ];
  }

  function badges(r, od) {
    return (
      <>
        {r.is_mrr?<span style={{background:'#CCFBF1',color:'#0F766E',fontSize:'10px',fontWeight:'700',padding:'2px 6px',borderRadius:'20px'}}>MRR</span>:null}
        {r.legal_flag?<span style={{background:'#FEF2F2',color:'#DC2626',fontSize:'10px',fontWeight:'700',padding:'2px 6px',borderRadius:'20px'}}>LEGAL</span>:null}
        {od?<span style={{background:'#FEF2F2',color:'#DC2626',fontSize:'10px',fontWeight:'700',padding:'2px 6px',borderRadius:'20px'}}>OVERDUE</span>:null}
        {r.open_objections>0?<span title="Open fee-estimate objection" style={{background:'#FDECEC',color:'#9B1C1C',fontSize:'10px',fontWeight:'700',padding:'2px 6px',borderRadius:'20px'}}>OBJECTION</span>:null}
      </>
    );
  }

  function requestorCell(r) {
    return (
      <td style={td}>
        <div style={{fontWeight:'500',fontSize:'14px',color:'#111'}}>{r.requestor_name}</div>
        <div style={{fontSize:'12px',color:'#9CA3AF'}}>{r.requestor_email}</div>
        {r.fee_waiver_requested?<div style={{fontSize:'11px',color:'#D97706',fontWeight:'600',marginTop:'2px'}}>Fee Waiver Requested</div>:null}
      </td>
    );
  }

  var hover = { on: function(e){e.currentTarget.style.background='#F9FAFB';}, off: function(e){e.currentTarget.style.background='transparent';} };

  return (
    <div style={{maxWidth:'1400px',display:'flex',flexDirection:'column',gap:'20px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 4px'}}>Request Queue</h1>
          <p style={{color:'#9CA3AF',fontSize:'14px',margin:0}}>{groups.length} active request{groups.length!==1?'s':''}{overdue>0?' · '+overdue+' overdue':''}</p>
        </div>
        <Link to="/requests/new" style={{display:'inline-flex',alignItems:'center',gap:'8px',padding:'10px 18px',background:'#1F4E79',color:'white',borderRadius:'8px',textDecoration:'none',fontSize:'14px',fontWeight:'600'}}>+ Log New Request</Link>
      </div>
      <div style={{display:'flex',gap:'8px',overflowX:'auto',paddingBottom:'4px'}}>
        {(function(){ var tcount = requests.filter(function(r){ return !r.department_id; }).length; var active = stageFilter === 'triage'; return (tcount>0 || active) ? <button onClick={function(){setStageFilter('triage');}} style={{padding:'7px 16px',borderRadius:'20px',border:'1px solid '+(active?'#92400E':'#F4D9B0'),background:active?'#92400E':'#FFF7ED',color:active?'white':'#92400E',fontSize:'13px',fontWeight:'600',cursor:'pointer',whiteSpace:'nowrap'}}>Needs triage ({tcount})</button> : null; })()}
        {(function(){ var ocount = requests.filter(function(r){ return r.open_objections>0; }).length; var active = stageFilter === 'objections'; return (ocount>0 || active) ? <button onClick={function(){setStageFilter('objections');}} style={{padding:'7px 16px',borderRadius:'20px',border:'1px solid '+(active?'#9B1C1C':'#F5C2C2'),background:active?'#9B1C1C':'#FDECEC',color:active?'white':'#9B1C1C',fontSize:'13px',fontWeight:'600',cursor:'pointer',whiteSpace:'nowrap'}}>Objections ({ocount})</button> : null; })()}
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
        ):groups.length===0?(
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
                  {COLS.map(function(h,i){ return <th key={i} style={th}>{h}</th>; })}
                </tr>
              </thead>
              <tbody>
                {groups.map(function(kids){
                  var head = kids[0];
                  var od = head.deadline_date && new Date(head.deadline_date) < new Date();

                  // COLLAPSED — child_count = 1. §7: "the pair collapses to a single line and the `-1` suffix is
                  // hidden — the operator sees exactly what they see today." The one child IS the work row, so
                  // Open targets it, exactly as before the wrap.
                  if (Number(head.child_count) <= 1) {
                    return (
                      <tr key={head.id} style={{borderTop:'1px solid #F3F4F6',background:'transparent'}} onMouseOver={hover.on} onMouseOut={hover.off}>
                        <td style={td}>{openBtn('/requests/'+head.id, 'Open →', 'Open the workspace')}</td>
                        <td style={td}>
                          <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                            <span style={{fontFamily:'monospace',fontWeight:'700',color:'#1F4E79',fontSize:'13px'}}>{head.request_number}</span>
                            {badges(head, od)}
                          </div>
                          <div style={{fontSize:'11px',color:'#9CA3AF',marginTop:'2px',textTransform:'none'}}>{prettyChannel(head.submission_channel)}</div>
                        </td>
                        {requestorCell(head)}
                        {workCells(head)}
                      </tr>
                    );
                  }

                  // MRR — a parent line, then one indented line per child. The parent line carries the CITIZEN's
                  // facts (number, requestor, statutory deadline, process status); the child lines carry the WORK
                  // (stage, classification, team, assignee). That split is the schema, not a layout choice: the
                  // parent row genuinely has no stage, description, or department (§5.1).
                  var shown = kids.length;
                  var total = Number(head.child_count);
                  return (
                    <React.Fragment key={head.parent_id}>
                      <tr style={{borderTop:'1px solid #E5E7EB',background:'#FBFDFE'}}>
                        {/* Kevin, 2026-07-16: the Open control moves from the far right to the LEFT of the parent
                            line. On an MRR there is nothing to open yet — the hub (§14.3) is design-gated and not
                            built, and the v1 workspace expects a WORK row, so pointing it at the parent would
                            render a screen with no stage, no description and no team. The children below each open
                            their own workspace; this placeholder is honest until the hub exists. */}
                        <td style={td}>
                          <span title="The MRR hub is not built yet (SPEC_parent_child_lifecycle.md §14.3). Open a record below."
                            style={{display:'inline-flex',alignItems:'center',fontSize:'13px',color:'#9CA3AF',fontWeight:'600',padding:'6px 12px',background:'#F3F4F6',borderRadius:'6px',whiteSpace:'nowrap',cursor:'not-allowed'}}>Hub —</span>
                        </td>
                        <td style={td}>
                          <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                            <span style={{fontFamily:'monospace',fontWeight:'700',color:'#1F4E79',fontSize:'13px'}}>{head.request_number}</span>
                            {badges(head, od)}
                          </div>
                          <div style={{fontSize:'11px',color:'#9CA3AF',marginTop:'2px',textTransform:'none'}}>
                            {prettyChannel(head.submission_channel)} · {shown < total ? shown + ' of ' + total + ' records match' : total + ' records'}
                          </div>
                        </td>
                        {requestorCell(head)}
                        <td style={td}>
                          <span style={{background:'#F1F5F9',color:'#475569',fontSize:'12px',fontWeight:'600',padding:'4px 10px',borderRadius:'20px',whiteSpace:'nowrap'}}>{parentState(kids)}</span>
                        </td>
                        {/* Classification and team are CHILD facts — an MRR's records can differ on both, so the
                            parent line must not pick one and imply it speaks for the rest. */}
                        <td style={td}><span style={{fontSize:'12px',color:'#D1D5DB'}}>—</span></td>
                        <td style={td}><span style={{fontSize:'12px',color:'#D1D5DB'}}>—</span></td>
                        <td style={{...td, whiteSpace:'nowrap'}}>
                          <span style={{fontSize:'13px',color:od?'#DC2626':'#6B7280',fontWeight:od?'700':'400'}}>{head.deadline_date||'—'}</span>
                        </td>
                        {/* §14.1: the MRR parent is system-routed to an ORO Associate via `mrr_processing`. NOT
                            BUILT — so there is no owner to name, and inventing one here would be a lie. */}
                        <td style={td}><span style={{fontSize:'12px',color:'#D1D5DB'}}>—</span></td>
                      </tr>
                      {kids.map(function(c){
                        return (
                          <tr key={c.id} style={{borderTop:'1px solid #F3F4F6',background:'transparent'}} onMouseOver={hover.on} onMouseOut={hover.off}>
                            <td style={{...td, paddingLeft:'40px'}}>{openBtn('/requests/'+c.id, 'Open →', 'Open this record’s workspace')}</td>
                            <td style={td}>
                              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                                <span style={{color:'#D1D5DB',fontSize:'13px'}}>└</span>
                                <span style={{fontFamily:'monospace',fontWeight:'600',color:'#6B7280',fontSize:'12px',whiteSpace:'nowrap'}}>–{c.child_no}</span>
                                <span style={{fontSize:'13px',color:'#374151'}}>{c.component_label || (c.description ? c.description.slice(0,60) + (c.description.length>60?'…':'') : '—')}</span>
                              </div>
                            </td>
                            {/* The requestor is a parent fact and is already on the line above. Repeating it on
                                every child is noise, and it is what makes an MRR read as n separate requests. */}
                            <td style={td}></td>
                            {workCells(c)}
                          </tr>
                        );
                      })}
                    </React.Fragment>
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
