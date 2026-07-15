import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

// Task-centric My Tasks (Tasks spec §5; SPEC_tasks_roles_mrr_fees §5). One box per task TYPE the user holds
// work in (no empty boxes), Queued (assigned) then In Process (in_progress). A claim pool + a notifications
// area sit below. Health scores are deferred (#13); the summary tiles are deadline-derived. Returned-for-rework
// ("URGENT CORRECTIONS REQUIRED") is slice 8b — not built here.

var TYPE_LABEL = {
  record_search: 'Record Search', redaction: 'Redaction', legal_redaction: 'Legal Redaction',
  redaction_qa: 'Redaction Review', review_auto_redaction: 'Auto-Redaction Review',
  estimate: 'Estimate', fee_waiver: 'Fee Waiver', legal_review: 'Legal Review', routing_review: 'Routing Review'
};
// Order boxes appear in: front-line fulfillment first, then approvals/office work.
var TYPE_ORDER = ['record_search', 'redaction', 'legal_redaction', 'redaction_qa', 'review_auto_redaction',
  'estimate', 'fee_waiver', 'legal_review', 'routing_review'];

// The ONE place a task type becomes a screen; anything else falls back to the request (or a sensible home
// for request-independent work).
var TASK_SCREEN = {
  record_search: function (t) { return '/record-search/' + t.id; },
  estimate: function (t) { return '/estimate/' + t.id; },
  redaction: function (t) { return '/redaction/' + t.id; },
  legal_redaction: function (t) { return '/redaction/' + t.id; },
  redaction_qa: function (t) { return '/redaction/' + t.id; },
  review_auto_redaction: function () { return '/mass-redaction'; }
};
function screenFor(t) { var f = TASK_SCREEN[t.type]; return f ? f(t) : (t.request_id ? '/requests/' + t.request_id : '/mass-redaction'); }
function actionLabel(t) {
  return t.type === 'record_search' ? 'Search →' : t.type === 'redaction' || t.type === 'legal_redaction' ? 'Redact →'
    : t.type === 'estimate' ? 'Estimate →' : t.type === 'redaction_qa' || t.type === 'review_auto_redaction' ? 'Review →'
    : t.status === 'in_progress' ? 'Continue →' : 'Open →';
}

// Humanize a duration (ms) adaptively: 4h · 3d 2h · 5d · <1m. (Slice B: raw calendar elapsed.)
function humanDur(ms) {
  if (ms == null) return '';
  var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d >= 1) return d + 'd' + (h ? ' ' + h + 'h' : '');
  if (h >= 1) return h + 'h';
  if (m >= 1) return m + 'm';
  return '<1m';
}
var CLOCK_LABEL = { open: 'In queue', assigned: 'In queue', in_progress: 'In process', awaiting_review: 'In review', returned: 'Returned' };
// The live "how long in the current state" clock for a task row.
function clockLabel(t) {
  var tm = t.timing; if (!tm || !tm.currentStatus) return '';
  return (CLOCK_LABEL[tm.currentStatus] || tm.currentStatus) + ' ' + humanDur(tm.currentSinceMs);
}

// Budget status for a row (Slice C): over / due-soon / on-track vs the step's budget.
function budgetInfo(t) {
  var b = t.budget; if (!b) return null;
  if (b.state === 'over') return { text: humanDur(b.overMs) + ' over budget', color: '#C22B2B', weight: 700 };
  if (b.state === 'warn') return { text: humanDur(b.remainingMs) + ' left of ' + b.budgetDays + 'd', color: '#B45309', weight: 600 };
  return { text: humanDur(b.remainingMs) + ' left of ' + b.budgetDays + 'd', color: '#17803D', weight: 500 };
}

