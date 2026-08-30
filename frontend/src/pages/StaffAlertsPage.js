import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import SetupScreen, { lbl, inp, hint, field, Msg, PrimaryButton, BLUE } from '../components/setup/SetupScreen';

// STAFF ALERTS — the hub's `notifications` row (Kevin 2026-08-30, SPEC_setup_hub §3i; formerly "System
// Notifications", C11). Two tabs. ALERTS: the catalogue of everything the bell at the top of the screen can say —
// rendered from GET /setup-hub/alerts (services/alertCatalog.js), read-only, no per-alert on/off. DEADLINE
// ALERTS: when overdue work is flagged and when it escalates to a supervisor — both must be SAVED; the screen's
// colour comes from this tab alone. The requestor acknowledgement switch moved to Request rules → Request Intake.

var TABS = [['alerts', 'Alerts'], ['deadlines', 'Deadline alerts']];
var TABCOL = { red: '#DC2626', yellow: '#D97706', green: '#16A34A' };
var KEYS = ['overdue_alert_days', 'escalation_days'];

export default function StaffAlertsPage() {
  var [params, setParams] = useSearchParams();
  var tab = TABS.some(function (t) { return t[0] === params.get('tab'); }) ? params.get('tab') : 'alerts';
  var [form, setForm] = useState(null);
  var [alerts, setAlerts] = useState(null);
  var [saving, setSaving] = useState(false);
  var [msg, setMsg] = useState(null);
  useEffect(function () {
    api.get('/config').then(function (r) {
      var c = r.data || {};
      setForm({ overdue_alert_days: c.overdue_alert_days || '', escalation_days: c.escalation_days || '' });
    }).catch(function () { setForm({}); setMsg({ ok: false, text: 'The current settings could not be read.' }); });
    api.get('/setup-hub/alerts').then(function (r) { setAlerts(r.data.alerts || []); }).catch(function () { setAlerts([]); });
  }, []);
  function goTab(t) { setParams({ tab: t }); }
  function set(k, v) { setForm(function (f) { var n = Object.assign({}, f); n[k] = v; return n; }); }
  async function save(reload) {
    setSaving(true); setMsg(null);
    try { var body = {}; KEYS.forEach(function (k) { body[k] = form[k]; }); await api.post('/config', body); setMsg({ ok: true, text: 'Deadline alert settings saved.' }); await reload(); }
    catch (e) { setMsg({ ok: false, text: (e.response && e.response.data && e.response.data.error) || 'Could not save.' }); }
    setSaving(false);
  }
  function tabBar(row) {
    var marks = (row && row.tabs) || {};
    return (
      <div style={{ display: 'flex', gap: '2px', borderBottom: '1px solid #D2DCE3', marginBottom: '18px' }}>
        {TABS.map(function (t) {
          var on = tab === t[0]; var mk = t[0] === 'deadlines' ? marks[t[0]] : null;
          return <button key={t[0]} type="button" onClick={function () { goTab(t[0]); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '9px 16px', background: 'none', border: 'none', borderBottom: '2px solid ' + (on ? BLUE : 'transparent'), marginBottom: '-1px', fontSize: '13px', fontWeight: 600, color: on ? BLUE : '#5C6F7C', cursor: 'pointer', fontFamily: 'inherit' }}>
            {t[1]}{mk && TABCOL[mk] ? <span title={mk === 'red' ? 'Required settings missing' : (mk === 'green' ? 'Approved' : 'Awaiting approval')} style={{ width: '8px', height: '8px', borderRadius: '50%', background: TABCOL[mk], display: 'inline-block' }} /> : null}
          </button>;
        })}
      </div>
    );
  }
  var th = { fontSize: '11px', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#8296A4', textAlign: 'left', padding: '0 10px 8px', borderBottom: '1px solid #D2DCE3' };
  var td = { padding: '11px 10px', borderBottom: '1px solid #EEF2F5', verticalAlign: 'top', fontSize: '13px', lineHeight: '1.45' };
  function alertsBody() {
    if (!alerts) return <div style={{ color: '#9CA3AF' }}>Loading…</div>;
    return (
      <div>
        <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#5C6F7C', maxWidth: '66ch', lineHeight: '1.5' }}>These are the alerts that light up the bell at the top of the screen. Each one goes to the people it names — nobody has to subscribe, and nothing here can be switched off.</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Alert</th><th style={th}>When it is sent</th><th style={th}>Who receives it</th></tr></thead>
            <tbody>{alerts.map(function (a) {
              return <tr key={a.kind}><td style={Object.assign({}, td, { fontWeight: 600, whiteSpace: 'nowrap' })}>{a.title}</td><td style={Object.assign({}, td, { color: '#5C6F7C' })}>{a.when}</td><td style={Object.assign({}, td, { whiteSpace: 'nowrap' })}>{a.who}</td></tr>;
            })}</tbody>
          </table>
        </div>
        <p style={{ margin: '14px 0 0', fontSize: '12px', color: '#8296A4', maxWidth: '66ch', lineHeight: '1.5' }}>Alerts stay on the bell and on My Tasks until dismissed. An identical alert is not stacked while the first is still waiting to be read — it is refreshed instead. Sending an alert by email as well is a future option, per alert.</p>
      </div>
    );
  }
  function deadlinesBody(s) {
    if (!form) return <div style={{ color: '#9CA3AF' }}>Loading…</div>;
    var red = s.row && s.row.tabs && s.row.tabs.deadlines === 'red';
    return (
      <div>
        {msg ? <Msg text={msg.text} ok={msg.ok} /> : null}
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#5C6F7C', maxWidth: '66ch', lineHeight: '1.5' }}>When overdue work is flagged to staff, and when it is raised to a supervisor. Both must be saved — a shipped default is not a decision.</p>
        <div style={field}>
          <label style={lbl}>Overdue alert — warn staff{red && !form.overdue_alert_days ? <span style={{ color: '#DC2626', fontWeight: 500 }}> · required, not saved</span> : null}</label>
          <select value={form.overdue_alert_days} disabled={!s.can} onChange={function (e) { set('overdue_alert_days', e.target.value); }} style={Object.assign({}, inp, red && !form.overdue_alert_days ? { border: '1px solid #DC2626' } : {})}>
            <option value="">Choose…</option>
            <option value="0">On the deadline day</option>
            <option value="1">1 day before the deadline</option>
            <option value="2">2 days before the deadline</option>
            <option value="3">3 days before the deadline</option>
            <option value="5">5 days before the deadline</option>
          </select>
          <div style={hint}>The assigned person sees the request flagged in their worklist this far ahead of the deadline.</div>
        </div>
        <div style={field}>
          <label style={lbl}>Supervisor escalation — escalate automatically after{red && !form.escalation_days ? <span style={{ color: '#DC2626', fontWeight: 500 }}> · required, not saved</span> : null}</label>
          <select value={form.escalation_days} disabled={!s.can} onChange={function (e) { set('escalation_days', e.target.value); }} style={Object.assign({}, inp, red && !form.escalation_days ? { border: '1px solid #DC2626' } : {})}>
            <option value="">Choose…</option>
            <option value="1">1 day overdue</option>
            <option value="2">2 days overdue</option>
            <option value="3">3 days overdue</option>
            <option value="5">5 days overdue</option>
            <option value="0">Never — a person escalates by hand</option>
          </select>
          <div style={hint}>An overdue request is flagged for supervisor review after this long.</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><PrimaryButton disabled={!s.can || saving} onClick={function () { save(s.reload); }}>{saving ? 'Saving…' : 'Save'}</PrimaryButton></div>
      </div>
    );
  }
  return (
    <SetupScreen hubKey="notifications" laneLabel="System Features and Options" title="Staff Alerts"
      intro="What the bell at the top of the screen tells your people, and the deadline settings that produce those alerts. Requestor correspondence — the acknowledgement, clarification and estimate letters — is configured under Request rules, not here.">
      {function (s) {
        return <div>{tabBar(s.row)}{tab === 'alerts' ? alertsBody() : deadlinesBody(s)}</div>;
      }}
    </SetupScreen>
  );
}
