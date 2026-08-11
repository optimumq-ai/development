import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { G, ConfirmPopup } from '../components/primitives';
import PowerQueue from '../components/ui/PowerQueue';
import ReleaseReviewPackagePanels from '../components/ui/ReleaseReviewPackagePanels';

// PHASE 7 / BW8 — POWER MODE for release review (Draft 9 Frame B; SPEC §5, DECIDED 2026-08-11).
//
// Kevin's 7/29 direction, verbatim intent: "approve and go to the next item without leaving the
// screen — the approved record's data disappears, the next request's data populates in place."
// The first PowerQueue instance. The queue arrives in clock-aware order from the queue endpoint;
// this page adds the three acts and the return dialog, and renders the SAME package panels the
// single-task screen renders — an accelerator, never a different (or thinner) review.
export default function ReleaseReviewPowerModePage() {
  var nav = useNavigate();
  var [queue, setQueue] = useState(null);
  var [err, setErr] = useState('');
  var [returning, setReturning] = useState(null); // { item, resolve } while the R dialog is open
  var [note, setNote] = useState('');
  var [busy, setBusy] = useState(false);

  useEffect(function () {
    var alive = true;
    api.get('/tasks/release-review-queue')
      .then(function (r) { if (alive) setQueue(r.data.tasks || []); })
      .catch(function () { if (alive) setErr('Could not load the release-review queue.'); });
    return function () { alive = false; };
  }, []);

  function fetchItem(item) {
    return api.get('/tasks/' + item.id + '/release-package').then(function (r) { return r.data; });
  }

  var acts = [
    {
      key: 'A', label: 'Approve & send → next', tone: 'primary',
      // The approve route re-checks two-eyes and re-evaluates the conditions before firing; a 409
      // here surfaces in the shell's error line and the item STAYS — approving something that
      // cannot ship must never look like progress.
      disabled: function (pkg) { return pkg && pkg.twoEyes && pkg.twoEyes.blocked; },
      run: function (item) {
        return api.post('/tasks/' + item.id + '/release-review/approve').then(function () { return 'advance'; });
      }
    },
    {
      key: 'R', label: 'Return with note…', tone: 'quiet',
      // Opens the dialog and stays; the dialog's own commit advances. The note is REQUIRED — the
      // backend 422s without one, and this button is what makes the review real (Draft 9 §2).
      run: function (item) {
        return new Promise(function (resolve) { setNote(''); setReturning({ item: item, resolve: resolve }); });
      }
    }
  ];

  function commitReturn() {
    if (!returning || !note.trim() || busy) return;
    setBusy(true);
    api.post('/tasks/' + returning.item.id + '/release-review/return', { note: note.trim() })
      .then(function () { setBusy(false); returning.resolve('advance'); setReturning(null); })
      .catch(function (e) {
        setBusy(false);
        setErr((e.response && e.response.data && e.response.data.error) || 'The return failed — the item is unchanged.');
        returning.resolve('stay'); setReturning(null);
      });
  }
  if (err && !queue) return <div style={{ padding: 20, color: C.crit, fontSize: 13.5 }}>{err}</div>;
  if (!queue) return <div style={{ padding: 20, color: C.muted, fontSize: 13.5 }}>Loading the queue…</div>;

  return (
    <div style={{ maxWidth: 1060, margin: '0 auto', padding: '14px 4px' }}>
      <PowerQueue
        title="⚡ POWER MODE — Release Review"
        contextLine="one item at a time · nearest deadline first"
        items={queue}
        fetchItem={fetchItem}
        keysEnabled={!returning}
        renderItem={function (pkg) {
          return (
            <div>
              {pkg.twoEyes && pkg.twoEyes.blocked ? (
                <div style={{ background: C.amberTint, border: '1px solid ' + G.amberLine, color: G.amberInk, borderRadius: 6, padding: '8px 12px', fontSize: 12.5, marginBottom: 10 }}>
                  Two-eyes: {pkg.twoEyes.reason || 'you completed this item’s last flow task, so this review is not yours to approve.'} Skip it — it stays in the queue for another reviewer.
                </div>
              ) : null}
              <ReleaseReviewPackagePanels pkg={pkg} />
            </div>
          );
        }}
        acts={acts}
        onExit={function () { nav('/my-tasks'); }}
      />

      <ConfirmPopup open={!!returning} title={returning ? 'Return — do not release' : ''}
        onClose={function () { if (returning) { returning.resolve('stay'); setReturning(null); } }}
        actions={[
          <button key="go" type="button" disabled={!note.trim() || busy} onClick={commitReturn}
            style={{ font: 'inherit', fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 6,
              background: G.navy, color: '#fff', border: '1px solid ' + G.navy,
              cursor: note.trim() && !busy ? 'pointer' : 'not-allowed', opacity: note.trim() && !busy ? 1 : 0.55 }}>
            Return with this note
          </button>,
          <button key="back" type="button" onClick={function () { if (returning) { returning.resolve('stay'); setReturning(null); } }}
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
