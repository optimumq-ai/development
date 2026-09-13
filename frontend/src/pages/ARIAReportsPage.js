import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { STAGE_LABELS as STAGES } from '../lib/stages';

const COLORS = ['var(--oq-x-1f4e79)','var(--oq-x-2e75b6)','var(--oq-x-5b9bd5)','var(--oq-x-843c0c)','var(--oq-x-375623)','var(--oq-x-7030a0)','var(--oq-x-1f3864)','var(--oq-x-7f6000)'];

export default function ARIAReportsPage() {
  const [stats, setStats] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('all');

  useEffect(function() { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      var [sr, rr] = await Promise.all([api.get('/requests/stats/dashboard'), api.get('/requests')]);
      setStats(sr.data);
      setRequests(rr.data.requests);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  if (loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'256px',color:'var(--oq-fg-9ca3af)'}}>Loading reports...</div>;

  var now = new Date();
  var filtered = requests;
  if (period === '30d') filtered = requests.filter(function(r){ return new Date(r.created_at) > new Date(now - 30*24*60*60*1000); });
  if (period === '7d') filtered = requests.filter(function(r){ return new Date(r.created_at) > new Date(now - 7*24*60*60*1000); });

  var overdue = filtered.filter(function(r){ return r.deadline_date && new Date(r.deadline_date) < now && r.status !== 'closed'; });
  var closed = filtered.filter(function(r){ return r.status === 'closed'; });
  var withFeeWaiver = filtered.filter(function(r){ return r.fee_waiver_requested; });
  var withLegal = filtered.filter(function(r){ return r.legal_flag; });
  var mrr = filtered.filter(function(r){ return r.is_mrr; });

  var byStage = {};
  filtered.forEach(function(r){ if(r.status!=='closed') byStage[r.stage] = (byStage[r.stage]||0) + 1; });

  var byDept = {};
  filtered.forEach(function(r){ var k = r.department_name||'Unassigned'; byDept[k] = (byDept[k]||0) + 1; });

  var byClass = {};
  filtered.forEach(function(r){ var k = r.classification||'standard'; byClass[k] = (byClass[k]||0) + 1; });

  var byChannel = {};
  filtered.forEach(function(r){ var k = r.submission_channel||'portal'; byChannel[k] = (byChannel[k]||0) + 1; });

  var maxDept = Math.max.apply(null, Object.values(byDept).concat([1]));
  var maxStage = Math.max.apply(null, Object.values(byStage).concat([1]));

  var card = { background:'var(--oq-bg-ffffff)', borderRadius:'12px', border:'1px solid var(--oq-ln-e5e7eb)', padding:'20px', display:'flex', flexDirection:'column', gap:'6px' };
  var cardTitle = { fontSize:'12px', fontWeight:'600', color:'var(--oq-fg-9ca3af)', textTransform:'uppercase', letterSpacing:'.05em' };
  var cardValue = { fontSize:'32px', fontWeight:'700', color:'var(--oq-fg-111111)' };

  return (
    <div style={{maxWidth:'1200px',display:'flex',flexDirection:'column',gap:'24px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 4px'}}>ARIA — Reports & Analytics</h1>
          <p style={{color:'var(--oq-fg-9ca3af)',fontSize:'14px',margin:0}}>Automated Records Intelligence & Analysis</p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          {[['all','All Time'],['30d','Last 30 Days'],['7d','Last 7 Days']].map(function(item){
            var active = period === item[0];
            return <button key={item[0]} onClick={function(){setPeriod(item[0]);}}
              style={{padding:'8px 16px',borderRadius:'8px',border:'1px solid '+(active?'var(--oq-ln-1f4e79)':'var(--oq-ln-e5e7eb)'),background:active?'var(--oq-bg-1f4e79)':'var(--oq-bg-ffffff)',color:active?'var(--oq-fg-ffffff)':'var(--oq-fg-6b7280)',fontSize:'13px',fontWeight:active?'700':'500',cursor:'pointer'}}>
              {item[1]}
            </button>;
          })}
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:'16px'}}>
        {[
          {label:'Total Requests',value:filtered.length,color:'var(--oq-fg-1f4e79)',bg:'var(--oq-bg-ebf3fb)'},
          {label:'Active',value:filtered.length-closed.length,color:'var(--oq-fg-1f4e79)',bg:'var(--oq-bg-ebf3fb)'},
          {label:'Closed',value:closed.length,color:'var(--oq-fg-166534)',bg:'var(--oq-bg-f0fdf4)'},
          {label:'Overdue',value:overdue.length,color:overdue.length>0?'var(--oq-fg-dc2626)':'var(--oq-fg-166534)',bg:overdue.length>0?'var(--oq-bg-fef2f2)':'var(--oq-bg-f0fdf4)'},
          {label:'Fee Waivers',value:withFeeWaiver.length,color:'var(--oq-fg-d97706)',bg:'var(--oq-bg-fffbeb)'},
          {label:'Legal Holds',value:withLegal.length,color:'var(--oq-fg-dc2626)',bg:'var(--oq-bg-fef2f2)'},
          {label:'Multi-Record',value:mrr.length,color:'var(--oq-fg-0f766e)',bg:'var(--oq-bg-ccfbf1)'},
        ].map(function(item){
          return <div key={item.label} style={card}>
            <div style={cardTitle}>{item.label}</div>
            <div style={Object.assign({},cardValue,{color:item.color})}>{item.value}</div>
            {filtered.length > 0 && <div style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)'}}>{Math.round(item.value/filtered.length*100)}% of total</div>}
          </div>;
        })}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>
        <div style={{background:'var(--oq-bg-ffffff)',borderRadius:'12px',border:'1px solid var(--oq-ln-e5e7eb)',padding:'24px'}}>
          <h3 style={{fontSize:'15px',fontWeight:'700',margin:'0 0 20px'}}>Active Requests by Stage</h3>
          <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
            {Object.entries(STAGES).map(function(entry){
              var k=entry[0]; var v=entry[1];
              var count = byStage[k]||0;
              var pct = maxStage > 0 ? Math.round(count/maxStage*100) : 0;
              return <div key={k}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px'}}>
                  <span style={{fontSize:'13px',color:'var(--oq-fg-374151)'}}>{v}</span>
                  <span style={{fontSize:'13px',fontWeight:'700',color:'var(--oq-fg-1f4e79)'}}>{count}</span>
                </div>
                <div style={{height:'8px',background:'var(--oq-bg-f3f4f6)',borderRadius:'4px',overflow:'hidden'}}>
                  <div style={{height:'100%',width:pct+'%',background:'var(--oq-bg-1f4e79)',borderRadius:'4px',transition:'width .3s'}}/>
                </div>
              </div>;
            })}
          </div>
        </div>

        <div style={{background:'var(--oq-bg-ffffff)',borderRadius:'12px',border:'1px solid var(--oq-ln-e5e7eb)',padding:'24px'}}>
          <h3 style={{fontSize:'15px',fontWeight:'700',margin:'0 0 20px'}}>Requests by City Department</h3>
          <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
            {Object.entries(byDept).sort(function(a,b){return b[1]-a[1];}).map(function(entry, i){
              var k=entry[0]; var v=entry[1];
              var pct = maxDept > 0 ? Math.round(v/maxDept*100) : 0;
              return <div key={k}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px'}}>
                  <span style={{fontSize:'13px',color:'var(--oq-fg-374151)'}}>{k}</span>
                  <span style={{fontSize:'13px',fontWeight:'700',color:COLORS[i%COLORS.length]}}>{v}</span>
                </div>
                <div style={{height:'8px',background:'var(--oq-bg-f3f4f6)',borderRadius:'4px',overflow:'hidden'}}>
                  <div style={{height:'100%',width:pct+'%',background:COLORS[i%COLORS.length],borderRadius:'4px',transition:'width .3s'}}/>
                </div>
              </div>;
            })}
          </div>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>
        <div style={{background:'var(--oq-bg-ffffff)',borderRadius:'12px',border:'1px solid var(--oq-ln-e5e7eb)',padding:'24px'}}>
          <h3 style={{fontSize:'15px',fontWeight:'700',margin:'0 0 20px'}}>Classification Breakdown</h3>
          <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
            {[['simple','Simple','var(--oq-x-166534)','var(--oq-x-f0fdf4)'],['standard','Standard','var(--oq-x-1e40af)','var(--oq-x-dbeafe)'],['complex','Complex','var(--oq-x-92400e)','var(--oq-x-fef3c7)'],['redaction_required','Redaction Required','var(--oq-x-991b1b)','var(--oq-x-fee2e2)']].map(function(item){
              var count = byClass[item[0]]||0;
              var pct = filtered.length > 0 ? Math.round(count/filtered.length*100) : 0;
              return <div key={item[0]} style={{display:'flex',alignItems:'center',gap:'12px',padding:'10px 14px',background:item[3],borderRadius:'8px'}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:'13px',fontWeight:'600',color:item[2]}}>{item[1]}</div>
                  <div style={{fontSize:'12px',color:item[2],opacity:.7}}>{pct}% of requests</div>
                </div>
                <div style={{fontSize:'24px',fontWeight:'700',color:item[2]}}>{count}</div>
              </div>;
            })}
          </div>
        </div>

        <div style={{background:'var(--oq-bg-ffffff)',borderRadius:'12px',border:'1px solid var(--oq-ln-e5e7eb)',padding:'24px'}}>
          <h3 style={{fontSize:'15px',fontWeight:'700',margin:'0 0 20px'}}>Submission Channels</h3>
          <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
            {Object.entries(byChannel).sort(function(a,b){return b[1]-a[1];}).map(function(entry,i){
              var k=entry[0]; var v=entry[1];
              var pct = filtered.length > 0 ? Math.round(v/filtered.length*100) : 0;
              return <div key={k} style={{display:'flex',alignItems:'center',gap:'12px',padding:'10px 14px',background:'var(--oq-bg-f9fafb)',borderRadius:'8px',border:'1px solid var(--oq-ln-f3f4f6)'}}>
                <div style={{width:'36px',height:'36px',borderRadius:'8px',background:COLORS[i%COLORS.length],display:'flex',alignItems:'center',justifyContent:'center',color:'var(--oq-fg-ffffff)',fontSize:'16px',flexShrink:0}}>
                  {k==='portal'?'🌐':k==='phone'?'📞':k==='walkin'?'🚶':k==='mail'?'✉️':k==='email'?'📧':'📋'}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'var(--oq-fg-111111)',textTransform:'capitalize'}}>{k}</div>
                  <div style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)'}}>{pct}% of submissions</div>
                </div>
                <div style={{fontSize:'20px',fontWeight:'700',color:'var(--oq-fg-374151)'}}>{v}</div>
              </div>;
            })}
          </div>
        </div>
      </div>

      <div style={{background:'var(--oq-bg-ffffff)',borderRadius:'12px',border:'1px solid var(--oq-ln-e5e7eb)',padding:'24px'}}>
        <h3 style={{fontSize:'15px',fontWeight:'700',margin:'0 0 16px'}}>Overdue Requests</h3>
        {overdue.length === 0 ? (
          <div style={{padding:'32px',textAlign:'center',color:'var(--oq-fg-9ca3af)'}}>
            <div style={{fontSize:'32px',marginBottom:'12px'}}>✅</div>
            <div style={{fontSize:'15px',fontWeight:'600',color:'var(--oq-fg-4b5563)'}}>No overdue requests</div>
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'var(--oq-bg-f9fafb)'}}>
              {['Request #','Requestor','Stage','Request Fulfillment Team','Deadline','Days Overdue'].map(function(h){
                return <th key={h} style={{textAlign:'left',fontSize:'11px',fontWeight:'600',color:'var(--oq-fg-6b7280)',textTransform:'uppercase',letterSpacing:'.05em',padding:'10px 16px'}}>{h}</th>;
              })}
            </tr></thead>
            <tbody>
              {overdue.map(function(r){
                var daysOver = Math.floor((now - new Date(r.deadline_date))/(1000*60*60*24));
                return <tr key={r.id} style={{borderTop:'1px solid var(--oq-ln-f3f4f6)'}}>
                  <td style={{padding:'12px 16px',fontFamily:'monospace',fontWeight:'700',color:'var(--oq-fg-1f4e79)',fontSize:'13px'}}>{r.request_number}</td>
                  <td style={{padding:'12px 16px',fontSize:'13px'}}>{r.requestor_name}</td>
                  <td style={{padding:'12px 16px',fontSize:'13px'}}>{STAGES[r.stage]||r.stage}</td>
                  <td style={{padding:'12px 16px',fontSize:'13px'}}>{r.department_name||'—'}</td>
                  <td style={{padding:'12px 16px',fontSize:'13px',color:'var(--oq-fg-dc2626)',fontWeight:'600'}}>{r.deadline_date}</td>
                  <td style={{padding:'12px 16px'}}>
                    <span style={{background:'var(--oq-bg-fef2f2)',color:'var(--oq-fg-dc2626)',fontSize:'12px',fontWeight:'700',padding:'3px 10px',borderRadius:'20px'}}>{daysOver} day{daysOver!==1?'s':''}</span>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
