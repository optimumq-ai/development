import React, { useEffect, useState } from 'react';
import api from '../lib/api';

export default function ConfigurationPage() {
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [err, setErr] = useState('');
  const [activeTab, setActiveTab] = useState('agency');

  useEffect(function() { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      var r = await api.get('/config');
      setConfig(r.data);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  function set(k, v) { setConfig(function(c) { return Object.assign({}, c, {[k]: v}); }); }

  async function save(e) {
    e.preventDefault(); setErr(''); setSuccess(''); setSaving(true);
    try {
      await api.post('/config', config);
      setSuccess('Configuration saved successfully.');
    } catch(e) { setErr(e.response && e.response.data ? e.response.data.error : 'Failed to save'); }
    setSaving(false);
  }

  var inp = { width:'100%', padding:'10px 12px', border:'1px solid #E5E7EB', borderRadius:'8px', fontSize:'14px', outline:'none', boxSizing:'border-box', background:'white' };
  var lbl = { display:'block', fontSize:'13px', fontWeight:'600', color:'#374151', marginBottom:'6px' };
  var hint = { fontSize:'12px', color:'#9CA3AF', marginTop:'4px' };
  var section = { background:'white', borderRadius:'12px', border:'1px solid #E5E7EB', padding:'24px', display:'flex', flexDirection:'column', gap:'20px' };
  var sectionTitle = { fontSize:'15px', fontWeight:'700', color:'#111', margin:'0 0 4px', paddingBottom:'14px', borderBottom:'1px solid #F3F4F6' };

  const tabs = [
    { key:'agency', label:'Agency' },
    { key:'auth', label:'Authentication' },
    { key:'fees', label:'Fees & Deadlines' },
    { key:'notifications', label:'Notifications' },
  ];

  if (loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'256px',color:'#9CA3AF'}}>Loading configuration...</div>;

  return (
    <div style={{maxWidth:'800px',display:'flex',flexDirection:'column',gap:'20px'}}>
      <div>
        <h1 style={{fontSize:'22px',fontWeight:'700',margin:'0 0 4px'}}>Configuration</h1>
        <p style={{color:'#9CA3AF',fontSize:'14px',margin:0}}>System settings for your Optimum Q deployment</p>
      </div>

      <div style={{display:'flex',borderBottom:'2px solid #E5E7EB',gap:'0'}}>
        {tabs.map(function(t){
          var active = activeTab === t.key;
          return <button key={t.key} onClick={function(){setActiveTab(t.key);}} style={{padding:'10px 20px',background:'none',border:'none',borderBottom:active?'2px solid #1F4E79':'2px solid transparent',marginBottom:'-2px',fontSize:'14px',fontWeight:active?'700':'500',color:active?'#1F4E79':'#6B7280',cursor:'pointer'}}>{t.label}</button>;
        })}
      </div>

      {success && <div style={{background:'#F0FDF4',border:'1px solid #86EFAC',borderRadius:'8px',padding:'14px',fontSize:'14px',color:'#166534'}}>{success}</div>}
      {err && <div style={{background:'#FEF2F2',border:'1px solid #FCA5A5',borderRadius:'8px',padding:'14px',fontSize:'14px',color:'#DC2626'}}>{err}</div>}

      <form onSubmit={save}>
        {activeTab === 'agency' && (
          <div style={section}>
            <div style={sectionTitle}>Agency Information</div>
            <div>
              <label style={lbl}>Agency Name</label>
              <input value={config.agency_name||''} onChange={function(e){set('agency_name',e.target.value);}} style={inp} placeholder="City of Optimum"/>
              <div style={hint}>Displayed throughout the application and on correspondence</div>
            </div>
            <div>
              <label style={lbl}>Agency Short Name</label>
              <input value={config.agency_short_name||''} onChange={function(e){set('agency_short_name',e.target.value);}} style={inp} placeholder="City of Optimum"/>
              <div style={hint}>Used in email subjects and compact displays</div>
            </div>
            <div>
              <label style={lbl}>Jurisdiction Type</label>
              <select value={config.jurisdiction_type||'city'} onChange={function(e){set('jurisdiction_type',e.target.value);}} style={inp}>
                <option value="city">City</option>
                <option value="county">County</option>
                <option value="state">State Agency</option>
                <option value="school">School District</option>
                <option value="special">Special District</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={lbl}>State</label>
              <select value={config.state||'TX'} onChange={function(e){set('state',e.target.value);}} style={inp}>
                {['TX','AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','UT','VT','VA','WA','WV','WI','WY'].map(function(s){ return <option key={s} value={s}>{s}</option>; })}
              </select>
              <div style={hint}>Determines applicable public records statute and default response windows</div>
            </div>
            <div>
              <label style={lbl}>Public Records Contact Email</label>
              <input type="email" value={config.contact_email||''} onChange={function(e){set('contact_email',e.target.value);}} style={inp} placeholder="openrecords@city.gov"/>
              <div style={hint}>Displayed to the public on the portal and in correspondence</div>
            </div>
            <div>
              <label style={lbl}>Public Records Contact Phone</label>
              <input value={config.contact_phone||''} onChange={function(e){set('contact_phone',e.target.value);}} style={inp} placeholder="(555) 000-0000"/>
            </div>
          </div>
        )}

        {activeTab === 'auth' && (
          <div style={section}>
            <div style={sectionTitle}>Authentication Settings</div>
            <div>
              <label style={lbl}>Authentication Mode</label>
              <select value={config.auth_mode||'local'} onChange={function(e){set('auth_mode',e.target.value);}} style={inp}>
                <option value="local">Local Credentials</option>
                <option value="sso">Single Sign-On (SSO)</option>
              </select>
              <div style={hint}>Local credentials uses username/password stored in Optimum Q. SSO integrates with your city's identity provider.</div>
            </div>
            <div>
              <label style={lbl}>Multi-Factor Authentication</label>
              <select value={config.mfa_mode||'optional'} onChange={function(e){set('mfa_mode',e.target.value);}} style={inp}>
                <option value="off">Off — MFA not available</option>
                <option value="optional">Optional — staff may enroll</option>
                <option value="required">Required — all staff must enroll</option>
                <option value="elevated">Elevated roles only — SUPERVISOR and above</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Session Timeout</label>
              <select value={config.session_timeout||'8h'} onChange={function(e){set('session_timeout',e.target.value);}} style={inp}>
                <option value="2h">2 hours</option>
                <option value="4h">4 hours</option>
                <option value="8h">8 hours (recommended)</option>
                <option value="24h">24 hours</option>
              </select>
              <div style={hint}>Staff are automatically logged out after this period of inactivity</div>
            </div>
            <div>
              <label style={lbl}>Minimum Password Length</label>
              <select value={config.min_password_length||'10'} onChange={function(e){set('min_password_length',e.target.value);}} style={inp}>
                {['8','10','12','14','16'].map(function(n){ return <option key={n} value={n}>{n} characters</option>; })}
              </select>
            </div>
          </div>
        )}

        {activeTab === 'fees' && (
          <div style={section}>
            <div style={sectionTitle}>Fees & Response Deadlines</div>
            <div>
              <label style={lbl}>Fee Waiver Threshold</label>
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <span style={{color:'#6B7280',fontSize:'14px'}}>$</span>
                <input type="number" value={config.fee_threshold||'40'} onChange={function(e){set('fee_threshold',e.target.value);}} style={Object.assign({},inp,{width:'120px'})} min="0" step="0.01"/>
              </div>
              <div style={hint}>Requests with estimated fees below this amount are automatically waived. Default: $40.00 (Texas PIA standard)</div>
            </div>
            <div>
              <label style={lbl}>Response Deadlines (Business Days)</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginTop:'8px'}}>
                {[['Simple','deadline_simple','5'],['Standard','deadline_standard','10'],['Complex','deadline_complex','20'],['Redaction Required','deadline_redaction','30']].map(function(item){
                  return (
                    <div key={item[0]} style={{background:'#F9FAFB',borderRadius:'8px',padding:'12px',border:'1px solid #F3F4F6'}}>
                      <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'6px'}}>{item[0]}</label>
                      <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                        <input type="number" value={config[item[1]]||item[2]} onChange={function(e){set(item[1],e.target.value);}} style={{width:'70px',padding:'8px',border:'1px solid #E5E7EB',borderRadius:'6px',fontSize:'14px',outline:'none'}} min="1"/>
                        <span style={{fontSize:'13px',color:'#9CA3AF'}}>business days</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={lbl}>Cost Per Page (Photocopies)</label>
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <span style={{color:'#6B7280',fontSize:'14px'}}>$</span>
                <input type="number" value={config.cost_per_page||'0.10'} onChange={function(e){set('cost_per_page',e.target.value);}} style={Object.assign({},inp,{width:'120px'})} min="0" step="0.01"/>
                <span style={{fontSize:'13px',color:'#9CA3AF'}}>per page</span>
              </div>
            </div>
            <div>
              <label style={lbl}>Staff Labor Rate</label>
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <span style={{color:'#6B7280',fontSize:'14px'}}>$</span>
                <input type="number" value={config.labor_rate||'15.00'} onChange={function(e){set('labor_rate',e.target.value);}} style={Object.assign({},inp,{width:'120px'})} min="0" step="0.01"/>
                <span style={{fontSize:'13px',color:'#9CA3AF'}}>per hour</span>
              </div>
              <div style={hint}>Used for fee estimates on research-intensive requests</div>
            </div>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div style={section}>
            <div style={sectionTitle}>Notification Settings</div>
            <div>
              <label style={lbl}>Overdue Alert — Notify Staff</label>
              <select value={config.overdue_alert_days||'1'} onChange={function(e){set('overdue_alert_days',e.target.value);}} style={inp}>
                <option value="0">On the deadline day</option>
                <option value="1">1 day before deadline</option>
                <option value="2">2 days before deadline</option>
                <option value="3">3 days before deadline</option>
                <option value="5">5 days before deadline</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Supervisor Escalation — Auto-Escalate After</label>
              <select value={config.escalation_days||'3'} onChange={function(e){set('escalation_days',e.target.value);}} style={inp}>
                <option value="1">1 day overdue</option>
                <option value="2">2 days overdue</option>
                <option value="3">3 days overdue</option>
                <option value="5">5 days overdue</option>
                <option value="0">Never — manual escalation only</option>
              </select>
              <div style={hint}>Overdue requests are automatically flagged for supervisor review after this period</div>
            </div>
            <div>
              <label style={lbl}>Requestor Acknowledgement Email</label>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                {[['on','Enabled'],['off','Disabled']].map(function(item){
                  var active = (config.ack_email||'on') === item[0];
                  return <button key={item[0]} type="button" onClick={function(){set('ack_email',item[0]);}}
                    style={{padding:'8px 20px',borderRadius:'8px',border:'2px solid '+(active?'#1F4E79':'#E5E7EB'),background:active?'#EBF3FB':'white',color:active?'#1F4E79':'#6B7280',fontSize:'13px',fontWeight:active?'700':'500',cursor:'pointer'}}>
                    {item[1]}
                  </button>;
                })}
              </div>
              <div style={hint}>Send an automatic acknowledgement email to requestors when their request is received</div>
            </div>
          </div>
        )}

        <div style={{display:'flex',justifyContent:'flex-end',marginTop:'8px'}}>
          <button type="submit" disabled={saving} style={{padding:'11px 32px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </form>
    </div>
  );
}
