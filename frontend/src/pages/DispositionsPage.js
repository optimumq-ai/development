import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { ParentStrip, DecidedByBadge, ConfirmPopup, GateRow, G } from '../components/primitives';

// THE DISPOSITION RECORD — PHASE 7 / BW5, Draft 8 rev 2 Frame C.
//
// Draft 8's screen became INFORMATIONAL. Dispositions are written where the evidence lives — a no-records
// close inside Record Search, a denial inside the deciding flow, Delivered by the release event — and are
// DISPLAYED here with who wrote them, where, and what evidence stands behind them.
//
// Reached from the request header; read-only for anyone who can see the request; NO TASK TYPE (nothing
// queues here). The only writes on the page are the two endings with no task to live in.
//
// THE PARENT IS DERIVED AND SAYS SO. §5.8: a parent derives Complete from its items and is never closed by
// hand, so this screen must not offer to close one — the strip states the derivation instead.

function Panel(props) {
  return (
    <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10, marginBottom: 16 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid ' + C.hair, fontSize: 12.5, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted }}>{props.title}</div>
      <div style={{ padding: 14 }}>{props.children}</div>
    </section>
  );
}

var BADGE_WORDS = { person: 'a person', statute: 'by statute', system: 'system · condition met', recorded: 'recorded only' };

