import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { G, SubmittedDescription, ConfirmPopup, GateRow } from '../components/primitives';

// PHASE 7 / BW6 — THE CHILD RECORD SCREEN.
// (docs/DRAFT_processing_ui_mrr_hub.md rev 5b + §0b · mockup screen 4)
//
// Kevin, 7/28 item 4: "clicking into a child record lets the manager DO OR ASSIGN Record Search — same for
// Estimate data gathering and Redaction". Three activity blocks, each with a status, an assignee, and the
// two verbs. That is the whole screen's spine.
//
// WHAT IS DELIBERATE HERE AND SHOULD NOT BE "TIDIED":
//
//  * THE ITEM'S VERBATIM WORDING LEADS, with Mark Vague / Mark Overly Broad boxed BESIDE it rather than on
//    a rail (Draft 1 §0b's global layout, applied here). The defect is a statement about the WORDS, so the
//    control that makes it belongs next to the words.
//  * MARK VAGUE GOES OUT THROUGH THE REQUEST MANAGER. One request, one voice: the clarification is sent by
//    the manager through the existing clarification machinery — no new outreach path, no second defect
//    store. The backend refuses anyone else, so this is not the only guard.
//  * NO ORDERING IS ENFORCED between the three activities. Redaction may be queued while search runs; the
//    screen says "queued" and the manager decides. On a multi-record request the orchestration IS the
//    manager's job (Draft 5 §3 q3, drafted position kept).
//  * DESIGNATE DENIAL IS NOT A DENIAL. It spawns legal_review with the manager's grounds attached and tags
//    the bar. Legal decides; BW5's deny-close-notify writes the ending if it is upheld. The confirm dialog
//    says so in the server's words before anything is written.
//  * THE ASSIGNEE INSET is not decoration. It shows what the person doing the work sees, so that "MRR tasks
//    never advance a stage" is VISIBLE to the manager who is relying on it.
//  * NO STATUTORY CLOCK. It is a master-record object (§4.2); the screen says where it lives rather than
//    leaving a gap that reads like a missing field.

var ST = {
  not_started: { bg: C.surface, fg: G.ghost, bd: G.ghost, dashed: true, label: 'Not started' },
  queued: { bg: C.surface2, fg: C.muted, bd: G.line, label: 'Queued' },
  in_process: { bg: G.amberBg, fg: G.amberInk, bd: G.amberLine, label: 'In Process' },
  complete: { bg: G.statuteBg, fg: G.statute, bd: G.statute, label: 'Complete' },
  not_required: { bg: C.surface, fg: G.ghost, bd: G.ghost, dashed: true, label: 'Not required' }
};

function Pill(props) {
  var t = ST[props.status] || ST.not_started;
  return (
    <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, borderRadius: 3,
      padding: '2px 8px', border: '1px ' + (t.dashed ? 'dashed ' : 'solid ') + t.bd,
      background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>{t.label}</span>
  );
}

var btn = { font: 'inherit', fontSize: 13, background: G.navy, color: '#fff', border: 'none',
  borderRadius: 5, padding: '6px 14px', fontWeight: 600, cursor: 'pointer' };
var btnQuiet = Object.assign({}, btn, { background: C.surface2, color: C.ink, border: '1px solid ' + G.line, fontWeight: 500 });
var btnSm = Object.assign({}, btnQuiet, { fontSize: 12, padding: '4px 10px' });
var btnDanger = Object.assign({}, btn, { background: C.surface, color: '#8C3A2B', border: '1px solid #C08A7E', fontWeight: 600 });
var kv = { fontSize: 12.5, color: C.muted };
var panelHead = { fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
  color: C.muted, marginBottom: 7 };
var input = { width: '100%', fontSize: 13, padding: 8, border: '1px solid ' + G.line, borderRadius: 5,
  fontFamily: 'inherit', marginBottom: 8 };

