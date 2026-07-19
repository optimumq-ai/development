import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { STAGE_LABELS } from '../lib/stages';
import { useWorkTimer, WorkTimerBadge, useTimeCaptureMode } from '../components/ui/WorkTimer';

// LEGAL REVIEW TASK SCREEN — brief §4 Phase 2, the first skeleton screen.
//
// WHY THIS EXISTS: `legal_review` has been fully resolvable since 2026-07-18 (p) — `POST /tasks/:id/resolve`
// checks the type, requires a note, and moves the request through `applyStageTransition`, with 18 passing
// assertions in verify_legal_review. NOTHING IN THE UI COULD REACH IT. `TASK_SCREEN` in MyTasksPage carried
// five entries and `legal_review` was not one, so the task fell through to `/requests/:id`, which has no
// resolution control. A legal review was completable only by curl. The harness passed the whole time because
// it tested the endpoint, never the reachability — see verify_legal_review §H, added with this screen.
//
// THE PHASE 2 SHAPE (brief §4), which every later stub should copy:
//   (a) a request-context header reading PARENT facts
//   (b) whatever evidence this task needs — here, the assertion being adjudicated
//   (c) ONE primary action that calls the central transition
//
// PARENT FACTS COME FROM THE PARENT. `request_number` arrives already parent-resolved: GET /tasks/:id builds
// it with `scope.numberExpr`/`numberJoin`, so it is the number the CITIZEN knows, not the child's suffixed
// component number. Do not reconstruct it from anything on the row.
//
// A NOTE IS REQUIRED (Kevin, 2026-07-18; brief §5 Q2). Asserting an exemption is a legal act the city may
// have to defend, and "the reviewer clicked approve" is not a defence. The backend enforces this (422
// NOTE_REQUIRED); the screen enforces it too so the reviewer is never surprised by a rejected submit.

// The three outcomes and where each one SENDS the request. This vocabulary is deliberately identical to the
// AG ruling's (`POST /requests/:id/ag-ruling`) — an internal exemption review and an AG pre-clearance ruling
// answer the same question, and two vocabularies would be two ways to say one thing. Destinations mirror
// LEGAL_OUTCOMES in backend/src/routes/tasks.js; if they diverge, the backend is right.
var OUTCOMES = [
  { key: 'sustained', label: 'Withholding sustained',
    consequence: 'The material stays withheld. Goes to Redaction Review.', stage: 'redaction_review' },
  { key: 'partial', label: 'Partial release',
    consequence: 'Some material is released, some withheld. Goes to Redaction Review.', stage: 'redaction_review' },
  { key: 'overruled', label: 'Must release',
    consequence: 'The exemption does not stand. Skips redaction review and goes to Delivery.', stage: 'delivery' }
];

// The evidence this screen exists to show: the act that put the request into a legal stage. Written by
// `POST /requests/:id/assert-exemption` — EXEMPTION_ASSERTED for the internal model, AG_PRECLEARANCE_SUBMITTED
// where the jurisdiction profile says `pre_clearance`.
var ASSERTION_ACTIONS = ['EXEMPTION_ASSERTED', 'AG_PRECLEARANCE_SUBMITTED'];

