import React, { useState, useEffect } from 'react';
import api from '../lib/api';

const DELIVERY = [{ value: 'email', label: 'Email' },{ value: 'mail', label: 'Physical Mail' },{ value: 'pickup', label: 'In-Person Pickup' }];
const REQUESTOR_TYPES = [{ value: 'individual', label: 'Individual' },{ value: 'journalist', label: 'Journalist / News Media' },{ value: 'nonprofit', label: 'Nonprofit Organization' },{ value: 'attorney', label: 'Attorney' },{ value: 'researcher', label: 'Researcher' },{ value: 'business', label: 'Business' }];

export default function PublicPortalPage() {
  const [step, setStep] = useState('form');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [requestNumber, setRequestNumber] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [form, setForm] = useState({ requestorName:'', requestorEmail:'', requestorPhone:'', requestorType:'individual', deliveryMethod:'email', description:'', feeWaiverRequested:false });

  useEffect(function() {
    fetch('/api/config/public').then(function(r){ return r.json(); }).then(function(d){ if(d.agency_name) setAgencyName(d.agency_name); }).catch(function(){});
  }, []);

  function setF(k,v){ setForm(function(f){ return Object.assign({},f,{[k]:v}); }); }

  async function handleSubmit(e) {
    e.preventDefault(); setErr('');
    if (!form.requestorName || !form.requestorEmail || !form.description) { setErr('Please fill in all required fields'); return; }
    if (form.description.length < 20) { setErr('Please provide a more detailed description of the records you are requesting'); return; }
    setSubmitting(true);
    try {
      var payload = Object.assign({}, form, { submissionChannel: 'portal', classification: 'standard' });
      var r = await fetch('/api/requests/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Submission failed');
      setRequestNumber(data.requestNumber);
      setStep('confirmation');
    } catch(e) { setErr(e.message || 'Submission failed. Please try again.'); }
    setSubmitting(false);
  }

  var inp = { width:'100%', padding:'12px 14px', border:'1px solid #D1D5DB', borderRadius:'10px', fontSize:'15px', outline:'none', boxSizing:'border-box', background:'white', fontFamily:'inherit' };
  var lbl = { display:'block', fontSize:'14px', fontWeight:'600', color:'#374151', marginBottom:'8px' };
  var hint = { fontSize:'13px', color:'#9CA3AF', marginTop:'6px' };

  if (step === 'confirmation') {
    return (
      <div style={{minHeight:'100vh',background:'#F8FAFC',display:'flex',alignItems:'center',justifyContent:'center',padding:'24px'}}>
        <div style={{maxWidth:'560px',width:'100%',background:'white',borderRadius:'20px',padding:'48px',boxShadow:'0 4px 24px rgba(0,0,0,.08)',textAlign:'center'}}>
          <div style={{width:'72px',height:'72px',borderRadius:'50%',background:'#F0FDF4',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 24px',fontSize:'36px'}}>✅</div>
          <h1 style={{fontSize:'24px',fontWeight:'700',color:'#111',margin:'0 0 12px'}}>Request Submitted</h1>
          <p style={{fontSize:'15px',color:'#6B7280',margin:'0 0 24px',lineHeight:'1.6'}}>Your public records request has been received and assigned a tracking number.</p>
          <div style={{background:'#EBF3FB',borderRadius:'12px',padding:'20px',marginBottom:'28px'}}>
            <div style={{fontSize:'13px',color:'#1F4E79',fontWeight:'600',marginBottom:'6px'}}>YOUR REQUEST NUMBER</div>
            <div style={{fontSize:'28px',fontWeight:'700',color:'#1F4E79',fontFamily:'monospace'}}>{requestNumber}</div>
          </div>
          <div style={{background:'#F9FAFB',borderRadius:'12px',padding:'20px',marginBottom:'28px',textAlign:'left'}}>
            <div style={{fontSize:'14px',fontWeight:'700',color:'#374151',marginBottom:'12px'}}>What happens next:</div>
            {[
              ['📋','Intake Review','Staff will review your request within 1-2 business days'],
              ['🔍','Record Search','We will locate responsive records in our system'],
              ['📬','Delivery','Records will be delivered via your preferred method'],
            ].map(function(item){
              return <div key={item[0]} style={{display:'flex',gap:'12px',marginBottom:'10px',alignItems:'flex-start'}}>
                <span style={{fontSize:'18px',flexShrink:0}}>{item[0]}</span>
                <div>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'#374151'}}>{item[1]}</div>
                  <div style={{fontSize:'13px',color:'#9CA3AF'}}>{item[2]}</div>
                </div>
              </div>;
            })}
          </div>
          <p style={{fontSize:'13px',color:'#9CA3AF',margin:0}}>A confirmation has been sent to <strong>{form.requestorEmail}</strong>. Please save your request number for tracking purposes.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{minHeight:'100vh',background:'#F8FAFC'}}>
      <div style={{background:'#1F4E79',padding:'20px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:'14px'}}>
          <div style={{width:'40px',height:'40px',borderRadius:'10px',background:'rgba(255,255,255,.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px'}}>🛡️</div>
          <div>
            <div style={{color:'white',fontWeight:'700',fontSize:'16px'}}>{agencyName||'City'}</div>
            <div style={{color:'rgba(255,255,255,.7)',fontSize:'12px'}}>Public Records Request Portal</div>
          </div>
        </div>
        <div style={{color:'rgba(255,255,255,.7)',fontSize:'12px'}}>Powered by Optimum Q</div>
      </div>

      <div style={{maxWidth:'680px',margin:'0 auto',padding:'32px 24px'}}>
        <div style={{marginBottom:'28px'}}>
          <h1 style={{fontSize:'26px',fontWeight:'700',color:'#111',margin:'0 0 8px'}}>Submit a Public Records Request</h1>
          <p style={{fontSize:'15px',color:'#6B7280',margin:0,lineHeight:'1.6'}}>Use this form to request public records. All fields marked with <span style={{color:'#DC2626'}}>*</span> are required. Your request will be processed in accordance with applicable public records law.</p>
        </div>

        <div style={{background:'#EBF3FB',borderRadius:'12px',padding:'16px',marginBottom:'24px',display:'flex',gap:'12px'}}>
          <span style={{fontSize:'20px',flexShrink:0}}>ℹ️</span>
          <div style={{fontSize:'13px',color:'#1F4E79',lineHeight:'1.6'}}>
            <strong>Before submitting:</strong> Please be as specific as possible about the records you are requesting. Include relevant dates, names, departments, and subject matter. Vague requests may result in delays or requests for clarification.
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:'24px'}}>
          <div style={{background:'white',borderRadius:'16px',padding:'28px',boxShadow:'0 1px 4px rgba(0,0,0,.06)'}}>
            <h2 style={{fontSize:'16px',fontWeight:'700',color:'#111',margin:'0 0 20px',paddingBottom:'14px',borderBottom:'1px solid #F3F4F6'}}>Your Information</h2>
            <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
                <div>
                  <label style={lbl}>Full Name <span style={{color:'#DC2626'}}>*</span></label>
                  <input value={form.requestorName} onChange={function(e){setF('requestorName',e.target.value);}} style={inp} placeholder="Jane Smith" required/>
                </div>
                <div>
                  <label style={lbl}>Email Address <span style={{color:'#DC2626'}}>*</span></label>
                  <input type="email" value={form.requestorEmail} onChange={function(e){setF('requestorEmail',e.target.value);}} style={inp} placeholder="jane@example.com" required/>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
                <div>
                  <label style={lbl}>Phone Number</label>
                  <input value={form.requestorPhone} onChange={function(e){setF('requestorPhone',e.target.value);}} style={inp} placeholder="(555) 000-0000"/>
                  <div style={hint}>Optional — helpful if we need to contact you</div>
                </div>
                <div>
                  <label style={lbl}>I am requesting as a</label>
                  <select value={form.requestorType} onChange={function(e){setF('requestorType',e.target.value);}} style={inp}>
                    {REQUESTOR_TYPES.map(function(t){return <option key={t.value} value={t.value}>{t.label}</option>;})}
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl}>Preferred Delivery Method</label>
                <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
                  {DELIVERY.map(function(d){
                    var active=form.deliveryMethod===d.value;
                    return <button key={d.value} type="button" onClick={function(){setF('deliveryMethod',d.value);}}
                      style={{padding:'10px 20px',borderRadius:'10px',border:'2px solid '+(active?'#1F4E79':'#E5E7EB'),background:active?'#EBF3FB':'white',color:active?'#1F4E79':'#6B7280',fontSize:'14px',fontWeight:active?'700':'500',cursor:'pointer'}}>
                      {d.label}
                    </button>;
                  })}
                </div>
              </div>
            </div>
          </div>

          <div style={{background:'white',borderRadius:'16px',padding:'28px',boxShadow:'0 1px 4px rgba(0,0,0,.06)'}}>
            <h2 style={{fontSize:'16px',fontWeight:'700',color:'#111',margin:'0 0 20px',paddingBottom:'14px',borderBottom:'1px solid #F3F4F6'}}>Records Requested</h2>
            <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
              <div>
                <label style={lbl}>Description of Records Requested <span style={{color:'#DC2626'}}>*</span></label>
                <textarea value={form.description} onChange={function(e){setF('description',e.target.value);}} style={Object.assign({},inp,{minHeight:'160px',resize:'vertical',lineHeight:'1.6'})} placeholder="Please describe the specific records you are requesting. Include relevant dates, subject matter, departments, and any other details that will help us locate the records..." required/>
                <div style={hint}>{form.description.length} characters — the more detail you provide, the faster we can respond</div>
              </div>
              <div style={{display:'flex',alignItems:'flex-start',gap:'12px',padding:'14px',background:'#F9FAFB',borderRadius:'10px',border:'1px solid #F3F4F6',cursor:'pointer'}} onClick={function(){setF('feeWaiverRequested',!form.feeWaiverRequested);}}>
                <input type="checkbox" checked={form.feeWaiverRequested} onChange={function(e){setF('feeWaiverRequested',e.target.checked);}} style={{width:'18px',height:'18px',marginTop:'2px',flexShrink:0,cursor:'pointer'}}/>
                <div>
                  <div style={{fontSize:'14px',fontWeight:'600',color:'#374151'}}>I am requesting a fee waiver</div>
                  <div style={{fontSize:'13px',color:'#9CA3AF',marginTop:'2px'}}>Check this box if you are a member of the news media, a nonprofit organization, or an academic researcher. Fee waivers are subject to approval.</div>
                </div>
              </div>
            </div>
          </div>

          <div style={{background:'#FFFBEB',borderRadius:'12px',padding:'16px',border:'1px solid #FDE68A',fontSize:'13px',color:'#92400E',lineHeight:'1.6'}}>
            <strong>Notice:</strong> Submission of a public records request does not guarantee that all requested records exist or are available for release. Some records may be exempt from disclosure under applicable law. You will be notified of any applicable fees before records are released.
          </div>

          {err && <div style={{background:'#FEF2F2',border:'1px solid #FCA5A5',borderRadius:'10px',padding:'14px',fontSize:'14px',color:'#DC2626'}}>{err}</div>}

          <button type="submit" disabled={submitting} style={{padding:'16px',background:'#1F4E79',color:'white',border:'none',borderRadius:'12px',fontSize:'16px',fontWeight:'700',cursor:'pointer',boxShadow:'0 4px 12px rgba(31,78,121,.3)'}}>
            {submitting ? 'Submitting...' : 'Submit Public Records Request →'}
          </button>

          <div style={{textAlign:'center',fontSize:'13px',color:'#9CA3AF',paddingBottom:'24px'}}>
            By submitting this form you confirm that the information provided is accurate to the best of your knowledge.
          </div>
        </form>
      </div>
    </div>
  );
}
