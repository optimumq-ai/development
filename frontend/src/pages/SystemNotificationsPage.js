import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import SetupScreen, { lbl, inp, hint, field, Msg, PrimaryButton, Choice } from '../components/setup/SetupScreen';

// SYSTEM NOTIFICATIONS — the hub's `notifications` row (C11, Kevin 2026-08-30: the v1 Configuration page's
// Notifications tab becomes this dedicated screen under System Features and Options). When staff are warned
// about a deadline, when an overdue request escalates to a supervisor, and whether requestors get an
// acknowledgement email. Data: GET/POST /api/config (operations_config or system).

var KEYS = ['overdue_alert_days', 'escalation_days', 'ack_email'];

export default function SystemNotificationsPage() {
  var [form, setForm] = useState(null);
  var [saving, setSaving] = useState(false);
  var [msg, setMsg] = useState(null);
  useEffect(function () {
    api.get('/config').then(function (r) {
      var c = r.data || {};
      setForm({ overdue_alert_days: c.overdue_alert_days || '1', escalation_days: c.escalation_days || '3', ack_email: c.ack_email || 'on' });
    }).catch(function () { setForm({}); setMsg({ ok: false, text: 'The current settings could not be read.' }); });
  }, []);
  function set(k, v) { setForm(function (f) { var n = Object.assign({}, f); n[k] = v; return n; }); }
  async function save(reload) {
    setSaving(true); setMsg(null);
    try { var body = {}; KEYS.forEach(function (k) { body[k] = form[k]; }); await api.post('/config', body); setMsg({ ok: true, text: 'Notification settings saved.' }); await reload(); }
    catch (e) { setMsg({ ok: false, text: (e.response && e.response.data && e.response.data.error) || 'Could not save.' }); }
    setSaving(false);
  }
  return (
    <SetupScreen hubKey="notifications" laneLabel="System Features and Options" title="System Notifications"
      intro="When the system warns people. Staff are told before a deadline arrives; a request that stays overdue is flagged for a supervisor; and requestors can be sent an automatic acknowledgement when their request is received. Notices go out through the Email configuration.">
      {function (s) {
        if (!form) return <div style={{ color: '#9CA3AF' }}>Loading…</div>;
        return (
          <div>
            {msg ? <Msg text={msg.text} ok={msg.ok} /> : null}
            <div style={field}>
              <label style={lbl}>Overdue alert — warn staff</label>
              <select value={form.overdue_alert_days} disabled={!s.can} onChange={function (e) { set('overdue_alert_days', e.target.value); }} style={inp}>
                <option value="0">On the deadline day</option>
                <option value="1">1 day before the deadline</option>
                <option value="2">2 days before the deadline</option>
                <option value="3">3 days before the deadline</option>
                <option value="5">5 days before the deadline</option>
              </select>
            </div>
            <div style={field}>
              <label style={lbl}>Supervisor escalation — escalate automatically after</label>
              <select value={form.escalation_days} disabled={!s.can} onChange={function (e) { set('escalation_days', e.target.value); }} style={inp}>
                <option value="1">1 day overdue</option>
                <option value="2">2 days overdue</option>
                <option value="3">3 days overdue</option>
                <option value="5">5 days overdue</option>
                <option value="0">Never — a person escalates by hand</option>
              </select>
              <div style={hint}>An overdue request is flagged for supervisor review after this long.</div>
            </div>
            <div style={field}>
              <label style={lbl}>Requestor acknowledgement email</label>
              <Choice value={form.ack_email} disabled={!s.can} onChange={function (v) { set('ack_email', v); }} options={[['on', 'Enabled'], ['off', 'Disabled']]} />
              <div style={hint}>Send an automatic acknowledgement to the requestor when their request is received.</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><PrimaryButton disabled={!s.can || saving} onClick={function () { save(s.reload); }}>{saving ? 'Saving…' : 'Save'}</PrimaryButton></div>
          </div>
        );
      }}
    </SetupScreen>
  );
}