export default function DispositionsPage() {
  var params = useParams();
  var requestId = params.id;

  var [rec, setRec] = useState(null);
  var [err, setErr] = useState('');
  var [flash, setFlash] = useState(null);
  var [busy, setBusy] = useState('');
  var [ending, setEnding] = useState(null);      // which manual-ending popup is open
  var [gate, setGate] = useState(null);
  var [note, setNote] = useState('');
  var [priorNo, setPriorNo] = useState('');
  var [priorDate, setPriorDate] = useState('');
  var [attested, setAttested] = useState(false);
  var [popErr, setPopErr] = useState('');

  function load() {
    return api.get('/dispositions/' + requestId)
      .then(function (r) { setRec(r.data); })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Could not load the dispositions.'); });
  }
  useEffect(function () { load(); }, [requestId]); // eslint-disable-line

  useEffect(function () {
    if (!ending) return;
    var h = setTimeout(function () {
      api.get('/dispositions/' + requestId + '/gate/' + ending +
        '?note=' + encodeURIComponent(note) +
        '&priorRequestNumber=' + encodeURIComponent(priorNo) +
        '&priorRequestDate=' + encodeURIComponent(priorDate) +
        '&matchAttested=' + (attested ? 'true' : 'false'))
        .then(function (r) { setGate(r.data); }).catch(function () {});
    }, 200);
    return function () { clearTimeout(h); };
  }, [ending, note, priorNo, priorDate, attested]); // eslint-disable-line

  function commit() {
    setBusy('close'); setPopErr('');
    api.post('/dispositions/' + requestId + '/close/' + ending, {
      note: note, priorRequestNumber: priorNo, priorRequestDate: priorDate, matchAttested: attested
    })
      .then(function (r) {
        setEnding(null);
        setFlash({ tone: 'ok', text: (r.data && r.data.label) + ' — closed, and the closure notice ' +
          (r.data && r.data.notice && r.data.notice.outcome === 'sent' ? 'was sent.'
            : (r.data && r.data.notice && r.data.notice.outcome === 'not_applicable'
              ? 'does not apply (no address on file).' : 'is still owed.')) });
        return load();
      })
      .catch(function (e) { setPopErr((e.response && e.response.data && e.response.data.error) || 'Could not close this item.'); })
      .then(function () { setBusy(''); });
  }

  if (err) return <div style={{ padding: 32, color: C.crit }}>{err}</div>;
  if (!rec) return <div style={{ padding: 32, color: C.muted }}>Loading…</div>;

  var rights = rec.rights || {};

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em',
        color: C.faint, marginBottom: 6 }}>Dispositions</div>
      <ParentStrip number={rec.parentNumber || rec.parentId}>
        <span style={{ fontSize: 12.5, color: C.muted }}>{rec.items.length} item(s)</span>
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: C.muted }}>
          Parent: <b style={{ color: C.ink }}>{rec.parentState.state}</b> — {rec.parentState.text}
        </span>
      </ParentStrip>

      {flash && (
        <div style={{ marginBottom: 12, fontSize: 12.5, borderRadius: 9, padding: '10px 12px', fontWeight: 600,
          background: C.greenTint, color: C.green, border: '1px solid ' + C.green }}>{flash.text}</div>
      )}

      <Panel title="Item dispositions — written elsewhere, displayed here">
        {rec.items.map(function (it) {
          return (
            <div key={it.id} style={{ paddingBottom: 11, marginBottom: 11, borderBottom: '1px solid ' + C.hair }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: G.navy }}>
                  {it.label || it.requestNumber}
                </span>
                <b style={{ fontSize: 13.5, color: it.closed ? C.ink : C.faint }}>
                  {it.closed ? it.endingLabel : 'Open'}
                </b>
                {it.decidedBy ? <DecidedByBadge by={it.decidedBy}>{BADGE_WORDS[it.decidedBy]}</DecidedByBadge> : null}
                {it.sweep ? (
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
                    borderRadius: 3, padding: '2px 7px', background: '#F2F6F9', color: G.navy,
                    border: '1px solid ' + G.line }}>Sweep · per attested config</span>
                ) : null}
              </div>
              {it.openText ? (
                <div style={{ fontSize: 12.5, color: C.faint, marginTop: 3 }}>{it.openText}</div>
              ) : (
                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
                  {it.closedBy ? <>Closed by <b style={{ color: C.ink }}>{it.closedBy}</b> </> : null}
                  {it.closedAt ? <>on {it.closedAt} </> : null}
                  {it.approval && it.approval.status === 'approved'
                    ? <>· approved by <b style={{ color: C.ink }}>{it.approval.decidedByName}</b> </> : null}
                  {it.approval && it.approval.status === 'pending'
                    ? <span style={{ color: C.amber, fontWeight: 700 }}>· Close pending approval (requested by {it.approval.requestedByName}) </span> : null}
                  {it.deliveredAt ? <>· delivered {it.deliveredAt}{it.installmentNo > 1 ? ' (installment ' + it.installmentNo + ')' : ''} </> : null}
                  <br />
                  {it.evidence ? <span style={{ color: C.faint }}>Evidence: {it.evidence}</span> : null}
                  {it.notice ? (
                    <div style={{ marginTop: 3, color: it.notice.outcome === 'failed' ? C.crit : C.muted }}>
                      Notice: {it.notice.text}
                    </div>
                  ) : null}
                  {it.reopenCount > 0 ? (
                    <div style={{ marginTop: 3, color: C.amber }}>
                      Reopened {it.reopenCount} time(s) — clocks were never reset; the original history stands.
                    </div>
                  ) : null}
                  {(it.bypasses || []).map(function (b) {
                    return (
                      <div key={b.id} style={{ marginTop: 3, fontSize: 12, color: C.faint }}>
                        {b.type} — auto-completed, not skipped ({b.bypass_kind}): {b.bypass_basis}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </Panel>

      <Panel title="Close manually — only the endings with no task to live in">
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 9, lineHeight: 1.5 }}>
          Everything else closes where it happens; these two have no machinery of their own, so the buttons
          live here — same popup pattern, same gates.
        </div>
        <button type="button" disabled={!rights.withdrawn || !rights.withdrawn.allowed}
          title={rights.withdrawn && rights.withdrawn.reason ? rights.withdrawn.reason : ''}
          onClick={function () { setEnding('withdrawn'); setGate(null); }}
          style={{ cursor: (rights.withdrawn && rights.withdrawn.allowed) ? 'pointer' : 'not-allowed',
            background: C.surface, color: (rights.withdrawn && rights.withdrawn.allowed) ? C.ink : C.faint,
            border: '1px solid ' + C.hairStrong, borderRadius: 8, padding: '8px 12px', fontSize: 13,
            fontWeight: 650, marginRight: 8 }}>
          Withdrawn by requestor…
        </button>
        <button type="button" disabled={!rights.previously_furnished || !rights.previously_furnished.allowed}
          title={rights.previously_furnished && rights.previously_furnished.reason ? rights.previously_furnished.reason : ''}
          onClick={function () { setEnding('previously_furnished'); setGate(null); }}
          style={{ cursor: (rights.previously_furnished && rights.previously_furnished.allowed) ? 'pointer' : 'not-allowed',
            background: C.surface, color: (rights.previously_furnished && rights.previously_furnished.allowed) ? C.ink : C.faint,
            border: '1px solid ' + C.hairStrong, borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 650 }}>
          Previously furnished…
        </button>
        <div style={{ fontSize: 12, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
          Withdrawn requires the requester’s communication attached — a choice, not silence (that distinction
          from No-response is why both exist). Previously furnished certifies prior request #, date and match —
          an ending, <b>not a denial</b>. Rights: Withdrawn — ORO Associate+ <b>and</b> the item’s current
          task-holder; Previously furnished — ORO Associate+ only.
        </div>
      </Panel>

      {rec.hold && rec.hold.known && (
        <Panel title="Release hold">
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
            {rec.hold.held
              ? <>A hold stands: <b style={{ color: C.ink }}>{rec.hold.note}</b> — {rec.hold.by}, {rec.hold.at}.</>
              : 'No hold stands on this record.'}
            {rec.hold.blockedReason ? (
              <div style={{ marginTop: 7, borderLeft: '4px solid ' + G.statute, background: G.statuteBg,
                padding: '8px 10px', borderRadius: 4, color: G.statute }}>
                <b>Hold unavailable</b> — {rec.hold.blockedReason} <i>{rec.hold.citation}</i>
              </div>
            ) : null}
            <div style={{ marginTop: 7, fontSize: 12, color: C.faint }}>{rec.hold.neverAPaymentHold}</div>
          </div>
        </Panel>
      )}

      <div style={{ fontSize: 12.5 }}>
        <Link to={'/requests/' + (rec.parentId || requestId)} style={{ color: C.blue }}>← Back to the request</Link>
      </div>

      <ConfirmPopup open={!!ending} onClose={function () { setEnding(null); }}
        title={ending === 'previously_furnished'
          ? 'Previously furnished — certify and close this item?'
          : 'Withdrawn by the requester — close this item?'}
        actions={gate ? (
          <>
            <button type="button" disabled={busy === 'close' || (gate.gate && gate.gate.blocked)}
              onClick={commit}
              style={{ cursor: (gate.gate && gate.gate.blocked) ? 'not-allowed' : 'pointer',
                background: (gate.gate && gate.gate.blocked) ? C.surface2 : C.blue,
                color: (gate.gate && gate.gate.blocked) ? C.faint : '#fff',
                border: '1px solid ' + ((gate.gate && gate.gate.blocked) ? C.hair : C.blue),
                borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 650 }}>
              {busy === 'close' ? 'Closing…' : 'Submit — close & notify'}
            </button>
            <button type="button" onClick={function () { setEnding(null); }}
              style={{ cursor: 'pointer', background: C.surface, color: C.muted, border: '1px solid ' + C.hairStrong,
                borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 650 }}>Cancel</button>
          </>
        ) : null}>
        {!gate ? <div style={{ fontSize: 12.5, color: C.muted }}>Checking the evidence…</div> : (
          <>
            {(gate.gate.rows || []).map(function (row) {
              return <GateRow key={row.code} ok={row.ok}>{row.text}</GateRow>;
            })}
            {ending === 'previously_furnished' && (
              <div style={{ marginTop: 8 }}>
                <input value={priorNo} onChange={function (e) { setPriorNo(e.target.value); }}
                  placeholder="Prior request number (required)"
                  style={{ width: '100%', font: 'inherit', fontSize: 13, padding: '6px 8px', marginBottom: 6,
                    border: '1px solid ' + C.hairStrong, borderRadius: 5 }} />
                <input value={priorDate} onChange={function (e) { setPriorDate(e.target.value); }}
                  placeholder="Date furnished (required)"
                  style={{ width: '100%', font: 'inherit', fontSize: 13, padding: '6px 8px', marginBottom: 6,
                    border: '1px solid ' + C.hairStrong, borderRadius: 5 }} />
                <label style={{ fontSize: 12.5, color: C.ink, display: 'block' }}>
                  <input type="checkbox" checked={attested} onChange={function (e) { setAttested(e.target.checked); }} />
                  {' '}I certify these are the SAME records previously furnished (Tex. Gov’t Code § 552.232).
                </label>
              </div>
            )}
            <textarea rows={2} value={note} onChange={function (e) { setNote(e.target.value); }}
              placeholder="Closure note (required)"
              style={{ width: '100%', font: 'inherit', fontSize: 13, padding: '6px 8px', marginTop: 8,
                border: '1px solid ' + C.hairStrong, borderRadius: 5 }} />
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
              Submitting writes the disposition and sends the closure notice — <b>one act</b>, never a silent end.
            </div>
            {popErr ? (
              <div style={{ marginTop: 8, fontSize: 12.5, color: C.crit, background: C.critTint,
                border: '1px solid ' + C.crit, borderRadius: 6, padding: '7px 9px' }}>{popErr}</div>
            ) : null}
          </>
        )}
      </ConfirmPopup>
    </div>
  );
}