function daysUntil(d) {
  if (!d) return null;
  var ms = new Date(d + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime();
  return Math.round(ms / 86400000);
}

function fmtWhen(s) {
  if (!s) return '';
  var d = new Date(s.indexOf('T') > 0 ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? s : d.toLocaleString(undefined,
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function LegalReviewTaskPage() {
  var params = useParams();
  var taskId = params.taskId;

  var [task, setTask] = useState(null);
  var [assertions, setAssertions] = useState([]);
  var [err, setErr] = useState('');
  var [outcome, setOutcome] = useState('');
  var [notes, setNotes] = useState('');
  var [busy, setBusy] = useState(false);
  var [flash, setFlash] = useState(null);
  var [resolved, setResolved] = useState(null);

  var timer = useWorkTimer(taskId);
  var tcm = useTimeCaptureMode('legal');

  useEffect(function () {
    var alive = true;
    api.get('/tasks/' + taskId)
      .then(function (r) {
        if (!alive) return;
        var t = r.data.task;
        setTask(t);
        // begin-work: owner-gated and idempotent (Slice A). A non-owner viewing does not start the clock.
        api.post('/tasks/' + taskId + '/begin').catch(function () {});
        // The assertion trail lives on the REQUEST, not the task.
        if (t && t.request_id) {
          return api.get('/requests/' + t.request_id).then(function (rr) {
            if (!alive) return;
            var hist = (rr.data && rr.data.history) || [];
            setAssertions(hist.filter(function (h) { return ASSERTION_ACTIONS.indexOf(h.action) >= 0; }));
          });
        }
      })
      .catch(function () { if (alive) setErr('Could not load this task.'); });
    return function () { alive = false; };
  }, [taskId]);

  function submit() {
    if (!outcome) { setFlash({ tone: 'crit', text: 'Choose an outcome first.' }); return; }
    // Mirror the backend's requirement rather than discovering it via a 422.
    if (!notes.trim()) {
      setFlash({ tone: 'crit', text: 'A note is required. Say what was withheld or released, and on what basis.' });
      return;
    }
    setBusy(true); setFlash(null);
    api.post('/tasks/' + taskId + '/resolve', { outcome: outcome, notes: notes.trim() })
      .then(function (r) {
        setResolved(r.data);
        setFlash({ tone: 'green', text: 'Decision recorded. The request moved to ' + (STAGE_LABELS[r.data.stage] || r.data.stage) + '.' });
      })
      .catch(function (e) {
        var d = e && e.response && e.response.data;
        setFlash({ tone: 'crit', text: (d && d.error) || 'Could not record the decision.' });
      })
      .finally(function () { setBusy(false); });
  }

  if (err) return <div style={{ padding: 24, color: C.crit, fontSize: 14 }}>{err}</div>;
  if (!task) return <div style={{ padding: 24, color: C.faint, fontSize: 14 }}>Loading…</div>;

  // A CANCELLED TASK IS NOT A DECIDABLE ONE. `status === 'done'` alone was not enough: §3.2's "a stage's task
  // dies with its stage" CANCELS the outgoing stage's task, so a legal_review whose request has moved on sits
  // at `cancelled` — and a screen that only checks for 'done' happily renders the full decision form over it.
  // Observed 2026-07-19: a cancelled legal_review was resolved through this screen and moved the request.
  // ⚠️ THE BACKEND DOES NOT GUARD THIS EITHER — `/tasks/:id/resolve` checks the task TYPE and never its
  // STATUS, so the same call by curl still succeeds. This client-side check is a courtesy, NOT the fix.
  // See HANDOFF 2026-07-19; the guard belongs in the route.
  var ACTIONABLE = ['open', 'assigned', 'in_progress', 'returned', 'awaiting_review'];
  var closed = ACTIONABLE.indexOf(task.status) < 0;
  var done = resolved || closed;
  var days = daysUntil(task.deadline_date);

  // WHICH REVIEW IS THIS, AND IS THE CLOCK RUNNING? DERIVED FROM THE ASSERTION, NOT FROM `stage`.
  //
  // The obvious implementation — `task.stage === 'ag_review'` — is WRONG IN PRACTICE, and observing that is
  // what this screen was first used for (2026-07-19). `stage` here is the stage of whichever row the task
  // hangs off, and for a legal task that row is not reliably the one doing the work: `assert-exemption`
  // resolves `id OR request_number` and hands the row it finds straight to applyStageTransition, so
  // asserting against a PARENT id moves the PARENT and spawns legal_review there — while the CHILD, which
  // carries the real work stage, sits at `intake` with its own open routing_review. A legal review then
  // renders a badge reading "INTAKE REVIEW". Verified on a live-shaped tree; see HANDOFF 2026-07-19.
  //
  // The ASSERTION is the durable fact and the screen already loads it: AG_PRECLEARANCE_SUBMITTED means the
  // AG route (which TOLLS the response clock), EXEMPTION_ASSERTED means the internal model (which
  // explicitly does NOT — assert-exemption returns `tolled: false`), so at an internal review the statutory
  // deadline is RUNNING while the task sits in someone's queue. Falls back to `stage` only when no
  // assertion is on record, which §(b) above already calls out as worth noticing.
  var latest = assertions.length ? assertions[assertions.length - 1] : null;
  var isAg = latest ? latest.action === 'AG_PRECLEARANCE_SUBMITTED' : task.stage === 'ag_review';
  var tolled = isAg;
  var reviewLabel = isAg ? 'AG PRE-CLEARANCE' : 'EXEMPTION REVIEW';

  return (
    <div style={{ maxWidth: 900, padding: '4px 0 40px' }}>
      <Link to="/my-tasks" style={{ fontSize: 13, color: C.blue, textDecoration: 'none' }}>&larr; My Tasks</Link>

      {/* (a) CONTEXT — parent facts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 4px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: C.ink }}>Legal Review</h1>
        <span style={{ background: C.blueTint, color: C.blueInk, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
          {reviewLabel}
        </span>
        {done ? (
          <span style={{
            background: resolved || task.status === 'done' ? C.greenTint : C.surface2,
            color: resolved || task.status === 'done' ? C.green : C.muted,
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20
          }}>{resolved || task.status === 'done' ? 'DECIDED' : String(task.status || '').toUpperCase()}</span>
        ) : null}
        {done || tcm.mode === 'off' ? null : <WorkTimerBadge timer={timer} />}
      </div>

      <p style={{ color: C.muted, fontSize: 14, margin: '0 0 6px' }}>
        {task.request_number ? <span style={{ fontFamily: C.mono }}>{task.request_number}</span> : null}
        {task.requestor_name ? ' · for ' + task.requestor_name : ''}
        {task.record_type_name ? ' · ' + task.record_type_name : ''}
      </p>
      {task.request_description
        ? <p style={{ color: C.faint, fontSize: 13, margin: '0 0 14px', maxWidth: 720, fontStyle: 'italic' }}>&ldquo;{task.request_description}&rdquo;</p>
        : null}

      {days != null ? (
        <div style={{
          background: tolled ? C.surface2 : (days <= 3 ? C.critTint : C.amberTint),
          color: tolled ? C.muted : (days <= 3 ? C.crit : C.amber),
          border: '1px solid ' + (tolled ? C.hair : 'transparent'),
          borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 600, marginBottom: 18, maxWidth: 720
        }}>
          {tolled
            ? 'Response clock TOLLED while the AG ruling is pending — it resumes when the ruling is recorded.'
            : (days < 0 ? Math.abs(days) + ' days PAST the response deadline.' : days + ' day' + (days === 1 ? '' : 's') + ' left on the response clock.') +
              ' An internal exemption review does NOT toll it.'}
        </div>
      ) : null}

      {/* (b) EVIDENCE — the assertion being adjudicated */}
      <div style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 12, padding: 18, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 10 }}>What was asserted</div>
        {assertions.length === 0 ? (
          // Honest rather than blank: a legal task with no assertion in the trail is worth noticing, since
          // the stage is supposed to be entered only by asserting one.
          <div style={{ fontSize: 13, color: C.muted }}>
            No exemption assertion is recorded on this request. The request reached this stage without one —
            worth checking the request history before deciding.
          </div>
        ) : assertions.map(function (a, i) {
          return (
            <div key={a.id || i} style={{ borderLeft: '3px solid ' + C.blue, paddingLeft: 12, marginBottom: i === assertions.length - 1 ? 0 : 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.blueInk, letterSpacing: '.02em' }}>{a.action}</div>
              <div style={{ fontSize: 12, color: C.faint, margin: '2px 0 6px' }}>
                {fmtWhen(a.created_at)}{a.actor_name ? ' · ' + a.actor_name : ''}
              </div>
              <div style={{ fontSize: 13, color: C.ink, whiteSpace: 'pre-wrap' }}>{a.notes || <span style={{ color: C.faint }}>(no note recorded)</span>}</div>
            </div>
          );
        })}
      </div>

      {/* (c) ONE primary action — routed through the central transition */}
      <div style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Decision</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Does the withholding stand?</div>

        {OUTCOMES.map(function (o) {
          var sel = outcome === o.key;
          return (
            <label key={o.key} style={{
              display: 'block', border: '1px solid ' + (sel ? C.blue : C.hair), background: sel ? C.blueTint : C.surface,
              borderRadius: 8, padding: '10px 12px', marginBottom: 8, cursor: done ? 'default' : 'pointer'
            }}>
              <input type="radio" name="outcome" value={o.key} checked={sel} disabled={!!done}
                onChange={function () { setOutcome(o.key); }} style={{ marginRight: 8 }} />
              <span style={{ fontSize: 13, fontWeight: 650, color: C.ink }}>{o.label}</span>
              <div style={{ fontSize: 12, color: C.muted, marginLeft: 22 }}>{o.consequence}</div>
            </label>
          );
        })}

        <div style={{ fontSize: 13, fontWeight: 650, color: C.ink, margin: '14px 0 4px' }}>
          Note <span style={{ color: C.crit }}>(required)</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
          Say what was withheld or released, and on what basis. This is the city&rsquo;s record of why.
        </div>
        <textarea value={notes} disabled={!!done} onChange={function (e) { setNotes(e.target.value); }}
          rows={4} style={{
            width: '100%', boxSizing: 'border-box', background: C.field, border: '1px solid ' + C.hairStrong,
            borderRadius: 8, padding: 10, fontSize: 13, color: C.ink, fontFamily: 'inherit', resize: 'vertical'
          }} />

        {flash ? (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: flash.tone === 'green' ? C.greenTint : C.critTint,
            color: flash.tone === 'green' ? C.green : C.crit
          }}>{flash.text}</div>
        ) : null}

        {done ? (
          <div style={{ marginTop: 14 }}>
            {closed && !resolved && task.status !== 'done' ? (
              <div style={{ background: C.surface2, border: '1px solid ' + C.hair, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: C.muted, marginBottom: 12 }}>
                This review is <strong>{task.status}</strong> and can no longer be decided — the request moved
                on and the task was closed with its stage. Open the request to see where it went.
              </div>
            ) : null}
            <Link to="/my-tasks" style={{ fontSize: 13, color: C.blue }}>Back to My Tasks &rarr;</Link>
          </div>
        ) : (
          <button onClick={submit} disabled={busy} style={{
            marginTop: 14, background: busy ? C.hairStrong : C.blue, color: '#fff', border: 0,
            borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer'
          }}>{busy ? 'Recording…' : 'Record decision'}</button>
        )}
      </div>
    </div>
  );
}
