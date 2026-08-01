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

const EMPTY_FORM = { requestorName:'', requestorEmail:'', requestorPhone:'', requestorType:'individual', deliveryMethod:'email', description:'', classification:'standard', departmentId:'', feeWaiverRequested:false, submissionChannel:'phone', isMrr:false, identityConfirmed:false };

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
      var r = await api.post('/requests', form);
      nav('/requests/' + r.data.requestId);
    } catch(e) { setErr(e.response && e.response.data ? e.response.data.error : 'Failed to create request'); }
    setLoading(false);
  }

  var inp = { width:'100%', padding:'10px 12px', border:'1px solid #E5E7EB', borderRadius:'8px', fontSize:'14px', outline:'none', boxSizing:'border-box', background:'white' };
  var inpLow = Object.assign({}, inp, { border:'2px solid #F59E0B', background:'#FFFBEB' });
  var lbl = { display:'block', fontSize:'13px', fontWeight:'600', color:'#374151', marginBottom:'6px' };
  var section = { background:'white', borderRadius:'12px', border:'1px solid #E5E7EB', padding:'24px', display:'flex', flexDirection:'column', gap:'16px' };

  if (!mode) {
    return (
      <div style={{maxWidth:'700px',display:'flex',flexDirection:'column',gap:'20px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'16px'}}>
          <button onClick={function(){nav('/requests');}} style={{background:'none',border:'none',cursor:'pointer',color:'#6B7280',fontSize:'14px',padding:'8px 12px',borderRadius:'8px'}}>← Back</button>
          <div>
            <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 2px'}}>Log New Request</h1>
            <p style={{color:'#9CA3AF',fontSize:'13px',margin:0}}>Choose how to enter this request</p>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
          <button onClick={function(){setMode('import');}} style={{background:'white',border:'2px solid #E5E7EB',borderRadius:'16px',padding:'32px 24px',cursor:'pointer',textAlign:'left',transition:'all .15s'}}
            onMouseOver={function(e){e.currentTarget.style.borderColor='#1F4E79';e.currentTarget.style.background='#EBF3FB';}}
            onMouseOut={function(e){e.currentTarget.style.borderColor='#E5E7EB';e.currentTarget.style.background='white';}}>
            <div style={{fontSize:'40px',marginBottom:'16px'}}>📄</div>
            <div style={{fontSize:'17px',fontWeight:'700',color:'#111',marginBottom:'8px'}}>Import from Document</div>
            <div style={{fontSize:'13px',color:'#6B7280',lineHeight:'1.5'}}>Upload a PDF or photo of a letter or email. AI will read the document and fill in the form automatically.</div>
            <div style={{marginTop:'16px',fontSize:'12px',color:'#1F4E79',fontWeight:'600'}}>Recommended for letters & emails →</div>
          </button>
          <button onClick={function(){setMode('manual');}} style={{background:'white',border:'2px solid #E5E7EB',borderRadius:'16px',padding:'32px 24px',cursor:'pointer',textAlign:'left',transition:'all .15s'}}
            onMouseOver={function(e){e.currentTarget.style.borderColor='#1F4E79';e.currentTarget.style.background='#EBF3FB';}}
            onMouseOut={function(e){e.currentTarget.style.borderColor='#E5E7EB';e.currentTarget.style.background='white';}}>
            <div style={{fontSize:'40px',marginBottom:'16px'}}>✏️</div>
            <div style={{fontSize:'17px',fontWeight:'700',color:'#111',marginBottom:'8px'}}>Enter Manually</div>
            <div style={{fontSize:'13px',color:'#6B7280',lineHeight:'1.5'}}>Fill in the form directly. Best for phone calls, walk-ins, and requests without a written document.</div>
            <div style={{marginTop:'16px',fontSize:'12px',color:'#6B7280',fontWeight:'600'}}>Phone, walk-in, other →</div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{maxWidth:'860px',display:'flex',flexDirection:'column',gap:'20px'}}>
      <div style={{display:'flex',alignItems:'center',gap:'16px'}}>
        <button onClick={function(){setMode(null);setAiExtracted(false);setAiSuggestion(null);setForm(EMPTY_FORM);setUploadedFile(null);}} style={{background:'none',border:'none',cursor:'pointer',color:'#6B7280',fontSize:'14px',padding:'8px 12px',borderRadius:'8px'}}>← Back</button>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 2px'}}>{mode==='import'?'Import Request Document':'Log New Request'}</h1>
          <p style={{color:'#9CA3AF',fontSize:'13px',margin:0}}>{mode==='import'?'Upload a document — AI will extract the request details':'Enter request details manually'}</p>
        </div>
      </div>

      {mode==='import' && !aiExtracted && (
        <div style={section}>
          <div style={{fontSize:'15px',fontWeight:'700',borderBottom:'1px solid #F3F4F6',paddingBottom:'12px'}}>Upload Request Document</div>
          <div onClick={function(){fileRef.current.click();}} style={{border:'3px dashed #D1D5DB',borderRadius:'12px',padding:'48px',textAlign:'center',cursor:'pointer',transition:'all .15s',background:extracting?'#F9FAFB':'white'}}
            onMouseOver={function(e){if(!extracting)e.currentTarget.style.borderColor='#1F4E79';}}
            onMouseOut={function(e){e.currentTarget.style.borderColor='#D1D5DB';}}>
            {extracting ? (
              <div>
                <div style={{fontSize:'40px',marginBottom:'16px'}}>⏳</div>
                <div style={{fontSize:'16px',fontWeight:'600',color:'#1F4E79',marginBottom:'8px'}}>Reading document with AI...</div>
                <div style={{fontSize:'13px',color:'#9CA3AF'}}>Extracting requestor information and records description</div>
              </div>
            ) : (
              <div>
                <div style={{fontSize:'48px',marginBottom:'16px'}}>📎</div>
                <div style={{fontSize:'16px',fontWeight:'600',color:'#111',marginBottom:'8px'}}>Drop document here or click to upload</div>
                <div style={{fontSize:'13px',color:'#9CA3AF',marginBottom:'16px'}}>PDF, JPG, PNG — up to 20MB</div>
                <div style={{display:'inline-flex',padding:'10px 24px',background:'#1F4E79',color:'white',borderRadius:'8px',fontSize:'14px',fontWeight:'600'}}>Choose File</div>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff" onChange={handleFileSelect} style={{display:'none'}}/>
          <div style={{fontSize:'13px',color:'#9CA3AF',textAlign:'center'}}>
            💡 For emails: open the email, print to PDF (Ctrl+P → Save as PDF), then upload the PDF here
          </div>
          {err && <div style={{background:'#FEF2F2',border:'1px solid #FCA5A5',borderRadius:'8px',padding:'12px',fontSize:'14px',color:'#DC2626'}}>{err}</div>}
        </div>
      )}

      {(mode==='manual' || aiExtracted) && (
        <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:'20px'}}>
          {aiExtracted && aiSuggestion && (
            <div style={{background:'#EBF3FB',border:'2px solid #1F4E79',borderRadius:'12px',padding:'20px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'10px'}}>
                <span style={{fontSize:'22px'}}>✅</span>
                <div>
                  <div style={{fontSize:'15px',fontWeight:'700',color:'#1F4E79'}}>AI Extracted Data — Please review all fields before submitting</div>
                  <div style={{fontSize:'13px',color:'#2E75B6'}}>Fields highlighted in amber have lower confidence and require verification</div>
                </div>
              </div>
              {aiSuggestion.reasoning && <div style={{fontSize:'13px',color:'#374151',fontStyle:'italic',borderTop:'1px solid #D6E4F0',paddingTop:'10px'}}>"{aiSuggestion.reasoning}"</div>}
            </div>
          )}

          <div style={section}>
            <div style={{fontSize:'15px',fontWeight:'700',borderBottom:'1px solid #F3F4F6',paddingBottom:'12px'}}>Submission Channel</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:'10px'}}>
              {CHANNELS.map(function(c){
                var active=form.submissionChannel===c.value;
                return <button key={c.value} type="button" onClick={function(){setF('submissionChannel',c.value);}}
                  style={{padding:'10px',borderRadius:'8px',border:'2px solid '+(active?'#1F4E79':'#E5E7EB'),background:active?'#EBF3FB':'white',color:active?'#1F4E79':'#6B7280',fontSize:'13px',fontWeight:active?'700':'500',cursor:'pointer'}}>
                  {c.label}
                </button>;
              })}
            </div>
          </div>

          <div style={section}>
            <div style={{fontSize:'15px',fontWeight:'700',borderBottom:'1px solid #F3F4F6',paddingBottom:'12px'}}>Requestor Information</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
              <div>
                <label style={lbl}>Full Name <span style={{color:'#DC2626'}}>*</span>{lowConfidenceFields.requestor_name&&<span style={{color:'#D97706',fontSize:'11px',marginLeft:'8px'}}>⚠ Verify</span>}</label>
                <input value={form.requestorName} onChange={function(e){setF('requestorName',e.target.value);}} style={lowConfidenceFields.requestor_name?inpLow:inp} placeholder="Jane Smith" required/>
              </div>
              <div>
                <label style={lbl}>Email Address <span style={{color:'#DC2626'}}>*</span>{lowConfidenceFields.requestor_email&&<span style={{color:'#D97706',fontSize:'11px',marginLeft:'8px'}}>⚠ Verify</span>}</label>
                <input type="email" value={form.requestorEmail} onChange={function(e){setF('requestorEmail',e.target.value);}} style={lowConfidenceFields.requestor_email?inpLow:inp} placeholder="jane@example.com" required/>
              </div>
              <div>
                <label style={lbl}>Phone Number{lowConfidenceFields.requestor_phone&&<span style={{color:'#D97706',fontSize:'11px',marginLeft:'8px'}}>⚠ Verify</span>}</label>
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
                {DELIVERY.map(function(d){var active=form.deliveryMethod===d.value;return <button key={d.value} type="button" onClick={function(){setF('deliveryMethod',d.value);}} style={{padding:'8px 16px',borderRadius:'8px',border:'2px solid '+(active?'#1F4E79':'#E5E7EB'),background:active?'#EBF3FB':'white',color:active?'#1F4E79':'#6B7280',fontSize:'13px',fontWeight:active?'700':'500',cursor:'pointer'}}>{d.label}</button>;})}
              </div>
            </div>
            {/* The walk-in identity anchor. An EXPLICIT act by the staffer logging the request — never
                inferred from the channel ("arrived by paper" is not "somebody checked"). Recorded with
                the staffer's name; it is what lets the requestor ledger anchor this request. */}
            <label style={{display:'flex',alignItems:'flex-start',gap:'10px',fontSize:'13px',color:'#374151',cursor:'pointer',background:'#F9FAFB',border:'1px solid #E5E7EB',borderRadius:'8px',padding:'12px 14px'}}>
              <input type="checkbox" checked={form.identityConfirmed===true} onChange={function(e){setF('identityConfirmed',e.target.checked);}} style={{marginTop:'2px'}}/>
              <span><strong>I confirmed this requestor's identity in person.</strong><br/>
                <span style={{color:'#6B7280',fontSize:'12px'}}>Check only if you verified who this person is (e.g., at the counter). Recorded under your name.</span></span>
            </label>
          </div>

          <div style={section}>
            <div style={{fontSize:'15px',fontWeight:'700',borderBottom:'1px solid #F3F4F6',paddingBottom:'12px'}}>Request Details</div>
            <div>
              <label style={lbl}>Description of Records Requested <span style={{color:'#DC2626'}}>*</span>{lowConfidenceFields.description&&<span style={{color:'#D97706',fontSize:'11px',marginLeft:'8px'}}>⚠ Verify</span>}</label>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'6px'}}>
                <button type="button" onClick={analyzeWithAI} disabled={analyzing||form.description.length<20}
                  style={{padding:'7px 14px',background:form.description.length>=20?'#1F4E79':'#E5E7EB',color:form.description.length>=20?'white':'#9CA3AF',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:form.description.length>=20?'pointer':'not-allowed'}}>
                  {analyzing?'⏳ Analyzing...':'✨ Analyze with AI'}
                </button>
              </div>
              {aiSuggestion&&!aiExtracted&&(
                <div style={{background:aiSuggestion.confidence>=85?'#F0FDF4':'#FFFBEB',border:'1px solid '+(aiSuggestion.confidence>=85?'#86EFAC':'#FDE68A'),borderRadius:'10px',padding:'14px',marginBottom:'10px'}}>
                  <div style={{fontWeight:'700',fontSize:'13px',color:aiSuggestion.confidence>=85?'#166534':'#92400E',marginBottom:'6px'}}>
                    ✅ AI Suggestion — {aiSuggestion.confidence}% confidence{aiSuggestion.confidence>=85?' (auto-populated)':''}
                  </div>
                  <div style={{fontSize:'13px',display:'flex',gap:'16px',flexWrap:'wrap',marginBottom:'6px'}}>
                    <span><strong>Classification:</strong> {aiSuggestion.classification&&aiSuggestion.classification.replace(/_/g,' ')}</span>
                    <span><strong>City Department:</strong> {aiSuggestion.department_name||'—'}</span>
                  </div>
                  <div style={{fontSize:'12px',color:'#374151',fontStyle:'italic'}}>"{aiSuggestion.reasoning}"</div>
                </div>
              )}
              <textarea value={form.description} onChange={function(e){setF('description',e.target.value);}} style={Object.assign({},lowConfidenceFields.description?inpLow:inp,{minHeight:'120px',resize:'vertical',fontFamily:'inherit'})} placeholder="Describe the records being requested..." required/>
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
                {CLASSIFICATIONS.map(function(c){var active=form.classification===c.value;return <button key={c.value} type="button" onClick={function(){setF('classification',c.value);}} style={{padding:'11px 16px',borderRadius:'8px',border:'2px solid '+(active?'#1F4E79':'#E5E7EB'),background:active?'#EBF3FB':'white',textAlign:'left',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between'}}><span style={{fontSize:'14px',fontWeight:'600',color:active?'#1F4E79':'#374151'}}>{c.label}</span><span style={{fontSize:'12px',color:active?'#2E75B6':'#9CA3AF'}}>{c.desc}</span></button>;})}
              </div>
            </div>
            <div style={{display:'flex',gap:'24px',flexWrap:'wrap'}}>
              <label style={{display:'flex',alignItems:'center',gap:'10px',cursor:'pointer'}}>
                <input type="checkbox" checked={form.feeWaiverRequested} onChange={function(e){setF('feeWaiverRequested',e.target.checked);}} style={{width:'16px',height:'16px'}}/>
                <div><div style={{fontSize:'14px',fontWeight:'600'}}>Fee Waiver Requested</div><div style={{fontSize:'12px',color:'#9CA3AF'}}>News media, nonprofit, or researcher status</div></div>
              </label>
              <label style={{display:'flex',alignItems:'center',gap:'10px',cursor:'pointer'}}>
                <input type="checkbox" checked={form.isMrr} onChange={function(e){setF('isMrr',e.target.checked);}} style={{width:'16px',height:'16px'}}/>
                <div><div style={{fontSize:'14px',fontWeight:'600'}}>Multi-Record Request</div><div style={{fontSize:'12px',color:'#9CA3AF'}}>Two or more distinct record types</div></div>
              </label>
            </div>
          </div>

          {err&&<div style={{background:'#FEF2F2',border:'1px solid #FCA5A5',borderRadius:'8px',padding:'14px',fontSize:'14px',color:'#DC2626'}}>{err}</div>}
          <div style={{display:'flex',gap:'12px',justifyContent:'flex-end'}}>
            <button type="button" onClick={function(){nav('/requests');}} style={{padding:'11px 24px',background:'white',color:'#6B7280',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>
            <button type="submit" disabled={loading} style={{padding:'11px 32px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>
              {loading?'Creating...':'Create Request'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
