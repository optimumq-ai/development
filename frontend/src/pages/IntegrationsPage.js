import React, { useState, useEffect } from 'react';
import api from '../lib/api';

var BLUE = '#1F4E79';
var lbl = { fontSize: '12.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '5px' };
var inp = { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', outline: 'none', boxSizing: 'border-box' };
var card = { background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px 22px', marginBottom: '18px' };

export default function IntegrationsPage() {
  var [status, setStatus] = useState(null);
  var [form, setForm] = useState({ anthropic_api_key: '', voyage_api_key: '', provider: 'smtp', from_name: '', smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', smtp_from: '', resend_from: '', resend_api_key: '' });
  var [saving, setSaving] = useState(false);
  var [savedMsg, setSavedMsg] = useState('');
  var [test, setTest] = useState({});
  var [testEmail, setTestEmail] = useState('');

  useEffect(function () { load(); }, []);
  async function load() {
    try {
      var r = await api.get('/integrations'); var d = r.data; setStatus(d);
      setForm(function (f) {
        return Object.assign({}, f, { provider: d.email.provider || 'smtp', from_name: d.email.from_name || '', smtp_host: d.email.smtp_host || '', smtp_port: d.email.smtp_port || '587', smtp_user: d.email.smtp_user || '', smtp_from: d.email.smtp_from || '', resend_from: d.email.resend_from || '' });
      });
    } catch (e) { /* ignore */ }
  }
  function set(k, v) { setForm(function (f) { var n = Object.assign({}, f); n[k] = v; return n; }); }
  async function save() {
    setSaving(true); setSavedMsg('');
    try {
      await api.post('/integrations', {
        ai: { anthropic_api_key: form.anthropic_api_key, voyage_api_key: form.voyage_api_key },
        email: { provider: form.provider, from_name: form.from_name, smtp_host: form.smtp_host, smtp_port: form.smtp_port, smtp_user: form.smtp_user, smtp_pass: form.smtp_pass, smtp_from: form.smtp_from, resend_from: form.resend_from, resend_api_key: form.resend_api_key }
      });
      setSavedMsg('Settings saved.');
      setForm(function (f) { return Object.assign({}, f, { anthropic_api_key: '', voyage_api_key: '', smtp_pass: '', resend_api_key: '' }); });
      load();
    } catch (e) { setSavedMsg('Could not save settings.'); }
    setSaving(false);
  }
  async function runTest(which, payload) {
    setTest(function (t) { var n = Object.assign({}, t); n[which] = { busy: true }; return n; });
    try { var r = await api.post('/integrations/test/' + which, payload || {}); setTest(function (t) { var n = Object.assign({}, t); n[which] = { busy: false, ok: r.data.ok, message: r.data.message }; return n; }); }
    catch (e) { setTest(function (t) { var n = Object.assign({}, t); n[which] = { busy: false, ok: false, message: 'Test failed.' }; return n; }); }
  }
  function TestBtn(props) {
    var st = test[props.which] || {};
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
        <button onClick={props.onClick} disabled={st.busy} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + BLUE, background: 'white', color: BLUE, fontSize: '12.5px', fontWeight: 700, cursor: st.busy ? 'default' : 'pointer' }}>{st.busy ? 'Testing\u2026' : 'Test'}</button>
        {st.message ? <span style={{ fontSize: '12.5px', fontWeight: 600, color: st.ok ? '#03543F' : '#9B1C1C' }}>{st.ok ? '\u2713 ' : '\u2717 '}{st.message}</span> : null}
      </span>
    );
  }
  function secretPlaceholder(set, hint) { return set ? ('Saved (' + (hint || '\u2022\u2022\u2022\u2022') + ') \u2014 enter a new value to replace') : 'Not set'; }

  if (!status) return <div style={{ color: '#9CA3AF', padding: '40px' }}>Loading integration settings\u2026</div>;

  return (
    <div style={{ maxWidth: '720px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111', margin: '0 0 4px' }}>Integrations &amp; API Keys</h1>
      <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 20px', lineHeight: 1.5 }}>Keys and credentials this installation uses for AI and email. Entered values are stored on this server and never displayed again after saving.</p>

      <div style={card}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>AI Services</div>
        <div style={{ fontSize: '12.5px', color: '#6B7280', marginBottom: '16px', lineHeight: 1.5 }}>Used for request classification, redaction assistance, semantic search, and reporting. Create accounts at Anthropic and Voyage AI and paste the keys here.</div>

        <div style={{ marginBottom: '16px' }}>
          <label style={lbl}>Anthropic API key {status.ai.anthropic.set ? <span style={{ color: '#03543F', fontWeight: 700 }}>&middot; configured</span> : <span style={{ color: '#9B1C1C', fontWeight: 700 }}>&middot; not set</span>}</label>
          <input type="password" value={form.anthropic_api_key} onChange={function (e) { set('anthropic_api_key', e.target.value); }} placeholder={secretPlaceholder(status.ai.anthropic.set, status.ai.anthropic.hint)} style={Object.assign({}, inp, { marginBottom: '8px' })} autoComplete="new-password" />
          <TestBtn which="anthropic" onClick={function () { runTest('anthropic', { key: form.anthropic_api_key }); }} />
        </div>
        <div>
          <label style={lbl}>Voyage AI API key {status.ai.voyage.set ? <span style={{ color: '#03543F', fontWeight: 700 }}>&middot; configured</span> : <span style={{ color: '#9B1C1C', fontWeight: 700 }}>&middot; not set</span>}</label>
          <input type="password" value={form.voyage_api_key} onChange={function (e) { set('voyage_api_key', e.target.value); }} placeholder={secretPlaceholder(status.ai.voyage.set, status.ai.voyage.hint)} style={Object.assign({}, inp, { marginBottom: '8px' })} autoComplete="new-password" />
          <TestBtn which="voyage" onClick={function () { runTest('voyage', { key: form.voyage_api_key }); }} />
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>Email</div>
        <div style={{ fontSize: '12.5px', color: '#6B7280', marginBottom: '16px', lineHeight: 1.5 }}>How notification emails are sent. On-premise installs typically use their own mail server (SMTP).</div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <span onClick={function () { set('provider', 'smtp'); }} style={{ fontSize: '12.5px', padding: '7px 14px', borderRadius: '999px', cursor: 'pointer', border: '1px solid ' + (form.provider === 'smtp' ? BLUE : '#D1D5DB'), background: form.provider === 'smtp' ? '#EBF3FB' : 'white', color: form.provider === 'smtp' ? BLUE : '#374151', fontWeight: 600 }}>My mail server (SMTP)</span>
          <span onClick={function () { set('provider', 'resend'); }} style={{ fontSize: '12.5px', padding: '7px 14px', borderRadius: '999px', cursor: 'pointer', border: '1px solid ' + (form.provider === 'resend' ? BLUE : '#D1D5DB'), background: form.provider === 'resend' ? '#EBF3FB' : 'white', color: form.provider === 'resend' ? BLUE : '#374151', fontWeight: 600 }}>Resend (hosted)</span>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={lbl}>From name</label>
          <input value={form.from_name} onChange={function (e) { set('from_name', e.target.value); }} placeholder="e.g. City of Springfield Records" style={inp} />
        </div>

        {form.provider === 'smtp' ? (
          <div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
              <div style={{ flex: 2 }}><label style={lbl}>SMTP host</label><input value={form.smtp_host} onChange={function (e) { set('smtp_host', e.target.value); }} placeholder="mail.city.gov" style={inp} /></div>
              <div style={{ flex: 1 }}><label style={lbl}>Port</label><input value={form.smtp_port} onChange={function (e) { set('smtp_port', e.target.value); }} placeholder="587" style={inp} /></div>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
              <div style={{ flex: 1 }}><label style={lbl}>Username</label><input value={form.smtp_user} onChange={function (e) { set('smtp_user', e.target.value); }} placeholder="records@city.gov" style={inp} autoComplete="off" /></div>
              <div style={{ flex: 1 }}><label style={lbl}>Password {status.email.smtp_pass_set ? <span style={{ color: '#03543F' }}>&middot; set</span> : null}</label><input type="password" value={form.smtp_pass} onChange={function (e) { set('smtp_pass', e.target.value); }} placeholder={status.email.smtp_pass_set ? 'Saved \u2014 enter to replace' : ''} style={inp} autoComplete="new-password" /></div>
            </div>
            <div style={{ marginBottom: '16px' }}><label style={lbl}>From address</label><input value={form.smtp_from} onChange={function (e) { set('smtp_from', e.target.value); }} placeholder="records@city.gov" style={inp} /></div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '14px' }}><label style={lbl}>Resend API key {status.email.resend_key_set ? <span style={{ color: '#03543F' }}>&middot; set</span> : null}</label><input type="password" value={form.resend_api_key} onChange={function (e) { set('resend_api_key', e.target.value); }} placeholder={status.email.resend_key_set ? 'Saved \u2014 enter to replace' : 're_\u2026'} style={inp} autoComplete="new-password" /></div>
            <div style={{ marginBottom: '16px' }}><label style={lbl}>From address (verified domain)</label><input value={form.resend_from} onChange={function (e) { set('resend_from', e.target.value); }} placeholder="records@city.gov" style={inp} /></div>
          </div>
        )}

        <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: '14px' }}>
          <label style={lbl}>Send a test email to</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={testEmail} onChange={function (e) { setTestEmail(e.target.value); }} placeholder="you@city.gov" style={Object.assign({}, inp, { flex: 1, minWidth: '200px', width: 'auto' })} />
            <TestBtn which="email" onClick={function () { runTest('email', { to: testEmail }); }} />
          </div>
          <div style={{ fontSize: '11.5px', color: '#9CA3AF', marginTop: '8px' }}>Save your settings before sending the test so it uses the latest values.</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <button onClick={save} disabled={saving} style={{ padding: '11px 24px', borderRadius: '9px', border: 'none', background: saving ? '#9CB4CC' : BLUE, color: 'white', fontSize: '14px', fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving\u2026' : 'Save settings'}</button>
        {savedMsg ? <span style={{ fontSize: '13px', fontWeight: 600, color: '#03543F' }}>{savedMsg}</span> : null}
      </div>
    </div>
  );
}
