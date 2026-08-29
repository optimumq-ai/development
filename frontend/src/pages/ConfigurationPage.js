import React, { useEffect, useState } from 'react';
import api from '../lib/api';

export default function ConfigurationPage() {
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [err, setErr] = useState('');
  const [activeTab, setActiveTab] = useState('auth');
  const [rules, setRules] = useState([]);
  const [newRuleText, setNewRuleText] = useState('');
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editingText, setEditingText] = useState('');
  // Time-capture visibility (Slice E) — saved via its own /config/time-capture endpoint, not the generic /config.
  const [tc, setTc] = useState(null);
  const [tcUis, setTcUis] = useState([]);
  const [tcSaving, setTcSaving] = useState(false);
  const [tcMsg, setTcMsg] = useState('');
  React.useEffect(function(){
    api.get('/config/time-capture').then(function(r){ setTc((r.data && r.data.config) || {}); setTcUis((r.data && r.data.uis) || []); }).catch(function(){});
  }, []);
  function setTcMode(key, mode) { setTc(function(c){ return Object.assign({}, c || {}, { [key]: mode }); }); }
  // Task time budgets (SPEC_operational_dashboard.md slice 1) — its own endpoint, like time-capture.
  const [budgets, setBudgets] = useState([]);
  const [budgetEdits, setBudgetEdits] = useState({});
  const [budgetMsg, setBudgetMsg] = useState('');
  React.useEffect(function(){
    api.get('/config/time-budgets').then(function(r){ setBudgets((r.data && r.data.budgets) || []); }).catch(function(){});
  }, []);
  async function saveBudget(taskType) {
    setBudgetMsg('');
    try {
      var r = await api.put('/config/time-budgets', { taskType: taskType, budgetDays: Number(budgetEdits[taskType]) });
      setBudgets(function(list){ return list.map(function(b){ return b.task_type === taskType ? r.data.budget : b; }); });
      setBudgetEdits(function(e){ var n = Object.assign({}, e); delete n[taskType]; return n; });
      setBudgetMsg('Budget for ' + budgetLabel(taskType) + ' saved.');
    } catch(e){ setBudgetMsg((e.response && e.response.data && e.response.data.error) || 'Failed to save.'); }
  }
  function budgetLabel(t){
    return ({ estimate:'Estimate', record_search:'Record Search', redaction:'Redaction', legal_redaction:'Legal Redaction',
      legal_review:'Legal Review', redaction_qa:'Redaction QA', fee_waiver:'Fee Waiver Review', routing_review:'Routing Review' })[t]
      || t.replace(/_/g,' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); });
  }
  async function saveTc() {
    setTcSaving(true); setTcMsg('');
    try { var r = await api.put('/config/time-capture', { config: tc }); setTc(r.data.config); setTcMsg('Time-tracking settings saved.'); }
    catch(e){ setTcMsg((e.response && e.response.data && e.response.data.error) || 'Failed to save.'); }
    setTcSaving(false);
  }
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
    { key:'auth', label:'Authentication' },
    { key:'notifications', label:'Notifications' },
    { key:'redaction', label:'Redaction' },
    { key:'timecapture', label:'Time Tracking' },
    { key:'budgets', label:'Task Time Budgets' },
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
        {activeTab === 'timecapture' && (
          <div style={section}>
            <div style={sectionTitle}>Staff Time Tracking</div>
            <p style={{fontSize:'13px',color:'#6B7280',margin:'0 0 4px',lineHeight:'1.5'}}>
              Whether staff log actual time spent on each task type — the measured hours that can feed fee reconciliation.
              Because states differ (and often disagree) on which labor is chargeable to a requester, this is your city's call, per screen.
              Time is always measured quietly in the background; these settings only control whether staff SEE the timer and are asked to confirm their time when they finish a task.
            </p>
            {tcMsg && <div style={{background: tcMsg.indexOf('saved')>=0 ? '#F0FDF4':'#FEF2F2', border:'1px solid '+(tcMsg.indexOf('saved')>=0 ? '#86EFAC':'#FCA5A5'), borderRadius:'8px', padding:'10px 12px', fontSize:'13px', color: tcMsg.indexOf('saved')>=0 ? '#166534':'#DC2626'}}>{tcMsg}</div>}
            {(tcUis||[]).map(function(u){
              var cur = (tc && tc[u.key]) || 'off';
              var modes = [['off','Off'],['discretion','User discretion'],['always','Always']];
              return (
                <div key={u.key} style={{opacity: u.available ? 1 : 0.55, borderBottom:'1px solid #F3F4F6', paddingBottom:'16px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'2px'}}>
                    <label style={{fontSize:'13px',fontWeight:'600',color:'#374151'}}>{u.label}</label>
                    {!u.available && <span style={{fontSize:'11px',fontWeight:600,color:'#9CA3AF',background:'#F3F4F6',borderRadius:'20px',padding:'2px 8px'}}>Not yet available</span>}
                  </div>
                  <div style={{display:'flex',gap:'8px',marginTop:'8px'}}>
                    {modes.map(function(m){
                      var active = cur === m[0];
                      return <button key={m[0]} type="button" disabled={!u.available}
                        onClick={function(){ if (u.available) setTcMode(u.key, m[0]); }}
                        style={{padding:'8px 16px',borderRadius:'8px',border:'2px solid '+(active?'#1F4E79':'#E5E7EB'),background:active?'#EBF3FB':'white',color:active?'#1F4E79':'#6B7280',fontSize:'13px',fontWeight:active?'700':'500',cursor: u.available?'pointer':'not-allowed'}}>
                        {m[1]}
                      </button>;
                    })}
                  </div>
                </div>
              );
            })}
            <div style={{fontSize:'12px',color:'#9CA3AF',lineHeight:'1.5'}}>
              <strong>Off</strong> — no timer shown; finishing a task moves straight on. &nbsp;
              <strong>User discretion</strong> — the timer shows and, on finish, staff confirm their time or Skip it. &nbsp;
              <strong>Always</strong> — the timer shows and staff always confirm their time on finish.
            </div>
            <div style={{display:'flex',justifyContent:'flex-end'}}>
              <button type="button" onClick={saveTc} disabled={tcSaving} style={{padding:'11px 32px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>
                {tcSaving ? 'Saving…' : 'Save Time-Tracking Settings'}
              </button>
            </div>
          </div>
        )}
        {activeTab === 'budgets' && (
          <div style={section}>
            <div style={sectionTitle}>Task Time Budgets</div>
            <p style={{fontSize:'13px',color:'#6B7280',margin:'0 0 4px',lineHeight:'1.5'}}>
              How many days each kind of task should take. When a task runs past its budget, it shows as late
              on the dashboard — an early warning that a slow early step is eating the legal deadline, long
              before the legal deadline itself is at risk. These are working targets your office sets, not
              legal deadlines; the statutory clock is tracked separately and is never affected by these numbers.
            </p>
            {budgetMsg && <div style={{background: budgetMsg.indexOf('saved')>=0 ? '#F0FDF4':'#FEF2F2', border:'1px solid '+(budgetMsg.indexOf('saved')>=0 ? '#86EFAC':'#FCA5A5'), borderRadius:'8px', padding:'10px 12px', fontSize:'13px', color: budgetMsg.indexOf('saved')>=0 ? '#166534':'#DC2626'}}>{budgetMsg}</div>}
            {budgets.map(function(b){
              var edited = budgetEdits[b.task_type] !== undefined;
              var val = edited ? budgetEdits[b.task_type] : String(b.budget_days);
              return (
                <div key={b.task_type} style={{display:'flex',alignItems:'center',gap:'14px',borderBottom:'1px solid #F3F4F6',paddingBottom:'12px'}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:'13px',fontWeight:'600',color:'#374151'}}>{budgetLabel(b.task_type)}</div>
                    <div style={{fontSize:'11px',color:'#9CA3AF'}}>
                      {b.source === 'supervisor' && b.updated_by ? ('Set by ' + b.updated_by) : 'Provisional default — not yet reviewed by your office'}
                    </div>
                  </div>
                  <input type="number" min="0.5" max="365" step="0.5" value={val}
                    onChange={function(e){ setBudgetEdits(function(ed){ return Object.assign({}, ed, { [b.task_type]: e.target.value }); }); }}
                    style={{width:'90px',padding:'9px 10px',border:'1px solid #E5E7EB',borderRadius:'8px',fontSize:'14px',textAlign:'right'}} />
                  <span style={{fontSize:'12px',color:'#6B7280',width:'34px'}}>days</span>
                  <button type="button" onClick={function(){ saveBudget(b.task_type); }} disabled={!edited}
                    style={{padding:'9px 18px',background: edited ? '#1F4E79' : '#E5E7EB',color: edited ? 'white' : '#9CA3AF',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor: edited ? 'pointer' : 'default'}}>Save</button>
                </div>
              );
            })}
            <div style={{fontSize:'12px',color:'#9CA3AF',lineHeight:'1.5'}}>
              Example: with a 3-day budget on Record Search, a search still unfinished on day 4 shows as
              1 day late on the dashboard — even if the request's legal deadline is still comfortably away.
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
        {activeTab !== 'timecapture' && (
          <div style={{display:'flex',justifyContent:'flex-end',marginTop:'8px'}}>
            <button type="submit" disabled={saving} style={{padding:'11px 32px',background:'#1F4E79',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'600',cursor:'pointer'}}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
