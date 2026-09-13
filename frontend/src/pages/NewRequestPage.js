import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

const CLASSIFICATIONS = [
  { value: 'simple', label: 'Simple', desc: '5 business days' },
  { value: 'standard', label: 'Standard', desc: '10 business days' },
  { value: 'complex', label: 'Complex', desc: '20 business days' },
  { value: 'redaction_required', label: 'Redaction Required', desc: '30 business days' },
];
const CHANNELS = [{ value: 'portal', label: 'Public Portal' },{ value: 'phone', label: 'Phone' },{ value: 'walkin', label: 'Walk-In' },{ value: 'mail', label: 'Mail' },{ value: 'email', label: 'Email' }];
const REQUESTOR_TYPES = [{ value: 'individual', label: 'Individual' },{ value: 'journalist', label: 'Journalist / News Media' },{ value: 'nonprofit', label: 'Nonprofit Organization' },{ value: 'attorney', label: 'Attorney' },{ value: 'researcher', label: 'Researcher' },{ value: 'business', label: 'Business' }];
const DELIVERY = [{ value: 'email', label: 'Email' },{ value: 'mail', label: 'Physical Mail' },{ value: 'pickup', label: 'In-Person Pickup' }];

const EMPTY_FORM = { requestorName:'', requestorEmail:'', requestorPhone:'', requestorType:'individual', deliveryMethod:'email', description:'', classification:'standard', departmentId:'', feeWaiverRequested:false, certificationRequested:false, submissionChannel:'phone', isMrr:false, identityConfirmed:false };

