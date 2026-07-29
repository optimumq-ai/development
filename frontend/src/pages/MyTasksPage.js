import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
// ⚠ The primitives are imported as COMPONENTS only. This file declares its own local `var C` palette
// (below) that predates lib/theme's — importing the theme's `C` here would shadow or be shadowed by it and
// silently repaint the whole page. The primitives carry their own tokens internally; that is the point of
// them being a library.
import { ClockChip } from '../components/primitives';

// Task-centric My Tasks (Tasks spec §5; SPEC_tasks_roles_mrr_fees §5). One box per task TYPE the user holds
// work in (no empty boxes), Queued (assigned) then In Process (in_progress). A claim pool + a notifications
// area sit below. Health scores are deferred (#13); the summary tiles are deadline-derived. Returned-for-rework
// ("URGENT CORRECTIONS REQUIRED") is slice 8b — not built here.

var TYPE_LABEL = {
  record_search: 'Record Search', redaction: 'Redaction', legal_redaction: 'Legal Redaction',
  redaction_qa: 'Redaction Review', review_auto_redaction: 'Auto-Redaction Review',
  estimate: 'Estimate', fee_waiver: 'Fee Waiver', legal_review: 'Legal Review', routing_review: 'Routing Review',
  // BW2 catalog (docs/SPEC_processing_ui.md §8). BW3 gave intake_review its screen and BW6 gave the four
  // MRR types theirs; release_review still falls back to the request (BW8).
  //
  // "MRR Management", not "MRR Coordination": the label a person reads has to be the task type's name, and
  // Kevin named it (7/28 item 1). Two names for one thing is how a queue and a screen start disagreeing.
  intake_review: 'Intake Review', mrr_management: 'MRR Management', release_review: 'Release Review',
  mrr_search: 'MRR Search', mrr_estimate: 'MRR Estimate', mrr_redaction: 'MRR Redaction'
};
// Order boxes appear in: front-line fulfillment first, then approvals/office work.
//
// BW6 MOVED `mrr_management` TO THE FRONT, and it is not a cosmetic reshuffle. An MRR Management task is a
// COORDINATION job that stays assigned until every item is terminal (Kevin 7/28 item 2), so its holder is
// the person other people's items are waiting on. Burying it below single-item work inverted the order in
// which the day should be worked. The three child activity types keep their own boxes right after it —
// "MRR Search — assigned to me" is a group like any other, including on the manager's own list when they
// take one (annotation 2).
var TYPE_ORDER = ['mrr_management', 'intake_review', 'record_search', 'redaction', 'legal_redaction', 'redaction_qa', 'review_auto_redaction',
  'mrr_search', 'mrr_estimate', 'mrr_redaction',
  'estimate', 'fee_waiver', 'legal_review', 'release_review', 'routing_review'];

// The MRR family, for the grouping banner. `mrr_management` is the coordination job; the other three are
// the items' activities, which NEVER advance a stage — the banner says so once, where the boxes meet, so
// the distinction is stated on the page a person actually starts their day on.
var MRR_TYPES = ['mrr_management', 'mrr_search', 'mrr_estimate', 'mrr_redaction'];

