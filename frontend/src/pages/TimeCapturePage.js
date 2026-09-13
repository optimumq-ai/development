import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import SetupScreen, { hint, Msg, PrimaryButton, Choice } from '../components/setup/SetupScreen';

// TASK PROCESSING TIME CAPTURE — the hub's `time_tracking` row (C11, Kevin 2026-08-30: the v1 Configuration
// page's Time Tracking tab becomes this dedicated screen under System Features and Options). Per task
// screen: whether staff see the timer and confirm their time when they finish. Time is always measured
// quietly in the background; these settings only govern what staff see. Data: GET/PUT /api/config/time-capture.

export default function TimeCapturePage() {
  var [cfg, setCfg] = useState(null);
  var [uis, setUis] = useState([]);
  var [saving, setSaving] = useState(false);
  var [msg, setMsg] = useState(null);
  useEffect(function () {
    api.get('/config/time-capture').then(function (r) { setCfg((r.data && r.data.config) || {}); setUis((r.data && r.data.uis) || []); })
      .catch(function () { setCfg({}); setMsg({ ok: false, text: 'The current settings could not be read.' }); });
  }, []);
  function setMode(key, mode) { setCfg(function (c) { var n = Object.assign({}, c || {}); n[key] = mode; return n; }); }
  async function save(reload) {
    setSaving(true); setMsg(null);
    try { var r = await api.put('/config/time-capture', { config: cfg }); setCfg(r.data.config); setMsg({ ok: true, text: 'Time capture settings saved.' }); await reload(); }
    catch (e) { setMsg({ ok: false, text: (e.response && e.response.data && e.response.data.error) || 'Could not save.' }); }
    setSaving(false);
  }
  var MODES = [['off', 'Off'], ['discretion', 'User discretion'], ['always', 'Always']];
  return (
    <SetupScreen hubKey="time_tracking" laneLabel="System Features and Options" title="Task Processing Time Capture"
      intro="Whether staff record the actual time they spend on each kind of task — the measured hours that can feed fee reconciliation. States differ on which labor is chargeable to a requestor, so this is the city's call, screen by screen. Time is always measured quietly in the background; these settings only control whether staff see the timer and are asked to confirm their time when they finish.">
      {function (s) {
        if (!cfg) return <div style={{ color: 'var(--oq-fg-9ca3af)' }}>Loading…</div>;
        return (
          <div>
            {msg ? <Msg text={msg.text} ok={msg.ok} /> : null}
            {uis.map(function (u) {
              var cur = cfg[u.key] || 'off';
              return (
                <div key={u.key} style={{ opacity: u.available ? 1 : 0.55, borderBottom: '1px solid var(--oq-ln-eef2f5)', padding: '12px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--oq-fg-374151)' }}>{u.label}</span>
                    {!u.available ? <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--oq-fg-9ca3af)', background: 'var(--oq-bg-f3f4f6)', borderRadius: '20px', padding: '2px 8px' }}>Not yet available</span> : null}
                  </div>
                  <Choice value={cur} disabled={!s.can || !u.available} onChange={function (m) { setMode(u.key, m); }} options={MODES} />
                </div>
              );
            })}
            <div style={Object.assign({}, hint, { margin: '14px 0 18px' })}>
              <strong>Off</strong> — no timer is shown; finishing a task moves straight on. &nbsp;
              <strong>User discretion</strong> — the timer shows and, on finish, staff confirm their time or skip it. &nbsp;
              <strong>Always</strong> — the timer shows and staff always confirm their time on finish.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><PrimaryButton disabled={!s.can || saving} onClick={function () { save(s.reload); }}>{saving ? 'Saving…' : 'Save'}</PrimaryButton></div>
          </div>
        );
      }}
    </SetupScreen>
  );
}
