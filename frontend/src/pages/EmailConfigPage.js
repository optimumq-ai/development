import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

// EMAIL CONFIGURATION — the hub's `email` row (C2 cleanup, Kevin 2026-08-29: the Integrations page's
// email section and the hub's "Outgoing email" row become ONE screen behind the renamed row). Provider,
// credentials, sender identity and the test send — everything about how this installation sends mail,
// with the shared status strip on top. The Integrations page keeps the AI keys only; the v1
// Configuration tab's email block is retired. Data: GET/POST /api/integrations (email part) ·
// POST /api/integrations/test/email · the hub row via /api/setup-hub.

var BLUE = '#1E6091';
var STATE = {
  ready:           { label: 'Ready',           bg: '#E1F2E9', color: '#1B8A5A' },
  in_progress:     { label: 'In progress',     bg: '#F6EBD6', color: '#9A6512' },
  not_started:     { label: 'Not started',     bg: '#F3F4F6', color: '#4B5563' },
  needs_attention: { label: 'Needs attention', bg: '#FEE2E2', color: '#991B1B' },
  waiting:         { label: 'Waiting',         bg: '#EDE9FE', color: '#5B21B6' },
};
var lbl = { fontSize: '12.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '5px' };
var inp = { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', outline: 'none', boxSizing: 'border-box' };
var card = { background: 'white', border: '1px solid #D2DCE3', borderRadius: '10px' };

export default function EmailConfigPage() {
  var nav = useNavigate();
  var [status, setStatus] = useState(null);
  var [hubRow, setHubRow] = useState(null);
  var [form, setForm] = useState({ provider: 'smtp', from_name: '', smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', smtp_from: '', resend_from: '', resend_api_key: '' });
  var [saving, setSaving] = useState(false);
  var [savedMsg, setSavedMsg] = useState('');
  var [test, setTest] = useState({});
  var [testEmail, setTestEmail] = useState('');
  var [busy, setBusy] = useState('');
  var [alertEmail, setAlertEmail] = useState('');   // new_request_alert_email — carried over from the retired v1 email tab

  useEffect(function () { load(); }, []);
  async function load() {
    try {
      var c = await api.get('/config');
      if (c.data && c.data.new_request_alert_email !== undefined) setAlertEmail(c.data.new_request_alert_email || '');
    } catch (e) { /* the field simply starts blank */ }
    try {
      var r = await api.get('/integrations'); var d = r.data; setStatus(d);
      setForm(function (f) {
        return Object.assign({}, f, { provider: d.email.provider || 'smtp', from_name: d.email.from_name || '', smtp_host: d.email.smtp_host || '', smtp_port: d.email.smtp_port || '587', smtp_user: d.email.smtp_user || '', smtp_from: d.email.smtp_from || '' , resend_from: d.email.resend_from || '' });
      });
      var h = await api.get('/setup-hub'); var row = null;
      h.data.lanes.forEach(function (l) { l.items.forEach(function (x) { if (x.key === 'email') row = x; }); });
      setHubRow(row);
    } catch (e) { /* the strip degrades to Not started; the form still loads what it can */ }
  }
  function set(k, v) { setForm(function (f) { var n = Object.assign({}, f); n[k] = v; return n; }); }
  async function save() {
    setSaving(true); setSavedMsg('');
    try {
      await api.post('/integrations', {
        email: { provider: form.provider, from_name: form.from_name, smtp_host: form.smtp_host, smtp_port: form.smtp_port, smtp_user: form.smtp_user, smtp_pass: form.smtp_pass, smtp_from: form.smtp_from, resend_from: form.resend_from, resend_api_key: form.resend_api_key }
      });
      await api.post('/config', { new_request_alert_email: alertEmail });
      setSavedMsg('Settings saved.');
      setForm(function (f) { return Object.assign({}, f, { smtp_pass: '', resend_api_key: '' }); });
      load();
    } catch (e) { setSavedMsg('Could not save settings.'); }
    setSaving(false);
  }
  async function runTest(payload) {
    setTest({ busy: true });
    try { var r = await api.post('/integrations/test/email', payload || {}); setTest({ busy: false, ok: r.data.ok, message: r.data.message }); }
    catch (e) { setTest({ busy: false, ok: false, message: 'Test failed.' }); }
  }
  async function toggleAttest() {
    setBusy('attest');
    try { if (hubRow && hubRow.signoff) await api.delete('/setup-hub/email/done'); else await api.post('/setup-hub/email/done'); await load(); }
    catch (e) { setSavedMsg('Could not update the sign-off.'); }
    setBusy('');
  }

  if (!status) return <div style={{ color: '#9CA3AF', padding: '40px' }}>Loading email settings…</div>;
  var st = STATE[(hubRow && hubRow.state) || 'not_started'];
  var can = !!(hubRow && hubRow.canEdit);
  var attested = hubRow && hubRow.signoff;

  return (
    <div style={{ maxWidth: '860px', color: '#12232E' }}>
      {/* status strip — the shared pattern */}
      <div style={Object.assign({}, card, { display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 14px', marginBottom: '14px' })}>
        <button type="button" onClick={function () { nav('/admin?tab=setup'); }} title="Back to Setup and Configuration"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 11px', border: 0, borderRadius: '999px', background: st.bg, color: st.color, fontSize: '11px', fontWeight: '700', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          {st.label}
        </button>
        <span style={{ flexGrow: 1, fontSize: '12px', color: '#5C6F7C', lineHeight: '1.35' }}>{hubRow ? hubRow.evidence : ''}</span>
        <span style={{ fontSize: '11.5px', color: '#8296A4' }}>Technical Setup</span>
        {attested
          ? <button type="button" disabled={busy === 'attest' || !can} onClick={toggleAttest} style={{ height: '30px', padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', background: 'white', color: '#12232E', border: '1px solid #BECAD3', cursor: 'pointer' }}>Attested · undo</button>
          : <button type="button" disabled={!can || busy === 'attest'} onClick={toggleAttest} style={{ height: '30px', padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', background: can ? BLUE : '#F2F6F9', color: can ? 'white' : '#A9B7C2', border: '1px solid ' + (can ? BLUE : '#D2DCE3'), cursor: can ? 'pointer' : 'default' }}>Attest as complete</button>}
      </div>

      <div style={Object.assign({}, card, { padding: '20px 22px' })}>
        <div style={{ fontSize: '19px', fontWeight: 700, marginBottom: '3px' }}>Email configuration</div>
        <div style={{ fontSize: '12.5px', color: '#5C6F7C', marginBottom: '18px', lineHeight: 1.5 }}>How this installation sends mail — acknowledgments, notices, and staff notifications. On-premise installs typically use their own mail server (SMTP). Credentials are stored on this server and never displayed again after saving.</div>

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
              <div style={{ flex: 1 }}><label style={lbl}>Password {status.email.smtp_pass_set ? <span style={{ color: '#03543F' }}>&middot; set</span> : null}</label><input type="password" value={form.smtp_pass} onChange={function (e) { set('smtp_pass', e.target.value); }} placeholder={status.email.smtp_pass_set ? 'Saved — enter to replace' : ''} style={inp} autoComplete="new-password" /></div>
            </div>
            <div style={{ marginBottom: '16px' }}><label style={lbl}>From address</label><input value={form.smtp_from} onChange={function (e) { set('smtp_from', e.target.value); }} placeholder="records@city.gov" style={inp} /></div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '14px' }}><label style={lbl}>Resend API key {status.email.resend_key_set ? <span style={{ color: '#03543F' }}>&middot; set</span> : null}</label><input type="password" value={form.resend_api_key} onChange={function (e) { set('resend_api_key', e.target.value); }} placeholder={status.email.resend_key_set ? 'Saved — enter to replace' : 're_…'} style={inp} autoComplete="new-password" /></div>
            <div style={{ marginBottom: '16px' }}><label style={lbl}>From address (verified domain)</label><input value={form.resend_from} onChange={function (e) { set('resend_from', e.target.value); }} placeholder="records@city.gov" style={inp} /></div>
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={lbl}>New request alert recipient</label>
          <input type="email" value={alertEmail} onChange={function (e) { setAlertEmail(e.target.value); }} placeholder="openrecords-team@city.gov" style={inp} />
          <div style={{ fontSize: '11.5px', color: '#9CA3AF', marginTop: '4px' }}>Gets an alert each time a new request is submitted. Blank = the public records contact email.</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
          <button onClick={save} disabled={saving || !can} style={{ padding: '10px 22px', borderRadius: '8px', border: 'none', background: (saving || !can) ? '#9CB4CC' : BLUE, color: 'white', fontSize: '13.5px', fontWeight: 700, cursor: (saving || !can) ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save settings'}</button>
          {savedMsg ? <span style={{ fontSize: '13px', fontWeight: 600, color: /not/i.test(savedMsg) ? '#9B1C1C' : '#03543F' }}>{savedMsg}</span> : null}
          {!can ? <span style={{ fontSize: '12px', color: '#8296A4' }}>view only for you — the System Administrator owns this</span> : null}
        </div>

        <div style={{ borderTop: '1px solid #EEF2F5', paddingTop: '14px' }}>
          <label style={lbl}>Send a test email to</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={testEmail} onChange={function (e) { setTestEmail(e.target.value); }} placeholder="you@city.gov" style={Object.assign({}, inp, { flex: 1, minWidth: '200px', width: 'auto' })} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
              <button onClick={function () { runTest({ to: testEmail }); }} disabled={test.busy} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + BLUE, background: 'white', color: BLUE, fontSize: '12.5px', fontWeight: 700, cursor: test.busy ? 'default' : 'pointer' }}>{test.busy ? 'Testing…' : 'Test'}</button>
              {test.message ? <span style={{ fontSize: '12.5px', fontWeight: 600, color: test.ok ? '#03543F' : '#9B1C1C' }}>{test.ok ? '✓ ' : '✗ '}{test.message}</span> : null}
            </span>
          </div>
          <div style={{ fontSize: '11.5px', color: '#9CA3AF', marginTop: '8px' }}>Save your settings before sending the test so it uses the latest values.</div>
        </div>
      </div>
    </div>
  );
}