// The ONE place a task type becomes a screen; anything else falls back to the request (or a sensible home
// for request-independent work).
var TASK_SCREEN = {
  record_search: function (t) { return '/record-search/' + t.id; },
  estimate: function (t) { return '/estimate/' + t.id; },
  redaction: function (t) { return '/redaction/' + t.id; },
  legal_redaction: function (t) { return '/redaction/' + t.id; },
  redaction_qa: function (t) { return '/redaction/' + t.id; },
  // legal_review has been resolvable since 2026-07-18 (`/tasks/:id/resolve`), but had no entry here — so the
  // task fell through to `/requests/:id`, which has no resolution control, and a legal review was completable
  // only by curl. A backend resolution path with no entry in THIS map is unreachable work.
  legal_review: function (t) { return '/legal-review/' + t.id; },
  // BW3 — the intake reviewer's task screen. Without this entry the task fell through to `/requests/:id`,
  // which has no Proceed control and no eligibility panel: a backend resolution path with no entry in THIS
  // map is unreachable work (the lesson legal_review left above).
  intake_review: function (t) { return '/intake-review/' + t.id; },
  // BW6 — the MRR hub. `mrr_management` tasks have existed on live installs since BW2 and had NO screen:
  // they fell through to `/requests/:id`, which coordinates nothing. This entry is the home they never had.
  // The three child activity types get the thin assignee view, which is a DIFFERENT screen on purpose — the
  // manager orchestrates on the hub; the assignee does one activity and advances nothing.
  mrr_management: function (t) { return '/mrr/' + t.id; },
  mrr_search: function (t) { return '/mrr-activity/' + t.id; },
  mrr_estimate: function (t) { return '/mrr-activity/' + t.id; },
  mrr_redaction: function (t) { return '/mrr-activity/' + t.id; },
  review_auto_redaction: function () { return '/mass-redaction'; }
};
function screenFor(t) { var f = TASK_SCREEN[t.type]; return f ? f(t) : (t.request_id ? '/requests/' + t.request_id : '/mass-redaction'); }
function actionLabel(t) {
  return t.type === 'record_search' ? 'Search →' : t.type === 'redaction' || t.type === 'legal_redaction' ? 'Redact →'
    : t.type === 'estimate' ? 'Estimate →' : t.type === 'redaction_qa' || t.type === 'review_auto_redaction' ? 'Review →'
    : t.type === 'legal_review' || t.type === 'intake_review' ? 'Review →'
    // BW6. The manager COORDINATES an MRR (they never "work" it — the items are the work); the assignee
    // opens ONE activity. Two verbs, because they are two jobs.
    : t.type === 'mrr_management' ? 'Coordinate →'
    : t.type === 'mrr_search' || t.type === 'mrr_estimate' || t.type === 'mrr_redaction' ? 'Open item →'
    : t.status === 'in_progress' ? 'Continue →' : 'Open →';
}