function Panel(props) {
  return (
    <div style={{ background: props.tinted ? C.surface2 : C.surface, border: '1px solid ' + G.line,
      borderRadius: 6, padding: '11px 13px', marginBottom: 11 }}>
      {props.title ? <div style={panelHead}>{props.title}</div> : null}
      {props.children}
    </div>
  );
}

export default function MrrChildPage() {
  var params = useParams();
  var hubId = params.taskId;
  var childId = params.childId;
  var [d, setD] = useState(null);
  var [err, setErr] = useState(null);
  var [staff, setStaff] = useState([]);
  var [assignFor, setAssignFor] = useState(null);   // activity key while the picker is open
  var [extEmail, setExtEmail] = useState('');       // external-contributor email in the open picker
  var [linkUrl, setLinkUrl] = useState('');         // the re-issued secure URL, for copy-by-hand
  var [pick, setPick] = useState('');
  var [denyOpen, setDenyOpen] = useState(false);
  var [grounds, setGrounds] = useState('');
  var [defectOpen, setDefectOpen] = useState(null); // 'vague' | 'overly_broad'
  var [defectNote, setDefectNote] = useState('');
  var [estOpen, setEstOpen] = useState(false);
  var [est, setEst] = useState({});
  var [busy, setBusy] = useState(false);
  var [msg, setMsg] = useState(null);

  function load() {
    api.get('/mrr/item/' + childId)
      .then(function (r) {
        setD(r.data);
        var e = r.data.estimateData || {};
        setEst({ laborMinutes: e.labor_minutes || '', pageCount: e.page_count || '',
          mediaCount: e.media_count || '', otherCost: e.other_cost || '',
          estimatedCost: e.estimated_cost || '', notes: e.notes || '' });
      })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || e.message); });
  }
  useEffect(load, [childId]);
  useEffect(function () {
    // EVERY person, not a team roster. MRR activities are hand-assigned to ANY person — no team filter and
    // no smart routing (MASTER A2, annotation 11). Filtering the list here would quietly reintroduce the
    // routing the design removed.
    api.get('/staff').then(function (r) {
      setStaff((r.data.staff || []).filter(function (u) { return u.status !== 'inactive'; }));
    }).catch(function () {});
  }, []);

  function post(path, body, then) {
    setBusy(true); setMsg(null);
    return api.post(path, body || {})
      .then(function (r) { setBusy(false); load(); if (then) then(r); return r; })
      .catch(function (e) {
        setBusy(false);
        var b = (e.response && e.response.data) || {};
        // A refusal is shown VERBATIM, with its citation when it carries one. Paraphrasing a legal refusal
        // makes it a different refusal.
        setMsg((b.error || e.message) + (b.citation ? ' (' + b.citation + ')' : ''));
      });
  }

  function assign(activity, self) {
    var body = self ? { self: true } : { assigneeId: pick };
    if (!self && !pick) { setMsg('Name the person — MRR activities are hand-assigned.'); return; }
    post('/mrr/item/' + childId + '/activity/' + activity + '/assign', body, function () { setAssignFor(null); setPick(''); });
  }
  function assignExternal(activity) {
    var em = extEmail.trim();
    if (!em || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setMsg('Enter the external contributor’s email address.'); return; }
    post('/mrr/item/' + childId + '/activity/' + activity + '/assign', { externalEmail: em },
      function () { setAssignFor(null); setExtEmail(''); });
  }
  function resendLink(activity) {
    setBusy(true); setLinkUrl('');
    api.post('/mrr/item/' + childId + '/activity/' + activity + '/external-link/resend', {})
      .then(function (r) { setLinkUrl(r.data.url || ''); setMsg(r.data.mail && r.data.mail.sent ? 'Link re-sent by email.' : 'New link issued — copy it below (no mail provider configured).'); load(); })
      .catch(function (e) { setMsg((e.response && e.response.data && e.response.data.error) || 'Could not re-issue.'); })
      .finally(function () { setBusy(false); });
  }
  function revokeLink(activity) {
    if (!window.confirm('Revoke the secure link? The contributor can no longer open it.')) return;
    post('/mrr/item/' + childId + '/activity/' + activity + '/external-link/revoke', {});
  }

  function saveEstimate(complete) {
    setBusy(true); setMsg(null);
    api.put('/mrr/item/' + childId + '/estimate-data', Object.assign({}, est, { complete: complete }))
      .then(function () { setBusy(false); setEstOpen(false); load(); })
      .catch(function (e) { setBusy(false); setMsg((e.response && e.response.data && e.response.data.error) || e.message); });
  }

  if (err) return <div style={{ padding: 20, color: '#8C3A2B' }}>{err}</div>;
  if (!d) return <div style={{ padding: 20, color: C.muted }}>Loading…</div>;

  var it = d.item;
  var acts = d.activities || [];
  var att = d.attachments || { files: [], count: 0 };
  var rel = d.release || {};

  return (
    <div style={{ padding: '14px 16px', maxWidth: 1080 }}>

      {/* ── THE ITEM CARD: verbatim wording, defect box beside it ────────────────────────────── */}
      <div style={{ background: C.surface2, border: '1px solid ' + G.line, borderRadius: 6,
        padding: '10px 13px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: G.navy, fontSize: 14 }}>
            {it.label} of {it.of}
          </span>
          <span style={kv}>
            {it.classification ? 'Classified as: ' : ''}<b style={{ color: C.ink }}>{it.classification || ''}</b>
          </span>
          <span style={Object.assign({}, kv, { marginLeft: 'auto' })}>
            <Link to={'/mrr/' + hubId} style={{ color: G.navy }}>← back to master record {d.parent.requestNumber}</Link>
          </span>
        </div>
        <div style={{ marginTop: 8 }}>
          {/* DEFECT BOX BESIDE THE DESCRIPTION — the global layout rule, not a rail. */}
          <SubmittedDescription title="Item Description as Submitted" margin="0"
            actions={d.canManage ? (
              <React.Fragment>
                <button style={btnSm} onClick={function () { setDefectOpen('vague'); }}>Mark Vague</button>
                <button style={btnSm} onClick={function () { setDefectOpen('overly_broad'); }}>Mark Overly Broad</button>
              </React.Fragment>
            ) : null}>
            {it.description}
          </SubmittedDescription>
          {d.defect ? (
            <div style={{ fontSize: 12.5, color: G.amberInk, marginTop: 6, fontWeight: 600 }}>
              {d.defect.label} — clarification outstanding since {String(d.defect.at || '').slice(0, 10)}.
              The requestor hears from the Request Manager and nobody else.
            </div>
          ) : null}
          <div style={Object.assign({}, kv, { marginTop: 5 })}>{d.clockNote}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 560px', minWidth: 0 }}>

          {/* ── ATTACHMENTS, PER ITEM ────────────────────────────────────────────────────────── */}
          <Panel title={'Attached by the requestor — this item (' + att.count + ')'}>
            {att.count === 0 ? <div style={kv}>Nothing was attached to this item.</div>
              : att.files.map(function (f) {
                return (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0',
                    borderBottom: '1px solid ' + C.surface2, fontSize: 12.5 }}>
                    <span>📄</span><b style={{ color: C.ink }}>{f.original_name || f.filename}</b>
                    <span style={kv}>· uploaded {String(f.uploaded_at || '').slice(0, 10)}</span>
                  </div>
                );
              })}
            <div style={Object.assign({}, kv, { marginTop: 5 })}>{att.ridesWithItem}</div>
            {att.fulfilsNote ? (
              <div style={{ fontSize: 12.5, color: G.statute, marginTop: 4, fontWeight: 600 }}>{att.fulfilsNote}</div>
            ) : null}
          </Panel>

          {/* ── THE THREE ACTIVITY BLOCKS ───────────────────────────────────────────────────── */}
          {acts.map(function (a) {
            var isEstimate = a.activity === 'estimate';
            return (
              <div key={a.activity} style={{ border: '1px solid ' + G.line, borderRadius: 6,
                padding: '10px 12px', marginBottom: 9, background: C.surface }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: G.navy }}>{a.name}</span>
                  <Pill status={a.status} />
                  <span style={kv}>
                    {a.assignee_name
                      ? <React.Fragment>Assigned to: <b style={{ color: C.ink }}>{a.assignee_name}</b> — sees “<b>{a.label}</b>” on their My Tasks</React.Fragment>
                      : (a.status === 'not_required'
                        ? (a.not_required_reason || 'Not required.')
                        : 'Nobody is on this yet.')}
                  </span>
                  {isEstimate && d.estimateData && d.estimateData.entered_by_name ? (
                    <span style={kv}>Entered by: <b style={{ color: C.ink }}>{d.estimateData.entered_by_name}</b></span>
                  ) : null}
                  {d.canManage ? (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {isEstimate ? (
                        <button style={btnSm} onClick={function () { setEstOpen(true); }}>
                          {d.estimateData && d.estimateData.entered_at ? 'View / edit data' : 'Enter data'}
                        </button>
                      ) : null}
                      <button style={btnSm} onClick={function () { setAssignFor(a.activity); setPick(''); }}>
                        {a.assignee_name ? 'Reassign…' : 'Assign…'}
                      </button>
                      <button style={btnSm} disabled={busy} onClick={function () { assign(a.activity, true); }}>Do it myself</button>
                      {a.status !== 'not_required' && a.status !== 'complete' ? (
                        <button style={btnSm} onClick={function () {
                          var r = window.prompt('Why is ' + a.name.toLowerCase() + ' not required on this item?');
                          if (r && r.trim()) post('/mrr/item/' + childId + '/activity/' + a.activity + '/not-required', { reason: r.trim() });
                        }}>Not required…</button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                {assignFor === a.activity ? (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* HAND-ASSIGNED, ANY PERSON. No team filter and no classifier hint: Draft 5 §3 q2 is
                        unanswered, so the drafted-clean picker ships. */}
                    <select value={pick} onChange={function (e) { setPick(e.target.value); }}
                      style={{ fontSize: 13, padding: '5px 8px', border: '1px solid ' + G.line, borderRadius: 5 }}>
                      <option value="">Choose a person…</option>
                      {staff.map(function (u) { return <option key={u.id} value={u.id}>{u.display_name || u.name}</option>; })}
                    </select>
                    <button style={btn} disabled={busy} onClick={function () { assign(a.activity, false); }}>Assign</button>
                    <span style={kv}>or an external contributor:</span>
                    <input type="email" value={extEmail} onChange={function (e) { setExtEmail(e.target.value); }}
                      placeholder="records@otheragency.gov"
                      style={{ fontSize: 13, padding: '5px 8px', border: '1px solid ' + G.line, borderRadius: 5, minWidth: 190 }} />
                    <button style={btnSm} disabled={busy} onClick={function () { assignExternal(a.activity); }}>Send secure link</button>
                    <button style={btnSm} onClick={function () { setAssignFor(null); }}>Cancel</button>
                    <span style={kv}>Hand-assigned to any person — no team filter, no smart routing.</span>
                  </div>
                ) : null}
                {a.external ? (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                    borderTop: '1px dashed ' + G.line, paddingTop: 8 }}>
                    <span style={kv}>Secure link to <b style={{ color: C.ink }}>{a.external.email}</b> — {' '}
                      <b style={{ color: a.external.linkState === 'expired' || a.external.linkState === 'revoked' ? '#8C3A2B' : C.ink }}>
                        {{ sent: 'sent, not yet opened', opened: 'opened ' + (a.external.openCount || 0) + '×, last ' + (a.external.lastOpenedAt || ''),
                           completed: 'their part is COMPLETE', expired: 'EXPIRED unused — re-send it', revoked: 'revoked' }[a.external.linkState] || a.external.linkState}
                      </b>{a.external.linkState === 'sent' || a.external.linkState === 'opened' ? ' · expires ' + a.external.expiresAt : ''}</span>
                    {d.canManage && a.external.linkState !== 'completed' ? (
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button style={btnSm} disabled={busy} onClick={function () { resendLink(a.activity); }}>Re-send link</button>
                        {a.external.linkState !== 'revoked' && a.external.linkState !== 'expired'
                          ? <button style={btnSm} disabled={busy} onClick={function () { revokeLink(a.activity); }}>Revoke</button> : null}
                      </span>
                    ) : null}
                    {linkUrl && assignFor === null ? (
                      <span style={Object.assign({}, kv, { width: '100%', wordBreak: 'break-all' })}>
                        New link (hand it over yourself if no email arrived): <b style={{ color: C.ink }}>{linkUrl}</b>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* ── WHAT THE ASSIGNEE SEES ──────────────────────────────────────────────────────── */}
          <Panel tinted title="What the assignee sees">
            <div style={kv}>{d.assigneeInset}</div>
          </Panel>

          {/* ── PER-CHILD RELEASE — BOTH GATES, IN THEIR OWN WORDS ──────────────────────────── */}
          <Panel title="Release this item">
            <GateRow ok={!(rel.hold && rel.hold.held)}>
              {rel.hold && rel.hold.held
                ? 'A release hold stands: ' + (rel.hold.note || 'no note recorded')
                : 'No release hold stands on this item.'}
            </GateRow>
            <GateRow ok={!rel.gate || !rel.gate.requiresPaymentBeforeRelease || rel.gate.covered}>
              {!rel.gate || !rel.gate.hasEstimate
                ? 'No estimate on this item, so nothing is owed on it.'
                : (rel.gate.covered
                  ? 'This item’s own share is covered.'
                  : 'This item’s own share is short by $' + (rel.gate.balanceDue != null ? rel.gate.balanceDue : '?') + '.')}
            </GateRow>
            <div style={Object.assign({}, kv, { marginTop: 4 })}>
              A sibling’s unpaid balance is never a reason to withhold this item (§5.9).
            </div>
            <div style={Object.assign({}, kv, { marginTop: 4 })}>{rel.pipelineNote}</div>
            {d.canManage ? (
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={Object.assign({}, btn, rel.canRelease ? {} : { opacity: 0.45, cursor: 'not-allowed' })}
                  disabled={!rel.canRelease || busy}
                  onClick={function () { post('/mrr/item/' + childId + '/release', {}); }}>
                  Release this item
                </button>
                {rel.hold && rel.hold.held ? (
                  <button style={btnSm} disabled={busy}
                    onClick={function () { post('/mrr/item/' + childId + '/lift-hold', { note: '' }); }}>Lift hold</button>
                ) : (
                  <button style={Object.assign({}, btnSm,
                    rel.holdControl && rel.holdControl.canHold === false ? { opacity: 0.45, cursor: 'not-allowed' } : {})}
                    disabled={busy || !!(rel.holdControl && rel.holdControl.canHold === false)}
                    title={rel.holdControl && rel.holdControl.blockedReason ? rel.holdControl.blockedReason : ''}
                    onClick={function () {
                      var n = window.prompt('A hold always needs a note. Why is this item being held?');
                      if (n && n.trim()) post('/mrr/item/' + childId + '/hold', { note: n.trim() });
                    }}>Hold…</button>
                )}
              </div>
            ) : null}
            {/* THE PREVENTION GUARD'S REFUSAL, VERBATIM AND WITH ITS CITATION. The control is disabled AND
                the reason is shown — prevention, not a fight at the point of click. */}
            {rel.holdControl && rel.holdControl.canHold === false ? (
              <div style={{ fontSize: 12.5, color: G.amberInk, marginTop: 6 }}>
                {rel.holdControl.blockedReason}
                {rel.holdControl.citation ? <span style={{ color: C.muted }}> ({rel.holdControl.citation})</span> : null}
              </div>
            ) : null}
            {!rel.canRelease && rel.blockedReason ? (
              <div style={{ fontSize: 12.5, color: '#8C3A2B', marginTop: 6 }}>{rel.blockedReason}</div>
            ) : null}
          </Panel>

          {msg ? <div style={{ fontSize: 12.5, color: '#8C3A2B', marginBottom: 10 }}>{msg}</div> : null}
        </div>

        {/* ── THE RAIL ─────────────────────────────────────────────────────────────────────── */}
        <div style={{ flex: '0 0 260px' }}>
          <Panel title="Child-record actions">
            {d.denial && d.denial.designated ? (
              <div>
                <div style={{ fontSize: 12.5, color: '#8C3A2B', fontWeight: 600 }}>
                  Denial designated — with Legal Review.
                </div>
                <div style={Object.assign({}, kv, { marginTop: 4 })}>Grounds: {d.denial.grounds}</div>
                <div style={Object.assign({}, kv, { marginTop: 4 })}>
                  Designated by {d.denial.by} on {String(d.denial.at || '').slice(0, 10)}. Legal decides; only a
                  legal decision can close this item as denied.
                </div>
                {d.canManage ? (
                  <button style={Object.assign({}, btnSm, { marginTop: 8 })} disabled={busy}
                    onClick={function () { post('/mrr/item/' + childId + '/withdraw-designation', {}); }}>
                    Withdraw designation
                  </button>
                ) : null}
              </div>
            ) : (
              <div>
                <button style={Object.assign({}, btnDanger, { width: '100%' })} disabled={!d.canManage}
                  onClick={function () { setDenyOpen(true); }}>
                  Designate denial → submit for Legal Review…
                </button>
                <div style={Object.assign({}, kv, { marginTop: 6 })}>
                  Designation is not a denial: it sends this item to Legal Review with your grounds attached.
                  If upheld, the letter is composed in Denial Compose. The bar carries the tag meanwhile.
                </div>
              </div>
            )}
            <div style={{ borderTop: '1px solid ' + C.surface2, margin: '10px 0' }} />
            <div style={panelHead}>Requestor</div>
            {d.canManage ? (
              <div style={kv}>
                You are the Request Manager. Contact-requestor lives on the master record — one request, one voice.
              </div>
            ) : (
              <div style={kv}>
                Email the Request Manager{d.managerName ? ' (' + d.managerName + ')' : ''} — every assignee-facing
                MRR surface offers that instead of any contact-requestor control.
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* ── DESIGNATE DENIAL ────────────────────────────────────────────────────────────────── */}
      <ConfirmPopup open={denyOpen} title="Designate a denial on this item, and send it to Legal Review"
        onClose={function () { setDenyOpen(false); }}
        actions={
          <React.Fragment>
            <button style={btnDanger} disabled={busy || !grounds.trim()}
              onClick={function () {
                post('/mrr/item/' + childId + '/designate-denial', { grounds: grounds.trim() },
                  function () { setDenyOpen(false); setGrounds(''); });
              }}>Designate and submit</button>
            <button style={btnQuiet} onClick={function () { setDenyOpen(false); }}>Cancel</button>
          </React.Fragment>
        }>
        <div style={{ fontSize: 12.5, color: C.ink, marginBottom: 8 }}>
          This does <b>not</b> deny anything. It flags the item, spawns a Legal Review task carrying your
          grounds, and tags the bar. Legal decides; only a legal decision can close this item as denied.
        </div>
        <textarea value={grounds} onChange={function (e) { setGrounds(e.target.value); }} rows={4}
          placeholder="Your grounds — the exemption you believe applies and why" style={input} />
        <div style={kv}>Legal reviews the grounds, not the label — so a designation without them is refused.</div>
      </ConfirmPopup>

      {/* ── MARK VAGUE / OVERLY BROAD, THROUGH THE RM ───────────────────────────────────────── */}
      <ConfirmPopup open={!!defectOpen}
        title={defectOpen === 'overly_broad' ? 'Mark this item overly broad' : 'Mark this item vague'}
        onClose={function () { setDefectOpen(null); }}
        actions={
          <React.Fragment>
            <button style={btn} disabled={busy}
              onClick={function () {
                post('/mrr/item/' + childId + '/mark-defect', { reason: defectOpen, note: defectNote.trim() },
                  function () { setDefectOpen(null); setDefectNote(''); });
              }}>Send the clarification</button>
            <button style={btnQuiet} onClick={function () { setDefectOpen(null); }}>Cancel</button>
          </React.Fragment>
        }>
        <div style={{ fontSize: 12.5, color: C.ink, marginBottom: 8 }}>
          The clarification goes out from <b>you, the Request Manager</b> — one request, one voice. It uses the
          city's existing clarification machinery, so this jurisdiction's clock effect and its conference duty
          apply exactly as they do everywhere else.
          {defectOpen === 'vague' ? ' Marking an item vague also pauses its estimate: you cannot price what you cannot parse.' : ''}
          {defectOpen === 'overly_broad' ? ' Overly broad does NOT pause the estimate — too large is not a mark, it IS the estimate.' : ''}
        </div>
        <textarea value={defectNote} onChange={function (e) { setDefectNote(e.target.value); }} rows={3}
          placeholder="Anything to add to the outreach (optional)" style={input} />
      </ConfirmPopup>

      {/* ── ESTIMATE DATA ENTRY ─────────────────────────────────────────────────────────────── */}
      <ConfirmPopup open={estOpen} title="Estimate data — this item" onClose={function () { setEstOpen(false); }}
        actions={
          <React.Fragment>
            <button style={btn} disabled={busy} onClick={function () { saveEstimate(true); }}>Save and mark complete</button>
            <button style={btnQuiet} disabled={busy} onClick={function () { saveEstimate(false); }}>Save draft</button>
            <button style={btnQuiet} onClick={function () { setEstOpen(false); }}>Cancel</button>
          </React.Fragment>
        }>
        <div style={{ fontSize: 12.5, color: C.ink, marginBottom: 8 }}>
          These are the item's GATHERED FIGURES. They price nothing on their own: one estimate is generated
          for the master record through the standard engine when every item's data is complete.
        </div>
        {[['pageCount', 'Pages'], ['laborMinutes', 'Labour (minutes)'], ['mediaCount', 'Media items'],
          ['otherCost', 'Other cost ($)'], ['estimatedCost', 'Estimated cost ($)']].map(function (f) {
          return (
            <div key={f[0]} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 12.5, color: C.muted, width: 150 }}>{f[1]}</label>
              <input value={est[f[0]] == null ? '' : est[f[0]]}
                onChange={function (e) { var n = {}; n[f[0]] = e.target.value; setEst(Object.assign({}, est, n)); }}
                style={{ flex: 1, fontSize: 13, padding: 6, border: '1px solid ' + G.line, borderRadius: 5 }} />
            </div>
          );
        })}
        <textarea value={est.notes || ''} onChange={function (e) { setEst(Object.assign({}, est, { notes: e.target.value })); }}
          rows={2} placeholder="Notes" style={Object.assign({}, input, { marginTop: 6 })} />
      </ConfirmPopup>

      <div style={{ fontSize: 12.5, marginTop: 12 }}>
        <Link to={'/mrr/' + hubId} style={{ color: G.navy }}>← Master record</Link>
      </div>
    </div>
  );
}
