import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { G, ClockChip, DecidedByBadge, SubmittedDescription } from '../components/primitives';

// PHASE 7 / BW6 — THE MASTER RECORD SCREEN.
// (docs/DRAFT_processing_ui_mrr_hub.md rev 5b + §0b · mockup screen 3 · SPEC_processing_ui.md §3 screen 5)
//
// Kevin, 7/28 item 3: "clicking into a master record summarizes master-level info at the top, with a line
// item for each child below, as a bar with task statuses and tags". That is exactly this file, and the
// order matters — the summary answers "what is this request and when is it due", the bars answer "where is
// each item", and nothing else competes for the top of the page.
//
// FOUR THINGS ON THIS SCREEN ARE LEGAL RATHER THAN COSMETIC:
//
//  1. THE VERBATIM DESCRIPTION (§0b). The master card carries the requestor's OWN WORDS, never a
//     paraphrase, and each bar's one-liner is a TRUNCATION of the item's submitted wording — not a
//     summary. A summary is the city's words standing in for the citizen's, and the whole request is
//     defined by the citizen's.
//  2. THE STATUTORY CLOCK IS MASTER-ONLY (§4.2). One legal deadline per citizen request, never one per
//     item. It renders here and nowhere below; the child view says so rather than leaving a suspicious gap.
//     ClockChip picks its treatment from the server's `kind`, never from a due date (spec rule a).
//  3. GENERATE ESTIMATE ARMS AT m OF m, and produces ONE estimate for the master through the standard
//     engine. Staff VERIFY; the REQUESTOR approves. Two words, two actors — requestor approval is a
//     statutory trigger in some states, so the screen never conflates them.
//  4. THE PARENT HAS NO DISPOSITION. Its state is DERIVED from its items (§5.8) and is labelled as
//     derived. There is no close control here and there must never be one.
//
// THE BAR'S STATUS VOCABULARY IS HONEST ON PURPOSE: Not started · Queued · In Process · Complete · Not
// required. "Nothing has been asked for yet" and "nothing is needed here" are different facts about an
// item, and a manager deciding what to assign next needs to tell them apart.

var ST = {
  not_started: { bg: C.surface, fg: G.ghost, bd: G.ghost, dashed: true, label: 'Not started' },
  queued: { bg: C.surface2, fg: C.muted, bd: G.line, label: 'Queued' },
  in_process: { bg: G.amberBg, fg: G.amberInk, bd: G.amberLine, label: 'In Process' },
  complete: { bg: G.statuteBg, fg: G.statute, bd: G.statute, label: 'Complete' },
  not_required: { bg: C.surface, fg: G.ghost, bd: G.ghost, dashed: true, label: 'Not required' }
};
var ACT_SHORT = { search: 'Search', estimate: 'Estimate', redaction: 'Redaction' };

function ActChip(props) {
  var t = ST[props.status] || ST.not_started;
  return (
    <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, borderRadius: 3,
      padding: '2px 8px', border: '1px ' + (t.dashed ? 'dashed ' : 'solid ') + t.bd,
      background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>
      {ACT_SHORT[props.activity]} <b style={{ fontWeight: 800 }}>{t.label}</b>
    </span>
  );
}

function Tag(props) {
  var tints = {
    vague: { bg: G.amberBg, fg: G.amberInk, bd: G.amberLine },
    denial: { bg: '#F7E9E5', fg: '#8C3A2B', bd: '#C08A7E' },
    ext: { bg: '#EDE9F5', fg: '#4A3A75', bd: '#8E7CC3' },
    closed: { bg: C.surface2, fg: C.muted, bd: G.line }
  };
  var t = tints[props.kind] || tints.closed;
  return (
    <span title={props.title || ''} style={{ display: 'inline-block', fontSize: 10, fontWeight: 800,
      letterSpacing: '.05em', textTransform: 'uppercase', borderRadius: 3, padding: '2px 7px',
      background: t.bg, color: t.fg, border: '1px solid ' + t.bd, whiteSpace: 'nowrap' }}>
      {props.children}
    </span>
  );
}

var btn = { font: 'inherit', fontSize: 13, background: G.navy, color: '#fff', border: 'none',
  borderRadius: 5, padding: '6px 14px', fontWeight: 600, cursor: 'pointer' };
