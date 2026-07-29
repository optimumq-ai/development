import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import FeeEstimatePanel from '../components/ui/FeeEstimatePanel';
import { useWorkTimer, WorkTimerBadge, useTimeCaptureMode } from '../components/ui/WorkTimer';
import { SubmittedDescription, DecidedByBadge, ConfirmPopup, G } from '../components/primitives';
import CommercialRatePanel from '../components/ui/CommercialRatePanel';

// The stacked defect buttons that live in SubmittedDescription's box (spec §2.2).
var defectBtn = { font: 'inherit', fontSize: '13px', fontWeight: 500, borderRadius: '5px', padding: '6px 14px',
  cursor: 'pointer', background: '#F7F9FB', color: '#101A2A', border: '1px solid #C3CFDA', whiteSpace: 'nowrap' };

export default function EstimateTaskPage() {
  var params = useParams();
  var taskId = params.taskId;
  var [task, setTask] = useState(null);
  var [ctx, setCtx] = useState(null);          // BW4: /tasks/:id/estimate-context
  var [flash, setFlash] = useState('');
  var [busy, setBusy] = useState('');
  var [dmOpen, setDmOpen] = useState(false);
  var [dmNote, setDmNote] = useState('');
  var [err, setErr] = useState('');
  var timer = useWorkTimer(taskId);
  var tcm = useTimeCaptureMode('estimate');   // Slice E: badge visibility only here — the estimate finalize
                                              // ceremony isn't consolidated yet, so the Complete modal rides along later.

  // BW4 — the screen-specific facts, in one read, from the same functions the guards use. Failure is not
  // fatal: the estimate builder is the pre-existing screen and must keep working if a context read breaks.
  function loadCtx() {
    return api.get('/tasks/' + taskId + '/estimate-context')
      .then(function (r) { setCtx(r.data); })
      .catch(function () {});
  }

  useEffect(function () {
    api.get('/tasks/' + taskId)
      .then(function (r) { setTask(r.data.task); api.post('/tasks/' + taskId + '/begin').catch(function () {}); }) // begin-work: owner-gated (Slice A)
      .catch(function () { setErr('Could not load this task.'); });
    loadCtx();
  }, [taskId]);

  // THE DEFECT MARKERS (Draft 2 §0, §4.1). The SAME clarification machinery the intake screen and the
  // record-search rail already use — `POST /requests/:id/clarification` with a `reason`, which decides the
  // clock effect per jurisdiction and (for `vague` only) pauses this task.
  //
  // The asymmetry is the design and the copy has to say so: marking VAGUE pauses the estimate, because you
  // cannot price what you cannot parse. Marking OVERLY BROAD does NOT — "too large is not a mark, it IS the
  // estimate": you stay on this screen and price it, and the acceptance gate (proceed / narrow / withdraw)
  // is the narrowing conversation.
  function markDefect(reason) {
    if (!ctx) return;
    setBusy(reason);
    return api.post('/requests/' + ctx.task.request_id + '/clarification', { reason: reason })
      .then(function (r) {
        var d = r.data || {};
        setFlash(d.conferenceRequired
          ? 'Conference offered. THE CLOCK DID NOT STOP — missing the deadline forfeits the burden defense entirely.'
          : (reason === 'vague'
              ? 'Clarification sent and this estimate is PAUSED pending the requestor’s reply' +
                (d.clockStillRunning ? '; the clock keeps running (' + d.effect + ').' : '; the response clock was tolled.')
              : 'Clarification sent. This estimate is NOT paused — the estimate is the response to volume. ' +
                'Price it, and the acceptance gate is where the request gets narrowed.'));
        return loadCtx();
      })
      .catch(function (e) { setFlash((e.response && e.response.data && e.response.data.error) || 'That did not go through.'); })
      .then(function () { setBusy(''); });
  }

  // RESUME. The reply is what resumes the estimate — so this posts the REPLY path
  // (`/clarification/resolve`), the same act that applies the jurisdiction's reply-side clock effect
  // (resume or restart). There is no bare "unpause" button: un-pausing without recording that the requestor
  // answered would leave the clock tolled and the trail claiming a clarification is still outstanding.
  function recordReply() {
    if (!ctx) return;
    setBusy('resume');
    return api.post('/requests/' + ctx.task.request_id + '/clarification/resolve', {})
      .then(function () {
        setFlash('Requestor’s reply recorded — the estimate is resumed and the response clock was handled per this jurisdiction’s rule.');
        return loadCtx();
      })
      .catch(function (e) { setFlash((e.response && e.response.data && e.response.data.error) || 'Could not record the reply.'); })
      .then(function () { setBusy(''); });
  }

  // DE MINIMIS — WAIVE AND ADVANCE. A rail action behind a ConfirmPopup, because it waives money the city
  // could have charged on this person's judgment and skips the requester's notice entirely: every close-like
  // act in this spec states what will be written before it is written (spec §4).
  function deMinimisWaive() {
    if (!ctx) return;
    setBusy('deminimis');
    return api.post('/fee-estimates/request/' + ctx.task.request_id + '/de-minimis-waive', { note: dmNote.trim() })
      .then(function (r) {
        setDmOpen(false); setDmNote('');
        setFlash('Waived to $0.00 and recorded against your name' + (r.data && r.data.advanced ? ' — the request advanced to record search.' : '.'));
        return loadCtx();
      })
      .catch(function (e) { setFlash((e.response && e.response.data && e.response.data.error) || 'Could not record the waive.'); })
      .then(function () { setBusy(''); });
  }

  function classify(value) {
    if (!ctx) return;
    setBusy('classify');
    return api.post('/requests/' + ctx.task.request_id + '/commercial-classification', { classifyAs: value })
      .then(function (r) {
        setFlash(r.data && r.data.overridesDeclaration
          ? 'Classified as ' + value + ' — this overrides the requester’s declaration and must be communicated.'
          : 'Classified as ' + value + ' — recorded against your name.');
        return loadCtx();
      })
      .catch(function (e) { setFlash((e.response && e.response.data && e.response.data.error) || 'Could not record that classification.'); })
      .then(function () { setBusy(''); });
  }

  if (err) return <div style={{ padding: '24px', color: '#9B1C1C', fontSize: '14px' }}>{err}</div>;
  if (!task) return <div style={{ padding: '24px', color: '#9CA3AF', fontSize: '14px' }}>Loading...</div>;

  var review = (task.title || '').toLowerCase().indexOf('review') >= 0;
  var done = task.status === 'done';
  var paused = !!(ctx && ctx.paused && ctx.paused.paused);
  var prov = (ctx && ctx.provenance) || null;
  var wp = (ctx && ctx.waiverPanel) || null;

  return (
    <div style={{ maxWidth: '1100px' }}>
      <Link to="/my-tasks" style={{ fontSize: '13px', color: '#1F4E79', textDecoration: 'none' }}>&larr; My Tasks</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '10px 0 4px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: 0 }}>Estimate</h1>
        <span style={{ background: review ? '#FEF3C7' : '#DBEAFE', color: review ? '#92400E' : '#1E40AF', fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px' }}>{review ? 'REVIEW — auto-generated' : 'CREATE'}</span>
        {done ? <span style={{ background: '#DEF7EC', color: '#03543F', fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px' }}>TASK COMPLETE</span> : null}
        {done || tcm.mode === 'off' ? null : <WorkTimerBadge timer={timer} />}
      </div>
      <p style={{ color: '#6B7280', fontSize: '14px', margin: '0 0 6px' }}>
        {task.request_number ? task.request_number + ' · ' : ''}{task.requestor_name ? 'for ' + task.requestor_name : ''}{task.record_type_name ? ' · ' + task.record_type_name : ''}
      </p>
      {/* ── THE FIRST-LOOK BANNER (Draft 2 §1, §4.2) ──
          Auto-routed only. On that path the estimate task is the first human checkpoint — the engine
          sequences estimate before record search on a confident match, so under only-when-needed intake
          (the default) the estimator is the first person to read most requests. The banner makes "nobody
          has reviewed this" impossible to miss; it is deliberately absent when an ORO Associate already
          scoped the request, because then it would be false.
          An auto-COMPLETED intake review is NOT a human review (draft decision 4: no assignee, no
          reviewer), so it renders here too, saying which it was. */}
      {prov && prov.firstHumanReview ? (
        <div style={{ fontSize: '13px', color: '#92400E', background: '#FFF8E5', border: '1px solid #D4A72C', borderRadius: '8px', padding: '11px 13px', margin: '0 0 14px' }}>
          <b>First human review.</b> This request was routed automatically and no one has read it yet — you are
          the first. Check that it says what the classification claims before you price it; if it does not,
          the defect markers beside the description are how you say so.
          {prov.detail ? <div style={{ marginTop: '4px', color: '#B45309' }}>{prov.detail}</div> : null}
          {prov.openStop ? <div style={{ marginTop: '4px', color: '#B45309' }}>An intake review is OPEN on this request and has not been decided.</div> : null}
        </div>
      ) : prov ? (
        <div style={{ fontSize: '12.5px', color: '#6B7280', margin: '0 0 14px' }}>
          Path here: <b>{prov.label}</b>{prov.detail ? ' — ' + prov.detail : ''}
        </div>
      ) : null}
      {/* Global record-item layout (SPEC_processing_ui.md §2): verbatim text first, titled — never an
          italic aside; the defect buttons stacked in a small box to its LEFT (§2.2), the same pair the
          intake screen and the record-search rail carry. BW4. */}
      {task.request_description
        ? <SubmittedDescription margin="0 0 18px" actions={ctx && !done ? (
            <>
              <button type="button" disabled={!!busy || paused} onClick={function () { markDefect('vague'); }} style={defectBtn}>Mark Vague</button>
              <button type="button" disabled={!!busy} onClick={function () { markDefect('overly_broad'); }} style={defectBtn}>Mark Overly Broad</button>
            </>
          ) : null}>{task.request_description}</SubmittedDescription>
        : null}
      {flash ? <div style={{ fontSize: '13px', color: '#03543F', background: '#DEF7EC', border: '1px solid #BCF0DA', borderRadius: '8px', padding: '9px 12px', marginBottom: '12px' }}>{flash}</div> : null}
      {/* THE PAUSE, IN THE SERVER'S WORDS. There is no manual hold anywhere (spec §2.4): the hold is a
          system state with a named cause, and the cause is printed. */}
      {paused ? (
        <div style={{ fontSize: '13px', color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '8px', padding: '11px 13px', marginBottom: '12px' }}>
          <b>Estimate paused.</b> {ctx.paused.text}
          {ctx.paused.at ? <span style={{ color: '#B45309' }}> (since {String(ctx.paused.at).slice(0, 10)}{ctx.paused.by ? ', marked by ' + ctx.paused.by : ''})</span> : null}
          <div style={{ marginTop: '8px' }}>
            <button type="button" disabled={!!busy} onClick={recordReply}
              style={{ font: 'inherit', fontSize: '13px', fontWeight: 700, padding: '6px 14px', borderRadius: '6px', border: 'none', background: busy ? '#9CB4CC' : '#1F4E79', color: 'white', cursor: busy ? 'default' : 'pointer' }}>
              {busy === 'resume' ? 'Recording…' : 'The requestor replied — resume'}
            </button>
            <span style={{ color: '#B45309', marginLeft: '10px' }}>
              Recording the reply is what resumes this estimate; it also applies this jurisdiction’s reply-side
              clock rule. There is no bare un-pause — that would leave the clock tolled and the trail claiming
              a clarification is still outstanding.
            </span>
          </div>
        </div>
      ) : null}
      {/* BW4 — the classification is the ESTIMATOR's business too: it is their invoice that carries the
          rate. Same component, same endpoint, same single stored fact as the intake screen. */}
      {ctx ? <CommercialRatePanel commercial={ctx.commercial} busy={!!busy} onClassify={classify} /> : null}
      {/* ── FEE WAIVER (Draft 2 §0b) ──
          HIDDEN when there is nothing to show: not requested, nothing pending, nothing decided, no
          statutory category armed. The four visible states come from the SERVER
          (approvalModules.waiverPanelState) — a screen deciding for itself whether a mandatory category is
          armed would be a second reading of the statute list, free to disagree with the one that acts. */}
      {wp && wp.state !== 'hidden' ? (
        <div style={{ background: '#F7F9FB', border: '1px solid ' + G.line, borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#6B7280', marginBottom: '7px' }}>Fee waiver</div>
          <div style={{ fontSize: '13px', color: '#1A2230' }}>
            {wp.text}{' '}
            {wp.state === 'by_statute' ? <DecidedByBadge by="statute">Waived by statute</DecidedByBadge> : null}
            {wp.state === 'decided' ? <DecidedByBadge by={wp.decidedBy === 'statute' ? 'statute' : 'person'}>{wp.decidedBy === 'statute' ? 'By statute' : ('Decided by ' + (wp.decidedBy || 'a person'))}</DecidedByBadge> : null}
            {wp.state === 'decision' ? <DecidedByBadge by="person">A person decides</DecidedByBadge> : null}
            {wp.state === 'not_offered' ? <DecidedByBadge by="recorded">Recorded — nothing to decide</DecidedByBadge> : null}
          </div>
          {wp.state === 'by_statute' ? (
            <div style={{ fontSize: '12.5px', color: '#6B7280', marginTop: '5px' }}>
              {wp.note}
              {wp.category ? <div style={{ marginTop: '3px' }}>{wp.category.label} — {wp.category.citation} (on verified {String(wp.category.evidence || '').replace(/_/g, ' ')})</div> : null}
            </div>
          ) : null}
          {wp.state === 'decided' && wp.reason ? <div style={{ fontSize: '12.5px', color: '#6B7280', marginTop: '4px' }}>Reason recorded: {wp.reason}</div> : null}
        </div>
      ) : null}

      {/* THE SEND GATE, IN WORDS, FROM THE SERVER (Draft 2 §4.3). The same 409 WAIVER_UNDECIDED sentence the
          send route refuses with — not a frontend re-derivation, so the greyed button and the refusal can
          never disagree. */}
      {ctx && ctx.waiverGate && ctx.waiverGate.blocked ? (
        <div style={{ fontSize: '13px', color: '#92400E', background: '#FFF8E5', border: '1px solid #D4A72C', borderRadius: '8px', padding: '11px 13px', marginBottom: '14px' }}>
          <b>The estimate cannot be sent yet.</b> {ctx.waiverGate.reason}
        </div>
      ) : null}

      {/* HELD, NOT HIDDEN. A paused estimate keeps showing whatever was already computed — the figures are
          evidence and removing them would look like data loss — but nothing on it can be changed or sent
          while the request's MEANING is in the post. */}
      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, background: 'white', borderRadius: '12px', border: '1px solid #E5E7EB', padding: '24px',
          opacity: paused ? 0.5 : 1, pointerEvents: paused ? 'none' : 'auto' }}>
          <FeeEstimatePanel requestId={task.request_id} />
        </div>

        {/* ── ACTIONS RAIL (spec §2.3 — "Actions", never "Work the request") ── */}
        <div style={{ flex: '0 0 236px' }}>
          <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '11px 13px' }}>
            <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: '#6B7280', marginBottom: '7px' }}>Actions</div>
            <button type="button" disabled={!!busy || done || paused} onClick={function () { setDmOpen(true); }}
              style={{ font: 'inherit', width: '100%', fontSize: '13px', fontWeight: 600, padding: '6px 12px', borderRadius: '5px',
                background: '#F7F9FB', color: '#101A2A', border: '1px solid ' + G.line, cursor: (busy || done || paused) ? 'not-allowed' : 'pointer', opacity: (busy || done || paused) ? 0.55 : 1 }}>
              De minimis — waive &amp; advance
            </button>
            <div style={{ fontSize: '11.5px', color: '#6B7280', marginTop: '6px' }}>
              Zeroes the estimate, skips the notice cycle and advances the request. Your judgment, your name on
              it — this is not the configured de-minimis rule, which zeroes by threshold and still notifies.
            </div>
          </div>
        </div>
      </div>

      <ConfirmPopup open={dmOpen} onClose={function () { setDmOpen(false); }}
        title="De minimis — waive the fee and advance"
        actions={
          <>
            <button type="button" disabled={!!busy || !dmNote.trim()} onClick={deMinimisWaive}
              style={{ font: 'inherit', fontSize: '13px', fontWeight: 700, padding: '7px 16px', borderRadius: '6px', border: 'none',
                background: (busy || !dmNote.trim()) ? '#9CB4CC' : '#1F4E79', color: 'white', cursor: (busy || !dmNote.trim()) ? 'default' : 'pointer' }}>
              {busy === 'deminimis' ? 'Recording…' : 'Waive and advance'}
            </button>
            <button type="button" onClick={function () { setDmOpen(false); }}
              style={{ font: 'inherit', fontSize: '13px', fontWeight: 600, padding: '7px 14px', borderRadius: '6px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', cursor: 'pointer' }}>Cancel</button>
          </>
        }>
        {/* Nothing closes on a single click, and every one-act popup states what will be WRITTEN and what
            will be SENT (spec §4). What is sent here is nothing, and that is the point worth stating. */}
        <div style={{ fontSize: '13px', color: '#1A2230', lineHeight: 1.5 }}>
          <p style={{ margin: '0 0 7px' }}>This will:</p>
          <ul style={{ margin: '0 0 9px 18px', padding: 0 }}>
            <li>record a $0.00 estimate against your name, keeping the computed one beside it as evidence of what the fees would have been;</li>
            <li>send the requestor <b>nothing</b> — no estimate notice, no acceptance gate, no payment;</li>
            <li>close this estimate task and advance the request to record search.</li>
          </ul>
          <p style={{ margin: '0 0 7px', color: '#92400E' }}>
            This is your judgment that the amount is not worth putting a citizen through the notice cycle for —
            not the configured de-minimis rule. A reason is required.
          </p>
          <textarea value={dmNote} onChange={function (e) { setDmNote(e.target.value); }} rows={3}
            placeholder="Why this is de minimis (required)"
            style={{ width: '100%', font: 'inherit', fontSize: '13px', padding: '7px 9px', borderRadius: '6px', border: '1px solid #E5E7EB', boxSizing: 'border-box', resize: 'vertical' }} />
        </div>
      </ConfirmPopup>
      <p style={{ color: '#9CA3AF', fontSize: '12px', marginTop: '12px' }}>Sending the estimate to the requestor marks this task complete.</p>
    </div>
  );
}
