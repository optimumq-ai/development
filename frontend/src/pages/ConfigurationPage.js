import React, { useEffect, useState } from 'react';
import api from '../lib/api';

export default function ConfigurationPage() {
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [err, setErr] = useState('');
  const [activeTab, setActiveTab] = useState('agency');
  const [rules, setRules] = useState([]);
  const [newRuleText, setNewRuleText] = useState('');
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editingText, setEditingText] = useState('');
  function loadRules() {
    api.get('/agent-rules')
      .then(function(r){ if (Array.isArray(r.data)) setRules(r.data); })
      .catch(function(){});
  }
  React.useEffect(function(){ loadRules(); }, []);
  function addRule() {
    var text = (newRuleText || '').trim();
    if (!text) return;
    api.post('/agent-rules', { rule_text: text })
      .then(function(){ setNewRuleText(''); loadRules(); });
  }
  function toggleRule(id, enabled) {
    api.patch('/agent-rules/' + id, { enabled: enabled ? 1 : 0 })
      .then(function(){ loadRules(); });
  }
  function saveRuleEdit(id) {
    api.patch('/agent-rules/' + id, { rule_text: editingText })
      .then(function(){ setEditingRuleId(null); setEditingText(''); loadRules(); });
  }
  function deleteRule(id) {
    if (!window.confirm('Delete this rule? The agent will stop following it on its next conversation.')) return;
    api.delete('/agent-rules/' + id)
      .then(function(){ loadRules(); });
  }

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
    { key:'email', label:'Email' },
    { key:'redaction', label:'Redaction' },
    { key:'agent', label:'Agent Rules' },
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

        {activeTab === 'email' && (
          <div style={section}>
            <div style={sectionTitle}>Email Provider Settings</div>
            <div style={{background:'#EBF3FB',border:'1px solid #C7D9EB',borderRadius:'8px',padding:'14px 16px',fontSize:'13px',color:'#1F4E79'}}>
              <strong>Supported email providers:</strong> Resend, SMTP, SendGrid, Postmark, Mailgun, AWS SES, and Microsoft 365 (Graph API).<br/>
              <span style={{fontSize:'12px',color:'#4B6584'}}>If a Resend API key is configured, it takes priority over SMTP. Additional providers can be enabled on request — contact Optimum Q for activation.</span>
            </div>
            <div>
              <label style={lbl}>Active Provider</label>
              <select disabled value={config.resend_api_key ? 'resend' : (config.smtp_host ? 'smtp' : 'none')} style={Object.assign({}, inp, {background:'#F9FAFB',color:'#6B7280',cursor:'not-allowed'})}>
                <option value="none">— Not configured —</option>
                <option value="resend">Resend</option>
                <option value="smtp">SMTP (Gmail, Office 365, etc.)</option>
                <option value="sendgrid" disabled>SendGrid (available on request)</option>
                <option value="postmark" disabled>Postmark (available on request)</option>
                <option value="mailgun" disabled>Mailgun (available on request)</option>
                <option value="ses" disabled>AWS SES (available on request)</option>
                <option value="ms365" disabled>Microsoft 365 (available on request)</option>
              </select>
              <div style={hint}>Auto-detected based on which credentials are configured below</div>
            </div>
            <div>
              <label style={lbl}>Resend API Key</label>
              <input type="password" value={config.resend_api_key||''} onChange={function(e){set('resend_api_key',e.target.value);}} style={inp} placeholder="re_..."/>
              <div style={hint}>Sign up free at resend.com — leave blank to fall back to SMTP</div>
            </div>
            <div>
              <label style={lbl}>Resend From Address</label>
              <input type="email" value={config.resend_from||'onboarding@resend.dev'} onChange={function(e){set('resend_from',e.target.value);}} style={inp} placeholder="onboarding@resend.dev"/>
              <div style={hint}>Use onboarding@resend.dev for testing (sends only to your verified account email), or a verified domain address for production</div>
            </div>
            <div style={{height:'1px',background:'#E5E7EB',margin:'8px 0'}}></div>
            <div style={{background:'#FFFBEB',border:'1px solid #FDE68A',borderRadius:'8px',padding:'12px 14px',fontSize:'13px',color:'#92400E'}}>
              Configure outbound email so the system can send submission confirmations to requestors and new-request alerts to staff. Leave blank to disable email sending.
            </div>
            <div>
              <label style={lbl}>SMTP Host</label>
              <input value={config.smtp_host||''} onChange={function(e){set('smtp_host',e.target.value);}} style={inp} placeholder="smtp.gmail.com"/>
              <div style={hint}>Examples: smtp.gmail.com, smtp.office365.com, smtp.sendgrid.net</div>
            </div>
            <div>
              <label style={lbl}>SMTP Port</label>
              <input value={config.smtp_port||'587'} onChange={function(e){set('smtp_port',e.target.value);}} style={inp} placeholder="587"/>
              <div style={hint}>Usually 587 (TLS) or 465 (SSL)</div>
            </div>
            <div>
              <label style={lbl}>SMTP Username</label>
              <input value={config.smtp_user||''} onChange={function(e){set('smtp_user',e.target.value);}} style={inp} placeholder="openrecords@cityofdallas.gov"/>
            </div>
            <div>
              <label style={lbl}>SMTP Password</label>
              <input type="password" value={config.smtp_pass||''} onChange={function(e){set('smtp_pass',e.target.value);}} style={inp} placeholder="••••••••"/>
              <div style={hint}>For Gmail, use an App Password (not your regular login)</div>
            </div>
            <div>
              <label style={lbl}>From Address</label>
              <input type="email" value={config.smtp_from||''} onChange={function(e){set('smtp_from',e.target.value);}} style={inp} placeholder="noreply@cityofdallas.gov"/>
              <div style={hint}>If blank, the SMTP Username will be used</div>
            </div>
            <div>
              <label style={lbl}>New Request Alert Recipient</label>
              <input type="email" value={config.new_request_alert_email||''} onChange={function(e){set('new_request_alert_email',e.target.value);}} style={inp} placeholder="openrecords-team@cityofdallas.gov"/>
              <div style={hint}>Email address that receives an alert each time a new request is submitted. If blank, the Public Records Contact Email is used.</div>
            </div>
          </div>
        )}
        {activeTab === 'redaction' && (
          <div style={section}>
            <div style={sectionTitle}>Video &amp; Audio Redaction</div>
            <p style={{fontSize:'13px',color:'#6B7280',margin:'0 0 16px',lineHeight:'1.5'}}>
              How this jurisdiction handles redaction of video and audio records. (Documents are always handled within Optimum Q.) This is the jurisdiction default; individual teams will be able to override it once team routing is configured.
            </p>
            <div>
              <label style={lbl}>Default video/audio redaction mode</label>
              <select value={config.av_redaction_mode||'internal'} onChange={function(e){set('av_redaction_mode',e.target.value);}} style={inp}>
                <option value="internal">Internal - redact with Optimum Q's built-in tools</option>
                <option value="external">External - city uses its own tool; Optimum Q holds the request and resumes on check-in</option>
                <option value="not_required">Not required - presumptively releasable (still reviewed and confirmed before release)</option>
              </select>
              <div style={hint}>Internal: annotate and burn redactions inside Optimum Q. External: download the original, redact in your own tool (e.g. a body-cam vendor's software), then check the redacted file back in. Not required: for records that are public by default (e.g. council meeting video) - a reviewer still confirms before release; nothing is auto-released on this setting alone.</div>
            </div>
          </div>
        )}
        {activeTab === 'agent' && (
          <div style={section}>
            <div style={sectionTitle}>Agent Behavior Rules</div>
            <p style={{fontSize:'13px',color:'#6B7280',margin:'0 0 16px',lineHeight:'1.5'}}>
              Plain-English rules that guide the public chat agent's behavior. Use these to correct confusion, set priorities, or shape how the agent responds. Rules are applied to every conversation in addition to the agent's core instructions.
            </p>
            <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'16px'}}>
              {rules.length === 0 && <div style={{fontSize:'13px',color:'#9CA3AF',fontStyle:'italic',padding:'12px 0'}}>No rules configured yet. Add one below.</div>}
              {rules.map(function(r){
                var isEditing = editingRuleId === r.id;
                return (
                  <div key={r.id} style={{border:'1px solid #E5E7EB',borderRadius:'8px',padding:'12px',background: r.enabled ? 'white' : '#F9FAFB',opacity: r.enabled ? 1 : 0.6}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:'12px'}}>
                      <input type="checkbox" checked={r.enabled === 1} onChange={function(e){ toggleRule(r.id, e.target.checked); }} style={{marginTop:'3px',cursor:'pointer'}}/>
                      <div style={{flex:1}}>
                        {isEditing ? (
                          <textarea value={editingText} onChange={function(e){ setEditingText(e.target.value); }} style={{width:'100%',minHeight:'80px',padding:'8px',border:'1px solid #D1D5DB',borderRadius:'6px',fontSize:'13px',fontFamily:'inherit',resize:'vertical'}}/>
                        ) : (
                          <div style={{fontSize:'13px',color:'#374151',lineHeight:'1.5',whiteSpace:'pre-wrap'}}>{r.rule_text}</div>
                        )}
                        <div style={{fontSize:'11px',color:'#9CA3AF',marginTop:'6px'}}>
                          {r.created_by ? 'Added by ' + r.created_by : ''} {r.created_at ? '· ' + new Date(r.created_at + 'Z').toLocaleDateString() : ''}
                        </div>
                      </div>
                      <div style={{display:'flex',gap:'6px'}}>
                        {isEditing ? (
                          <>
                            <button type="button" onClick={function(){ saveRuleEdit(r.id); }} style={{padding:'5px 10px',fontSize:'12px',background:'#16A34A',color:'white',border:'none',borderRadius:'6px',cursor:'pointer'}}>Save</button>
                            <button type="button" onClick={function(){ setEditingRuleId(null); setEditingText(''); }} style={{padding:'5px 10px',fontSize:'12px',background:'white',color:'#6B7280',border:'1px solid #D1D5DB',borderRadius:'6px',cursor:'pointer'}}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={function(){ setEditingRuleId(r.id); setEditingText(r.rule_text); }} style={{padding:'5px 10px',fontSize:'12px',background:'white',color:'#1F4E79',border:'1px solid #1F4E79',borderRadius:'6px',cursor:'pointer'}}>Edit</button>
                            <button type="button" onClick={function(){ deleteRule(r.id); }} style={{padding:'5px 10px',fontSize:'12px',background:'white',color:'#B91C1C',border:'1px solid #FCA5A5',borderRadius:'6px',cursor:'pointer'}}>Delete</button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{borderTop:'1px solid #E5E7EB',paddingTop:'16px'}}>
              <label style={lbl}>Add a new rule</label>
              <textarea value={newRuleText} onChange={function(e){ setNewRuleText(e.target.value); }} placeholder='Example: "When a citizen mentions a specific case number, always include that case number verbatim in the search query."' style={{width:'100%',minHeight:'70px',padding:'10px',border:'1px solid #D1D5DB',borderRadius:'8px',fontSize:'13px',fontFamily:'inherit',resize:'vertical'}}/>
              <div style={{display:'flex',justifyContent:'flex-end',marginTop:'8px'}}>
                <button type="button" onClick={addRule} disabled={!newRuleText.trim()} style={{padding:'8px 18px',background: newRuleText.trim() ? '#1F4E79' : '#D1D5DB',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor: newRuleText.trim() ? 'pointer' : 'not-allowed'}}>+ Add Rule</button>
              </div>
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