export default function NewRequestPage() {
  const nav = useNavigate();
  const fileRef = useRef();
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiExtracted, setAiExtracted] = useState(false);
  const [lowConfidenceFields, setLowConfidenceFields] = useState({});
  const [uploadedFile, setUploadedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  // FORM BUILD (2026-08-01): one description per described record (§5.1). The main description is
  // Record 1 — every AI-assist flow keeps working on it — and these are Records 2..10, so a paper
  // form's items log in exactly the portal's parent/child shape. is_mrr is derived, never a checkbox.
  const [extraItems, setExtraItems] = useState([]);

  useEffect(function() {
    api.get('/departments').then(function(r){ setDepartments(r.data.departments); }).catch(function(){});
  }, []);

  function setF(field, value) { setForm(function(f) { return Object.assign({}, f, { [field]: value }); }); }

  async function handleFileSelect(e) {
    var file = e.target.files[0];
    if (!file) return;
    setUploadedFile(file);
    if (file.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }
    await extractFromDocument(file);
  }

  async function extractFromDocument(file) {
    setExtracting(true); setErr(''); setAiExtracted(false);
    try {
      var formData = new FormData();
      formData.append('document', file);
      var r = await api.post('/extract', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      var d = r.data;
      var lowConf = {};
      if (d.confidence) {
        Object.keys(d.confidence).forEach(function(k) {
          if (d.confidence[k] < 75) lowConf[k] = true;
        });
      }
      setLowConfidenceFields(lowConf);
      setForm({
        requestorName: d.requestor_name || '',
        requestorEmail: d.requestor_email || '',
        requestorPhone: d.requestor_phone || '',
        requestorType: d.requestor_type || 'individual',
        deliveryMethod: d.delivery_method || 'email',
        description: d.description || '',
        classification: d.classification || 'standard',
        departmentId: d.department_id || '',
        feeWaiverRequested: !!d.fee_waiver_signal,
        submissionChannel: 'mail',
        isMrr: !!d.mrr_flag,
      });
      setAiExtracted(true);
      setAiSuggestion({ reasoning: d.reasoning, confidence: d.confidence, department_name: d.department_name });
    } catch(e) {
      setErr('Document extraction failed. Please fill in the form manually.');
    }
    setExtracting(false);
  }

  async function analyzeWithAI() {
    if (!form.description || form.description.length < 20) return;
    setAnalyzing(true); setAiSuggestion(null);
    try {
      var r = await api.post('/classify', { description: form.description });
      setAiSuggestion(r.data);
      if (r.data.confidence >= 85) {
        setForm(function(f) {
          var updates = { classification: r.data.classification };
          if (r.data.department_id) updates.departmentId = r.data.department_id;
          if (r.data.mrr_flag) updates.isMrr = true;
          if (r.data.fee_waiver_signal) updates.feeWaiverRequested = true;
          return Object.assign({}, f, updates);
        });
      }
    } catch(e) { console.error(e); }
    setAnalyzing(false);
  }

  async function handleSubmit(e) {
    e.preventDefault(); setErr('');
    if (!form.requestorName || !form.requestorEmail || !form.description) { setErr('Please fill in all required fields'); return; }
    setLoading(true);
    try {
      var extras = extraItems.map(function (t) { return t.trim(); }).filter(Boolean);
      var payload = form;
      if (extras.length) {
        payload = Object.assign({}, form, {
          children: [{ description: form.description }].concat(extras.map(function (t) { return { description: t }; }))
        });
      }
      var r = await api.post('/requests', payload);
      nav('/requests/' + r.data.requestId);
    } catch(e) { setErr(e.response && e.response.data ? e.response.data.error : 'Failed to create request'); }
    setLoading(false);
  }

  var inp = { width:'100%', padding:'10px 12px', border:'1px solid var(--oq-ln-e5e7eb)', borderRadius:'8px', fontSize:'14px', outline:'none', boxSizing:'border-box', background:'var(--oq-bg-ffffff)' };
  var inpLow = Object.assign({}, inp, { border:'2px solid var(--oq-ln-f59e0b)', background:'var(--oq-bg-fffbeb)' });
  var lbl = { display:'block', fontSize:'13px', fontWeight:'600', color:'var(--oq-fg-374151)', marginBottom:'6px' };
  var section = { background:'var(--oq-bg-ffffff)', borderRadius:'12px', border:'1px solid var(--oq-ln-e5e7eb)', padding:'24px', display:'flex', flexDirection:'column', gap:'16px' };

  if (!mode) {
    return (
      <div style={{maxWidth:'700px',display:'flex',flexDirection:'column',gap:'20px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'16px'}}>
          <button onClick={function(){nav('/requests');}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--oq-fg-6b7280)',fontSize:'14px',padding:'8px 12px',borderRadius:'8px'}}>← Back</button>
          <div>
            <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 2px'}}>Log New Request</h1>
            <p style={{color:'var(--oq-fg-9ca3af)',fontSize:'13px',margin:0}}>Choose how to enter this request</p>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
          <button onClick={function(){setMode('import');}} style={{background:'var(--oq-bg-ffffff)',border:'2px solid var(--oq-ln-e5e7eb)',borderRadius:'16px',padding:'32px 24px',cursor:'pointer',textAlign:'left',transition:'all .15s'}}
            onMouseOver={function(e){e.currentTarget.style.borderColor='var(--oq-ln-1f4e79)';e.currentTarget.style.background='var(--oq-bg-ebf3fb)';}}
            onMouseOut={function(e){e.currentTarget.style.borderColor='var(--oq-ln-e5e7eb)';e.currentTarget.style.background='var(--oq-bg-ffffff)';}}>
            <div style={{fontSize:'40px',marginBottom:'16px'}}>📄</div>
            <div style={{fontSize:'17px',fontWeight:'700',color:'var(--oq-fg-111111)',marginBottom:'8px'}}>Import from Document</div>
            <div style={{fontSize:'13px',color:'var(--oq-fg-6b7280)',lineHeight:'1.5'}}>Upload a PDF or photo of a letter or email. AI will read the document and fill in the form automatically.</div>
            <div style={{marginTop:'16px',fontSize:'12px',color:'var(--oq-fg-1f4e79)',fontWeight:'600'}}>Recommended for letters & emails →</div>
          </button>
          <button onClick={function(){setMode('manual');}} style={{background:'var(--oq-bg-ffffff)',border:'2px solid var(--oq-ln-e5e7eb)',borderRadius:'16px',padding:'32px 24px',cursor:'pointer',textAlign:'left',transition:'all .15s'}}
            onMouseOver={function(e){e.currentTarget.style.borderColor='var(--oq-ln-1f4e79)';e.currentTarget.style.background='var(--oq-bg-ebf3fb)';}}
            onMouseOut={function(e){e.currentTarget.style.borderColor='var(--oq-ln-e5e7eb)';e.currentTarget.style.background='var(--oq-bg-ffffff)';}}>
            <div style={{fontSize:'40px',marginBottom:'16px'}}>✏️</div>
            <div style={{fontSize:'17px',fontWeight:'700',color:'var(--oq-fg-111111)',marginBottom:'8px'}}>Enter Manually</div>
            <div style={{fontSize:'13px',color:'var(--oq-fg-6b7280)',lineHeight:'1.5'}}>Fill in the form directly. Best for phone calls, walk-ins, and requests without a written document.</div>
            <div style={{marginTop:'16px',fontSize:'12px',color:'var(--oq-fg-6b7280)',fontWeight:'600'}}>Phone, walk-in, other →</div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{maxWidth:'860px',display:'flex',flexDirection:'column',gap:'20px'}}>
      <div style={{display:'flex',alignItems:'center',gap:'16px'}}>
        <button onClick={function(){setMode(null);setAiExtracted(false);setAiSuggestion(null);setForm(EMPTY_FORM);setUploadedFile(null);}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--oq-fg-6b7280)',fontSize:'14px',padding:'8px 12px',borderRadius:'8px'}}>← Back</button>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 2px'}}>{mode==='import'?'Import Request Document':'Log New Request'}</h1>
          <p style={{color:'var(--oq-fg-9ca3af)',fontSize:'13px',margin:0}}>{mode==='import'?'Upload a document — AI will extract the request details':'Enter request details manually'}</p>
        </div>
      </div>

      {mode==='import' && !aiExtracted && (
        <div style={section}>
          <div style={{fontSize:'15px',fontWeight:'700',borderBottom:'1px solid var(--oq-ln-f3f4f6)',paddingBottom:'12px'}}>Upload Request Document</div>
          <div onClick={function(){fileRef.current.click();}} style={{border:'3px dashed var(--oq-ln-d1d5db)',borderRadius:'12px',padding:'48px',textAlign:'center',cursor:'pointer',transition:'all .15s',background:extracting?'var(--oq-bg-f9fafb)':'var(--oq-bg-ffffff)'}}
            onMouseOver={function(e){if(!extracting)e.currentTarget.style.borderColor='var(--oq-ln-1f4e79)';}}
            onMouseOut={function(e){e.currentTarget.style.borderColor='var(--oq-ln-d1d5db)';}}>
            {extracting ? (
              <div>
                <div style={{fontSize:'40px',marginBottom:'16px'}}>⏳</div>
                <div style={{fontSize:'16px',fontWeight:'600',color:'var(--oq-fg-1f4e79)',marginBottom:'8px'}}>Reading document with AI...</div>
                <div style={{fontSize:'13px',color:'var(--oq-fg-9ca3af)'}}>Extracting requestor information and records description</div>
              </div>
            ) : (
              <div>
                <div style={{fontSize:'48px',marginBottom:'16px'}}>📎</div>
                <div style={{fontSize:'16px',fontWeight:'600',color:'var(--oq-fg-111111)',marginBottom:'8px'}}>Drop document here or click to upload</div>
                <div style={{fontSize:'13px',color:'var(--oq-fg-9ca3af)',marginBottom:'16px'}}>PDF, JPG, PNG — up to 20MB</div>
                <div style={{display:'inline-flex',padding:'10px 24px',background:'var(--oq-bg-1f4e79)',color:'var(--oq-fg-ffffff)',borderRadius:'8px',fontSize:'14px',fontWeight:'600'}}>Choose File</div>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff" onChange={handleFileSelect} style={{display:'none'}}/>
          <div style={{fontSize:'13px',color:'var(--oq-fg-9ca3af)',textAlign:'center'}}>
            💡 For emails: open the email, print to PDF (Ctrl+P → Save as PDF), then upload the PDF here
          </div>
          {err && <div style={{background:'var(--oq-bg-fef2f2)',border:'1px solid var(--oq-ln-fca5a5)',borderRadius:'8px',padding:'12px',fontSize:'14px',color:'var(--oq-fg-dc2626)'}}>{err}</div>}
        </div>
      )}

      {(mode==='manual' || aiExtracted) && (
        <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:'20px'}}>
          {aiExtracted && aiSuggestion && (
            <div style={{background:'var(--oq-bg-ebf3fb)',border:'2px solid var(--oq-ln-1f4e79)',borderRadius:'12px',padding:'20px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'10px'}}>
                <span style={{fontSize:'22px'}}>✅</span>
                <div>
                  <div style={{fontSize:'15px',fontWeight:'700',color:'var(--oq-fg-1f4e79)'}}>AI Extracted Data — Please review all fields before submitting</div>
                  <div style={{fontSize:'13px',color:'var(--oq-fg-2e75b6)'}}>Fields highlighted in amber have lower confidence and require verification</div>
                </div>
              </div>
              {aiSuggestion.reasoning && <div style={{fontSize:'13px',color:'var(--oq-fg-374151)',fontStyle:'italic',borderTop:'1px solid var(--oq-ln-d6e4f0)',paddingTop:'10px'}}>"{aiSuggestion.reasoning}"</div>}
            </div>
          )}

          <div style={section}>
            <div style={{fontSize:'15px',fontWeight:'700',borderBottom:'1px solid var(--oq-ln-f3f4f6)',paddingBottom:'12px'}}>Submission Channel</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:'10px'}}>
              {CHANNELS.map(function(c){
                var active=form.submissionChannel===c.value;
                return <button key={c.value} type="button" onClick={function(){setF('submissionChannel',c.value);}}
                  style={{padding:'10px',borderRadius:'8px',border:'2px solid '+(active?'var(--oq-ln-1f4e79)':'var(--oq-ln-e5e7eb)'),background:active?'var(--oq-bg-ebf3fb)':'var(--oq-bg-ffffff)',color:active?'var(--oq-fg-1f4e79)':'var(--oq-fg-6b7280)',fontSize:'13px',fontWeight:active?'700':'500',cursor:'pointer'}}>
                  {c.label}
                </button>;
              })}
            </div>
          </div>

          <div style={section}>
            <div style={{fontSize:'15px',fontWeight:'700',borderBottom:'1px solid var(--oq-ln-f3f4f6)',paddingBottom:'12px'}}>Requestor Information</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
              <div>
                <label style={lbl}>Full Name <span style={{color:'var(--oq-fg-dc2626)'}}>*</span>{lowConfidenceFields.requestor_name&&<span style={{color:'var(--oq-fg-d97706)',fontSize:'11px',marginLeft:'8px'}}>⚠ Verify</span>}</label>
                <input value={form.requestorName} onChange={function(e){setF('requestorName',e.target.value);}} style={lowConfidenceFields.requestor_name?inpLow:inp} placeholder="Jane Smith" required/>
              </div>
              <div>
                <label style={lbl}>Email Address <span style={{color:'var(--oq-fg-dc2626)'}}>*</span>{lowConfidenceFields.requestor_email&&<span style={{color:'var(--oq-fg-d97706)',fontSize:'11px',marginLeft:'8px'}}>⚠ Verify</span>}</label>
                <input type="email" value={form.requestorEmail} onChange={function(e){setF('requestorEmail',e.target.value);}} style={lowConfidenceFields.requestor_email?inpLow:inp} placeholder="jane@example.com" required/>
              </div>
              <div>
                <label style={lbl}>Phone Number{lowConfidenceFields.requestor_phone&&<span style={{color:'var(--oq-fg-d97706)',fontSize:'11px',marginLeft:'8px'}}>⚠ Verify</span>}</label>
                <input value={form.requestorPhone} onChange={function(e){setF('requestorPhone',e.target.value);}} style={lowConfidenceFields.requestor_phone?inpLow:inp} placeholder="(555) 000-0000"/>
              </div>
              <div>
                <label style={lbl}>Requestor Type</label>
                <select value={form.requestorType} onChange={function(e){setF('requestorType',e.target.value);}} style={inp}>
                  {REQUESTOR_TYPES.map(function(t){return <option key={t.value} value={t.value}>{t.label}</option>;})}
                </select>
              </div>
            </div>
            <div>
              <label style={lbl}>Preferred Delivery Method</label>
              <div style={{display:'flex',gap:'10px'}}>
                {DELIVERY.map(function(d){var active=form.deliveryMethod===d.value;return <button key={d.value} type="button" onClick={function(){setF('deliveryMethod',d.value);}} style={{padding:'8px 16px',borderRadius:'8px',border:'2px solid '+(active?'var(--oq-ln-1f4e79)':'var(--oq-ln-e5e7eb)'),background:active?'var(--oq-bg-ebf3fb)':'var(--oq-bg-ffffff)',color:active?'var(--oq-fg-1f4e79)':'var(--oq-fg-6b7280)',fontSize:'13px',fontWeight:active?'700':'500',cursor:'pointer'}}>{d.label}</button>;})}
              </div>
            </div>
            {/* The walk-in identity anchor. An EXPLICIT act by the staffer logging the request — never
                inferred from the channel ("arrived by paper" is not "somebody checked"). Recorded with
                the staffer's name; it is what lets the requestor ledger anchor this request. */}
            <label style={{display:'flex',alignItems:'flex-start',gap:'10px',fontSize:'13px',color:'var(--oq-fg-374151)',cursor:'pointer',background:'var(--oq-bg-f9fafb)',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'8px',padding:'12px 14px'}}>
              <input type="checkbox" checked={form.identityConfirmed===true} onChange={function(e){setF('identityConfirmed',e.target.checked);}} style={{marginTop:'2px'}}/>
              <span><strong>I confirmed this requestor's identity in person.</strong><br/>
                <span style={{color:'var(--oq-fg-6b7280)',fontSize:'12px'}}>Check only if you verified who this person is (e.g., at the counter). Recorded under your name.</span></span>
            </label>
          </div>

          <div style={section}>
            <div style={{fontSize:'15px',fontWeight:'700',borderBottom:'1px solid var(--oq-ln-f3f4f6)',paddingBottom:'12px'}}>Request Details</div>
            <div>
              <label style={lbl}>Description of Records Requested <span style={{color:'var(--oq-fg-dc2626)'}}>*</span>{lowConfidenceFields.description&&<span style={{color:'var(--oq-fg-d97706)',fontSize:'11px',marginLeft:'8px'}}>⚠ Verify</span>}</label>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'6px'}}>
                <button type="button" onClick={analyzeWithAI} disabled={analyzing||form.description.length<20}
                  style={{padding:'7px 14px',background:form.description.length>=20?'var(--oq-bg-1f4e79)':'var(--oq-bg-e5e7eb)',color:form.description.length>=20?'var(--oq-fg-ffffff)':'var(--oq-fg-9ca3af)',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:form.description.length>=20?'pointer':'not-allowed'}}>
                  {analyzing?'⏳ Analyzing...':'✨ Analyze with AI'}
                </button>
              </div>
              {aiSuggestion&&!aiExtracted&&(
                <div style={{background:aiSuggestion.confidence>=85?'var(--oq-bg-f0fdf4)':'var(--oq-bg-fffbeb)',border:'1px solid '+(aiSuggestion.confidence>=85?'var(--oq-ln-86efac)':'var(--oq-ln-fde68a)'),borderRadius:'10px',padding:'14px',marginBottom:'10px'}}>
                  <div style={{fontWeight:'700',fontSize:'13px',color:aiSuggestion.confidence>=85?'var(--oq-fg-166534)':'var(--oq-fg-92400e)',marginBottom:'6px'}}>
                    ✅ AI Suggestion — {aiSuggestion.confidence}% confidence{aiSuggestion.confidence>=85?' (auto-populated)':''}
                  </div>
                  <div style={{fontSize:'13px',display:'flex',gap:'16px',flexWrap:'wrap',marginBottom:'6px'}}>
                    <span><strong>Classification:</strong> {aiSuggestion.classification&&aiSuggestion.classification.replace(/_/g,' ')}</span>
                    <span><strong>City Department:</strong> {aiSuggestion.department_name||'—'}</span>
                  </div>
                  <div style={{fontSize:'12px',color:'var(--oq-fg-374151)',fontStyle:'italic'}}>"{aiSuggestion.reasoning}"</div>
                </div>
              )}
              <textarea value={form.description} onChange={function(e){setF('description',e.target.value);}} style={Object.assign({},lowConfidenceFields.description?inpLow:inp,{minHeight:'120px',resize:'vertical',fontFamily:'inherit'})} placeholder={extraItems.length?'Record 1 — describe the first record being requested...':'Describe the records being requested...'} required/>
              {extraItems.map(function(txt, i){
                return (
                  <div key={i} style={{marginTop:'10px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
                      <span style={{fontSize:'12px',fontWeight:'600',color:'var(--oq-fg-374151)'}}>Record {i+2}</span>
                      <button type="button" onClick={function(){setExtraItems(function(p){return p.filter(function(_,j){return j!==i;});});}}
                        style={{background:'none',border:'none',color:'var(--oq-fg-dc2626)',fontSize:'12px',cursor:'pointer',fontWeight:'600'}}>Remove</button>
                    </div>
                    <textarea value={txt} onChange={function(e){var v=e.target.value;setExtraItems(function(p){return p.map(function(t,j){return j===i?v:t;});});}}
                      style={Object.assign({},inp,{minHeight:'80px',resize:'vertical',fontFamily:'inherit'})}
                      placeholder={'Describe record '+(i+2)+' in the requestor’s own words...'}/>
                  </div>
                );
              })}
              {extraItems.length < 9 ? (
                <button type="button" onClick={function(){setExtraItems(function(p){return p.concat(['']);});}}
                  style={{marginTop:'10px',padding:'8px 14px',background:'var(--oq-bg-ffffff)',color:'var(--oq-fg-1f4e79)',border:'1px dashed var(--oq-ln-1f4e79)',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
                  + Add another record (each record is tracked and delivered individually)
                </button>
              ) : <div style={{marginTop:'10px',fontSize:'12px',color:'var(--oq-fg-9ca3af)'}}>A request can include at most 10 records.</div>}
            </div>
            <div>
              <label style={lbl}>Request Fulfillment Team</label>
              <select value={form.departmentId} onChange={function(e){setF('departmentId',e.target.value);}} style={inp}>
                <option value="">— Auto-route or select manually —</option>
                {departments.map(function(d){return <option key={d.id} value={d.id}>{d.name}</option>;})}
              </select>
            </div>
            <div>
              <label style={lbl}>Effort Classification</label>
              <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                {CLASSIFICATIONS.map(function(c){var active=form.classification===c.value;return <button key={c.value} type="button" onClick={function(){setF('classification',c.value);}} style={{padding:'11px 16px',borderRadius:'8px',border:'2px solid '+(active?'var(--oq-ln-1f4e79)':'var(--oq-ln-e5e7eb)'),background:active?'var(--oq-bg-ebf3fb)':'var(--oq-bg-ffffff)',textAlign:'left',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between'}}><span style={{fontSize:'14px',fontWeight:'600',color:active?'var(--oq-fg-1f4e79)':'var(--oq-fg-374151)'}}>{c.label}</span><span style={{fontSize:'12px',color:active?'var(--oq-fg-2e75b6)':'var(--oq-fg-9ca3af)'}}>{c.desc}</span></button>;})}
              </div>
            </div>
            <div style={{display:'flex',gap:'24px',flexWrap:'wrap'}}>
              <label style={{display:'flex',alignItems:'center',gap:'10px',cursor:'pointer'}}>
                <input type="checkbox" checked={form.feeWaiverRequested} onChange={function(e){setF('feeWaiverRequested',e.target.checked);}} style={{width:'16px',height:'16px'}}/>
                <div><div style={{fontSize:'14px',fontWeight:'600'}}>Fee Waiver Requested</div><div style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)'}}>News media, nonprofit, or researcher status</div></div>
              </label>
              {/* Parity with the portal wizard's certification opt-in — staff intake used to drop it
                  silently (SPEC_record_verification.md §1.5). Parent fact; feeds the fee engine. */}
              <label style={{display:'flex',alignItems:'center',gap:'10px',cursor:'pointer'}}>
                <input type="checkbox" checked={form.certificationRequested} onChange={function(e){setF('certificationRequested',e.target.checked);}} style={{width:'16px',height:'16px'}}/>
                <div><div style={{fontSize:'14px',fontWeight:'600'}}>Certification Requested</div><div style={{fontSize:'12px',color:'var(--oq-fg-9ca3af)'}}>Include a page attesting the records are true and accurate. Additional fees may apply.</div></div>
              </label>
              {/* The old Multi-Record checkbox is gone: is_mrr is DERIVED from how many records are
                  actually described (§4.1 — a fact, not a mode). Add records below instead. */}
            </div>
          </div>

          {err&&<div style={{background:'var(--oq-bg-fef2f2)',border:'1px solid var(--oq-ln-fca5a5)',borderRadius:'8px',padding:'14px',fontSize:'14px',color:'var(--oq-fg-dc2626)'}}>{err}</div>}
          <div style={{display:'flex',gap:'12px',justifyContent:'flex-end'}}>
            <button type="button" onClick={function(){nav('/requests');}} style={{padding:'11px 24px',background:'var(--oq-bg-ffffff)',color:'var(--oq-fg-6b7280)',border:'1px solid var(--oq-ln-e5e7eb)',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>
            <button type="submit" disabled={loading} style={{padding:'11px 32px',background:'var(--oq-bg-1f4e79)',color:'var(--oq-fg-ffffff)',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>
              {loading?'Creating...':'Create Request'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
