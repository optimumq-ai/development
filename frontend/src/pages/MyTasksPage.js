import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import TaskPoolSection from '../components/ui/TaskPoolSection';
import { STAGE_LABELS as STAGES, STAGE_COLORS as SC } from '../lib/stages';


export default function MyTasksPage() {
  const store = useAuthStore();
  const user = store.user;
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [myObjs, setMyObjs] = useState([]);
  const [pendingObjs, setPendingObjs] = useState([]);
  const canApprove = store.hasAnyRole('FEE_WAIVER_APPROVER', 'SYSTEM_ADMIN', 'DIRECTOR');

  useEffect(function() { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      var r = await api.get('/requests');
      setRequests(r.data.requests);
      try { var mo = await api.get('/objections/mine'); setMyObjs(mo.data.objections || []); } catch (e2) {}
      if (store.hasAnyRole('FEE_WAIVER_APPROVER', 'SYSTEM_ADMIN', 'DIRECTOR')) { try { var pa = await api.get('/objections/pending-approval'); setPendingObjs(pa.data.objections || []); } catch (e3) {} }
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  var myRequests = requests.filter(function(r) {
    return r.assigned_to === (user && user.id);
  });

  var overdue = myRequests.filter(function(r) {
    return r.deadline_date && new Date(r.deadline_date) < new Date();
  });

  var dueSoon = myRequests.filter(function(r) {
    if (!r.deadline_date) return false;
    var d = new Date(r.deadline_date);
    var now = new Date();
    var diff = (d - now) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 3;
  });

  var filtered = filter === 'overdue' ? overdue : filter === 'due_soon' ? dueSoon : myRequests;

  return (
    <div style={{maxWidth:'1100px',display:'flex',flexDirection:'column',gap:'20px'}}>
      <div>
        <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 4px'}}>My Tasks</h1>
        <p style={{color:'#9CA3AF',fontSize:'14px',margin:0}}>
          Requests assigned to you — {myRequests.length} active{overdue.length>0?' · '+overdue.length+' overdue':''}
        </p>
      </div>
      {myObjs.length ? (
        <div style={{background:'white',border:'1px solid #FDE68A',borderRadius:'12px',padding:'16px 18px'}}>
          <div style={{fontSize:'14px',fontWeight:700,color:'#92400E',marginBottom:'8px'}}>Fee Estimate Objections <span style={{fontSize:'12px',fontWeight:600,color:'#B45309'}}>({myObjs.length})</span></div>
          {myObjs.map(function(o){ return (
            <div key={o.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0',borderTop:'1px solid #F3F4F6'}}>
              <div style={{fontSize:'13px',color:'#374151'}}><strong>{o.reason}</strong> <span style={{color:'#9CA3AF'}}>&middot; {o.requestNumber||o.requestId} &middot; {o.status==='tentative'?'pending approval':'open'}</span></div>
              <Link to={'/requests/'+o.requestId} style={{fontSize:'12.5px',color:'#1F4E79',textDecoration:'none',fontWeight:700}}>Open &rarr; Fees</Link>
            </div>
          ); })}
        </div>
      ) : null}
      {canApprove && pendingObjs.length ? (
        <div style={{background:'white',border:'1px solid #FCA5A5',borderRadius:'12px',padding:'16px 18px'}}>
          <div style={{fontSize:'14px',fontWeight:700,color:'#9B1C1C',marginBottom:'8px'}}>Fee resolutions awaiting your approval <span style={{fontSize:'12px',fontWeight:600}}>({pendingObjs.length})</span></div>
          {pendingObjs.map(function(o){ return (
            <div key={o.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0',borderTop:'1px solid #F3F4F6'}}>
              <div style={{fontSize:'13px',color:'#374151'}}>{o.resolutionType} of <strong>${(Number(o.resolutionAmount)||0).toFixed(2)}</strong> <span style={{color:'#9CA3AF'}}>&middot; {o.requestNumber||o.requestId} &middot; proposed by {o.assigneeName}</span></div>
              <Link to={'/requests/'+o.requestId} style={{fontSize:'12.5px',color:'#1F4E79',textDecoration:'none',fontWeight:700}}>Review &rarr; Fees</Link>
            </div>
          ); })}
        </div>
      ) : null}

      <TaskPoolSection />

      {myRequests.length === 0 && !loading && (
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',padding:'64px',textAlign:'center'}}>
          <div style={{fontSize:'48px',marginBottom:'16px'}}>✅</div>
          <div style={{fontSize:'18px',fontWeight:'600',color:'#4B5563',marginBottom:'8px'}}>No tasks assigned to you</div>
          <div style={{fontSize:'14px',color:'#9CA3AF',marginBottom:'24px'}}>Requests assigned to you will appear here</div>
          <Link to="/requests" style={{display:'inline-flex',padding:'10px 20px',background:'#1F4E79',color:'white',borderRadius:'8px',textDecoration:'none',fontSize:'14px',fontWeight:'600'}}>
            View Request Queue
          </Link>
        </div>
      )}

      {myRequests.length > 0 && (
        <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
            {[
              {key:'all',label:'All My Tasks',value:myRequests.length,bg:'#EBF3FB',color:'#1F4E79'},
              {key:'overdue',label:'Overdue',value:overdue.length,bg:overdue.length>0?'#FEF2F2':'#F9FAFB',color:overdue.length>0?'#DC2626':'#9CA3AF'},
              {key:'due_soon',label:'Due Within 3 Days',value:dueSoon.length,bg:dueSoon.length>0?'#FFFBEB':'#F9FAFB',color:dueSoon.length>0?'#D97706':'#9CA3AF'},
            ].map(function(item){
              var active = filter === item.key;
              return (
                <button key={item.key} onClick={function(){setFilter(item.key);}}
                  style={{display:'flex',alignItems:'center',gap:'14px',padding:'16px',background:'white',borderRadius:'12px',border:'2px solid '+(active?item.color:'#E5E7EB'),cursor:'pointer',textAlign:'left',transition:'border-color .15s'}}>
                  <div style={{width:'44px',height:'44px',borderRadius:'10px',background:item.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px',fontWeight:'700',color:item.color,flexShrink:0}}>
                    {item.value}
                  </div>
                  <div style={{fontSize:'13px',color:active?item.color:'#6B7280',fontWeight:active?'700':'500'}}>{item.label}</div>
                </button>
              );
            })}
          </div>

          <div style={{background:'white',borderRadius:'12px',border:'1px solid #E5E7EB',overflow:'hidden'}}>
            {loading ? (
              <div style={{padding:'48px',textAlign:'center',color:'#9CA3AF'}}>Loading...</div>
            ) : filtered.length === 0 ? (
              <div style={{padding:'48px',textAlign:'center',color:'#9CA3AF'}}>
                <div style={{fontSize:'32px',marginBottom:'12px'}}>👍</div>
                <div style={{fontSize:'15px',fontWeight:'600',color:'#4B5563'}}>No {filter === 'overdue' ? 'overdue' : 'upcoming'} tasks</div>
              </div>
            ) : (
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{background:'#F9FAFB'}}>
                    {['Request #','Requestor','Stage','Request Fulfillment Team','Deadline',''].map(function(h){
                      return <th key={h} style={{textAlign:'left',fontSize:'11px',fontWeight:'600',color:'#6B7280',textTransform:'uppercase',letterSpacing:'.05em',padding:'10px 16px'}}>{h}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(function(r){
                    var od = r.deadline_date && new Date(r.deadline_date) < new Date();
                    var sc = SC[r.stage];
                    return (
                      <tr key={r.id} style={{borderTop:'1px solid #F3F4F6'}}
                        onMouseOver={function(e){e.currentTarget.style.background='#F9FAFB';}}
                        onMouseOut={function(e){e.currentTarget.style.background='white';}}>
                        <td style={{padding:'12px 16px'}}>
                          <div style={{fontFamily:'monospace',fontWeight:'700',color:'#1F4E79',fontSize:'13px'}}>{r.request_number}</div>
                          {od && <div style={{fontSize:'11px',color:'#DC2626',fontWeight:'700',marginTop:'2px'}}>⚠ OVERDUE</div>}
                        </td>
                        <td style={{padding:'12px 16px'}}>
                          <div style={{fontWeight:'500',fontSize:'14px'}}>{r.requestor_name}</div>
                          <div style={{fontSize:'12px',color:'#9CA3AF'}}>{r.requestor_email}</div>
                        </td>
                        <td style={{padding:'12px 16px'}}>
                          {sc ? <span style={{background:sc.bg,color:sc.color,fontSize:'12px',fontWeight:'500',padding:'3px 10px',borderRadius:'20px'}}>{STAGES[r.stage]}</span> : <span style={{fontSize:'12px',color:'#6B7280'}}>{r.stage}</span>}
                        </td>
                        <td style={{padding:'12px 16px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                            <div style={{width:'8px',height:'8px',borderRadius:'50%',background:r.department_color||'#9CA3AF'}}/>
                            <span style={{fontSize:'13px'}}>{r.department_name||'—'}</span>
                          </div>
                        </td>
                        <td style={{padding:'12px 16px'}}>
                          <span style={{fontSize:'13px',color:od?'#DC2626':'#6B7280',fontWeight:od?'700':'400'}}>{r.deadline_date||'—'}</span>
                        </td>
                        <td style={{padding:'12px 16px'}}>
                          <Link to={'/requests/'+r.id} style={{fontSize:'13px',color:'#1F4E79',textDecoration:'none',fontWeight:'600',padding:'6px 12px',background:'#EBF3FB',borderRadius:'6px'}}>Open →</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
