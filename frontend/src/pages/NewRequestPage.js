import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

const CLASSIFICATIONS = [
  { value: 'simple', label: 'Simple', desc: '5 business days — self-service or single clean digital record' },
  { value: 'standard', label: 'Standard', desc: '10 business days — 1-3 items, standard content' },
  { value: 'complex', label: 'Complex', desc: '20 business days — 4+ items, fee waiver, or complex content' },
  { value: 'redaction_required', label: 'Redaction Required', desc: '30 business days — any item requiring redaction review' },
];
const CHANNELS = [ { value: 'portal', label: 'Public Portal' }, { value: 'phone', label: 'Phone' }, { value: 'walkin', label: 'Walk-In' }, { value: 'mail', label: 'Mail' } ];
const REQUESTOR_TYPES = [ { value: 'individual', label: 'Individual' }, { value: 'journalist', label: 'Journalist / News Media' }, { value: 'nonprofit', label: 'Nonprofit Organization' }, { value: 'attorney', label: 'Attorney' }, { value: 'researcher', label: 'Researcher' }, { value: 'business', label: 'Business' } ];
const DELIVERY = [ { value: 'email', label: 'Email' }, { value: 'mail', label: 'Physical Mail' }, { value: 'pickup', label: 'In-Person Pickup' } ];