// ── THE INTAKE EXCEPTIONS QUEUE (BW3; DRAFT_processing_ui_intake_review.md §1, mockup screen 1) ──
//
// Its own surface, not a box of ordinary rows, because under `when_needed` (the default) this queue is the
// EXCEPTIONS: most requests route straight to their team and never appear. The reviewer's first question is
// therefore "which exception?", so "Why it's here" is a COLUMN, not a hover.
//
// RULE (a) LIVES HERE. Every date in the Clock column is drawn by ClockChip from the server's `kind` — a
// city service target renders dashed and labelled "not a legal deadline", a statutory deadline navy with
// its citation, and a request with NO clock renders the honest "no deadline" rather than a fabricated date.
// The frontend never picks the treatment from a due date; it picks it from the kind.
var CLOCK_KICKER = {
  response: 'Statutory deadline', agency_action: 'Statutory deadline',
  operational_target: 'City service target', requestor_window: "Requestor's window"
};
function QueueClock(props) {
  var c = props.clock;
  // No clock row at all. Never invent one — and say WHY there is no date, because "blank" reads as a bug.
  if (!c || !c.dueDate) {
    return <ClockChip kind="none">no deadline — no city target set</ClockChip>;
  }
  return (
    <ClockChip kind={c.kind || 'none'} k={CLOCK_KICKER[c.kind] || null}
      citation={c.citation || null}
      exposure={c.isOverdue ? (c.overdueMeaning || null) : null}>
      {String(c.dueDate).slice(0, 10)}
    </ClockChip>
  );
}
// Clock-first, earliest first; a row with no clock sorts by AGE (mockup screen-1 note) — it is not "least
// urgent", it is "no date exists to sort it by", and age is the only honest substitute.
function queueSort(a, b) {
  var ad = a.clock && a.clock.dueDate, bd = b.clock && b.clock.dueDate;
  if (ad && bd) return String(ad) < String(bd) ? -1 : String(ad) > String(bd) ? 1 : 0;
  if (ad) return -1;
  if (bd) return 1;
  return String(a.request_created_at || a.created_at || '') < String(b.request_created_at || b.created_at || '') ? -1 : 1;
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
  var [intake, setIntake] = useState([]);
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
      // Its own fetch: the trigger labels and the per-request clock resolution are work no other task type
      // wants done. Tolerated failure — an intake queue that cannot load must not blank My Tasks.
      try { var iq = await api.get('/tasks/intake-queue'); setIntake(iq.data.tasks || []); } catch (e3) { setIntake([]); }
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

  // group my tasks by type. `intake_review` is lifted OUT — it has its own exceptions queue below, and
  // rendering it twice would be two answers to "what intake work do I hold".
  var byType = {};
  mine.forEach(function (t) { if (t.type !== 'intake_review') (byType[t.type] = byType[t.type] || []).push(t); });
  var poolOther = pool.filter(function (t) { return t.type !== 'intake_review'; });
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
        {/* "PATH HERE" (BW4; Draft 2 §1) — an ESTIMATE-only column, because it is the only queue where the
            answer changes the holder's duty. `Auto-routed — first human review` means literally nobody has
            read this request: on a confident auto-route the engine sequences estimate BEFORE record search,
            so under only-when-needed intake (the default) most requests meet their first human here. */}
        {t.pathHere ? (
          <div style={{ minWidth: '186px', fontSize: '11.5px', lineHeight: 1.35 }}>
            <div style={{ fontWeight: 700, color: t.pathHere.firstHumanReview ? '#92400E' : C.muted }}>
              {t.pathHere.label}
            </div>
            {t.paused && t.paused.paused ? <div style={{ color: '#92400E', fontWeight: 700 }}>Paused — clarification sent</div> : null}
          </div>
        ) : null}
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

      {/* ── Intake Review — the exceptions queue (BW3) ── */}
      {intake.length ? (
        <>
          {sectionHead('Intake Review · the exceptions')}
          <section style={C.card}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white' }}>
                <thead>
                  <tr>
                    {['Request', 'Requestor', 'Description', 'Clock', "Why it's here", ''].map(function (h) {
                      return <th key={h} style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted, textAlign: 'left', padding: '7px 10px', borderBottom: '2px solid #C3CFDA', fontWeight: 700 }}>{h}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {intake.slice().sort(queueSort).map(function (t) {
                    return (
                      <tr key={t.id}>
                        <td style={{ padding: '9px 10px', borderBottom: '1px solid #F2F6F9', verticalAlign: 'top' }}>
                          <div style={{ fontFamily: 'monospace', fontWeight: 700, color: C.accent, fontSize: '12.5px' }}>{t.request_number || '—'}</div>
                          <div style={{ fontSize: '11.5px', color: C.muted }}>{'recv ' + String(t.request_created_at || '').slice(0, 10)}</div>
                        </td>
                        <td style={{ padding: '9px 10px', borderBottom: '1px solid #F2F6F9', verticalAlign: 'top', fontSize: '12.5px' }}>{t.requestor_name || 'Anonymous'}</td>
                        <td style={{ padding: '9px 10px', borderBottom: '1px solid #F2F6F9', verticalAlign: 'top', fontSize: '12.5px', color: C.muted, maxWidth: '330px' }}>{t.request_description || t.title || '—'}</td>
                        <td style={{ padding: '9px 10px', borderBottom: '1px solid #F2F6F9', verticalAlign: 'top' }}><QueueClock clock={t.clock} /></td>
                        <td style={{ padding: '9px 10px', borderBottom: '1px solid #F2F6F9', verticalAlign: 'top', fontSize: '12.5px' }}>
                          {(t.triggers || []).map(function (g) {
                            return <div key={g.key} style={{ marginBottom: '3px' }}>{g.label}</div>;
                          })}
                          {/* Three DIFFERENT facts, never collapsed into one another. */}
                          {t.alwaysMode ? <div style={{ color: C.muted }}>Every request stops here — this city set intake review to “always”.</div> : null}
                          {t.triggerUnrecorded ? <div style={{ color: C.faint, fontStyle: 'italic' }}>No trigger recorded on this task.</div> : null}
                          {!t.mine ? <div style={{ display: 'inline-block', marginTop: '3px', fontSize: '10px', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', borderRadius: '3px', padding: '2px 7px', background: '#F2F6F9', border: '1px solid #C3CFDA', color: C.muted }}>Pool — unassigned</div> : null}
                        </td>
                        <td style={{ padding: '9px 10px', borderBottom: '1px solid #F2F6F9', verticalAlign: 'top', textAlign: 'right' }}>
                          {t.mine
                            ? <Link to={screenFor(t)} style={{ fontSize: '12.5px', fontWeight: 600, color: C.accent, background: C.accentSoft, border: '1px solid #E5E7EB', borderRadius: '7px', padding: '5px 11px', textDecoration: 'none', whiteSpace: 'nowrap' }}>Review →</Link>
                            : <button onClick={function () { claim(t.id); }} disabled={busy === t.id} style={{ fontSize: '12.5px', fontWeight: 600, color: C.good, background: C.goodSoft, border: 'none', borderRadius: '7px', padding: '6px 13px', cursor: 'pointer', opacity: busy === t.id ? 0.6 : 1 }}>{busy === t.id ? 'Claiming…' : 'Claim'}</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '11.5px', color: C.faint, padding: '9px 12px', margin: 0, borderTop: '1px solid #F3F4F6' }}>
              These are the exceptions, not the traffic: with intake review set to “only when needed” (the default), a
              confidently-classified, clean request routes straight to its team and never appears here. Sorted by clock,
              earliest first; a request with no clock sorts by age.
            </p>
          </section>
        </>
      ) : null}

      {!loading && boxTypes.length ? sectionHead('Your work') : null}
      {/* THE MRR GROUPING (BW6; mockup screen 1). The MRR boxes are ordinary boxes — the banner exists to
          say ONCE, on the page a person starts their day on, what makes the child activities different:
          completing one updates the manager's MRR screen and advances no stage. Without that line the
          three MRR boxes look like ordinary fulfillment work, and an assignee reasonably assumes finishing
          theirs moved the request along. */}
      {!loading && boxTypes.filter(function (ty) { return MRR_TYPES.indexOf(ty) >= 0; }).length ? (
        <div style={{ fontSize: '12px', color: C.faint, padding: '0 2px 8px' }}>
          <b style={{ color: '#1A2230' }}>Multi-record requests.</b>{' '}
          MRR Management is a coordination job and stays assigned until every item is terminal.
          MRR Search / Estimate / Redaction are one item's activities — completing one updates the Request
          Manager's MRR screen and advances no stage.
          {/* The overview is a LEVEL of the MRR navigation (group → overview → master → child), reached
              from the group — not a global nav item. My Tasks stays the only router (spec §1). */}
          {byType.mrr_management ? <> <Link to="/mrr" style={{ color: C.accent, fontWeight: 600 }}>All my MRRs →</Link></> : null}
        </div>
      ) : null}
      {boxTypes.map(box)}

      {!loading && !boxTypes.length && !myObjs.length && !intake.length ? (
        <div style={Object.assign({}, C.card, { padding: '56px', textAlign: 'center' })}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>✅</div>
          <div style={{ fontSize: '17px', fontWeight: 600, color: '#4B5563' }}>No tasks assigned to you</div>
          <div style={{ fontSize: '13px', color: C.faint, marginTop: '6px' }}>Claim work from the pool below, or it will be routed to you.</div>
        </div>
      ) : null}

      {/* Claim pool. `intake_review` is excluded — its claimable rows are already in the exceptions queue
          above, with the trigger and the clock the generic row cannot show. */}
      {poolOther.length ? (
        <>
          {sectionHead("Claim pool · work you're eligible for")}
          <section style={C.card}>
            {poolOther.map(function (t, i) {
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
