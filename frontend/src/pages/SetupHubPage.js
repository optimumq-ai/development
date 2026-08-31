import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

// SETTINGS AND CONFIGURATION — navigation only (Kevin 2026-08-31). Initial setup and its approvals happen on the
// Set Up Guide (the gantt: every item's own screen reports red / yellow / green, approval is the lane owner's
// act on that screen); this page is the way back to any screen afterwards, grouped by what it is about — no
// status, no marks, no dependencies. Same GET /api/setup-hub catalog; only the doors are used here.

var GROUPS = [
  { title: 'The city and its people', keys: ['agency', 'departments', 'teams', 'staff', 'record_owners'] },
  { title: 'The rules the law set', keys: ['fee_law', 'clarification', 'exemptions', 'eligibility', 'intake', 'deadlines', 'redaction_rules', 'city_choices', 'law_updates'] },
  { title: 'How a request is worked', keys: ['taxonomy', 'calibration', 'routing_rules', 'time_budgets', 'time_tracking', 'notifications', 'agent_rules', 'av_redaction', 'redaction_auto', 'release_review', 'layout_templates', 'decision_reasons', 'mass_schedule'] },
  { title: 'Technical', keys: ['sources', 'ai_config', 'email', 'auth_policy', 'settlement'] },
];
var EXTRA = [{ title: 'The city and its people', name: 'User types', door: '/setup/user-types', hint: 'the catalog of what each type may do' }];

export default function SetupHubPage() {
  var nav = useNavigate();
  var [data, setData] = useState(null);
  var [err, setErr] = useState('');
  useEffect(function () {
    api.get('/setup-hub').then(function (r) { setData(r.data); }).catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'The settings list could not load.'); });
  }, []);
  if (err) return <div style={{ color: '#B91C1C', padding: '24px' }}>{err}</div>;
  if (!data) return <div style={{ color: '#9CA3AF', padding: '24px' }}>Loading…</div>;
  var byKey = {};
  (data.top || []).forEach(function (it) { byKey[it.key] = it; });
  (data.lanes || []).forEach(function (l) { (l.items || []).forEach(function (it) { byKey[it.key] = it; }); });
  var placed = {};
  var groups = GROUPS.map(function (gr) {
    var rows = gr.keys.map(function (k) { placed[k] = true; return byKey[k]; }).filter(Boolean).map(function (it) { return { name: it.name, door: it.door, hint: it.noScreen ? 'no screen yet' : '' }; });
    EXTRA.filter(function (x) { return x.title === gr.title; }).forEach(function (x) { rows.push({ name: x.name, door: x.door, hint: x.hint }); });
    return { title: gr.title, rows: rows };
  });
  var leftovers = Object.keys(byKey).filter(function (k) { return !placed[k] && !byKey[k].goLive; }).map(function (k) { return { name: byKey[k].name, door: byKey[k].door, hint: byKey[k].noScreen ? 'no screen yet' : '' }; });
  if (leftovers.length) groups.push({ title: 'Other', rows: leftovers });

  return (
    <div style={{ color: '#12232E' }}>
      <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Settings and Configuration</div>
      <div style={{ fontSize: '13px', color: '#5C6F7C', marginBottom: '18px', lineHeight: 1.5 }}>Every screen that shapes how the system runs, grouped by what it is about. Initial setup and its approvals happen on the Set Up Guide; this page is the way back to any screen afterwards.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
        {groups.map(function (gr) {
          return (
            <div key={gr.title} style={{ background: 'white', border: '1px solid #D2DCE3', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', fontSize: '13px', fontWeight: 700, color: '#1E6091', background: '#F2F6F9' }}>{gr.title}</div>
              {gr.rows.map(function (row, i) {
                var open = row.door ? function () { nav(row.door); } : null;
                return (
                  <div key={row.name + i} onClick={open} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderTop: '1px solid #EEF2F5', fontSize: '13px', cursor: open ? 'pointer' : 'default', color: open ? '#12232E' : '#8296A4' }}
                    onMouseEnter={function (e) { if (open) e.currentTarget.style.background = '#F8FAFC'; }} onMouseLeave={function (e) { e.currentTarget.style.background = 'white'; }}>
                    <span style={{ flexGrow: 1 }}>{row.name}</span>
                    {row.hint ? <span style={{ fontSize: '12px', color: '#8296A4' }}>{row.hint}</span> : null}
                    {open ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8296A4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
