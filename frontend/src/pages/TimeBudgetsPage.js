import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import SetupScreen, { hint, Msg, PrimaryButton } from '../components/setup/SetupScreen';

// TASK TIME BUDGETS — the hub's `time_budgets` row "How many days a task should take" (C11, Kevin 2026-08-30:
// the v1 Configuration page's Task Time Budgets tab becomes this dedicated screen under System Features and
// Options). One working target per task type; the statutory clock is tracked separately and never moves.
// Data: GET/PUT /api/config/time-budgets (the editor changes values; the task catalog owns the rows).

var LABELS = { estimate: 'Estimate', record_search: 'Record Search', redaction: 'Redaction', legal_redaction: 'Legal Redaction', legal_review: 'Legal Review', redaction_qa: 'Redaction QA', fee_waiver: 'Fee Waiver Review', routing_review: 'Routing Review' };
function label(t) { return LABELS[t] || t.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

export default function TimeBudgetsPage() {
  var [budgets, setBudgets] = useState(null);
  var [edits, setEdits] = useState({});
  var [busy, setBusy] = useState('');
  var [msg, setMsg] = useState(null);
  useEffect(function () {
    api.get('/config/time-budgets').then(function (r) { setBudgets((r.data && r.data.budgets) || []); })
      .catch(function () { setBudgets([]); setMsg({ ok: false, text: 'The current budgets could not be read.' }); });
  }, []);
  async function save(taskType, reload) {
    setBusy(taskType); setMsg(null);
    try {
      var r = await api.put('/config/time-budgets', { taskType: taskType, budgetDays: Number(edits[taskType]) });
      setBudgets(function (list) { return list.map(function (b) { return b.task_type === taskType ? r.data.budget : b; }); });
      setEdits(function (e) { var n = Object.assign({}, e); delete n[taskType]; return n; });
      setMsg({ ok: true, text: 'Budget for ' + label(taskType) + ' saved.' }); await reload();
    } catch (e) { setMsg({ ok: false, text: (e.response && e.response.data && e.response.data.error) || 'Could not save.' }); }
    setBusy('');
  }
  return (
    <SetupScreen hubKey="time_budgets" laneLabel="System Features and Options" title="How many days a task should take"
      intro="A working target for each kind of task. When a task runs past its budget it shows as late on the dashboard — an early warning that a slow early step is eating into the legal deadline. These are targets your office sets, not legal deadlines; the statutory clock is tracked separately and is never affected by these numbers.">
      {function (s) {
        if (!budgets) return <div style={{ color: 'var(--oq-fg-9ca3af)' }}>Loading…</div>;
        return (
          <div>
            {msg ? <Msg text={msg.text} ok={msg.ok} /> : null}
            {budgets.map(function (b) {
              var edited = edits[b.task_type] !== undefined;
              var val = edited ? edits[b.task_type] : String(b.budget_days);
              return (
                <div key={b.task_type} style={{ display: 'flex', alignItems: 'center', gap: '14px', borderBottom: '1px solid var(--oq-ln-eef2f5)', padding: '10px 0' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--oq-fg-374151)' }}>{label(b.task_type)}</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-8296a4)' }}>{b.source === 'supervisor' && b.updated_by ? 'Set by ' + b.updated_by : 'Provisional default — not yet reviewed by your office'}</div>
                  </div>
                  <input type="number" min="0.5" max="365" step="0.5" value={val} disabled={!s.can}
                    onChange={function (e) { var v = e.target.value; setEdits(function (ed) { var n = Object.assign({}, ed); n[b.task_type] = v; return n; }); }}
                    style={{ width: '90px', padding: '8px 10px', border: '1px solid var(--oq-ln-d1d5db)', borderRadius: '8px', fontSize: '13px', textAlign: 'right', fontFamily: 'inherit' }} />
                  <span style={{ fontSize: '12px', color: 'var(--oq-fg-5c6f7c)', width: '34px' }}>days</span>
                  <PrimaryButton disabled={!s.can || !edited || busy === b.task_type} onClick={function () { save(b.task_type, s.reload); }}>{busy === b.task_type ? 'Saving…' : 'Save'}</PrimaryButton>
                </div>
              );
            })}
            <div style={Object.assign({}, hint, { marginTop: '14px' })}>Example: with a 3-day budget on Record Search, a search still unfinished on day 4 shows as 1 day late on the dashboard — even if the request's legal deadline is still comfortably away.</div>
          </div>
        );
      }}
    </SetupScreen>
  );
}
