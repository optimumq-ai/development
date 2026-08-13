import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { SubmittedDescription } from '../components/primitives';

// LEGAL HOURS ESTIMATE — the thin answer screen for a hand-assigned `legal_estimate` ask
// (DESIGN_legal_hours_estimate.md slice 1). Phase-2 shape, same as every task screen:
//   (a) request-context header reading PARENT facts (GET /tasks/:id resolves the citizen's number)
//   (b) the evidence — the estimator's question ("what should legal look at")
//   (c) ONE primary action — hours + a required note, recorded as an ESTIMATE INPUT.
// Completing this advances no stage and prices nothing by itself: the estimator reads the answer on
// the estimate panel and stays the single author of the estimate snapshot.

export default function LegalEstimateTaskPage() {
  var params = useParams();
  var taskId = params.taskId;

  var [task, setTask] = useState(null);
  var [ask, setAsk] = useState(null);
  var [err, setErr] = useState('');
  var [hours, setHours] = useState('');
  var [note, setNote] = useState('');
  var [busy, setBusy] = useState(false);
  var [flash, setFlash] = useState(null);
  var [answered, setAnswered] = useState(null);

  useEffect(function () {
    var alive = true;
    api.get('/tasks/' + taskId)
      .then(function (r) {
        if (!alive) return;
        setTask(r.data.task);
        api.post('/tasks/' + taskId + '/begin').catch(function () {});
        return api.get('/legal-estimate/task/' + taskId).then(function (a) {
          if (!alive) return;
          setAsk(a.data.ask);
          if (a.data.ask && a.data.ask.hours != null) setAnswered(a.data.ask);
        });
      })
      .catch(function () { if (alive) setErr('Could not load this task.'); });
    return function () { alive = false; };
  }, [taskId]);

  function submit() {
    var h = Number(hours);
    if (!isFinite(h) || h <= 0) { setFlash({ tone: 'crit', text: 'Enter the expected legal hours (more than zero).' }); return; }
    if (!note.trim()) { setFlash({ tone: 'crit', text: 'A note is required. Say what the hours cover.' }); return; }
    setBusy(true); setFlash(null);
    api.post('/legal-estimate/task/' + taskId + '/complete', { hours: h, note: note.trim() })
      .then(function (r) {
        setAnswered(r.data.input);
        setFlash({ tone: 'green', text: 'Recorded. The estimator sees your answer on the estimate — this advances no stage.' });
      })
      .catch(function (e) {
        var d = e && e.response && e.response.data;
        setFlash({ tone: 'crit', text: (d && d.error) || 'Could not record the answer.' });
      })
      .finally(function () { setBusy(false); });
  }

  if (err) return <div style={{ padding: 24, color: C.crit, fontSize: 14 }}>{err}</div>;
  if (!task) return <div style={{ padding: 24, color: C.faint, fontSize: 14 }}>Loading…</div>;

  // Courtesy mirror of the backend's actionability guard (the resolve-route lesson).
  var ACTIONABLE = ['open', 'assigned', 'in_progress', 'returned', 'awaiting_review'];
  var closed = ACTIONABLE.indexOf(task.status) < 0;
  var done = answered || closed;

  return (
    <div style={{ maxWidth: 900, padding: '4px 0 40px' }}>
      <Link to="/my-tasks" style={{ fontSize: 13, color: C.blue, textDecoration: 'none' }}>&larr; My Tasks</Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 4px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: C.ink }}>Legal Hours Estimate</h1>
        {done ? (
          <span style={{
            background: answered || task.status === 'done' ? C.greenTint : C.surface2,
            color: answered || task.status === 'done' ? C.green : C.muted,
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20
          }}>{answered || task.status === 'done' ? 'ANSWERED' : String(task.status || '').toUpperCase()}</span>
        ) : null}
      </div>

      <p style={{ color: C.muted, fontSize: 14, margin: '0 0 6px' }}>
        {task.request_number ? <span style={{ fontFamily: C.mono }}>{task.request_number}</span> : null}
        {task.requestor_name ? ' · for ' + task.requestor_name : ''}
        {task.record_type_name ? ' · ' + task.record_type_name : ''}
      </p>
      {task.request_description
        ? <SubmittedDescription margin="0 0 14px">{task.request_description}</SubmittedDescription>
        : null}

      <div style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 12, padding: 18, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 6 }}>What the estimator asked</div>
        {ask ? (
          <div style={{ borderLeft: '3px solid ' + C.blue, paddingLeft: 12 }}>
            <div style={{ fontSize: 12, color: C.faint, marginBottom: 4 }}>
              {ask.asked_by_name || 'Estimator'}{ask.asked_at ? ' · ' + ask.asked_at : ''}
            </div>
            <div style={{ fontSize: 13, color: C.ink, whiteSpace: 'pre-wrap' }}>{ask.ask_note}</div>
          </div>
        ) : <div style={{ fontSize: 13, color: C.muted }}>Loading the question…</div>}
      </div>

      <div style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Your answer</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          How many hours of legal work should this request be expected to need? Your answer goes onto the
          estimate as an input for the estimator — it does not price anything by itself and moves nothing.
        </div>

        {answered ? (
          <div style={{ borderLeft: '3px solid ' + C.green, paddingLeft: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 650, color: C.ink }}>{answered.hours} hour{answered.hours === 1 ? '' : 's'}</div>
            <div style={{ fontSize: 12, color: C.faint, margin: '2px 0 6px' }}>
              {answered.entered_by_name || ''}{answered.entered_at ? ' · ' + answered.entered_at : ''}
            </div>
            <div style={{ fontSize: 13, color: C.ink, whiteSpace: 'pre-wrap' }}>{answered.note}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 13, fontWeight: 650, color: C.ink, marginBottom: 4 }}>Expected hours</div>
            <input type="number" min="0.25" step="0.25" value={hours} disabled={!!done}
              onChange={function (e) { setHours(e.target.value); }}
              style={{ width: 140, background: C.field, border: '1px solid ' + C.hairStrong, borderRadius: 8, padding: 10, fontSize: 13, color: C.ink }} />
            <div style={{ fontSize: 13, fontWeight: 650, color: C.ink, margin: '14px 0 4px' }}>
              Note <span style={{ color: C.crit }}>(required)</span>
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
              Say what the hours cover. This is the city&rsquo;s record of why legal time is expected.
            </div>
            <textarea value={note} disabled={!!done} onChange={function (e) { setNote(e.target.value); }}
              rows={4} style={{
                width: '100%', boxSizing: 'border-box', background: C.field, border: '1px solid ' + C.hairStrong,
                borderRadius: 8, padding: 10, fontSize: 13, color: C.ink, fontFamily: 'inherit', resize: 'vertical'
              }} />
          </div>
        )}

        {flash ? (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: flash.tone === 'green' ? C.greenTint : C.critTint,
            color: flash.tone === 'green' ? C.green : C.crit
          }}>{flash.text}</div>
        ) : null}

        {done ? (
          <div style={{ marginTop: 14 }}>
            {closed && !answered && task.status !== 'done' ? (
              <div style={{ background: C.surface2, border: '1px solid ' + C.hair, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: C.muted, marginBottom: 12 }}>
                This ask is <strong>{task.status}</strong> and can no longer be answered — the estimator
                likely re-asked or the request moved on.
              </div>
            ) : null}
            <Link to="/my-tasks" style={{ fontSize: 13, color: C.blue }}>Back to My Tasks &rarr;</Link>
          </div>
        ) : (
          <button onClick={submit} disabled={busy} style={{
            marginTop: 14, background: busy ? C.hairStrong : C.blue, color: '#fff', border: 0,
            borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer'
          }}>{busy ? 'Recording…' : 'Record answer'}</button>
        )}
      </div>
    </div>
  );
}
