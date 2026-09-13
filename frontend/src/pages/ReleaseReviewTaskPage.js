import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { G, ConfirmPopup } from '../components/primitives';
import ReleaseReviewPackagePanels from '../components/ui/ReleaseReviewPackagePanels';

// PHASE 7 / BW8 — the release-review task screen, the NORMAL one-at-a-time path (Draft 9 §1: "the
// task opens one-at-a-time from My Tasks like any other. Power mode is an accelerator, not a
// replacement."). Same package panels, same two acts, same audit shape as power mode — the two paths
// differ in navigation and in nothing else.
export default function ReleaseReviewTaskPage() {
  var params = useParams();
  var taskId = params.taskId;
  var nav = useNavigate();

  var [pkg, setPkg] = useState(null);
  var [err, setErr] = useState('');
  var [flash, setFlash] = useState(null);
  var [busy, setBusy] = useState(false);
  var [done, setDone] = useState(null);
  var [returning, setReturning] = useState(false);
  var [note, setNote] = useState('');

  useEffect(function () {
    var alive = true;
    api.get('/tasks/' + taskId + '/release-package')
      .then(function (r) {
        if (!alive) return;
        setPkg(r.data);
        api.post('/tasks/' + taskId + '/begin').catch(function () {});
      })
      .catch(function (e) {
        if (alive) setErr((e.response && e.response.data && e.response.data.error) || 'Could not load this review.');
      });
    return function () { alive = false; };
  }, [taskId]);

  function approve() {
    if (busy) return;
    setBusy(true); setFlash(null);
    api.post('/tasks/' + taskId + '/release-review/approve')
      .then(function (r) { setBusy(false); setDone(r.data); })
      .catch(function (e) {
        setBusy(false);
        setFlash((e.response && e.response.data && e.response.data.error) || 'The release could not fire — the review is unchanged.');
      });
  }

  function commitReturn() {
    if (!note.trim() || busy) return;
    setBusy(true);
    api.post('/tasks/' + taskId + '/release-review/return', { note: note.trim() })
      .then(function () { setBusy(false); setReturning(false); setDone({ returned: true }); })
      .catch(function (e) {
        setBusy(false); setReturning(false);
        setFlash((e.response && e.response.data && e.response.data.error) || 'The return failed — the review is unchanged.');
      });
  }

  if (err) return <div style={{ padding: 20, color: C.crit, fontSize: 13.5 }}>{err}</div>;
  if (!pkg) return <div style={{ padding: 20, color: C.muted, fontSize: 13.5 }}>Loading the package…</div>;

  var blocked = pkg.twoEyes && pkg.twoEyes.blocked;

  if (done) {
    return (
      <div style={{ maxWidth: 720, margin: '30px auto', background: C.surface, border: '1px solid ' + G.line, borderRadius: 8, padding: '20px 22px' }}>
        <div style={{ fontSize: 15.5, fontWeight: 800, color: G.navy, marginBottom: 8 }}>
          {done.returned ? 'Returned — the package does not ship.' : 'Released.'}
        </div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
          {done.returned
            ? 'Your note travels with the item; the pipeline re-arms when the fix lands and the conditions re-satisfy.'
            : 'The release event fired — Closed – Delivered, the notice, and the delivery stamp, recorded as your act' + (done.release && done.release.recordCount != null ? ' (' + done.release.recordCount + ' record(s))' : '') + '.'}
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
          <Link to="/my-tasks" style={{ fontSize: 13, fontWeight: 700, color: G.navy }}>← Back to My Tasks</Link>
          <Link to="/release-review-power" style={{ fontSize: 13, fontWeight: 700, color: G.navy }}>Continue in power mode →</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1060, margin: '0 auto', padding: '14px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 15.5, fontWeight: 800, color: G.navy }}>Release Review</span>
        <span style={{ fontSize: 12.5, color: C.muted }}>approve before this package ships — the substance is below, nothing hides behind a click</span>
        <Link to="/release-review-power" style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: G.navy }}>Continue in power mode →</Link>
      </div>

      {blocked ? (
        <div style={{ background: C.amberTint, border: '1px solid ' + G.amberLine, color: G.amberInk, borderRadius: 6, padding: '9px 13px', fontSize: 12.5, marginBottom: 10 }}>
          Two-eyes: {pkg.twoEyes.reason || 'you completed this item’s last flow task, so this review is not yours to approve.'} You can read everything; the approve act belongs to another reviewer.
        </div>
      ) : null}
      {flash ? <div style={{ background: C.critTint, border: '1px solid ' + C.crit, color: C.crit, borderRadius: 6, padding: '9px 13px', fontSize: 12.5, marginBottom: 10 }}>{flash}</div> : null}

      <ReleaseReviewPackagePanels pkg={pkg} />

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" disabled={busy || blocked} onClick={approve}
          style={{ font: 'inherit', fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 6,
            background: G.navy, color: 'var(--oq-fg-ffffff)', border: '1px solid ' + G.navy,
            cursor: busy || blocked ? 'not-allowed' : 'pointer', opacity: busy || blocked ? 0.55 : 1 }}>
          Approve & send
        </button>
        <button type="button" disabled={busy} onClick={function () { setNote(''); setReturning(true); }}
          style={{ font: 'inherit', fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 6,
            background: C.surface, color: C.ink, border: '1px solid ' + G.line, cursor: 'pointer' }}>
          Return with note…
        </button>
        <button type="button" onClick={function () { nav('/my-tasks'); }}
          style={{ font: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '8px 13px', borderRadius: 6, marginLeft: 'auto',
            background: C.surface, color: C.muted, border: '1px solid ' + G.line, cursor: 'pointer' }}>
          Back to My Tasks
        </button>
      </div>

      <ConfirmPopup open={returning} title="Return — do not release"
        onClose={function () { setReturning(false); }}
        actions={[
          <button key="go" type="button" disabled={!note.trim() || busy} onClick={commitReturn}
            style={{ font: 'inherit', fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 6,
              background: G.navy, color: 'var(--oq-fg-ffffff)', border: '1px solid ' + G.navy,
              cursor: note.trim() && !busy ? 'pointer' : 'not-allowed', opacity: note.trim() && !busy ? 1 : 0.55 }}>
            Return with this note
          </button>,
          <button key="back" type="button" onClick={function () { setReturning(false); }}
            style={{ font: 'inherit', fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 6,
              background: C.surface, color: C.ink, border: '1px solid ' + G.line, cursor: 'pointer' }}>
            Cancel — back to review
          </button>
        ]}>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 7, lineHeight: 1.5 }}>
          Sends the item back with your note; the release pipeline re-arms when the fix lands and the
          conditions re-satisfy. The requestor is not notified — nothing has been promised.
        </div>
        <textarea rows={3} value={note} autoFocus
          onChange={function (e) { setNote(e.target.value); }}
          placeholder="Say what has to change before this package ships."
          style={{ width: '100%', font: 'inherit', fontSize: 13, padding: '8px 10px', borderRadius: 6,
            border: '1px solid ' + G.line, boxSizing: 'border-box', resize: 'vertical' }} />
      </ConfirmPopup>
    </div>
  );
}