function dayDiff(d) { if (!d) return null; return (new Date(d) - new Date()) / (1000 * 60 * 60 * 24); }
function deadlineState(d) { var x = dayDiff(d); if (x === null) return null; if (x < 0) return 'over'; if (x <= 3) return 'soon'; return null; }
function deadlineLabel(d) {
  if (!d) return '—';
  var x = dayDiff(d);
  if (x < 0) { var n = Math.ceil(-x); return 'Overdue ' + n + 'd'; }
  if (x < 1) return 'Today';
  if (x <= 3) return 'in ' + Math.ceil(x) + ' days';
  return String(d).slice(0, 10);
}

var C = {
  card: { background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', boxShadow: '0 1px 2px rgba(16,26,42,.04),0 1px 3px rgba(16,26,42,.06)', overflow: 'hidden' },
  accent: '#1F4E79', accentSoft: '#EAF1F8', muted: '#66717F', faint: '#98A2B0',
  good: '#17803D', goodSoft: '#E8F4EC', warn: '#B45309', warnSoft: '#FBF1E1', crit: '#C22B2B', critSoft: '#FBEBEB'
};
function chip(text, kind) {
  var s = { q: { bg: '#FAFBFC', fg: C.muted, bd: '1px solid #E5E7EB' }, p: { bg: C.accentSoft, fg: '#1B4067' },
    crit: { bg: C.critSoft, fg: C.crit }, warn: { bg: C.warnSoft, fg: C.warn } }[kind] || { bg: '#F3F4F6', fg: C.muted };
  return <span style={{ fontSize: '11.5px', fontWeight: 600, padding: '2px 9px', borderRadius: '999px', background: s.bg, color: s.fg, border: s.bd || 'none', whiteSpace: 'nowrap' }}>{text}</span>;
}

export default function MyTasksPage() {
  var store = useAuthStore();
  var canApprove = store.hasAnyRole('SYSTEM_ADMIN', 'DIRECTOR') || store.hasAnyPerm('FINANCE');
  var [mine, setMine] = useState([]);
  var [pool, setPool] = useState([]);
  var [notes, setNotes] = useState([]);
  var [myObjs, setMyObjs] = useState([]);
  var [pendingObjs, setPendingObjs] = useState([]);
  var [loading, setLoading] = useState(true);
  var [busy, setBusy] = useState(null);
  var [msg, setMsg] = useState('');

  useEffect(function () { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      var m = await api.get('/tasks/mine'); setMine(m.data.tasks || []);
      var p = await api.get('/tasks/pool'); setPool(p.data.tasks || []);
      try { var n = await api.get('/notifications'); setNotes(n.data.notifications || []); } catch (e0) {}
      try { var mo = await api.get('/objections/mine'); setMyObjs(mo.data.objections || []); } catch (e1) {}
      if (canApprove) { try { var pa = await api.get('/objections/pending-approval'); setPendingObjs(pa.data.objections || []); } catch (e2) {} }
    } catch (e) { console.error(e); }
    setLoading(false);
  }
  async function claim(id) {
    setBusy(id); setMsg('');
    try { await api.post('/tasks/' + id + '/claim'); await load(); }
    catch (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Could not claim the task.'); await load(); }
    setBusy(null);
  }
  async function dismiss(id) { try { await api.post('/notifications/' + id + '/dismiss'); } catch (e) {} setNotes(function (l) { return l.filter(function (x) { return x.id !== id; }); }); }

  var assigned = mine.length;
  var overdue = mine.filter(function (t) { return deadlineState(t.deadline_date) === 'over'; }).length;
  var soon = mine.filter(function (t) { return deadlineState(t.deadline_date) === 'soon'; }).length;
  var returned = mine.filter(function (t) { return t.return_reason; }).length;
  var overBudget = mine.filter(function (t) { return t.budget && t.budget.state === 'over'; }).length;

  // group my tasks by type
  var byType = {};
  mine.forEach(function (t) { (byType[t.type] = byType[t.type] || []).push(t); });
  var boxTypes = TYPE_ORDER.filter(function (ty) { return byType[ty]; })
    .concat(Object.keys(byType).filter(function (ty) { return TYPE_ORDER.indexOf(ty) < 0; }));

  function taskRow(t) {
    // Returned-for-rework (R10, 8b): the most time-critical thing a person can hold — a deadline is running and
    // a release is blocked. Render it URGENT: red row, a banner, the reviewer's note, a red Fix action.
    if (t.return_reason) {
      return (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 16px', borderTop: '1px solid #F3F4F6', background: C.critSoft }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: C.crit, flexShrink: 0 }} />
          <div style={{ minWidth: '128px' }}>
            <div style={{ fontFamily: 'monospace', fontWeight: 700, color: C.accent, fontSize: '12.5px' }}>{t.request_number || '—'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px', fontSize: '11px', fontWeight: 800, letterSpacing: '.04em', color: C.crit }}>⚠ URGENT CORRECTIONS REQUIRED</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', color: '#1A2230' }}>{t.record_type_name || t.request_description || t.title || TYPE_LABEL[t.type] || t.type}</div>
            <div style={{ fontSize: '11.5px', color: C.crit, fontStyle: 'italic', marginTop: '2px' }}>{t.returned_by ? 'Returned by ' + t.returned_by + ' — ' : 'Returned — '}“{t.return_reason}”</div>
          </div>
          <div style={{ fontSize: '12.5px', textAlign: 'right', minWidth: '92px', color: deadlineState(t.deadline_date) === 'over' ? C.crit : C.muted, fontWeight: deadlineState(t.deadline_date) === 'over' ? 700 : 400 }}>{deadlineLabel(t.deadline_date)}</div>
          <Link to={screenFor(t)} style={{ fontSize: '12.5px', fontWeight: 700, color: 'white', background: C.crit, borderRadius: '7px', padding: '5px 13px', textDecoration: 'none', whiteSpace: 'nowrap' }}>Fix →</Link>
        </div>
      );
    }
    var ds = deadlineState(t.deadline_date);
    var dot = t.status === 'in_progress' ? C.accent : C.faint;
    return (
      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '9px 16px', borderTop: '1px solid #F3F4F6' }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <div style={{ minWidth: '128px' }}>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, color: C.accent, fontSize: '12.5px' }}>{t.request_number || '—'}</div>
          <div style={{ fontSize: '11.5px', color: C.muted, marginTop: '1px' }}>{t.requestor_name || (t.request_id ? '' : 'no request')}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', color: '#1A2230', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.record_type_name || t.request_description || t.title || TYPE_LABEL[t.type] || t.type}</div>
          <div style={{ fontSize: '11.5px', color: C.muted }}>{clockLabel(t)}{(function () { var bi = budgetInfo(t); return bi ? <span> · <span style={{ color: bi.color, fontWeight: bi.weight }}>{bi.text}</span></span> : null; })()}{t.team_name ? ' · ' + t.team_name : ''}</div>
        </div>
        <div style={{ fontSize: '12.5px', textAlign: 'right', minWidth: '92px', color: ds === 'over' ? C.crit : ds === 'soon' ? C.warn : C.muted, fontWeight: ds ? 700 : 400 }}>{deadlineLabel(t.deadline_date)}</div>
        <Link to={screenFor(t)} style={{ fontSize: '12.5px', fontWeight: 600, color: C.accent, background: C.accentSoft, border: '1px solid #E5E7EB', borderRadius: '7px', padding: '5px 11px', textDecoration: 'none', whiteSpace: 'nowrap' }}>{actionLabel(t)}</Link>
      </div>
    );
  }

  function box(ty) {
    var tasks = byType[ty];
    // Returned tasks are 'assigned' (flag, not status), so they live in Queued — sort them to the very top.
    // Queued = not-yet-started work: 'assigned' plus 'returned' (a correction is queued work), returned first.
    var queued = tasks.filter(function (t) { return t.status === 'assigned' || t.status === 'returned'; })
      .sort(function (a, b) { return (b.return_reason ? 1 : 0) - (a.return_reason ? 1 : 0); });
    var inProc = tasks.filter(function (t) { return t.status === 'in_progress'; });
    // Submitted & handed off to a reviewer — passive, no action; their processing clock has stopped.
    var inReview = tasks.filter(function (t) { return t.status === 'awaiting_review'; });
    var rtn = tasks.filter(function (t) { return t.return_reason; }).length;
    var od = tasks.filter(function (t) { return deadlineState(t.deadline_date) === 'over'; }).length;
    var sn = tasks.filter(function (t) { return deadlineState(t.deadline_date) === 'soon'; }).length;
    return (
      <section key={ty} style={C.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '13px 16px', borderBottom: '1px solid #E5E7EB' }}>
          <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: C.accentSoft, color: C.accent, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '13px', flexShrink: 0 }}>{(TYPE_LABEL[ty] || ty).slice(0, 1)}</div>
          <span style={{ fontSize: '14.5px', fontWeight: 700 }}>{TYPE_LABEL[ty] || ty}</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: C.accent, background: C.accentSoft, borderRadius: '999px', padding: '1px 9px' }}>{tasks.length}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {rtn ? chip(rtn + ' returned', 'crit') : null}
            {queued.length ? chip(queued.length + ' queued', 'q') : null}
            {inProc.length ? chip(inProc.length + ' in process', 'p') : null}
            {inReview.length ? chip(inReview.length + ' in review', 'q') : null}
            {od ? chip(od + ' overdue', 'crit') : null}
            {!od && sn ? chip(sn + ' due soon', 'warn') : null}
          </div>
        </div>
        {queued.length ? <div style={{ padding: '5px 0' }}><div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: C.faint, padding: '6px 16px 2px' }}>Queued</div>{queued.map(taskRow)}</div> : null}
        {inProc.length ? <div style={{ padding: '5px 0', borderTop: queued.length ? '1px solid #E5E7EB' : 'none' }}><div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: C.faint, padding: '6px 16px 2px' }}>In Process</div>{inProc.map(taskRow)}</div> : null}
        {inReview.length ? <div style={{ padding: '5px 0', borderTop: (queued.length || inProc.length) ? '1px solid #E5E7EB' : 'none' }}>
          <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: C.faint, padding: '6px 16px 2px' }}>Submitted · in review</div>
          {inReview.map(function (t) {
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '9px 16px', borderTop: '1px solid #F3F4F6', opacity: 0.72 }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: C.faint, flexShrink: 0 }} />
                <div style={{ minWidth: '128px' }}>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, color: C.accent, fontSize: '12.5px' }}>{t.request_number || '—'}</div>
                  <div style={{ fontSize: '11.5px', color: C.muted, marginTop: '1px' }}>{t.requestor_name || ''}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: '#1A2230' }}>{t.record_type_name || t.request_description || t.title || TYPE_LABEL[t.type] || t.type}</div>
                  <div style={{ fontSize: '11.5px', color: C.faint }}>With the reviewer — no action needed</div>
                </div>
                <span style={{ fontSize: '12px', color: C.muted, fontWeight: 600 }}>{humanDur((t.timing && t.timing.inReviewMs) || (t.timing && t.timing.currentSinceMs)) || 'In review'}</span>
              </div>
            );
          })}
        </div> : null}
      </section>
    );
  }

  function sectionHead(text) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: '9px', margin: '4px 2px -4px' }}><span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>{text}</span><span style={{ flex: 1, height: '1px', background: '#E5E7EB' }} /></div>;
  }

  var stat = function (k, v, kind) {
    var col = kind === 'crit' ? C.crit : kind === 'warn' ? C.warn : kind === 'accent' ? C.accent : '#1A2230';
    var rail = kind === 'crit' ? C.crit : kind === 'warn' ? C.warn : kind === 'accent' ? C.accent : C.good;
    return (
      <div style={Object.assign({}, C.card, { padding: '13px 15px', position: 'relative' })}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', background: rail }} />
        <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted }}>{k}</div>
        <div style={{ fontSize: '26px', fontWeight: 800, marginTop: '3px', lineHeight: 1, color: col, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: '1080px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, letterSpacing: '-.01em' }}>My Tasks</h1>
        <p style={{ color: C.muted, fontSize: '13.5px', margin: '3px 0 0' }}>
          Work assigned to you, grouped by type{returned ? ' · ' : ''}{returned ? <span style={{ color: C.crit, fontWeight: 600 }}>{returned} needs corrections</span> : null}{overdue ? ' · ' : ''}{overdue ? <span style={{ color: C.crit, fontWeight: 600 }}>{overdue} overdue</span> : null}{soon ? ' · ' + soon + ' due within 3 days' : ''}.
        </p>
      </div>

      {msg ? <div style={{ fontSize: '13px', color: '#9B1C1C', background: '#FDE8E8', border: '1px solid #FBD5D5', borderRadius: '8px', padding: '9px 12px' }}>{msg}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + (3 + (returned ? 1 : 0) + (overBudget ? 1 : 0)) + ',1fr)', gap: '12px' }}>
        {stat('Assigned to you', assigned, 'accent')}
        {returned ? stat('Needs corrections', returned, 'crit') : null}
        {overBudget ? stat('Over budget', overBudget, 'crit') : null}
        {stat('Overdue', overdue, overdue ? 'crit' : 'ok')}
        {stat('Due ≤ 3 days', soon, soon ? 'warn' : 'ok')}
      </div>

      {loading ? <div style={Object.assign({}, C.card, { padding: '48px', textAlign: 'center', color: C.faint })}>Loading…</div> : null}

      {/* Fee objections — real work items that aren't tasks; kept as their own boxes. */}
      {myObjs.length ? (
        <section style={Object.assign({}, C.card, { border: '1px solid #FDE68A' })}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#92400E', padding: '13px 16px', borderBottom: '1px solid #F3F4F6' }}>Fee estimate objections <span style={{ color: '#B45309' }}>({myObjs.length})</span></div>
          {myObjs.map(function (o) { return (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', borderTop: '1px solid #F3F4F6' }}>
              <div style={{ fontSize: '13px', color: '#374151' }}><strong>{o.reason}</strong> <span style={{ color: C.faint }}>· {o.requestNumber || o.requestId} · {o.status === 'tentative' ? 'pending approval' : 'open'}</span></div>
              <Link to={'/requests/' + o.requestId} style={{ fontSize: '12.5px', color: C.accent, textDecoration: 'none', fontWeight: 700 }}>Open → Fees</Link>
            </div>
          ); })}
        </section>
      ) : null}
      {canApprove && pendingObjs.length ? (
        <section style={Object.assign({}, C.card, { border: '1px solid #FCA5A5' })}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#9B1C1C', padding: '13px 16px', borderBottom: '1px solid #F3F4F6' }}>Fee resolutions awaiting your approval <span>({pendingObjs.length})</span></div>
          {pendingObjs.map(function (o) { return (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', borderTop: '1px solid #F3F4F6' }}>
              <div style={{ fontSize: '13px', color: '#374151' }}>{o.resolutionType} of <strong>${(Number(o.resolutionAmount) || 0).toFixed(2)}</strong> <span style={{ color: C.faint }}>· {o.requestNumber || o.requestId} · proposed by {o.assigneeName}</span></div>
              <Link to={'/requests/' + o.requestId} style={{ fontSize: '12.5px', color: C.accent, textDecoration: 'none', fontWeight: 700 }}>Review → Fees</Link>
            </div>
          ); })}
        </section>
      ) : null}

      {!loading && boxTypes.length ? sectionHead('Your work') : null}
      {boxTypes.map(box)}

      {!loading && !boxTypes.length && !myObjs.length ? (
        <div style={Object.assign({}, C.card, { padding: '56px', textAlign: 'center' })}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>✅</div>
          <div style={{ fontSize: '17px', fontWeight: 600, color: '#4B5563' }}>No tasks assigned to you</div>
          <div style={{ fontSize: '13px', color: C.faint, marginTop: '6px' }}>Claim work from the pool below, or it will be routed to you.</div>
        </div>
      ) : null}

      {/* Claim pool */}
      {pool.length ? (
        <>
          {sectionHead("Claim pool · work you're eligible for")}
          <section style={C.card}>
            {pool.map(function (t, i) {
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 16px', borderTop: i ? '1px solid #F3F4F6' : 'none' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: C.good, flexShrink: 0 }} />
                  <div style={{ minWidth: '128px' }}>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '12.5px' }}>{t.request_number || '—'}</div>
                    <div style={{ fontSize: '11.5px', color: C.muted, marginTop: '1px' }}>{t.requestor_name || ''}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px' }}>{TYPE_LABEL[t.type] || t.type}{t.record_type_name ? ' · ' + t.record_type_name : (t.request_description ? ' · ' + t.request_description : '')}</div>
                    <div style={{ fontSize: '11.5px', color: C.faint }}>Unclaimed{t.team_name ? ' · ' + t.team_name : ' · team-agnostic'}</div>
                  </div>
                  <div style={{ fontSize: '12.5px', textAlign: 'right', minWidth: '92px', color: deadlineState(t.deadline_date) === 'over' ? C.crit : deadlineState(t.deadline_date) === 'soon' ? C.warn : C.muted }}>{deadlineLabel(t.deadline_date)}</div>
                  <button onClick={function () { claim(t.id); }} disabled={busy === t.id} style={{ fontSize: '12.5px', fontWeight: 600, color: C.good, background: C.goodSoft, border: 'none', borderRadius: '7px', padding: '6px 13px', cursor: 'pointer', opacity: busy === t.id ? 0.6 : 1 }}>{busy === t.id ? 'Claiming…' : 'Claim'}</button>
                </div>
              );
            })}
          </section>
        </>
      ) : null}

      {/* Notifications area (same data as the header bell) */}
      {notes.length ? (
        <>
          {sectionHead('Notifications')}
          <section style={C.card}>
            {notes.map(function (n, i) {
              return (
                <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '11px', padding: '11px 16px', borderTop: i ? '1px solid #F3F4F6' : 'none', opacity: n.read_at ? 0.72 : 1 }}>
                  <span style={{ marginTop: '5px', width: '7px', height: '7px', borderRadius: '50%', background: n.read_at ? 'transparent' : C.accent, border: n.read_at ? '1px solid #D3DAE4' : 'none', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{n.link ? <Link to={n.link} style={{ color: '#1A2230', textDecoration: 'none' }}>{n.title}</Link> : n.title}</div>
                    {n.body ? <div style={{ fontSize: '12px', color: C.muted, marginTop: '1px' }}>{n.body}</div> : null}
                    <div style={{ fontSize: '11px', color: C.faint, marginTop: '2px' }}>{(n.created_at || '').replace('T', ' ').slice(0, 16)}</div>
                  </div>
                  <span onClick={function () { dismiss(n.id); }} title="Dismiss" style={{ color: C.faint, cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 3px' }}>×</span>
                </div>
              );
            })}
          </section>
        </>
      ) : null}

      {!loading && boxTypes.length ? (
        <p style={{ fontSize: '11.5px', color: C.faint, textAlign: 'center', margin: '2px 0 8px' }}>
          A box appears only when you hold a task of that type — no empty boxes.
        </p>
      ) : null}
    </div>
  );
}
