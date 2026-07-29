import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { useWorkTimer, WorkTimerBadge, WorkTimerCompleteModal, useTimeCaptureMode } from '../components/ui/WorkTimer';
import { SubmittedDescription, PortalResultsBar, ConfirmPopup, GateRow, DecidedByBadge } from '../components/primitives';

// RECORD-SEARCH TASK SCREEN — SPEC_record_search_task_screen.md
//
// Slice 1: the CONTEXT zone. The searcher opens this and the first thing they must understand is what the
// PORTAL ALREADY DID on their behalf — which, until R9 shipped, the system could not tell them.
//
//   - the "Self Service Portal Search Results" bar (spec §2.3, Kevin's mark-up): Selected (n) / Not Selected (n)
//   - the per-description INTENT block (spec §2, DESIGN_split_canvas_intake §R9.4) — the instruction the
//     requestor actually gave, which a flat pile of selections could never express
//   - queries the portal already ran, so the searcher does not repeat one the requestor already rejected
//
// The search surface (§4) and the actions/resolution rail (§5) are the NEXT slices.

// Palette = the PORTAL token set (Kevin, 2026-07-14): gray ground, lighter gray boxes, white fields,
// #1E6091 as the one button colour. See SPEC §9. Moved to lib/theme.js 2026-07-19 so a second v2 staff
// screen cannot obey §9 only by copying it — same values, no rendered change. Import it; do not redefine.

// The four intents, and what each one MEANS to the person now doing the searching. This table is the whole
// point of R9 — see DESIGN_split_canvas_intake §R9.4.
var INTENT = {
  complete: {
    label: 'Requestor: this is everything',
    tone: 'neutral',
    hint: 'The selection answers the ask. Nothing further was requested for this description.'
  },
  search_more: {
    label: 'Requestor asked us to search for MORE',
    tone: 'amber',
    hint: 'Fulfilling from the selection alone CLOSES a request the requestor considers OPEN.'
  },
  no_match_search: {
    label: 'No match in the portal results — team search required',
    tone: 'amber',
    hint: 'The portal searched and found nothing they wanted. This is an instruction to search, NOT abandonment.'
  },
  not_searchable: {
    label: 'Not portal-searchable — team must pull',
    tone: 'blue',
    hint: 'Email / audio-video / photos / data exports / paper. The portal NEVER searched this one.'
  }
};

function toneStyle(tone) {
  if (tone === 'amber') return { bg: C.amberTint, fg: C.amber, bd: C.amber };
  if (tone === 'blue') return { bg: C.blueTint, fg: C.blueInk, bd: C.blue };
  return { bg: C.surface2, fg: C.muted, bd: C.hairStrong };
}