var btnQuiet = Object.assign({}, btn, { background: C.surface2, color: C.ink, border: '1px solid ' + G.line, fontWeight: 500 });
var kv = { fontSize: 12.5, color: C.muted };
var panelHead = { fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
  color: C.muted, marginBottom: 7 };

export default function MrrMasterPage() {
  var params = useParams();
  var nav = useNavigate();
  var id = params.taskId;
  var [m, setM] = useState(null);
  var [err, setErr] = useState(null);
  var [findings, setFindings] = useState(null);
  var [ledger, setLedger] = useState(null);
  var [busy, setBusy] = useState(false);
  var [msg, setMsg] = useState(null);

  function load() {
    api.get('/mrr/' + id + '/master')
      .then(function (r) {
        setM(r.data);
        var pid = r.data.parent.id;
        // DRAFT-1 BINDINGS, PARENT-SCOPED. Same endpoints the intake-review card reads — there is no
        // intake-review stop on an MRR, so these requestor-level checks surface HERE instead of vanishing.
        api.get('/requests/' + pid + '/eligibility-findings').then(function (x) { setFindings(x.data); }).catch(function () {});
        api.get('/jurisdiction-profile/ledger/request/' + pid).then(function (x) { setLedger(x.data); }).catch(function () { setLedger(null); });
      })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || e.message); });
  }
  useEffect(load, [id]);

  function generateEstimate() {
    setBusy(true); setMsg(null);
    api.post('/mrr/' + id + '/generate-estimate', {})
      .then(function (r) { setBusy(false); nav('/estimate/' + r.data.estimateTaskId); })
      .catch(function (e) {
        setBusy(false);
        setMsg((e.response && e.response.data && e.response.data.error) || e.message);
      });
  }

  if (err) return <div style={{ padding: 20, color: '#8C3A2B' }}>{err}</div>;
  if (!m) return <div style={{ padding: 20, color: C.muted }}>Loading…</div>;

  var p = m.parent;
  var ready = m.readiness || { n: 0, m: 0 };
  // The STATUTORY clock, and only it, headlines. Others render beside it in their own grammar.
  var clocks = m.clocks || [];

  return (
    <div style={{ padding: '14px 16px', maxWidth: 1080 }}>

      {/* ── THE MASTER CARD ─────────────────────────────────────────────────────────────────── */}
      <div style={{ background: C.surface2, border: '1px solid ' + G.line, borderRadius: 6,
        padding: '10px 13px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: G.navy, fontSize: 14, fontFamily: C.mono }}>{p.requestNumber}</span>
          <span style={{ fontWeight: 700, color: G.navy, fontSize: 14 }}>{m.itemCount} items</span>
          <span style={kv}><b style={{ color: C.ink }}>{p.requestorName}</b> · {p.requestorEmail} ·
            delivery: {p.deliveryMethod || 'email'} · received {String(p.createdAt || '').slice(0, 10)}
            {p.submissionChannel ? ' (' + p.submissionChannel + ')' : ''}</span>
          <span style={Object.assign({}, kv, { marginLeft: 'auto' })}>
            Manager: <b style={{ color: C.ink }}>{m.managerName || '—'}</b> · assigned until all items terminal
          </span>
        </div>

        {/* VERBATIM. The requestor's own words, at the top, never a paraphrase. */}
        <div style={{ marginTop: 8 }}>
          <SubmittedDescription title="Request Description as Submitted" margin="0">{p.description}</SubmittedDescription>
          <div style={Object.assign({}, kv, { marginTop: 3 })}>
            Itemized by the requestor as the {m.itemCount} record items below — each carries its own submitted wording.
          </div>
        </div>

        {/* THE CLOCK STRIP — MASTER ONLY. ClockChip picks its treatment from `kind`, never from a date. */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 9 }}>
          {clocks.length === 0 ? (
            <ClockChip kind="none" k="Response deadline">No statutory deadline in this jurisdiction</ClockChip>
          ) : clocks.map(function (c, i) {
            return (
              <ClockChip key={i} kind={c.kind}
                k={c.kind === 'response' || c.kind === 'agency_action' ? 'Statutory deadline — master'
                  : c.kind === 'operational_target' ? 'City service target' : c.label}
                citation={c.citation}>
                {c.dueDate ? 'Respond by ' + c.dueDate : (c.label || '—')}
              </ClockChip>
            );
          })}
          <span style={kv} title={m.clockScope}>{m.clockScope}</span>
        </div>

        {/* REQUESTOR-LEVEL CHIPS — Draft-1 bindings, parent-scoped. There is no intake-review stop on an
            MRR, so these checks would otherwise have no surface at all on this request. */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 8 }}>
          {findings == null ? <span style={kv}>Eligibility · loading…</span>
            : (findings.blocks || []).length
              // A BLOCK is a person's call, never the system's (rule c) — so it is badged 'person'.
              ? <DecidedByBadge by="person">Eligibility · {findings.blocks.length} condition needs a decision</DecidedByBadge>
              : findings.openReviews
                ? <DecidedByBadge by="person">Eligibility · {findings.openReviews} review awaiting confirmation</DecidedByBadge>
                : (findings.advisories || []).length
                  // An ADVISORY is recorded, not decided. Ghost/dashed: there is nothing here to act on.
                  ? <DecidedByBadge by="recorded">Eligibility · {findings.advisories.length} advisory recorded</DecidedByBadge>
                  : <DecidedByBadge by="recorded">Eligibility · nothing raised</DecidedByBadge>}
          {ledger == null ? <span style={kv}>Ledger · loading…</span>
            : ledger.anonymous
              // RULE (e): an anonymous requestor's history DOES NOT APPLY. Never "hidden", which reads as
              // something withheld from the reader rather than something that does not exist.
              ? <DecidedByBadge by="recorded">Ledger · anonymous — does not apply</DecidedByBadge>
              : <DecidedByBadge by="system">Ledger · prior balance {ledger.balance && ledger.balance.outstanding != null ? '$' + Number(ledger.balance.outstanding).toFixed(2) : 'none'}</DecidedByBadge>}
          <DecidedByBadge by="recorded">
            Parent state · {p.state === 'complete' ? 'Complete' : 'In Process'} (derived)
          </DecidedByBadge>
        </div>
        <div style={Object.assign({}, kv, { marginTop: 4 })}>{p.stateNote}</div>

        {/* ── THE READINESS METER AND ITS ONE BUTTON ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, borderRadius: 4,
            padding: '3px 10px', background: C.surface, border: '1px solid ' + (ready.ready ? G.statute : G.line),
            color: ready.ready ? G.statute : C.ink }}>
            Estimate data: <b style={{ color: ready.ready ? G.statute : G.navy }}>{ready.n} of {ready.m} items complete</b>
            {ready.ready ? ' ✓' : ''}
          </span>
          <button onClick={generateEstimate} disabled={!ready.ready || !m.canManage || busy}
            style={Object.assign({}, btn, ready.ready && m.canManage
              // ARMED AND HIGHLIGHTED at m of m, exactly as Kevin drew it.
              ? { boxShadow: '0 0 0 3px ' + G.amberBg, border: '1px solid ' + G.amberLine }
              : { opacity: 0.45, cursor: 'not-allowed' })}>
            {busy ? 'Arming…' : 'Generate estimate'}
          </button>
          <span style={kv}>
            {ready.ready
              ? 'One estimate for the master record, through the standard engine.'
              : '— activates and highlights when ' + ready.m + ' of ' + ready.m + ' are complete'}
          </span>
        </div>
        <div style={Object.assign({}, kv, { marginTop: 4 })}>{ready.armingRule}</div>
        {!ready.ready && (ready.pending || []).length ? (
          <div style={Object.assign({}, kv, { marginTop: 3 })}>
            Waiting on: {(ready.pending || []).map(function (x) { return x.label; }).join(' · ')}
          </div>
        ) : null}
        {msg ? <div style={{ fontSize: 12.5, color: '#8C3A2B', marginTop: 6 }}>{msg}</div> : null}
      </div>

      {/* ── ONE BAR PER CHILD ───────────────────────────────────────────────────────────────── */}
      <div style={panelHead}>Items — click a bar to open the child record</div>
      {(m.items || []).map(function (it) {
        return (
          <div key={it.id} onClick={function () { nav('/mrr/' + id + '/item/' + it.id); }}
            style={{ display: 'flex', gap: 10, alignItems: 'center', border: '1px solid ' + G.line,
              borderRadius: 6, background: C.surface, padding: '8px 12px', marginBottom: 7,
              flexWrap: 'wrap', cursor: 'pointer' }}>
            <span style={{ fontWeight: 700, color: G.navy, fontSize: 12.5, whiteSpace: 'nowrap' }}>{it.label}</span>
            {/* A TRUNCATION of the requestor's wording — never a summary. */}
            <span style={{ color: C.muted, fontSize: 12.5, flex: '1 1 220px', minWidth: 180 }}>
              {it.descriptionShort}
              {it.attachmentCount ? (
                <span style={{ display: 'inline-block', fontSize: 11, border: '1px solid ' + G.line,
                  borderRadius: 4, padding: '1px 7px', background: C.surface2, color: C.muted,
                  fontWeight: 600, marginLeft: 6 }}>📎 {it.attachmentCount}</span>
              ) : null}
            </span>
            {(it.activities || []).map(function (a) {
              return <ActChip key={a.activity} activity={a.activity} status={a.status} />;
            })}
            <span style={kv}>{it.assigneeName || '—'}</span>
            {it.defect ? <Tag kind="vague" title={'Clarification outstanding since ' + it.defect.at}>{it.defect.label}</Tag> : null}
            {it.denial && it.denial.designated
              ? <Tag kind="denial" title={it.denial.grounds}>Denial designated → Legal Review</Tag> : null}
            {it.external ? <Tag kind="ext" title={'Secure link to ' + it.external.email + (it.external.expiresAt ? ' · expires ' + it.external.expiresAt : '')}>
              {'External · ' + ({ sent: 'link sent', opened: 'link opened', completed: 'complete', expired: 'link EXPIRED', revoked: 'link revoked' }[it.external.linkState] || it.external.linkState)}
            </Tag> : null}
            {it.status === 'closed' ? <Tag kind="closed">{it.closureReason || 'Ended'}</Tag> : null}
          </div>
        );
      })}

      <div style={Object.assign({}, kv, { marginTop: 8 })}>{m.orderNote}</div>

      {/* ── ONE REQUEST, ONE VOICE ──────────────────────────────────────────────────────────── */}
      <div style={{ background: C.surface, border: '1px solid ' + G.line, borderRadius: 6,
        padding: '11px 13px', marginTop: 14, maxWidth: 420 }}>
        <div style={panelHead}>One request, one voice</div>
        {m.oneVoice && m.oneVoice.contactRequestorHere ? (
          <a href={'mailto:' + (p.requestorEmail || '')} style={Object.assign({}, btn, { textDecoration: 'none', display: 'inline-block' })}>
            Contact requestor…
          </a>
        ) : null}
        <div style={Object.assign({}, kv, { marginTop: 6 })}>{m.oneVoice ? m.oneVoice.note : ''}</div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to={'/requests/' + p.id} style={Object.assign({}, btnQuiet, { textDecoration: 'none' })}>Master record</Link>
          <Link to={'/requests/' + p.id + '/dispositions'} style={Object.assign({}, btnQuiet, { textDecoration: 'none' })}>Dispositions</Link>
          {/* BW7 — THE FINANCIAL VIEW. Routed on the PARENT id rather than the hub task, because money is a
              parent fact (§4.3): one request, one ledger, however it is reached. */}
          <Link to={'/requests/' + p.id + '/financial'} style={Object.assign({}, btnQuiet, { textDecoration: 'none' })}>Financial view</Link>
        </div>
        {/* NO CLOSE CONTROL. A parent is never closed by hand (§5.8) — the absence is the design. */}
      </div>

      <div style={{ fontSize: 12.5, marginTop: 12 }}>
        <Link to="/mrr" style={{ color: G.navy }}>← My MRRs</Link>
        <span style={{ color: C.faint }}> · </span>
        <Link to="/my-tasks" style={{ color: G.navy }}>My Tasks</Link>
      </div>
    </div>
  );
}