export default function NewRequestPage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({
    requestorName: '', requestorEmail: '', requestorPhone: '', requestorType: 'individual',
    deliveryMethod: 'email', description: '', classification: 'standard',
    feeWaiverRequested: false, submissionChannel: 'phone', isMrr: false,
  });

  function set(field, value) { setForm(function(f) { return Object.assign({}, f, { [field]: value }); }); }

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
    if (!form.requestorName || !form.requestorEmail || !form.description) {
      setErr('Please fill in all required fields'); return;
    }
    setLoading(true);
    try {
      var r = await api.post('/requests', form);
      nav('/requests/' + r.data.requestId);
    } catch(e) { setErr(e.response && e.response.data ? e.response.data.error : 'Failed to create request'); }
    setLoading(false);
  }

  var inp = { width: '100%', padding: '10px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box', background: 'white' };
  var sel = Object.assign({}, inp, { cursor: 'pointer' });
  var label = { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' };
  var hint = { fontSize: '12px', color: '#9CA3AF', marginTop: '4px' };
  var section = { background: 'white', borderRadius: '12px', border: '1px solid #E5E7EB', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' };
  var sectionTitle = { fontSize: '15px', fontWeight: '700', color: '#111', margin: '0 0 4px', paddingBottom: '12px', borderBottom: '1px solid #F3F4F6' };

  return (
    <div style={{ maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button onClick={function() { nav('/requests'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: '14px', padding: '8px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>← Back</button>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 2px' }}>Log New Request</h1>
          <p style={{ color: '#9CA3AF', fontSize: '13px', margin: 0 }}>For phone, walk-in, and mail submissions</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Submission channel */}
        <div style={section}>
          <div style={sectionTitle}>Submission Channel</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '10px' }}>
            {CHANNELS.map(function(c) {
              var active = form.submissionChannel === c.value;
              return <button key={c.value} type="button" onClick={function() { set('submissionChannel', c.value); }}
                style={{ padding: '12px', borderRadius: '8px', border: '2px solid ' + (active ? '#1F4E79' : '#E5E7EB'), background: active ? '#EBF3FB' : 'white', color: active ? '#1F4E79' : '#6B7280', fontSize: '13px', fontWeight: active ? '700' : '500', cursor: 'pointer' }}>
                {c.label}
              </button>;
            })}
          </div>
        </div>

        {/* Requestor info */}
        <div style={section}>
          <div style={sectionTitle}>Requestor Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={label}>Full Name <span style={{ color: '#DC2626' }}>*</span></label>
              <input type="text" value={form.requestorName} onChange={function(e) { set('requestorName', e.target.value); }} style={inp} placeholder="Jane Smith" required />
            </div>
            <div>
              <label style={label}>Email Address <span style={{ color: '#DC2626' }}>*</span></label>
              <input type="email" value={form.requestorEmail} onChange={function(e) { set('requestorEmail', e.target.value); }} style={inp} placeholder="jane@example.com" required />
            </div>
            <div>
              <label style={label}>Phone Number</label>
              <input type="tel" value={form.requestorPhone} onChange={function(e) { set('requestorPhone', e.target.value); }} style={inp} placeholder="(555) 000-0000" />
            </div>
            <div>
              <label style={label}>Requestor Type</label>
              <select value={form.requestorType} onChange={function(e) { set('requestorType', e.target.value); }} style={sel}>
                {REQUESTOR_TYPES.map(function(t) { return <option key={t.value} value={t.value}>{t.label}</option>; })}
              </select>
            </div>
          </div>
          <div>
            <label style={label}>Preferred Delivery Method</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              {DELIVERY.map(function(d) {
                var active = form.deliveryMethod === d.value;
                return <button key={d.value} type="button" onClick={function() { set('deliveryMethod', d.value); }}
                  style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid ' + (active ? '#1F4E79' : '#E5E7EB'), background: active ? '#EBF3FB' : 'white', color: active ? '#1F4E79' : '#6B7280', fontSize: '13px', fontWeight: active ? '700' : '500', cursor: 'pointer' }}>
                  {d.label}
                </button>;
              })}
            </div>
          </div>
        </div>

        {/* Request details */}
        <div style={section}>
          <div style={sectionTitle}>Request Details</div>
          <div>
            <label style={label}>Description of Records Requested <span style={{ color: '#DC2626' }}>*</span></label>
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'8px'}}>
              <button type="button" onClick={analyzeWithAI} disabled={analyzing||form.description.length<20}
                style={{display:'flex',alignItems:'center',gap:'8px',padding:'8px 16px',background:form.description.length>=20?'#1F4E79':'#E5E7EB',color:form.description.length>=20?'white':'#9CA3AF',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:form.description.length>=20?'pointer':'not-allowed'}}>
                {analyzing ? '⏳ Analyzing...' : '✨ Analyze with AI'}
              </button>
            </div>
            {aiSuggestion && (
              <div style={{background:aiSuggestion.confidence>=85?'#F0FDF4':'#FFFBEB',border:'1px solid '+(aiSuggestion.confidence>=85?'#86EFAC':'#FDE68A'),borderRadius:'10px',padding:'16px',marginBottom:'12px'}}>
                <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}>
                  <span style={{fontSize:'16px'}}>{aiSuggestion.confidence>=85?'✅':'⚠️'}</span>
                  <span style={{fontWeight:'700',fontSize:'14px',color:aiSuggestion.confidence>=85?'#166534':'#92400E'}}>
                    AI Suggestion — {aiSuggestion.confidence}% confidence
                  </span>
                  {aiSuggestion.confidence>=85&&<span style={{fontSize:'12px',color:'#166534',fontStyle:'italic'}}>Auto-populated below</span>}
                </div>
                <div style={{display:'flex',gap:'16px',flexWrap:'wrap',marginBottom:'8px'}}>
                  <div style={{fontSize:'13px'}}><strong>Classification:</strong> <span style={{textTransform:'capitalize'}}>{aiSuggestion.classification&&aiSuggestion.classification.replace(/_/g,' ')}</span></div>
                  <div style={{fontSize:'13px'}}><strong>Department:</strong> {aiSuggestion.department_name||'Unknown'}</div>
                  <div style={{fontSize:'13px'}}><strong>Redaction:</strong> {aiSuggestion.redaction_flag?'Yes — Review Required':'No'}</div>
                </div>
                <div style={{fontSize:'13px',color:'#374151',fontStyle:'italic'}}>"{aiSuggestion.reasoning}"</div>
                {aiSuggestion.confidence<85&&(
                  <button type="button" onClick={function(){
                    setForm(function(f){
                      var u={classification:aiSuggestion.classification};
                      if(aiSuggestion.department_id) u.departmentId=aiSuggestion.department_id;
                      return Object.assign({},f,u);
                    });
                  }} style={{marginTop:'10px',padding:'6px 14px',background:'#1F4E79',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                    Accept Suggestion
                  </button>
                )}
              </div>
            )}
            <textarea value={form.description} onChange={function(e) { set('description', e.target.value); }} style={Object.assign({}, inp, { minHeight: '120px', resize: 'vertical', fontFamily: 'inherit' })} placeholder="Describe the records being requested in detail..." required />
          </div>
          <div>
            <label style={label}>Effort Classification</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {CLASSIFICATIONS.map(function(c) {
                var active = form.classification === c.value;
                return <button key={c.value} type="button" onClick={function() { set('classification', c.value); }}
                  style={{ padding: '12px 16px', borderRadius: '8px', border: '2px solid ' + (active ? '#1F4E79' : '#E5E7EB'), background: active ? '#EBF3FB' : 'white', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: active ? '#1F4E79' : '#374151' }}>{c.label}</span>
                  <span style={{ fontSize: '12px', color: active ? '#2E75B6' : '#9CA3AF' }}>{c.desc}</span>
                </button>;
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.feeWaiverRequested} onChange={function(e) { set('feeWaiverRequested', e.target.checked); }} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>Fee Waiver Requested</div>
                <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Requestor claims news media, nonprofit, or researcher status</div>
              </div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.isMrr} onChange={function(e) { set('isMrr', e.target.checked); }} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>Multi-Record Request</div>
                <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Request involves two or more distinct record types</div>
              </div>
            </label>
          </div>
        </div>

        {err && <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '14px', fontSize: '14px', color: '#DC2626' }}>{err}</div>}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={function() { nav('/requests'); }} style={{ padding: '11px 24px', background: 'white', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
          <button type="submit" disabled={loading} style={{ padding: '11px 32px', background: '#1F4E79', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            {loading ? 'Creating...' : 'Create Request'}
          </button>
        </div>
      </form>
    </div>
  );
}