function daysUntil(d) {
  if (!d) return null;
  var ms = new Date(d + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime();
  return Math.round(ms / 86400000);
}

export default function RecordSearchTaskPage() {
  var params = useParams();
  var taskId = params.taskId;

  var [task, setTask] = useState(null);
  var [intake, setIntake] = useState(null);
  var [policy, setPolicy] = useState(null);   // the jurisdiction's clarification rules — drives the rail
  var [trail, setTrail] = useState([]);
  var [err, setErr] = useState('');
  var [view, setView] = useState('selected'); // which side of the bar is open
  var [defect, setDefect] = useState(null);   // 'vague' | 'overly_broad' — which marker is open
  var [busy, setBusy] = useState('');
  var [flash, setFlash] = useState(null);

  var [q, setQ] = useState('');
  var [results, setResults] = useState(null);
  var [searching, setSearching] = useState(false);
  var [attached, setAttached] = useState([]);
  var [resolved, setResolved] = useState(null);
  var timer = useWorkTimer(taskId);
  var tcm = useTimeCaptureMode('search');   // city's per-UI capture mode (Slice E): off|discretion|always
  var [laborModal, setLaborModal] = useState(null);
  var [notes, setNotes] = useState({});       // per-description: what the searcher actually searched
  // BW5 — the close popup's state. `closeGate` is the SERVER's gate, never a client-side guess.
  var [closeEnding, setCloseEnding] = useState(null);
  var [closeGate, setCloseGate] = useState(null);
  var [closeNote, setCloseNote] = useState('');
  var [custodianName, setCustodianName] = useState('');
  var [custodianContact, setCustodianContact] = useState('');
  var [referralNote, setReferralNote] = useState('');
  var [closeErr, setCloseErr] = useState('');
  var [pendingClose, setPendingClose] = useState(null);

  function loadTrail(rid) {
    return api.get('/requests/' + rid).then(function (r) {
      setTrail((r.data.history || []).slice().reverse());
    }).catch(function () {});
  }
  function loadAttached(rid) {
    return api.get('/files/' + rid).then(function (r) { setAttached(r.data.files || []); }).catch(function () {});
  }
  function loadIntake(rid) {
    return api.get('/requests/' + rid + '/search-intents')
      .then(function (x) { setIntake(x.data); }).catch(function () {});
  }

  useEffect(function () {
    var alive = true;
    api.get('/tasks/' + taskId)
      .then(function (r) {
        if (!alive) return;
        setTask(r.data.task);
        api.post('/tasks/' + taskId + '/begin').catch(function () {}); // begin-work: owner-gated server-side (Slice A)
        var rid = r.data.task.request_id;
        api.get('/requests/' + rid + '/search-intents')
          .then(function (x) { if (alive) setIntake(x.data); }).catch(function () {});
        api.get('/clarification-policy')
          .then(function (x) { if (alive) setPolicy(x.data.policy); }).catch(function () {});
        loadTrail(rid);
        loadAttached(rid);
      })
      .catch(function () { if (alive) setErr('Could not load this task.'); });
    return function () { alive = false; };
  }, [taskId]);

  // --- actions -------------------------------------------------------------------------------------
  function effort(action, notes) {
    setBusy(action);
    return api.post('/requests/' + task.request_id + '/effort', { action: action, notes: notes })
      .then(function () { setFlash({ tone: 'ok', text: notes }); return loadTrail(task.request_id); })
      .catch(function () { setFlash({ tone: 'crit', text: 'That did not go through.' }); })
      .then(function () { setBusy(''); });
  }

  // Marking a defect is NOT a note — it sends the clarification and lets the jurisdiction's own rules decide
  // what happens to the clock. The reason travels ('vague' | 'overly_broad') because the two are different
  // legal defects; see clarificationAction.
  function markDefect(reason) {
    setBusy(reason);
    return api.post('/requests/' + task.request_id + '/clarification', { reason: reason })
      .then(function (r) {
        var d = r.data;
        setFlash({
          tone: d.conferenceRequired ? 'crit' : 'ok',
          text: d.conferenceRequired
            ? 'Conference offered. THE CLOCK DID NOT STOP — missing the deadline forfeits the burden defense.'
            : ('Clarification sent' + (d.clockStillRunning ? ' — the clock keeps running (' + d.effect + ').'
                                                           : ' — the response clock was tolled.'))
        });
        setDefect(null);
        return loadTrail(task.request_id);
      })
      .catch(function (e) {
        var msg = (e.response && e.response.data && e.response.data.error) || 'That did not go through.';
        setFlash({ tone: 'crit', text: msg });
      })
      .then(function () { setBusy(''); });
  }

  // --- the search surface (§4a) ---------------------------------------------------------------------
  function runSearch() {
    var query = q.trim();
    if (!query || searching) return;
    setSearching(true); setResults(null);
    api.post('/files/search/records', { query: query })
      .then(function (r) { setResults(r.data.results || []); })
      .catch(function () { setFlash({ tone: 'crit', text: 'Search failed.' }); })
      .then(function () { setSearching(false); });
  }

  function attach(rec) {
    setBusy(rec.id);
    api.post('/files/attach/' + task.request_id, { record: rec, includeInResponse: true })
      .then(function (r) {
        setFlash({ tone: 'ok', text: 'Included in Response: ' + r.data.originalName });
        return Promise.all([loadAttached(task.request_id), loadTrail(task.request_id)]);
      })
      .catch(function (e) {
        var d = e.response && e.response.data;
        // A record with no retrievable file cannot be attached. Say WHY rather than failing silently —
        // the connectors that would pull it are stubs, and the searcher needs to know that, not guess.
        setFlash({ tone: 'crit', text: (d && d.error) || 'Could not attach that record.' });
      })
      .then(function () { setBusy(''); });
  }

  // --- answering a description (§5d — the UN-GATE) ---------------------------------------------------
  // The searcher's answer to what the requestor asked for. Until every duty-carrying description has one,
  // the backend refuses `found` — otherwise the requestor's OWN portal picks would be enough to advance a
  // request they explicitly asked us to search further, and it would be fulfilled and closed as complete.
  function answerIntent(intentId, outcome) {
    setBusy(intentId);
    return api.post('/requests/' + task.request_id + '/search-intents/' + intentId + '/resolve',
      { outcome: outcome, note: (notes[intentId] || '').trim() })
      .then(function (r) {
        setFlash({ tone: 'ok', text: outcome === 'nothing_further'
          ? 'Recorded: searched, nothing further responsive.'
          : 'Recorded: the attached records answer this description.' });
        setNotes(function (n) { var c = Object.assign({}, n); delete c[intentId]; return c; });
        return Promise.all([loadIntake(task.request_id), loadTrail(task.request_id)]);
      })
      .catch(function (e) {
        var d = e.response && e.response.data;
        setFlash({ tone: 'crit', text: (d && d.error) || 'Could not record that.' });
      })
      .then(function () { setBusy(''); });
  }

  // --- resolution (§5d) -----------------------------------------------------------------------------
  // Completing the search first logs the actual labor (Slice D): flush the timer, then the popup finalizes
  // (accept or adjust-with-reason) and runs resolve() on confirm.
  async function requestComplete(outcome) {
    timer.flush();
    // off: no log window — finalize with no billable time and resolve straight through. else: the log window.
    if (tcm.mode === 'off') { await timer.skip(); timer.markFinalized(); await resolve(outcome); return; }
    setLaborModal({ outcome: outcome });
  }
  function resolve(outcome) {
    setBusy(outcome);
    api.post('/tasks/' + taskId + '/resolve', { outcome: outcome })
      .then(function (r) {
        setResolved(r.data);
        setFlash({ tone: 'ok', text: outcome === 'found'
          ? ('Search complete — ' + r.data.included + ' record(s) handed to Exemption Review.')
          : ('Closed — no responsive records. Diligence evidenced by ' + r.data.effortEntries + ' logged action(s).') });
        return loadTrail(task.request_id);
      })
      .catch(function (e) {
        var d = e.response && e.response.data;
        setFlash({ tone: 'crit', text: (d && d.error) || 'Could not resolve the task.' });
      })
      .then(function () { setBusy(''); });
  }

  // --- PHASE 7 / BW5 — CLOSING FROM THIS TASK (Draft 8 rev 2, Frames A + A′) -------------------------
  //
  // Kevin's 7/28 direction: the item ends where the evidence lives, from a confirm popup that STATES WHAT
  // WILL BE WRITTEN AND SENT. Nothing closes on a single click, and the popup never draws its own gate —
  // it renders `GET /tasks/:id/close-gate`, the same evaluator `POST /close` refuses on, so the screen
  // cannot permit what the endpoint will reject.
  function openClose(ending) {
    setCloseEnding(ending);
    setCloseGate(null);
    setCloseErr('');
  }
  function refreshGate(ending, fields) {
    var q = '/tasks/' + taskId + '/close-gate?ending=' + encodeURIComponent(ending) +
      '&note=' + encodeURIComponent(fields.note || '') +
      '&custodianName=' + encodeURIComponent(fields.custodianName || '') +
      '&custodianContact=' + encodeURIComponent(fields.custodianContact || '') +
      '&referralNote=' + encodeURIComponent(fields.referralNote || '');
    return api.get(q).then(function (r) { setCloseGate(r.data); }).catch(function () {});
  }
  function commitClose(mode) {
    setBusy('close');
    setCloseErr('');
    api.post('/tasks/' + taskId + '/close', {
      ending: closeEnding, mode: mode, note: closeNote,
      custodianName: custodianName, custodianContact: custodianContact, referralNote: referralNote
    })
      .then(function (r) {
        setCloseEnding(null);
        if (r.data && r.data.pending) {
          setPendingClose(r.data);
          setFlash({ tone: 'ok', text: 'Close pending approval — ' + r.data.label +
            '. The disposition and its notice fire when the supervisor approves; the close is recorded as their act.' });
        } else {
          setResolved({ outcome: 'closed', label: r.data && r.data.label });
          setFlash({ tone: 'ok', text: (r.data && r.data.label) + ' — closed, and the closure notice ' +
            (r.data && r.data.notice && r.data.notice.outcome === 'sent' ? 'was sent to the requester.'
              : (r.data && r.data.notice && r.data.notice.outcome === 'not_applicable'
                ? 'does not apply (no address on file).' : 'is still owed — delivery failed.')) });
        }
        return loadTrail(task.request_id);
      })
      .catch(function (e) {
        var d = e.response && e.response.data;
        setCloseErr((d && d.error) || 'Could not close this item.');
        if (d && d.gate) setCloseGate(Object.assign({}, closeGate, { gate: d.gate }));
      })
      .then(function () { setBusy(''); });
  }

  // The gate ticks LIVE as the closer types — the popup's checklist is the server's answer to the payload
  // as it stands, not a hopeful client-side mirror of it.
  useEffect(function () {
    if (!closeEnding) return;
    var h = setTimeout(function () {
      refreshGate(closeEnding, { note: closeNote, custodianName: custodianName,
        custodianContact: custodianContact, referralNote: referralNote });
    }, 200);
    return function () { clearTimeout(h); };
  }, [closeEnding, closeNote, custodianName, custodianContact, referralNote]); // eslint-disable-line

  if (err) return <div style={{ padding: 32, color: C.crit }}>{err}</div>;
  if (!task) return <div style={{ padding: 32, color: C.muted }}>Loading…</div>;

  var totals = (intake && intake.totals) || { selected: 0, notSelected: 0, shown: 0 };
  var groups = (intake && intake.groups) || [];
  var ungrouped = (intake && intake.ungroupedSelected) || [];
  var dLeft = daysUntil(task.deadline_date);
  var overdue = dLeft !== null && dLeft < 0;

  // Every record shown-and-passed-over, flattened. The requestor never sees this and never will — it exists
  // so the searcher does not re-surface something the requestor already looked at and declined.
  var passedOver = groups.reduce(function (a, g) { return a.concat(g.notSelected || []); }, []);
  var selectedAll = groups.reduce(function (a, g) { return a.concat(g.selected || []); }, []).concat(ungrouped);

  // Bar() moved to components/primitives PortalResultsBar (BW1) — same pixels, now importable.

  function Rec(props) {
    var r = props.r, dim = props.dim;
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: C.surface,
        border: '1px solid ' + C.hair, borderRadius: 8, padding: '9px 11px', marginTop: 6, opacity: dim ? 0.72 : 1 }}>
        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px',
          background: dim ? C.surface2 : C.greenTint, color: dim ? C.faint : C.green }}>
          {dim ? 'Shown' : 'Selected'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink, textDecoration: dim ? 'line-through' : 'none' }}>
            {r.title || r.record_id}
          </div>
          <div style={{ fontSize: 12, color: C.faint }}>
            {[r.source_system, dim && r.shown_in_query ? 'shown for “' + r.shown_in_query + '”' : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        {dim && <span style={{ fontSize: 11, fontWeight: 700, color: C.faint }}>Excluded</span>}
      </div>
    );
  }

  // The conference duty is the JURISDICTION'S, not the word's. If this city does not impose it, marking a
  // request Overly Broad records the defect and owes no conference — and the screen must not pretend otherwise.
  var duty = policy && policy.clarification_duty;
  var effect = policy && policy.clarification_clock_effect;
  var conferenceOwed = duty === 'required_before_burden_denial';
  var includedCount = attached.filter(function (f) { return f.responsive; }).length;

  // The descriptions the requestor asked us to SEARCH and the searcher has not answered yet. This is the
  // gate, mirrored client-side so the button can refuse before the round trip — but the backend is the one
  // that actually enforces it (routes/tasks.js, 422 UNRESOLVED_SEARCH_INTENT).
  var openIntents = groups.filter(function (g) { return g.open; });
  var clockStops = effect === 'toll_pause_resume' || effect === 'toll_and_restart'
                || effect === 'start_gate' || effect === 'operational_hold';

  // The stacked defect-marker buttons in the description box (global layout, spec §2.2).
  function defBtn(on) {
    return { cursor: busy ? 'not-allowed' : 'pointer', fontSize: 12.5, fontWeight: 650, textAlign: 'left',
      background: on ? C.blueTint : C.surface, color: on ? C.blue : C.ink,
      border: '1px solid ' + (on ? C.blue : C.hairStrong), borderRadius: 6, padding: '6px 10px' };
  }

  function Act(props) {
    return (
      <button type="button" disabled={!!busy} onClick={props.onClick}
        style={{ display: 'block', width: '100%', textAlign: 'left', cursor: busy ? 'not-allowed' : 'pointer',
          background: props.on ? C.blueTint : C.surface, border: '1px solid ' + (props.on ? C.blue : C.hair),
          borderRadius: 9, padding: '10px 12px', marginBottom: 8, opacity: busy && busy !== props.k ? 0.55 : 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650, color: C.ink }}>{props.title}</div>
        <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{props.sub}</div>
      </button>
    );
  }

  return (
    <div style={{ background: C.ground, minHeight: '100%', padding: 20, color: C.ink }}>
      <div style={{ maxWidth: 1360, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 16, alignItems: 'start' }}>
       <div style={{ minWidth: 0 }}>

        <Link to="/my-tasks" style={{ fontSize: 13, color: C.blue, textDecoration: 'none', fontWeight: 600 }}>‹ My Tasks</Link>

        {/* ---------------- ZONE 1 — CONTEXT ---------------- */}
        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10, marginTop: 12 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + C.hair, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: C.mono, fontSize: 19, fontWeight: 700, color: C.blue }}>{task.request_number}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px', background: C.blueTint, color: C.blueInk }}>
              Record Search
            </span>
            {task.record_type_name && (
              <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px', background: C.amberTint, color: C.amber }}>
                {task.record_type_name}
              </span>
            )}
            {resolved || tcm.mode === 'off' ? null : <WorkTimerBadge timer={timer} />}
            <span style={{ marginLeft: 'auto', fontSize: 13, color: overdue ? C.crit : C.muted, fontWeight: overdue ? 700 : 400 }}>
              {task.deadline_date
                ? <><b>Statutory due</b> {task.deadline_date}{dLeft !== null ? ' · ' + (overdue ? Math.abs(dLeft) + ' days OVERDUE' : dLeft + ' days') : ''}</>
                : 'No deadline on file'}
            </span>
          </div>

          <div style={{ padding: 18 }}>
            {/* Global record-item layout (SPEC_processing_ui.md §2, Kevin 7/28): the verbatim text
                first, titled; the two defect markers boxed to its LEFT. Marking machinery unchanged
                (markDefect) — only where the triggers live moved. */}
            <SubmittedDescription actions={
              <>
                <button type="button" disabled={!!busy}
                  onClick={function () { setDefect(defect === 'vague' ? null : 'vague'); }}
                  style={defBtn(defect === 'vague')}>Mark Vague</button>
                <button type="button" disabled={!!busy}
                  onClick={function () { setDefect(defect === 'overly_broad' ? null : 'overly_broad'); }}
                  style={defBtn(defect === 'overly_broad')}>Mark Overly Broad</button>
              </>
            }>{task.request_description}</SubmittedDescription>

            {policy && !policy.enabled && defect && (
              <div style={{ fontSize: 11.5, color: C.faint, margin: '-6px 0 8px' }}>
                The jurisdiction's clarification policy is off or un-attested — marking records the
                effort trail but changes no clock.
              </div>
            )}
            {defect === 'vague' && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.muted, background: C.surface2,
                border: '1px solid ' + C.hair, borderRadius: 8, padding: '10px 12px', margin: '0 0 12px' }}>
                Sends a clarification request. This jurisdiction’s clock rule is <code style={{ fontFamily: C.mono }}>{effect || '—'}</code>
                {clockStops ? ' — the response clock will PAUSE.' : ' — the response clock KEEPS RUNNING.'}
                <button type="button" disabled={!!busy} onClick={function () { markDefect('vague'); }}
                  style={{ marginTop: 9, display: 'block', cursor: 'pointer', background: C.blue, color: '#fff',
                    border: '1px solid ' + C.blue, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 650 }}>
                  {busy === 'vague' ? 'Sending…' : 'Send clarification request'}
                </button>
              </div>
            )}
            {defect === 'overly_broad' && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, borderRadius: 8, padding: '10px 12px', margin: '0 0 12px',
                background: conferenceOwed ? C.critTint : C.surface2,
                border: '1px solid ' + (conferenceOwed ? C.crit : C.hair), color: C.ink }}>
                {conferenceOwed ? (
                  <>
                    <b>This jurisdiction requires a conference.</b> Before this request can be denied as unduly
                    burdensome, the agency <b>shall</b> offer the requestor an opportunity to confer and reduce it to
                    manageable proportions.
                    <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid ' + C.crit }}>
                      <span style={{ display: 'block', fontWeight: 700, color: C.crit, marginBottom: 3 }}>
                        ⚠ The clock does not stop for the conference.
                      </span>
                      Failing to respond on time means the request <b>may not be treated as unduly burdensome at all</b>.
                      Waiting silently <b>forfeits the burden defense</b>.
                      {task.deadline_date && (
                        <span style={{ display: 'block', marginTop: 7, fontFamily: C.mono, fontSize: 12,
                          color: C.crit, fontWeight: 700 }}>
                          Response due {task.deadline_date}{dLeft !== null ? ' · ' + (overdue ? Math.abs(dLeft) + ' days OVERDUE' : dLeft + ' days left') : ''}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    Records the request as <b>overly broad</b> and sends a clarification. <b>This jurisdiction imposes no
                    conference duty</b> (<code style={{ fontFamily: C.mono }}>duty={duty || 'none'}</code>), so conferring
                    is discretionary here.
                  </>
                )}
                <button type="button" disabled={!!busy} onClick={function () { markDefect('overly_broad'); }}
                  style={{ marginTop: 9, display: 'block', cursor: 'pointer', color: '#fff',
                    background: conferenceOwed ? C.crit : C.blue,
                    border: '1px solid ' + (conferenceOwed ? C.crit : C.blue),
                    borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 650 }}>
                  {busy === 'overly_broad' ? 'Sending…' : (conferenceOwed ? 'Offer the conference' : 'Send clarification request')}
                </button>
              </div>
            )}

            <div style={{ fontSize: 13, color: C.faint, marginBottom: 16 }}>
              <b style={{ color: C.muted }}>Requestor</b> {task.requestor_name}
              {task.requestor_email ? ' · ' + task.requestor_email : ''}
              {task.team_name ? <> &nbsp;·&nbsp; <b style={{ color: C.muted }}>Team</b> {task.team_name}</> : null}
              {task.delivery_method ? <> &nbsp;·&nbsp; <b style={{ color: C.muted }}>Delivery</b> {task.delivery_method}</> : null}
            </div>

            {/* --- the bar (spec §2.3) --- */}
            <PortalResultsBar totals={totals} view={view} onView={setView} />

            {/* --- what the portal already did, per description (R9) --- */}
            {view === 'selected' ? (
              <div style={{ marginTop: 12 }}>
                {groups.length === 0 && ungrouped.length === 0 && (
                  <div style={{ fontSize: 13, color: C.faint, padding: '10px 0' }}>
                    The portal did not search for this request, or it predates the intake-provenance change.
                    Nothing was carried forward.
                  </div>
                )}
                {groups.map(function (g) {
                  var meta = INTENT[g.intent] || INTENT.no_match_search;
                  var t = toneStyle(meta.tone);
                  return (
                    <div key={g.id} style={{ border: '1px solid ' + C.hair, borderRadius: 9, padding: 12, marginTop: 10, background: C.surface2 }}>
                      <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 6 }}>“{g.description}”</div>
                      <div style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, borderRadius: 999,
                        padding: '3px 10px', background: t.bg, color: t.fg, border: '1px solid ' + t.bd }}>
                        {meta.label}
                      </div>
                      <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>{meta.hint}</div>

                      {g.queriesTried && g.queriesTried.length > 0 && (
                        <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>
                          <b style={{ color: C.muted }}>The portal already ran</b> — don’t repeat these:{' '}
                          {g.queriesTried.map(function (q, i) {
                            return (
                              <span key={i} style={{ display: 'inline-block', background: C.surface, border: '1px solid ' + C.hair,
                                borderRadius: 999, padding: '1px 8px', margin: '2px 4px 0 0', fontFamily: C.mono, fontSize: 11.5 }}>
                                {q}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {(g.selected || []).map(function (r) { return <Rec key={r.id} r={r} />; })}
                      {(g.selected || []).length === 0 && (
                        <div style={{ fontSize: 12.5, color: C.faint, marginTop: 8, fontStyle: 'italic' }}>
                          Nothing selected for this description.
                        </div>
                      )}

                      {/* THE UN-GATE (§5d). A description the requestor asked us to search stays OPEN until the
                          searcher answers it. Answering is what releases the Found button — nothing else does. */}
                      {g.searcherOutcome ? (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + C.hair,
                          fontSize: 12.5, color: C.green, lineHeight: 1.5 }}>
                          <b>✓ {g.searcherOutcome === 'nothing_further'
                            ? 'Searched — nothing further responsive.'
                            : 'Searched — the attached records answer this.'}</b>
                          {g.resolutionNote && <span style={{ color: C.muted }}> — “{g.resolutionNote}”</span>}
                          <span style={{ color: C.faint }}> ({g.resolvedBy})</span>
                        </div>
                      ) : g.open ? (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + C.hair }}>
                          <div style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 6 }}>
                            Your answer to this description
                          </div>
                          <input
                            value={notes[g.id] || ''}
                            onChange={function (e) {
                              var v = e.target.value;
                              setNotes(function (n) { var c = Object.assign({}, n); c[g.id] = v; return c; });
                            }}
                            placeholder="What did you search? (systems, date ranges, terms)"
                            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13,
                              borderRadius: 8, border: '1px solid ' + C.hairStrong, background: C.field, marginBottom: 8 }} />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" disabled={!!busy}
                              onClick={function () { answerIntent(g.id, 'records_added'); }}
                              style={{ flex: 1, cursor: busy ? 'not-allowed' : 'pointer', background: C.surface,
                                color: C.ink, border: '1px solid ' + C.hairStrong, borderRadius: 8,
                                padding: '8px 10px', fontSize: 12.5, fontWeight: 650 }}>
                              {busy === g.id ? '…' : 'The attached records answer this'}
                            </button>
                            <button type="button" disabled={!!busy}
                              onClick={function () { answerIntent(g.id, 'nothing_further'); }}
                              style={{ flex: 1, cursor: busy ? 'not-allowed' : 'pointer', background: C.surface,
                                color: C.ink, border: '1px solid ' + C.hairStrong, borderRadius: 8,
                                padding: '8px 10px', fontSize: 12.5, fontWeight: 650 }}>
                              {busy === g.id ? '…' : 'I searched — nothing more'}
                            </button>
                          </div>
                          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>
                            “Nothing more” closes a description the requestor considers open — it needs the note.
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {ungrouped.length > 0 && (
                  <div style={{ border: '1px dashed ' + C.hairStrong, borderRadius: 9, padding: 12, marginTop: 10 }}>
                    <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 4 }}>
                      <b>Selected before intake recorded what it meant.</b> These carry no description or intent.
                    </div>
                    {ungrouped.map(function (r) { return <Rec key={r.id} r={r} />; })}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, background: C.field,
                  border: '1px solid ' + C.hair, borderRadius: 8, padding: '10px 12px' }}>
                  <b>The requestor was shown these and passed them over.</b> They have never been shown this list and
                  never will be — it is here so you don’t re-surface a record they already declined.
                </div>
                {passedOver.length === 0
                  ? <div style={{ fontSize: 13, color: C.faint, padding: '10px 0' }}>Nothing was shown and passed over.</div>
                  : passedOver.map(function (r) { return <Rec key={r.id} r={r} dim />; })}
              </div>
            )}
          </div>
        </section>

        {/* ---------------- ZONE 2 — THE SEARCH SURFACE (§4a) ---------------- */}
        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10, marginTop: 16 }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + C.hair, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted }}>
              Find the records
            </span>
            {includedCount > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '2px 9px',
                background: C.greenTint, color: C.green }}>{includedCount} to include</span>
            )}
          </div>
          <div style={{ padding: 18 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={q} onChange={function (e) { setQ(e.target.value); }}
                onKeyDown={function (e) { if (e.key === 'Enter') runSearch(); }}
                placeholder="Search the connected record systems…"
                style={{ flex: 1, minWidth: 0, background: C.surface, border: '1px solid ' + C.hairStrong,
                  borderRadius: 8, padding: '9px 12px', fontSize: 14, color: C.ink }} />
              <button type="button" onClick={runSearch} disabled={searching || !q.trim()}
                style={{ cursor: searching ? 'wait' : 'pointer', background: C.blue, color: '#fff',
                  border: '1px solid ' + C.blue, borderRadius: 8, padding: '9px 18px', fontSize: 13.5, fontWeight: 650,
                  opacity: (searching || !q.trim()) ? 0.55 : 1 }}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>

            {results && results.length === 0 && (
              <div style={{ marginTop: 14, fontSize: 13, color: C.muted, background: C.surface2,
                border: '1px solid ' + C.hair, borderRadius: 8, padding: '12px 14px' }}>
                <b style={{ color: C.ink }}>No matches.</b> That is a real, common outcome — not a failure. Log the
                effort, then close with <b>No responsive records</b> when you are satisfied the search was diligent.
              </div>
            )}

            {results && results.map(function (r) {
              var lib = r.publicReady === true;
              return (
                <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 10,
                  background: C.surface2, border: '1px solid ' + C.hair, borderRadius: 9, padding: '11px 13px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 650 }}>{r.title}</div>
                    <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>
                      {[r.docType, r.department, r.dateCreated, r.sourceSystem, r.pageCount ? r.pageCount + ' pp' : null]
                        .filter(Boolean).join(' · ')}
                    </div>
                    {r.summary && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 5, lineHeight: 1.45 }}>{r.summary}</div>}
                    {lib && (
                      <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 700,
                        borderRadius: 999, padding: '2px 8px', background: C.greenTint, color: C.green }}>
                        Already released · Public Records Library
                      </span>
                    )}
                  </div>
                  <button type="button" disabled={!!busy} onClick={function () { attach(r); }}
                    style={{ flex: 'none', cursor: busy ? 'not-allowed' : 'pointer', background: C.blueTint,
                      color: C.blue, border: '1px solid ' + C.blue, borderRadius: 8, padding: '8px 12px',
                      fontSize: 13, fontWeight: 650, opacity: busy && busy !== r.id ? 0.55 : 1 }}>
                    {busy === r.id ? 'Adding…' : 'Include in Response'}
                  </button>
                </div>
              );
            })}

            {attached.length > 0 && (
              <div style={{ marginTop: 18, borderTop: '1px dashed ' + C.hair, paddingTop: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
                  color: C.muted, marginBottom: 8 }}>On this request ({attached.length})</div>
                {attached.slice(0, 12).map(function (f) {
                  return (
                    <div key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6,
                      background: C.surface, border: '1px solid ' + C.hair, borderRadius: 8, padding: '8px 11px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px',
                        background: f.responsive ? C.greenTint : C.surface2, color: f.responsive ? C.green : C.faint }}>
                        {f.responsive ? 'Include in Response' : 'Attached'}
                      </span>
                      <span style={{ fontSize: 13, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.original_name}
                      </span>
                    </div>
                  );
                })}
                {attached.length > 12 && (
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>…and {attached.length - 12} more.</div>
                )}
              </div>
            )}
          </div>
        </section>
       </div>

       {/* ---------------- ZONE 3 — ACTIONS & DEFECT RAIL ---------------- */}
       <div style={{ minWidth: 0 }}>

        {flash && (
          <div style={{ marginBottom: 12, fontSize: 12.5, lineHeight: 1.5, borderRadius: 9, padding: '10px 12px',
            background: flash.tone === 'crit' ? C.critTint : C.greenTint,
            color: flash.tone === 'crit' ? C.crit : C.green,
            border: '1px solid ' + (flash.tone === 'crit' ? C.crit : C.green), fontWeight: 600 }}>
            {flash.text}
          </div>
        )}

        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10, marginBottom: 16 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid ' + C.hair, fontSize: 12.5, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted }}>Actions</div>
          <div style={{ padding: 14, paddingBottom: 6 }}>
            <Act k="CONSULT_REQUESTED" title="Confer with supervisor" sub="Send this task and a note"
              onClick={function () { effort('CONSULT_REQUESTED', 'Conferred with a supervisor on this search.'); }} />
            <Act k="CALL_LOGGED" title="Log a phone call" sub="Who, when, what came of it"
              onClick={function () { effort('CALL_LOGGED', 'Phone call logged during record search.'); }} />
          </div>
        </section>

        {/* Defect markers moved onto the record item itself (global layout, spec §2.2 — Kevin 7/28):
            the buttons live in the description's defect box in Zone 1; the jurisdiction-aware
            explainers render beneath it. Same markDefect machinery, different home. */}

        {/* ===== RESOLUTION (§5d) — two ways out, and they are NOT symmetrical ===== */}
        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10, marginBottom: 16 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid ' + C.hair, fontSize: 12.5, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted }}>Resolve</div>
          <div style={{ padding: 14 }}>
            {resolved ? (
              <div style={{ fontSize: 13, fontWeight: 650, color: resolved.outcome === 'found' ? C.green : C.crit }}>
                {resolved.outcome === 'found'
                  ? '✓ Search complete — handed to Exemption Review.'
                  : '✓ Closed — no responsive records.'}
              </div>
            ) : (
              <>
                {/* Blocked by EITHER an empty response (nothing to hand on) or an unanswered description
                    (the requestor asked us to search and we have not said what we found). */}
                <button type="button" disabled={!!busy || includedCount < 1 || openIntents.length > 0}
                  onClick={function () { requestComplete('found'); }}
                  title={openIntents.length > 0
                    ? 'Answer the description(s) the requestor asked you to search first.'
                    : (includedCount < 1 ? 'Include at least one record in the response first.' : '')}
                  style={{ width: '100%', cursor: (busy || includedCount < 1 || openIntents.length > 0) ? 'not-allowed' : 'pointer',
                    background: (includedCount < 1 || openIntents.length > 0) ? C.surface2 : C.green,
                    color: (includedCount < 1 || openIntents.length > 0) ? C.faint : '#fff',
                    border: '1px solid ' + ((includedCount < 1 || openIntents.length > 0) ? C.hair : C.green), borderRadius: 9,
                    padding: '10px 12px', fontSize: 13.5, fontWeight: 650, marginBottom: 8 }}>
                  {busy === 'found' ? 'Completing…' : 'Found — ' + includedCount + ' to include →'}
                </button>

                {openIntents.length > 0 && (
                  <div style={{ fontSize: 12, color: C.amber, background: C.amberTint, border: '1px solid ' + C.amber,
                    borderRadius: 8, padding: '8px 10px', marginBottom: 8, lineHeight: 1.5 }}>
                    <b>{openIntents.length === 1 ? 'One description is still open.' : openIntents.length + ' descriptions are still open.'}</b>{' '}
                    The requestor asked the team to search. Answer {openIntents.length === 1 ? 'it' : 'them'} above —
                    fulfilling from their own selection alone would close a request they consider OPEN.
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
                  {includedCount < 1
                    ? 'Include at least one record to hand this on. If there is nothing to hand on, end the item below.'
                    : 'Handing on sends the located records to Redaction Review.'}
                </div>
              </>
            )}
          </div>
        </section>

        {/* ===== END THIS ITEM (BW5 · Draft 8 rev 2, Frame A) =====================================
            Closing happens where the evidence lives. Two endings live on this rail; denial is NOT one
            of them — an exemption discovered during a search is Legal Review's determination, not the
            searcher's. Each opens a confirm popup: nothing closes on a single click. */}
        {!resolved && (
        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10, marginBottom: 16 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid ' + C.hair, fontSize: 12.5, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted }}>End this item</div>
          <div style={{ padding: 14 }}>
            {pendingClose ? (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.amber, background: C.amberTint,
                border: '1px solid ' + C.amber, borderRadius: 8, padding: '9px 11px' }}>
                <b>Close pending approval</b> — {pendingClose.label}. The disposition and its notice fire when the
                supervisor approves, and the close is recorded as their act.
              </div>
            ) : (
              <>
                <button type="button" disabled={!!busy} onClick={function () { openClose('no_records'); }}
                  style={{ width: '100%', cursor: busy ? 'not-allowed' : 'pointer', background: C.surface,
                    color: C.ink, border: '1px solid ' + C.hairStrong, borderRadius: 9,
                    padding: '10px 12px', fontSize: 13.5, fontWeight: 650, marginBottom: 8 }}>
                  No records found — close…
                </button>
                <button type="button" disabled={!!busy} onClick={function () { openClose('not_in_custody'); }}
                  style={{ width: '100%', cursor: busy ? 'not-allowed' : 'pointer', background: C.surface,
                    color: C.muted, border: '1px solid ' + C.hairStrong, borderRadius: 9,
                    padding: '10px 12px', fontSize: 13.5, fontWeight: 650 }}>
                  Not our records — refer &amp; close…
                </button>
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
                  Each opens a confirm popup stating what will be written and sent. A closure is a legal act —
                  it must be evidenced by the effort trail below, and it always owes the requester a notice.
                </div>
              </>
            )}
          </div>
        </section>
        )}

        {/* The effort trail. Not decoration — it is the evidence that supports a "no responsive records"
            closure, and the place a city looks when someone asks what it actually DID. */}
        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid ' + C.hair, display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted }}>
              Effort trail
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px',
              background: C.surface2, color: C.faint, fontFamily: C.mono }}>{trail.length}</span>
          </div>
          <div style={{ padding: 14, maxHeight: 380, overflowY: 'auto' }}>
            {trail.length === 0 && <div style={{ fontSize: 12.5, color: C.faint }}>Nothing logged yet.</div>}
            {trail.slice(0, 25).map(function (h) {
              var loud = /CLARIFICATION|OVERLY BROAD|forfeit/i.test((h.action || '') + ' ' + (h.notes || ''));
              return (
                <div key={h.id} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid ' + C.hair }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, fontFamily: C.mono,
                    color: loud ? C.crit : C.blue }}>{h.action}</div>
                  <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.45, marginTop: 2 }}>{h.notes}</div>
                  <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>{h.actor_name} · {h.created_at}</div>
                </div>
              );
            })}
          </div>
        </section>
       </div>
      </div>
      {/* ===== THE CONFIRM POPUP (Frame A′) — one act: close + notify ==========================
          It states what will be WRITTEN and what will be SENT, renders the server's gate rows, and
          draws only the commit buttons this department's `close_approval` config left open. */}
      <ConfirmPopup open={!!closeEnding} onClose={function () { setCloseEnding(null); }}
        title={closeEnding === 'not_in_custody'
          ? 'Not in our custody — refer and close this item?'
          : 'No records located — close this item?'}
        actions={closeGate ? (
          <>
            {closeGate.approval && closeGate.approval.canSubmit && (
              <button type="button" disabled={busy === 'close' || (closeGate.gate && closeGate.gate.blocked)}
                onClick={function () { commitClose('submit'); }}
                style={{ cursor: (closeGate.gate && closeGate.gate.blocked) ? 'not-allowed' : 'pointer',
                  background: (closeGate.gate && closeGate.gate.blocked) ? C.surface2 : C.blue,
                  color: (closeGate.gate && closeGate.gate.blocked) ? C.faint : '#fff',
                  border: '1px solid ' + ((closeGate.gate && closeGate.gate.blocked) ? C.hair : C.blue),
                  borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 650 }}>
                {busy === 'close' ? 'Closing…' : 'Submit — close & notify'}
              </button>
            )}
            {closeGate.approval && closeGate.approval.canRoute && (
              <button type="button" disabled={busy === 'close' || (closeGate.gate && closeGate.gate.blocked)}
                onClick={function () { commitClose('route'); }}
                style={{ cursor: 'pointer', background: C.surface, color: C.blue,
                  border: '1px solid ' + C.blue, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 650 }}>
                Route to supervisor for approval…
              </button>
            )}
            <button type="button" onClick={function () { setCloseEnding(null); }}
              style={{ cursor: 'pointer', background: C.surface, color: C.muted, border: '1px solid ' + C.hairStrong,
                borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 650 }}>
              Cancel — back to the task
            </button>
          </>
        ) : null}>
        {!closeGate ? <div style={{ fontSize: 12.5, color: C.muted }}>Checking the evidence…</div> : (
          <>
            {(closeGate.gate.rows || []).map(function (row) {
              return <GateRow key={row.code} ok={row.ok}>{row.text}</GateRow>;
            })}

            {closeEnding === 'not_in_custody' && (
              <div style={{ marginTop: 8 }}>
                <input value={custodianName} onChange={function (e) { setCustodianName(e.target.value); }}
                  placeholder="Custodian who holds these records (required)"
                  style={{ width: '100%', font: 'inherit', fontSize: 13, padding: '6px 8px', marginBottom: 6,
                    border: '1px solid ' + C.hairStrong, borderRadius: 5 }} />
                <input value={custodianContact} onChange={function (e) { setCustodianContact(e.target.value); }}
                  placeholder="How to reach them (optional — it rides the referral letter)"
                  style={{ width: '100%', font: 'inherit', fontSize: 13, padding: '6px 8px', marginBottom: 6,
                    border: '1px solid ' + C.hairStrong, borderRadius: 5 }} />
                <textarea rows={2} value={referralNote} onChange={function (e) { setReferralNote(e.target.value); }}
                  placeholder="The referral record (required) — why these records are not ours, and where the requester should go"
                  style={{ width: '100%', font: 'inherit', fontSize: 13, padding: '6px 8px',
                    border: '1px solid ' + C.hairStrong, borderRadius: 5 }} />
              </div>
            )}

            <textarea rows={2} value={closeNote} onChange={function (e) { setCloseNote(e.target.value); }}
              placeholder={closeEnding === 'not_in_custody'
                ? 'Closure note (required) — how you determined these records are not in this office’s custody'
                : 'Closure note (required) — why this search is exhaustive'}
              style={{ width: '100%', font: 'inherit', fontSize: 13, padding: '6px 8px', marginTop: 8,
                border: '1px solid ' + C.hairStrong, borderRadius: 5 }} />

            <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, margin: '8px 0 0' }}>
              Submitting writes <b>{closeEnding === 'not_in_custody'
                ? 'Closed – Not in our custody (referred)' : 'Closed – No records located'}</b> and sends the
              closure notice to the requester — <b>one act</b>, never a silent end.
              {closeEnding === 'no_records' && (
                <> ⚠ The two gates never feed each other: an “answered description” is a claim, not effort.</>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>
              Which commit buttons appear is department-level config (<code>close_approval</code> ={' '}
              {closeGate.approval && closeGate.approval.mode}).{' '}
              <DecidedByBadge by="person">a person</DecidedByBadge>
            </div>
            {closeErr ? (
              <div style={{ marginTop: 8, fontSize: 12.5, color: C.crit, background: C.critTint,
                border: '1px solid ' + C.crit, borderRadius: 6, padding: '7px 9px', lineHeight: 1.5 }}>{closeErr}</div>
            ) : null}
          </>
        )}
      </ConfirmPopup>

      {laborModal ? <WorkTimerCompleteModal open taskId={taskId} seconds={timer.seconds} allowSkip={tcm.mode === 'discretion'}
        contextLabel={'Record search · ' + (task.request_number || '')}
        confirmLabel={laborModal.outcome === 'found' ? 'Log time & hand off' : 'Log time & close'}
        onConfirm={function () { timer.markFinalized(); resolve(laborModal.outcome); setLaborModal(null); }}
        onClose={function () { setLaborModal(null); }} /> : null}
    </div>
  );
}
