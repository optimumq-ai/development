import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import SetupScreen, { lbl, inp, hint, field, Msg, PrimaryButton } from '../components/setup/SetupScreen';

// USER AUTHENTICATION SETUP — the hub's `auth_policy` row (C11, Kevin 2026-08-30: the v1 Configuration
// page's Authentication tab becomes this dedicated screen). Sign-in mode, MFA policy, session timeout and
// password length. Data: GET/POST /api/config (system authority).

var KEYS = ['auth_mode', 'mfa_mode', 'session_timeout', 'min_password_length'];

export default function AuthenticationSetupPage() {
  var [form, setForm] = useState(null);
  var [saving, setSaving] = useState(false);
  var [msg, setMsg] = useState(null);
  useEffect(function () {
    api.get('/config').then(function (r) {
      var c = r.data || {};
      setForm({ auth_mode: c.auth_mode || 'local', mfa_mode: c.mfa_mode || 'optional', session_timeout: c.session_timeout || '8h', min_password_length: c.min_password_length || '10' });
    }).catch(function () { setForm({}); setMsg({ ok: false, text: 'The current settings could not be read.' }); });
  }, []);
  function set(k, v) { setForm(function (f) { var n = Object.assign({}, f); n[k] = v; return n; }); }
  async function save(reload) {
    setSaving(true); setMsg(null);
    try { var body = {}; KEYS.forEach(function (k) { body[k] = form[k]; }); await api.post('/config', body); setMsg({ ok: true, text: 'Authentication settings saved.' }); await reload(); }
    catch (e) { setMsg({ ok: false, text: (e.response && e.response.data && e.response.data.error) || 'Could not save.' }); }
    setSaving(false);
  }
  return (
    <SetupScreen hubKey="auth_policy" laneLabel="Technical Setup" title="User Authentication Setup"
      intro="How staff sign in to this installation: local credentials or the city's single sign-on, whether multi-factor authentication is required, how long a session lasts, and how long a password must be.">
      {function (s) {
        if (!form) return <div style={{ color: '#9CA3AF' }}>Loading…</div>;
        return (
          <div>
            {msg ? <Msg text={msg.text} ok={msg.ok} /> : null}
            <div style={field}>
              <label style={lbl}>Authentication mode</label>
              <select value={form.auth_mode} disabled={!s.can} onChange={function (e) { set('auth_mode', e.target.value); }} style={inp}>
                <option value="local">Local credentials</option>
                <option value="sso">Single sign-on (SSO)</option>
              </select>
              <div style={hint}>Local credentials keeps usernames and passwords inside Optimum Q. Single sign-on uses the city's identity provider instead.</div>
            </div>
            <div style={field}>
              <label style={lbl}>Multi-factor authentication</label>
              <select value={form.mfa_mode} disabled={!s.can} onChange={function (e) { set('mfa_mode', e.target.value); }} style={inp}>
                <option value="off">Off — not available</option>
                <option value="optional">Optional — staff may enroll</option>
                <option value="required">Required — all staff must enroll</option>
                <option value="elevated">Elevated roles only — supervisors and above</option>
              </select>
            </div>
            <div style={field}>
              <label style={lbl}>Session timeout</label>
              <select value={form.session_timeout} disabled={!s.can} onChange={function (e) { set('session_timeout', e.target.value); }} style={inp}>
                <option value="2h">2 hours</option>
                <option value="4h">4 hours</option>
                <option value="8h">8 hours (recommended)</option>
                <option value="24h">24 hours</option>
              </select>
              <div style={hint}>Staff are signed out automatically after this much inactivity.</div>
            </div>
            <div style={field}>
              <label style={lbl}>Minimum password length</label>
              <select value={form.min_password_length} disabled={!s.can} onChange={function (e) { set('min_password_length', e.target.value); }} style={inp}>
                {['8', '10', '12', '14', '16'].map(function (n) { return <option key={n} value={n}>{n} characters</option>; })}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><PrimaryButton disabled={!s.can || saving} onClick={function () { save(s.reload); }}>{saving ? 'Saving…' : 'Save'}</PrimaryButton></div>
          </div>
        );
      }}
    </SetupScreen>
  );
}
