import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

// AI SERVICE KEYS — reached from the hub's 'AI service keys' row (?tab=integrations; the admin nav tab
// was removed, C3 cleanup 2026-08-29). Email moved to its own screen (C2): Setup → Email configuration.

var BLUE = '#1F4E79';
var lbl = { fontSize: '12.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '5px' };
var inp = { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', outline: 'none', boxSizing: 'border-box' };
var card = { background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px 22px', marginBottom: '18px' };

export default function IntegrationsPage() {
  var nav = useNavigate();
  var [status, setStatus] = useState(null);
  var [form, setForm] = useState({ anthropic_api_key: '', voyage_api_key: '' });
  var [saving, setSaving] = useState(false);
  var [savedMsg, setSavedMsg] = useState('');
  var [test, setTest] = useState({});

  useEffect(function () { load(); }, []);
  async function load() {
    try { var r = await api.get('/integrations'); setStatus(r.data); } catch (e) { /* ignore */ }
  }
  function set(k, v) { setForm(function (f) { var n = Object.assign({}, f); n[k] = v; return n; }); }
  async function save() {
    setSaving(true); setSavedMsg('');
    try {
      await api.post('/integrations', { ai: { anthropic_api_key: form.anthropic_api_key, voyage_api_key: form.voyage_api_key } });
      setSavedMsg('Settings saved.');
      setForm({ anthropic_api_key: '', voyage_api_key: '' });
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
        <button onClick={props.onClick} disabled={st.busy} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + BLUE, background: 'white', color: BLUE, fontSize: '12.5px', fontWeight: 700, cursor: st.busy ? 'default' : 'pointer' }}>{st.busy ? 'Testing…' : 'Test'}</button>
        {st.message ? <span style={{ fontSize: '12.5px', fontWeight: 600, color: st.ok ? '#03543F' : '#9B1C1C' }}>{st.ok ? '✓ ' : '✗ '}{st.message}</span> : null}
      </span>
    );
  }
  function secretPlaceholder(set, hint) { return set ? ('Saved (' + (hint || '••••') + ') — enter a new value to replace') : 'Not set'; }

  if (!status) return <div style={{ color: '#9CA3AF', padding: '40px' }}>Loading integration settings…</div>;

  return (
    <div style={{ maxWidth: '720px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111', margin: '0 0 4px' }}>AI Service Keys</h1>
      <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 20px', lineHeight: 1.5 }}>Keys this installation uses for AI services. Entered values are stored on this server and never displayed again after saving. Email sending is set up on its own screen: <button type="button" onClick={function () { nav('/setup/email'); }} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: BLUE, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline dotted' }}>Email configuration</button>.</p>

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

      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <button onClick={save} disabled={saving} style={{ padding: '11px 24px', borderRadius: '9px', border: 'none', background: saving ? '#9CB4CC' : BLUE, color: 'white', fontSize: '14px', fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save settings'}</button>
        {savedMsg ? <span style={{ fontSize: '13px', fontWeight: 600, color: '#03543F' }}>{savedMsg}</span> : null}
      </div>
    </div>
  );
}
