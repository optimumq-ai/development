import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { G, StatusChip, GateChecklist, ConfirmPopup, ClockChip } from '../components/primitives';
import { useAuthStore } from '../store/authStore';

// BW9a — JURISDICTION CONFIGURATION: THE GO-LIVE CHECKLIST (Draft 6, residuals decided 2026-08-11).
//
// Two screens on one route family:
//   /jurisdiction-config            the section readiness index — the computed gate summary, one row
//                                   per profile section, attest/re-open per row, and the go-live
//                                   ceremony once every pill is green (Kevin: guided ceremony).
//   /jurisdiction-config/:section   the section detail — one card per LOCAL POLICY SETTING (what the
//                                   statute left to the city), each carrying the template's
//                                   suggestion rendered dashed-amber ("a starting point, never an
//                                   answer") and a Confirm that records name + date. The attest
//                                   panel restates the attest() gate in words.
//
// COMPLIANCE POSTURE (rule d, carried from the drafts):
//  - everything here is COMPUTED from the same sources the engine enforces — policy settings from
//    the stores, attestation from section hashes, findings from configIntegrity. Nothing asserted.
//  - a section the state never configured renders honestly (never an alarm, never a default).
//  - confirming the suggested default is still a decision, recorded as one — the suggestion chip
//    stays visible on a confirmed card.
//  - ownership is display metadata; the enforcement lives server-side (Senior Legal attests the
//    Legal Rules sections; the enforcement flip is System Administrator only).

var LEGAL_SECTIONS = { exemption: 1, redaction: 1, deadlines: 1 };
var LEGAL_DOMAINS = { exemption: 1, redaction: 1, deadline: 1, clock_matrix: 1 };

var page = { maxWidth: 1120, margin: '0 auto', padding: '18px 20px 60px' };
var h1 = { fontSize: 17, fontWeight: 700, color: G.navy, margin: '0 0 2px' };
var sub = { fontSize: 12.5, color: C.muted, margin: '0 0 14px' };
var panel = { background: C.surface, border: '1px solid ' + G.line, borderRadius: 8, padding: '12px 14px', marginBottom: 12 };
var railHead = { fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: C.muted, marginBottom: 6 };
var btn = { font: 'inherit', fontSize: 12.5, fontWeight: 600, borderRadius: 5, padding: '5px 12px', cursor: 'pointer', background: C.blue, color: '#fff', border: '1px solid ' + C.blue };
var btnSec = Object.assign({}, btn, { background: C.surface, color: C.blue });
var btnQuiet = Object.assign({}, btn, { background: C.surface2, color: C.ink, border: '1px solid ' + G.line, fontWeight: 500 });
var btnOff = Object.assign({}, btn, { opacity: 0.45, cursor: 'not-allowed' });
var kv = { fontSize: 12.5, color: C.muted };

function pill(toneStyle, content, key) {
  return <span key={key} style={Object.assign({ display: 'inline-block', fontSize: 11.5, fontWeight: 700,
    borderRadius: 4, padding: '3px 10px', border: '1px solid ' + G.line, background: C.surface,
    color: C.muted }, toneStyle)}>{content}</span>;
}
var pillWarn = { borderColor: G.amberLine, background: G.amberBg, color: G.amberInk };
var pillBad = { borderColor: '#C08A7E', background: '#F7E9E5', color: '#8C3A2B' };
var pillOk = { borderColor: G.statute, background: G.statuteBg, color: G.statute };

// The section-row status, in the mockup's vocabulary. Only ACTIVE-on-unconfirmed and drift are
// alarms; "not configured" is the honest quiet state.
function rowStatus(sec, summary) {
  if (sec.section === 'branches' && summary && summary.activeBranchUnconfirmed.length > 0) {
    return { tone: 'bad', label: 'ACTIVE + unconfirmed parameter' };
  }
  if (sec.readiness === 'needs_reattestation') return { tone: 'bad', label: 'Drifted — re-attest' };
  if (sec.readiness === 'attested') return { tone: 'attested', label: 'Attested ✓' };
  if (sec.unconfirmed > 0) return { tone: 'unconf', label: (sec.status === 'not_configured' ? 'Imported — ' : '') + sec.unconfirmed + ' unconfirmed' };
  if (sec.status === 'not_configured') return { tone: 'empty', label: 'Not configured' };
  return { tone: 'configured', label: 'Configured (ready to attest)' };
}

function GateSummary(props) {
  var s = props.summary;
  if (!s) return null;
  var live = s.live;
  return (
    <div style={{ background: C.surface2, border: '1px solid ' + G.line, borderRadius: 6, padding: '11px 14px', marginBottom: 13 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: s.ready ? G.statute : '#8C3A2B' }}>
          {live ? 'LIVE — ENFORCEMENT ON' : (s.ready ? 'READY FOR GO-LIVE' : 'NOT READY FOR GO-LIVE')}
        </span>
        {pill(s.unconfirmedSettings > 0 ? pillWarn : pillOk,
          <span><b>{s.unconfirmedSettings}</b> unconfirmed policy settings{s.sectionsWithUnconfirmed > 0 ? ' · ' + s.sectionsWithUnconfirmed + ' sections' : ''}</span>, 'k')}
        {pill(s.proposalsPending > 0 ? pillWarn : pillOk, <span><b>{s.proposalsPending}</b> proposals pending</span>, 'p')}
        {s.activeBranchUnconfirmed.length > 0
          ? pill(pillBad, <span><b>{s.activeBranchUnconfirmed.length}</b> active branch(es) on an unconfirmed parameter</span>, 'b')
          : pill(pillOk, <span>no active branch on an unconfirmed parameter</span>, 'b')}
        {pill(s.sectionsAttested === s.sectionsTotal ? pillOk : {}, <span><b>{s.sectionsAttested}</b> of {s.sectionsTotal} sections attested</span>, 'a')}
        {pill(s.devMode ? pillBad : pillOk, <span>Enforcement: <b>{s.devMode ? 'dev mode ON' : 'ON (live)'}</b></span>, 'e')}
      </div>
      <p style={Object.assign({}, kv, { marginTop: 6, marginBottom: 0 })}>
        Everything above is computed, nothing is asserted: policy settings from the imported template and the
        code-defined services, proposals from the review queue, attestation from the section hashes. When every
        pill is green this city is configured — not before.
      </p>
    </div>
  );
}

// ── the go-live ceremony (Kevin 2026-08-11: guided — green checklist → typed confirm → flip) ────
function Ceremony(props) {
  var s = props.summary;
  var [typed, setTyped] = useState('');
  var [busy, setBusy] = useState(false);
  var [err, setErr] = useState('');
  if (!s) return null;
  var rows = [
    { ok: s.unconfirmedSettings === 0, label: 'Every local policy setting is confirmed by name (' + s.unconfirmedSettings + ' open)' },
    { ok: s.proposalsPending === 0, label: 'No configuration proposals await review (' + s.proposalsPending + ' pending)' },
    { ok: s.activeBranchUnconfirmed.length === 0, label: 'No ACTIVE branch runs on an unconfirmed parameter' },
    { ok: s.sectionsAttested === s.sectionsTotal, label: 'Every section is attested (' + s.sectionsAttested + ' of ' + s.sectionsTotal + ')' },
    { ok: s.sectionsDrifted === 0, label: 'No attested section has drifted' }
  ];
  function flip() {
    setBusy(true); setErr('');
    api.post('/jurisdiction-profile/enforcement', { devMode: false })
      .then(function () { props.onDone(); })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'The flip was refused.'); })
      .then(function () { setBusy(false); });
  }
  return (
    <ConfirmPopup open={props.open} onClose={props.onClose} title="Go live — turn enforcement on"
      actions={[
        <button key="go" type="button" disabled={busy || typed !== 'GO LIVE'}
          style={typed === 'GO LIVE' && !busy ? btn : btnOff} onClick={flip}>Turn enforcement on</button>,
        <button key="no" type="button" style={btnQuiet} onClick={props.onClose}>Not yet</button>
      ]}>
      <GateChecklist title="The checklist this act relies on" rows={rows} />
      <p style={Object.assign({}, kv, { margin: '10px 0 6px' })}>
        Turning dev mode off is the go-live act: from this moment the attestation gates refuse for real. It is a
        System Administrator's act, informed by this checklist. Type <b style={{ color: C.ink }}>GO LIVE</b> to enable the button.
      </p>
      <input value={typed} onChange={function (e) { setTyped(e.target.value); }} placeholder="GO LIVE"
        style={{ font: 'inherit', fontSize: 13, padding: '5px 9px', border: '1px solid ' + G.line, borderRadius: 5, width: 160 }} />
      {err ? <div style={{ color: C.crit, fontSize: 12.5, marginTop: 6 }}>{err}</div> : null}
    </ConfirmPopup>
  );
}

// ── one local-policy-setting card (the unit of the whole screen — Draft 6 annotation 6) ─────────
function SettingCard(props) {
  var st = props.setting;
  var [val, setVal] = useState(st.value != null ? String(st.value) : (st.suggestedDefault != null ? String(st.suggestedDefault) : ''));
  var [busy, setBusy] = useState(false);
  var [err, setErr] = useState('');
  var open = st.kind === 'dimension' ? (st.gated && !st.confirmed) : !st.confirmed;
  function confirmIt() {
    setBusy(true); setErr('');
    api.post('/jurisdiction-profile/policy-settings/confirm', { domain: st.domain, path: st.path, value: val })
      .then(function () { props.onChanged(); })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Refused.'); })
      .then(function () { setBusy(false); });
  }
  return (
    <div style={{ border: '1px solid ' + (st.confirmed ? G.statute : G.line), borderRadius: 6,
      padding: '10px 12px', marginBottom: 9, background: C.surface }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: G.navy }}>{st.label}</span>
        {st.suggestedDefault != null ? (
          <span style={{ display: 'inline-block', fontSize: 11, border: '1px dashed ' + G.amberLine,
            background: G.amberBg, color: G.amberInk, borderRadius: 3, padding: '1px 8px', fontWeight: 700 }}>
            suggested: {String(st.suggestedDefault)}
          </span>
        ) : null}
        {st.confirmed
          ? <StatusChip tone="attested">Confirmed{st.confirmedBy ? ' · ' + st.confirmedBy : ''}{st.confirmedAt ? ' · ' + String(st.confirmedAt).slice(0, 10) : ''}</StatusChip>
          : (open ? <StatusChip tone="unconf">Unconfirmed</StatusChip> : <StatusChip tone="empty">Not gated — nothing to decide yet</StatusChip>)}
      </div>
      {st.note ? <div style={{ fontSize: 12.5, color: C.ink, marginTop: 4, maxWidth: '78ch' }}>{st.note}</div> : null}
      {st.confirmed && st.value != null ? (
        <div style={Object.assign({}, kv, { marginTop: 5 })}>Value: <b style={{ color: C.ink }}>{String(st.value)}</b></div>
      ) : null}
      {open && props.canConfirm ? (
        <div style={{ marginTop: 7, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={val} onChange={function (e) { setVal(e.target.value); }}
            style={{ font: 'inherit', fontSize: 13, padding: '4px 9px', border: '1px solid ' + G.line, borderRadius: 4, minWidth: 220 }} />
          <button type="button" disabled={busy} style={busy ? btnOff : btn} onClick={confirmIt}>Confirm this value</button>
          <span style={kv}>records your name + date on the setting</span>
        </div>
      ) : null}
      {open && !props.canConfirm ? (
        <div style={Object.assign({}, kv, { marginTop: 6 })}>
          Awaiting the owner's confirmation — {props.ownerLabel || 'the owning group'} decides this one.
        </div>
      ) : null}
      {err ? <div style={{ color: C.crit, fontSize: 12.5, marginTop: 6 }}>{err}</div> : null}
    </div>
  );
}

// ═══════════════════════════════ BW9b — THE RULE-CONTENT EDITORS ═══════════════════════════════
// Draft 10 as decided 2026-08-11: each section screen holds four zones — Content · Local Policy
// Settings · Provenance · Proposals. Two kinds of content, one visual grammar: statute-derived
// facts carry the navy solid edge + citation chip and edit ONLY through the proposal composer
// (citation + note required); local policy settings are the dashed-amber cards of the zone next
// door. A reader never wonders which kind they face.

function CiteChip(props) {
  if (!props.children) return null;
  return <span style={{ display: 'inline-block', fontSize: 10.5, color: G.navy, background: C.surface2,
    border: '1px solid ' + G.line, borderRadius: 3, padding: '0 6px', fontWeight: 600,
    whiteSpace: 'nowrap', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }}>{props.children}</span>;
}
function WiredBadge(props) {
  return props.wired
    ? <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
        background: G.statuteBg, color: G.statute, border: '1px solid ' + G.statute, borderRadius: 3, padding: '1px 6px' }}>wired</span>
    : <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
        background: C.surface, color: G.ghost, border: '1px dashed ' + G.ghost, borderRadius: 3, padding: '1px 6px' }}>content-only</span>;
}
// A statute-derived fact row: navy solid edge, cited — editing it is asserting the law.
function FactRow(props) {
  return (
    <div style={{ border: '1px solid ' + G.line, borderLeft: '4px solid ' + G.navy, borderRadius: 5,
      padding: '8px 11px', marginBottom: 7, background: C.surface }}>
      <div style={{ fontWeight: 600, color: C.ink, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>{props.title}</div>
      {props.children ? <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{props.children}</div> : null}
    </div>
  );
}

// The research-text drill-down (decided IN): the full record behind a cited fact.
function ResearchPopup(props) {
  var [rec, setRec] = useState(null);
  var [err, setErr] = useState('');
  useEffect(function () {
    if (!props.ruleId) return undefined;
    var alive = true;
    setRec(null); setErr('');
    api.get('/jurisdiction-profile/rules-research/' + props.ruleId)
      .then(function (r) { if (alive) setRec(r.data.rule); })
      .catch(function (e) { if (alive) setErr((e.response && e.response.data && e.response.data.error) || 'Unavailable.'); });
    return function () { alive = false; };
  }, [props.ruleId]);
  return (
    <ConfirmPopup open={!!props.ruleId} onClose={props.onClose} title={'Research record — ' + (props.ruleId || '')}
      actions={[<button key="c" type="button" style={btnQuiet} onClick={props.onClose}>Close</button>]}>
      {err ? <div style={{ color: C.muted, fontSize: 12.5 }}>{err}</div> : null}
      {rec ? (
        <div style={{ fontSize: 12.5, maxHeight: '58vh', overflowY: 'auto' }}>
          <div style={{ fontWeight: 700, color: G.navy }}>{rec.legal_concept}</div>
          <div style={{ margin: '4px 0' }}><CiteChip>{rec.source_authority || rec.concept_key}</CiteChip> <span style={kv}>{rec.rule_type}{rec.category ? ' · ' + rec.category : ''}</span></div>
          <div style={{ margin: '7px 0' }}><b>The rule:</b> {rec.atomic_rule}</div>
          {rec.trigger ? <div style={Object.assign({}, kv, { margin: '5px 0' })}><b style={{ color: C.ink }}>Trigger:</b> {rec.trigger}</div> : null}
          {rec.source_language ? (
            <div style={{ borderLeft: '4px solid ' + G.navy, background: C.surface2, borderRadius: 4, padding: '7px 10px', margin: '8px 0' }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted, marginBottom: 3 }}>
                Statute language{rec.is_paraphrase ? ' (paraphrase)' : ' (verbatim)'}</div>
              <div style={{ fontStyle: 'italic' }}>{rec.source_language}</div>
            </div>
          ) : null}
          {rec.official_link ? <div style={kv}>Official source: <a href={rec.official_link} target="_blank" rel="noreferrer" style={{ color: C.blue }}>{rec.official_link}</a></div> : null}
        </div>
      ) : (!err ? <div style={kv}>Loading…</div> : null)}
    </ConfirmPopup>
  );
}

// The proposal composer — every content edit is a proposal, one audit path, no exceptions.
// `seed` shapes the form: {clockType, row} → the structured Frame C editor; {field} → a policy
// field editor; otherwise the full-config JSON editor. Submit builds the FULL proposed config.
// ── FEE VALUE COMPOSER (Draft 11, approved mockup 2026-08-21) ────────────────────────────────
// Replaces the raw-JSON fallback for the fees section: one labeled row per fee value, with what
// state law allows shown beside the input (bounds from the verified 32-state fee layer). An entry
// above a state ceiling is refused inline AND server-side. Files a DRAFT fee-profile version —
// review, test and activate stay on the Fee Configuration screen.
var FEE_FIELDS = [
  { g: 'Copy charges', key: 'duplication.bw.rate', label: 'Charge per black-and-white copy', unit: '$ / page' },
  { g: 'Copy charges', key: 'duplication.color.rate', label: 'Charge per color copy', unit: '$ / page' },
  { g: 'Copy charges', key: 'duplication.oversized.rate', label: 'Charge per oversized copy', unit: '$ / page' },
  { g: 'Copy charges', key: 'duplication.specialty.rate', label: 'Charge per specialty item', unit: '$ / item' },
  { g: 'Copy charges', key: 'certification.rate', label: 'Charge to certify a copy', unit: '$ / record' },
  { g: 'Staff time', key: 'labor.search.rate', label: 'Search time — hourly rate', unit: '$ / hour' },
  { g: 'Staff time', key: 'labor.review.rate', label: 'Review & redaction time — hourly rate', unit: '$ / hour' },
  { g: 'Staff time', key: 'labor.programming.rate', label: 'Programming time — hourly rate', unit: '$ / hour' },
  { g: 'Staff time', key: 'labor.overheadPct', label: 'Overhead added to staff-time charges', unit: '%' },
  { g: 'Free allowances', key: 'requestRules.freePageAllowance', label: 'Free pages before copy charges start', unit: 'pages' },
  { g: 'Free allowances', key: 'requestRules.freeLaborHours', label: 'Free staff hours before time charges start', unit: 'hours' },
  { g: 'Estimates & deposits', key: 'requestRules.estimateNotifyThreshold', label: 'Send a written estimate when the total reaches', unit: '$' },
  { g: 'Estimates & deposits', key: 'requestRules.deposit.threshold', label: 'Require a deposit when the estimate reaches', unit: '$' },
  { g: 'Estimates & deposits', key: 'requestRules.deposit.percent', label: 'Deposit amount', unit: '% of estimate' },
  { g: 'Estimates & deposits', key: 'estimatePolicy.requesterResponseDays', label: 'Days a requestor has to respond to an estimate', unit: 'business days' },
  { g: 'Estimates & deposits', key: 'estimatePolicy.revisionNotifyPercent', label: 'Re-notify the requestor if the cost changes by more than', unit: '%' },
  { g: 'Estimates & deposits', key: 'estimatePolicy.estimateValidityDays', label: 'Days an estimate stays valid', unit: 'days' },
  { g: 'Limits & rounding', key: 'requestRules.deMinimis', label: 'Waive totals at or below', unit: '$' },
  { g: 'Limits & rounding', key: 'requestRules.minFee', label: 'Minimum charge', unit: '$' },
  { g: 'Limits & rounding', key: 'requestRules.maxFee', label: 'Maximum charge per request', unit: '$' },
  { g: 'Media & delivery', key: 'media.cd', label: 'CD', unit: '$ / item' },
  { g: 'Media & delivery', key: 'media.dvd', label: 'DVD', unit: '$ / item' },
  { g: 'Media & delivery', key: 'media.usb', label: 'USB drive', unit: '$ / item' },
  { g: 'Media & delivery', key: 'delivery.mail', label: 'Postage & mailing', unit: '$' },
  { g: 'Media & delivery', key: 'delivery.handling', label: 'Handling', unit: '$' },
  { g: 'Media & delivery', key: 'av.perRecording', label: 'Audio / video — per recording', unit: '$' },
  { g: 'Media & delivery', key: 'av.perMinute', label: 'Audio / video — per minute', unit: '$ / minute' }
];
function getPath(obj, dotted) {
  var cur = obj; var parts = dotted.split('.');
  for (var i = 0; i < parts.length; i++) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[parts[i]]; }
  return cur;
}
function setPath(obj, dotted, val) {
  var parts = dotted.split('.'); var cur = obj;
  for (var i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}
function boundProblem(bound, num) {
  if (!bound || bound.value == null || num == null || isNaN(num)) return null;
  if (bound.kind === 'ceiling' && num > bound.value) return 'Above the state limit — this cannot be submitted.';
  if (bound.kind === 'fixed' && num > bound.value) return 'Above the statute-set figure — this cannot be submitted.';
  if (bound.kind === 'floor' && num < bound.value) return 'Below the state minimum — this cannot be submitted.';
  return null;
}

function FeeComposerPopup(props) {
  var [loading, setLoading] = useState(true);
  var [loadErr, setLoadErr] = useState('');
  var [code, setCode] = useState(null);
  var [jid, setJid] = useState(null);
  var [bounds, setBounds] = useState({});
  var [base, setBase] = useState(null);      // the active FR profile config (or {} when none)
  var [baseName, setBaseName] = useState('');
  var [entries, setEntries] = useState({});  // key -> raw input string
  var [note, setNote] = useState('');
  var [citation, setCitation] = useState('');
  var [busy, setBusy] = useState(false);
  var [err, setErr] = useState('');
  var [filed, setFiled] = useState(null);

  useEffect(function () {
    var alive = true;
    (async function () {
      try {
        var b = await api.get('/fee-profiles/bounds');
        if (!alive) return;
        setCode(b.data.code); setJid(b.data.jurisdiction_id); setBounds(b.data.bounds || {});
        var list = await api.get('/fee-profiles', { params: { jurisdiction_id: b.data.jurisdiction_id } });
        var rows = (list.data.profiles || []).filter(function (p) { return p.context === 'FR'; });
        var pick = rows.find(function (p) { return p.status === 'active'; }) || rows[0];
        if (pick) {
          var full = await api.get('/fee-profiles/' + pick.id);
          if (!alive) return;
          setBase(full.data.profile.config || {}); setBaseName(pick.name || pick.id);
        } else { setBase({}); setBaseName('(no fee configuration exists yet — values start blank)'); }
      } catch (e) { if (alive) setLoadErr('Could not load the fee configuration or the state bounds.'); }
      if (alive) setLoading(false);
    })();
    return function () { alive = false; };
  }, []);

  var rows = FEE_FIELDS.map(function (f) {
    var bound = bounds && bounds[f.key];
    var cur = base ? getPath(base, f.key) : undefined;
    var raw = entries[f.key];
    var touched = raw != null && String(raw).trim() !== '';
    var num = touched ? Number(String(raw).replace(/[$,]/g, '')) : null;
    var bad = touched && isNaN(num) ? 'Enter a number.' : boundProblem(bound, num);
    var statutory = bound && (bound.kind === 'ceiling' || bound.kind === 'floor' || bound.kind === 'fixed' || bound.kind === 'actual_cost');
    return { f: f, bound: bound, cur: cur, raw: raw, touched: touched, num: num, bad: bad, statutory: statutory };
  });
  var changed = rows.filter(function (r) { return r.touched && !r.bad; });
  var blocked = rows.filter(function (r) { return r.touched && r.bad; });
  var statutoryChanged = changed.some(function (r) { return r.statutory; });
  var canSubmit = !busy && changed.length > 0 && blocked.length === 0 && note.trim() && (!statutoryChanged || citation.trim());

  function submit() {
    setErr(''); setBusy(true);
    var cfg = JSON.parse(JSON.stringify(base || {}));
    changed.forEach(function (r) { setPath(cfg, r.f.key, r.num); });
    cfg._proposal = { note: note, citation: citation || null, changed: changed.map(function (r) { return r.f.key; }),
      from: baseName, via: 'jurisdiction-config/fees composer' };
    api.post('/fee-profiles', { jurisdiction_id: jid, context: 'FR',
      name: 'Proposed from Fee & cost schedule — ' + new Date().toISOString().slice(0, 10), config: cfg })
      .then(function () { setFiled('Filed as a DRAFT fee configuration (' + changed.length + ' change' + (changed.length === 1 ? '' : 's') + '). It does not price anything until it is reviewed, tested and made active on the Fee Configuration screen.'); })
      .catch(function (e) {
        var d = e.response && e.response.data;
        setErr((d && d.error) || 'Refused.');
        if (d && d.violations) setErr(d.error + ' ' + d.violations.map(function (v) { return v.message; }).join(' '));
      })
      .then(function () { setBusy(false); });
  }

  var inputStyle = { font: 'inherit', fontSize: 12.5, border: '1px solid ' + G.line, borderRadius: 5, padding: '6px 9px', background: C.surface, color: C.ink, width: 90 };
  var groups = [];
  rows.forEach(function (r) { if (!groups.length || groups[groups.length - 1].g !== r.f.g) groups.push({ g: r.f.g, rows: [] }); groups[groups.length - 1].rows.push(r); });

  return (
    <ConfirmPopup open={true} onClose={props.onClose} title={'Propose change — Fee & cost schedule' + (code ? ' (' + code + ')' : '')}
      actions={filed ? [<button key="c" type="button" style={btnQuiet} onClick={function () { props.onDone(null); }}>Close</button>]
        : [
          <button key="s" type="button" disabled={!canSubmit} style={canSubmit ? btn : btnOff} onClick={submit}>File as draft fee configuration</button>,
          <button key="x" type="button" style={btnQuiet} onClick={props.onClose}>Cancel</button>
        ]}>
      {filed ? <div style={{ fontSize: 12.5, color: C.ink }}>{filed}</div>
        : loading ? <div style={kv}>Loading the current fee configuration and this state's legal limits…</div>
        : loadErr ? <div style={{ color: C.crit, fontSize: 12.5 }}>{loadErr}</div>
        : (
        <div>
          <div style={Object.assign({}, kv, { marginBottom: 8 })}>
            Every answer shows what state law allows next to it. Change only what you need — untouched answers stay as they are.
            Starting from: <b style={{ color: C.ink }}>{baseName}</b>
          </div>
          <div style={{ maxHeight: '48vh', overflowY: 'auto', paddingRight: 4 }}>
            {groups.map(function (grp) {
              return (
                <div key={grp.g}>
                  <div style={Object.assign({}, railHead, { marginTop: 6 })}>{grp.g}</div>
                  {grp.rows.map(function (r) {
                    var rowStyle = r.statutory
                      ? { border: '1px solid ' + G.line, borderLeft: '4px solid ' + G.navy, borderRadius: 5, padding: '7px 10px', marginBottom: 6, background: C.surface, display: 'flex', gap: 12, alignItems: 'flex-start' }
                      : { border: '1px dashed ' + G.amberLine, borderLeft: '4px solid ' + G.amberLine, borderRadius: 5, padding: '7px 10px', marginBottom: 6, background: G.amberBg, display: 'flex', gap: 12, alignItems: 'flex-start' };
                    return (
                      <div key={r.f.key} style={rowStyle}>
                        <div style={{ flex: '1 1 0', minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{r.f.label}</div>
                          <div style={{ display: 'inline-block', marginTop: 4, fontSize: 10.5, fontWeight: 600, borderRadius: 3, padding: '1px 7px',
                            color: r.statutory ? G.navy : G.amberInk,
                            background: r.statutory ? C.surface2 : C.surface,
                            border: r.statutory ? '1px solid ' + G.line : '1px dashed ' + G.amberLine }}>
                            {r.bound ? r.bound.text : 'THE LAW IS SILENT — your city decides.'}
                          </div>
                        </div>
                        <div style={{ flex: 'none', width: 200 }}>
                          <div style={{ fontSize: 11, color: C.faint }}>Current: <b style={{ color: C.ink }}>{r.cur == null ? '—' : String(r.cur)}</b></div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                            <input value={r.raw || ''} placeholder="unchanged"
                              onChange={function (e) { var v = e.target.value; setEntries(function (prev) { var n = Object.assign({}, prev); n[r.f.key] = v; return n; }); }}
                              style={r.bad ? Object.assign({}, inputStyle, { border: '1px solid ' + C.crit, background: C.critTint }) : inputStyle} />
                            <span style={{ fontSize: 11, color: C.muted }}>{r.f.unit}</span>
                          </div>
                          {r.bad ? <div style={{ fontSize: 11, color: C.crit, fontWeight: 600, marginTop: 3 }}>{r.bad}</div>
                            : r.touched ? <div style={{ fontSize: 11, color: C.green, fontWeight: 600, marginTop: 3 }}>Will be included.</div> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div style={Object.assign({}, kv, { margin: '9px 0 3px' })}>Citation <i>{statutoryChanged ? '(required — you are changing a law-bounded answer)' : '(needed only if you change a law-bounded answer)'}</i></div>
          <input value={citation} onChange={function (e) { setCitation(e.target.value); }}
            style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 12.5, border: '1px solid ' + G.line, borderRadius: 5, padding: '7px 9px', background: C.surface, color: C.ink }} />
          <div style={Object.assign({}, kv, { margin: '8px 0 3px' })}>Note <i>(required — the next reader needs to know why)</i></div>
          <textarea rows={2} value={note} onChange={function (e) { setNote(e.target.value); }}
            style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 12.5, border: '1px solid ' + G.line, borderRadius: 5, padding: '7px 9px', background: C.surface, color: C.ink }} />
          <div style={Object.assign({}, kv, { marginTop: 8 })}>
            This files a <b style={{ color: C.ink }}>draft fee configuration</b>: <b style={{ color: C.ink }}>{changed.length} change{changed.length === 1 ? '' : 's'} ready</b>
            {blocked.length ? <span> · <b style={{ color: C.crit }}>{blocked.length} blocked by a state limit</b></span> : null}.
            Review, test and activate it on the Fee Configuration screen. Nothing prices differently until then.
          </div>
          {err ? <div style={{ color: C.crit, fontSize: 12.5, marginTop: 7 }}>{err}</div> : null}
        </div>
      )}
    </ConfirmPopup>
  );
}

function ComposerPopup(props) {
  var seed = props.seed || {};
  var cur = props.currentConfig || {};
  var [duration, setDuration] = useState(seed.row && seed.row.durationRaw != null ? String(seed.row.durationRaw) : '');
  var [basis, setBasis] = useState((seed.row && seed.row.basis) || 'business_days');
  var [fieldVal, setFieldVal] = useState(seed.field ? String(seed.field.value != null ? seed.field.value : '') : '');
  var [jsonText, setJsonText] = useState(JSON.stringify(cur, null, 2));
  var [citation, setCitation] = useState(seed.row && seed.row.citation ? seed.row.citation : (seed.field && seed.field.citation) || '');
  var [note, setNote] = useState('');
  var [busy, setBusy] = useState(false);
  var [err, setErr] = useState('');
  var [filed, setFiled] = useState(null);

  function buildConfig() {
    if (seed.clockType) {
      var cfg = JSON.parse(JSON.stringify(cur));
      var def = (cfg.clocks || {})[seed.clockType] || {};
      var n = Number(duration);
      if (!isFinite(n)) throw new Error('The duration must be a number of days.');
      delete def.durationByClassification; delete def.default;
      def.duration = n; def.basis = basis;
      def.citation = citation || def.citation;
      cfg.clocks[seed.clockType] = def;
      return cfg;
    }
    if (seed.field) {
      var c2 = JSON.parse(JSON.stringify(cur));
      var v = fieldVal;
      if (seed.field.type === 'number') v = Number(fieldVal);
      if (seed.field.type === 'boolean') v = fieldVal === 'true';
      c2[seed.field.key] = v;
      return c2;
    }
    return JSON.parse(jsonText);
  }
  function submit(applyNow) {
    setErr(''); setBusy(true);
    var cfg;
    try { cfg = buildConfig(); }
    catch (e) { setErr(e.message); setBusy(false); return; }
    api.post('/jurisdiction-profile/rules/' + props.section + '/propose',
      { domain: props.domain, config: cfg, citation: citation, note: note, applyNow: applyNow })
      .then(function (r) {
        if (r.data.applied) { props.onDone(r.data); }
        else if (r.data.refusal) { setFiled('Filed for review. ' + r.data.refusal); }
        else { setFiled('Filed for review — it appears in this section’s Proposals zone and the review queue.'); }
      })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Refused.'); })
      .then(function () { setBusy(false); });
  }
  var inputStyle = { width: '100%', font: 'inherit', fontSize: 12.5, border: '1px solid ' + G.line, borderRadius: 5, padding: '7px 9px', marginTop: 4, background: C.surface, color: C.ink };
  return (
    <ConfirmPopup open={props.open} onClose={props.onClose} title={props.title}
      actions={filed ? [<button key="c" type="button" style={btnQuiet} onClick={function () { props.onDone(null); }}>Close</button>]
        : [
        props.canApply ? <button key="a" type="button" disabled={busy} style={busy ? btnOff : btn} onClick={function () { submit(true); }}>Submit &amp; apply (owner)</button> : null,
        <button key="r" type="button" disabled={busy} style={busy ? btnOff : btnSec} onClick={function () { submit(false); }}>Submit for review{props.canApply ? ' only' : ''}</button>,
        <button key="x" type="button" style={btnQuiet} onClick={props.onClose}>Cancel</button>
      ].filter(Boolean)}>
      {filed ? <div style={{ fontSize: 12.5, color: C.ink }}>{filed}</div> : (
        <div>
          {seed.clockType ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div><div style={kv}>Duration (days)</div>
                <input style={Object.assign({}, inputStyle, { width: 110 })} value={duration} onChange={function (e) { setDuration(e.target.value); }} /></div>
              <div><div style={kv}>Basis</div>
                <select style={Object.assign({}, inputStyle, { width: 170 })} value={basis} onChange={function (e) { setBasis(e.target.value); }}>
                  <option value="business_days">business days</option>
                  <option value="calendar_days">calendar days</option>
                </select></div>
            </div>
          ) : seed.field ? (
            <div>
              <div style={kv}>{seed.field.label} — new value</div>
              {seed.field.values ? (
                <select style={inputStyle} value={fieldVal} onChange={function (e) { setFieldVal(e.target.value); }}>
                  {seed.field.values.map(function (v) { return <option key={v} value={v}>{v}</option>; })}
                </select>
              ) : <input style={inputStyle} value={fieldVal} onChange={function (e) { setFieldVal(e.target.value); }} />}
            </div>
          ) : (
            <div>
              <div style={kv}>The full {props.domain} configuration (JSON) — edit in place</div>
              <textarea rows={10} style={Object.assign({}, inputStyle, { fontFamily: C.mono, fontSize: 11.5 })}
                value={jsonText} onChange={function (e) { setJsonText(e.target.value); }} />
            </div>
          )}
          <div style={Object.assign({}, kv, { marginTop: 8 })}>Citation for the change <i>(required — you are asserting what the law provides)</i></div>
          <input style={inputStyle} value={citation} onChange={function (e) { setCitation(e.target.value); }} />
          <div style={Object.assign({}, kv, { marginTop: 7 })}>Note <i>(required — the next reader needs why)</i></div>
          <textarea rows={2} style={inputStyle} value={note} onChange={function (e) { setNote(e.target.value); }} />
          <div style={Object.assign({}, kv, { margin: '9px 0 0' })}>
            This lands as a <b style={{ color: C.ink }}>proposal</b> in the existing review/apply flow.
            {props.canApply ? ' You are the owner — you may apply it in the same act.' : (props.legal ? ' Legal Rules content applies under Senior Legal — your proposal routes to them.' : '')}
            {' '}Applying recomputes the section’s content hash: an attested section will <b style={{ color: C.ink }}>drift</b> and demand re-attestation. Nothing edits silently.
          </div>
          {err ? <div style={{ color: C.crit, fontSize: 12.5, marginTop: 7 }}>{err}</div> : null}
        </div>
      )}
    </ConfirmPopup>
  );
}

export default function JurisdictionConfigPage() {
  var params = useParams();
  var nav = useNavigate();
  var store = useAuthStore();
  var [data, setData] = useState(null);
  var [summary, setSummary] = useState(null);
  var [integrity, setIntegrity] = useState(null);
  var [err, setErr] = useState('');
  var [popup, setPopup] = useState(null); // {kind:'attest'|'unattest', section} | {kind:'ceremony'} | {kind:'devmode-on'}
  var [busy, setBusy] = useState(false);
  var [tick, setTick] = useState(0);

  // v3 (S2): the API now decides by user-type claims — go_live authority for the flip, compliance_policy for
  // non-legal sections, legal_rules for the Legal Rules sections (oro_sysadmin does NOT hold legal_rules).
  var isSA = store.hasAuthority('go_live');
  var isDir = store.hasPermission('compliance_policy');
  var isLegal = store.hasPermission('legal_rules');

  var [rules, setRules] = useState(null);       // BW9b: the section's Content/Provenance/Proposals payload
  var [zone, setZone] = useState('content');
  var [composer, setComposer] = useState(null); // {domain, title, seed}
  var [drill, setDrill] = useState(null);       // ruleId for the research popup

  useEffect(function () {
    var alive = true;
    setErr('');
    Promise.all([
      api.get('/jurisdiction-profile/policy-settings'),
      api.get('/jurisdiction-profile/go-live'),
      api.get('/config-integrity').catch(function () { return null; }),
      params.section ? api.get('/jurisdiction-profile/rules/' + params.section).catch(function () { return null; }) : Promise.resolve(null)
    ]).then(function (r) {
      if (!alive) return;
      setData(r[0].data); setSummary(r[1].data);
      setIntegrity(r[2] && r[2].data ? r[2].data : null);
      setRules(r[3] && r[3].data ? r[3].data : null);
    }).catch(function (e) {
      if (alive) setErr((e.response && e.response.data && e.response.data.error) || 'This screen could not load.');
    });
    return function () { alive = false; };
  }, [tick, params.section]);

  function reload() { setTick(function (t) { return t + 1; }); }
  function canAttest(sectionKey) { return LEGAL_SECTIONS[sectionKey] ? isLegal : isDir; }
  function canConfirm(domain) { return LEGAL_DOMAINS[domain] ? isLegal : isDir; }

  function doAttest(section, un) {
    setBusy(true);
    api.post('/jurisdiction-profile/' + (un ? 'unattest' : 'attest'), { section: section })
      .then(function () { setPopup(null); reload(); })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Refused.'); setPopup(null); })
      .then(function () { setBusy(false); });
  }

  if (err && !data) return <div style={page}><div style={Object.assign({}, panel, { color: C.crit })}>{err}</div></div>;
  if (!data || !summary) return <div style={page}><div style={kv}>Loading the checklist…</div></div>;

  var jur = data.jurisdiction || {};
  var findings = (integrity && (integrity.findings || integrity.issues)) || [];

  // ── SCREEN 2 — the SECTION SCREEN (BW9b: Draft 10 zones over the BW9a detail) ───────────────
  if (params.section) {
    var sec = (data.sections || []).filter(function (s) { return s.section === params.section; })[0];
    if (!sec) return <div style={page}><div style={panel}>Unknown section.</div></div>;
    var status = rowStatus(sec, summary);
    var openCount = sec.unconfirmed;
    var attestable = sec.status !== 'not_configured' && openCount === 0;
    var body = rules && rules.content;
    var isLegalSection = rules ? rules.legal : !!LEGAL_SECTIONS[sec.section];
    // Edit rights mirror the server: Director/SysAdmin everywhere; Senior Legal on Legal domains.
    var canPropose = isDir || (isLegal && isLegalSection);
    var canApplyContent = isLegalSection ? isLegal : isDir;
    var proposals = (rules && rules.proposals) || [];
    var secFindings = findings.filter(function (f) { return String(f.where || '').indexOf(sec.section) >= 0 ||
      ((rules ? rules.domains : []) || []).some(function (d) { return String(f.where || '').indexOf('/' + d) >= 0; }); });
    var zones = [
      { k: 'content', label: 'Content' },
      { k: 'settings', label: 'Local Policy Settings' + (openCount > 0 ? ' (' + openCount + '⚠)' : ' (' + sec.settings.length + ')') },
      { k: 'provenance', label: 'Provenance' },
      { k: 'proposals', label: 'Proposals' + (proposals.length ? ' (' + proposals.length + ')' : '') }
    ];
    var openComposer = function (domain, title, seed) { setComposer({ domain: domain, title: title, seed: seed || {} }); };
    var ruleChips = function (ids) {
      return (ids || []).map(function (id) {
        return <button key={id} type="button" onClick={function () { setDrill(id); }}
          style={{ cursor: 'pointer', font: 'inherit', fontSize: 10.5, color: C.blue, background: C.surface2,
            border: '1px solid ' + G.line, borderRadius: 3, padding: '0 6px', fontWeight: 600 }}>{id}</button>;
      });
    };

    return (
      <div style={page}>
        <div style={{ marginBottom: 10 }}>
          <Link to="/jurisdiction-config" style={{ fontSize: 12.5, color: C.blue, textDecoration: 'none' }}>← Jurisdiction Configuration</Link>
        </div>
        <h1 style={h1}>{sec.label}</h1>
        <p style={sub}>
          <StatusChip tone={status.tone}>{status.label}</StatusChip>
          <span style={{ marginLeft: 10 }}>Owner: <b style={{ color: C.ink }}>{sec.owner && sec.owner.label}</b></span>
          {sec.attested ? <span style={{ marginLeft: 10 }}>attested {String(sec.attestedAt || '').slice(0, 10)} · {sec.attestedBy}</span> : null}
        </p>
        {!canPropose ? (
          <div style={{ background: G.amberBg, border: '1px solid ' + G.amberLine, borderRadius: 5, padding: '7px 11px',
            fontSize: 12.5, marginBottom: 10 }}>
            <b>Read-only for you.</b> {isLegalSection
              ? 'Legal Rules — you can do the work its rules route to you; changing the rules belongs to Senior Legal (the Director may propose).'
              : 'This section’s content is edited by its owner (' + ((sec.owner && sec.owner.label) || 'the Director') + ').'}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid ' + G.line, marginBottom: 11 }}>
          {zones.map(function (z) {
            var on = zone === z.k;
            return <button key={z.k} type="button" onClick={function () { setZone(z.k); }}
              style={{ cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, padding: '6px 13px',
                color: on ? G.navy : C.muted, background: on ? C.surface2 : 'transparent',
                border: on ? '1px solid ' + G.line : '1px solid transparent', borderBottom: 'none',
                borderRadius: '5px 5px 0 0' }}>{z.label}</button>;
          })}
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 560px', minWidth: 0 }}>

            {zone === 'content' ? (
              !body ? <div style={panel}><span style={kv}>No content payload — this section renders its policy settings only.</span></div>
              : body.kind === 'timerTable' ? (
                <div>
                  <div style={Object.assign({}, panel, { padding: 0, overflowX: 'auto' })}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead><tr>{['Timer', 'Use case', 'Duration', 'Citation', ''].map(function (h, i) {
                        return <th key={i} style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted,
                          textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid ' + G.line }}>{h}</th>; })}</tr></thead>
                      <tbody>
                        {body.rows.map(function (r) {
                          return (
                            <tr key={r.clockType}>
                              <td style={{ padding: '7px 8px', borderBottom: '1px solid ' + C.surface2, verticalAlign: 'top', fontWeight: r.primary ? 700 : 500 }}>
                                {r.label}{r.primary ? ' (primary)' : ''}
                              </td>
                              <td style={{ padding: '7px 8px', borderBottom: '1px solid ' + C.surface2, verticalAlign: 'top', maxWidth: 360 }}>
                                <ClockChip kind={r.kind}>{r.kindLabel}</ClockChip>
                                {r.useCase ? <div style={Object.assign({}, kv, { marginTop: 3 })}>{r.useCase}</div> : null}
                              </td>
                              <td style={{ padding: '7px 8px', borderBottom: '1px solid ' + C.surface2, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                {r.duration || <span style={{ color: G.amberInk, fontWeight: 700 }}>⚠ not set</span>}
                              </td>
                              <td style={{ padding: '7px 8px', borderBottom: '1px solid ' + C.surface2, verticalAlign: 'top' }}>
                                {r.citation ? <CiteChip>{r.citation}</CiteChip> : <span style={kv}>{r.kind === 'operational_target' ? 'city policy' : '—'}</span>}
                                {r.sourceRuleIds.length ? <div style={{ marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap' }}>{ruleChips(r.sourceRuleIds)}</div> : null}
                              </td>
                              <td style={{ padding: '7px 8px', borderBottom: '1px solid ' + C.surface2, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                {r.kind === 'operational_target'
                                  ? <Link to={'/jurisdiction-config/' + sec.section} onClick={function () { setZone('settings'); }} style={{ fontSize: 12, color: C.blue }}>Set &amp; confirm →</Link>
                                  : (canPropose ? <button type="button" style={btnQuiet}
                                      onClick={function () { openComposer('deadline', 'Propose change — ' + r.label, { clockType: r.clockType, row: r }); }}>Propose…</button> : null)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {body.noStatutoryDeadlines ? (
                    <div style={Object.assign({}, panel, { background: C.surface2 })}>
                      <span style={kv}><b style={{ color: C.ink }}>No statutory deadlines in this state.</b> Timers exist, none are legal
                      deadlines — every row above is a city target or a requestor window, and this screen cannot be used to invent a
                      deadline the law does not set.</span>
                    </div>
                  ) : null}
                  {(body.unlandedTimers || []).length ? (
                    <div style={panel}>
                      <div style={railHead}>Named timers that resolved to no clock</div>
                      {body.unlandedTimers.map(function (t) {
                        return <div key={t.timer} style={{ borderLeft: '3px dashed ' + G.ghost, paddingLeft: 10, fontSize: 12.5, color: C.muted, marginBottom: 5 }}>
                          {t.timerLabel} — present in the research, not landed as a clock. {ruleChips(t.sourceRuleIds)}
                        </div>;
                      })}
                    </div>
                  ) : null}
                </div>
              ) : body.kind === 'facts' ? (
                <div>
                  {body.facts.length === 0 ? <div style={panel}><span style={kv}>No content — import a state template or add the first rule.</span></div>
                    : body.facts.map(function (f, i) {
                      return <FactRow key={i} title={<span>{f.summary} {f.citation ? <CiteChip>{f.citation}</CiteChip> : null} {f.ruleId ? ruleChips([f.ruleId]) : null}</span>}>
                        Statute-derived fact ({f.concept}). Editing asserts the law says otherwise — it opens the proposal composer, citation required.
                      </FactRow>;
                    })}
                  {canPropose ? <button type="button" style={btnSec}
                    onClick={function () { openComposer(rules.domains[0], 'Propose change — ' + sec.label, {}); }}>Propose change…</button> : null}
                </div>
              ) : body.kind === 'fields' ? (
                <div>
                  {body.areaEditorNote ? (
                    <div style={Object.assign({}, panel, { background: C.surface2 })}>
                      <span style={kv}>{body.areaEditorNote}{' '}
                        <Link to={body.areaEditor} style={{ color: C.blue }}>{body.areaEditorLabel || 'Open →'}</Link></span>
                    </div>
                  ) : null}
                  {!body.enabled ? <div style={Object.assign({}, panel, { background: C.surface2 })}><span style={kv}>This policy is not enabled — the fields below are what the import carried; nothing acts on them yet.</span></div> : null}
                  {body.fields.map(function (f) {
                    return (
                      <div key={f.key} style={f.statuteDerived
                        ? { border: '1px solid ' + G.line, borderLeft: '4px solid ' + G.navy, borderRadius: 5, padding: '8px 11px', marginBottom: 7, background: C.surface }
                        : { border: '1px dashed ' + G.amberLine, borderLeft: '4px solid ' + G.amberLine, borderRadius: 5, padding: '8px 11px', marginBottom: 7, background: G.amberBg }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600 }}>{f.label}:</span>
                          <b style={{ color: G.navy }}>{f.value == null ? '—' : String(f.value)}</b>
                          {/* Three provenance labels, never conflated: a citation, statute-derived without
                              one (e.g. the identity section's state/model facts), or the city's own call. */}
                          {f.citation ? <CiteChip>{f.citation}</CiteChip> : f.statuteDerived ? <span style={kv}>statute-derived</span> : <span style={kv}>city policy</span>}
                          {ruleChips(f.sourceRuleIds)}
                          {/* No propose control on a section with no rules domain (identity/taxonomy render
                              derived read-only fields — their real editors are linked above). */}
                          {canPropose && rules.domains.length ? <button type="button" style={Object.assign({}, btnQuiet, { marginLeft: 'auto' })}
                            onClick={function () { openComposer(rules.domains[0], 'Propose change — ' + f.label, { field: f }); }}>Propose…</button> : null}
                        </div>
                        {f.help ? <div style={Object.assign({}, kv, { marginTop: 2 })}>{f.help}</div> : null}
                      </div>
                    );
                  })}
                </div>
              ) : body.kind === 'exemptionList' ? (
                <div>
                  <div style={Object.assign({}, panel, { background: C.surface2 })}>
                    <span style={kv}><b style={{ color: C.ink }}>Exemption model: {body.exemptionModel || '—'}</b>. {body.areaEditorNote}{' '}
                      <Link to={body.areaEditor} style={{ color: C.blue }}>Open the Redaction Rules area →</Link></span>
                  </div>
                  {body.exemptions.length === 0 ? <div style={panel}><span style={kv}>No rules yet — add the first one in the Redaction Rules area.</span></div>
                    : body.exemptions.map(function (x) {
                      return <FactRow key={x.id} title={<span>{x.title} {x.citations.map(function (c, i) { return <CiteChip key={i}>{c.citation || c.name}</CiteChip>; })} <WiredBadge wired={x.wired} /></span>}>
                        {x.wiredWhy}{x.category ? ' · ' + x.category : ''}{x.status !== 'approved' ? ' · status: ' + x.status : ''}
                      </FactRow>;
                    })}
                  {canPropose ? <button type="button" style={btnSec}
                    onClick={function () { openComposer(rules.domains[0], 'Propose change — ' + sec.label + ' configuration', {}); }}>Propose configuration change…</button> : null}
                </div>
              ) : (
                <div>
                  <div style={Object.assign({}, panel, { padding: 0 })}>
                    {body.config == null
                      ? <div style={{ padding: '11px 13px' }}><span style={kv}>No content — import a state template or add the first rule. (Nothing here is an alarm.)</span></div>
                      : <pre style={{ margin: 0, padding: '11px 13px', fontFamily: C.mono, fontSize: 11.5, overflowX: 'auto', maxHeight: 420 }}>{JSON.stringify(body.config, null, 2)}</pre>}
                  </div>
                  {canPropose && body.config != null && rules.editable.length ? <button type="button" style={btnSec}
                    onClick={function () { openComposer(rules.editable[0], 'Propose change — ' + sec.label, {}); }}>Propose change…</button> : null}
                </div>
              )
            ) : null}

            {zone === 'settings' ? (
              <div>
                <div style={Object.assign({}, panel, { background: C.surface2 })}>
                  <p style={Object.assign({}, kv, { margin: 0 })}>
                    <b style={{ color: C.ink }}>What the statute left to the city.</b>{' '}
                    {sec.settings.length ? 'Each setting carries the template’s suggested default — a starting point, never an answer. The section cannot be attested until each is confirmed.' : 'This section has no local policy settings.'}
                  </p>
                </div>
                {sec.settings.map(function (st) {
                  return <SettingCard key={st.domain + '/' + st.path} setting={st} onChanged={reload}
                    canConfirm={canConfirm(st.domain)} ownerLabel={sec.owner && sec.owner.label} />;
                })}
              </div>
            ) : null}

            {zone === 'provenance' ? (
              <div>
                {(rules && rules.provenance ? rules.provenance.imported : []).map(function (im) {
                  return (
                    <div key={im.domain} style={panel}>
                      <div style={railHead}>{im.domain}</div>
                      {im.imported
                        ? <div style={kv}>Imported from the state template{im.importInfo && im.importInfo.state ? ' (' + im.importInfo.state + ')' : ''}{im.importInfo && im.importInfo.imported_at ? ' · ' + String(im.importInfo.imported_at).slice(0, 10) : ''}. The import wrote the statute-derived content; the city’s decisions live in Local Policy Settings.</div>
                        : <div style={kv}>Not template-imported — this configuration was seeded or hand-entered; provenance rides its fields where it exists.</div>}
                    </div>
                  );
                })}
                <div style={panel}>
                  <div style={railHead}>Research records behind this section’s content</div>
                  {rules && rules.provenance && rules.provenance.sourceRuleIds.length
                    ? <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{ruleChips(rules.provenance.sourceRuleIds)}</div>
                    : <div style={kv}>None referenced — absence shown as absence.</div>}
                  <div style={Object.assign({}, kv, { marginTop: 6 })}>Click an id to read the full research record — the rule, its trigger, and the statute’s own words.</div>
                </div>
              </div>
            ) : null}

            {zone === 'proposals' ? (
              <div>
                {proposals.length === 0 ? <div style={panel}><span style={kv}>No pending proposals on this section.</span></div>
                  : proposals.map(function (p) {
                    return (
                      <div key={p.id} style={panel}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <b style={{ color: G.navy }}>{p.domain}</b>
                          <StatusChip tone={p.source_ref === 'editor' ? 'configured' : 'unconf'}>{p.source_ref === 'editor' ? 'editor' : 'import/extract'}</StatusChip>
                          <span style={kv}>{p.created_by} · {String(p.created_at || '').slice(0, 10)}</span>
                        </div>
                        <div style={{ fontSize: 12.5, marginTop: 4 }}>{p.summary}</div>
                      </div>
                    );
                  })}
                <div style={kv}>Review and apply happen in the ordinary flow: <Link to="/admin?tab=updates" style={{ color: C.blue }}>open the review queue →</Link>
                  {isLegalSection ? ' Editor proposals on Legal Rules domains apply under Senior Legal.' : ''}</div>
              </div>
            ) : null}

            <div style={panel}>
              <div style={railHead}>Attest this section</div>
              {sec.foldedInto ? (
                /* Attestation fold (2026-08-29): this section's sign-off lives on the screen that
                   absorbed it — "Attest as complete" there records (or re-opens) this attestation. */
                <div>
                  <div style={Object.assign({}, kv, { marginBottom: 7 })}>
                    This section is attested from <b>{sec.foldedInto.name}</b> — its "Attest as complete" records this attestation in the same act{sec.drift ? '; it has drifted since, so re-attest it there' : ''}. Drift and provenance still show here.
                  </div>
                  <button type="button" style={btn} onClick={function () { window.location.href = sec.foldedInto.door; }}>Open {sec.foldedInto.name}</button>
                </div>
              ) : (
                <div>
                  <div style={Object.assign({}, kv, { marginBottom: 7 })}>
                    {openCount > 0
                      ? <span><b>{openCount}</b> policy setting(s) unconfirmed — <b>attestation refuses until every one is</b> (the attest() gate, not a UI nicety).</span>
                      : sec.status === 'not_configured'
                        ? <span>This section has no configuration yet, so there is nothing to sign off on.</span>
                        : <span>When you attest, the section’s content hash is recorded under your name; any later edit — including an applied proposal — shows as drift until re-attested.</span>}
                  </div>
                  {sec.attested && !sec.drift ? (
                    <button type="button" style={canAttest(sec.section) ? btnQuiet : btnOff} disabled={!canAttest(sec.section)}
                      onClick={function () { setPopup({ kind: 'unattest', section: sec.section }); }}>Re-open (un-attest)…</button>
                  ) : (
                    <button type="button" style={attestable && canAttest(sec.section) ? btn : btnOff}
                      disabled={!attestable || !canAttest(sec.section)}
                      onClick={function () { setPopup({ kind: 'attest', section: sec.section }); }}>
                      {sec.drift ? 'Re-attest ' + sec.section + '…' : 'Attest ' + sec.section + '…'}
                    </button>
                  )}
                  {!canAttest(sec.section) ? (
                    <span style={Object.assign({}, kv, { marginLeft: 8 })}>
                      {LEGAL_SECTIONS[sec.section] ? 'Senior Legal or the Director attests this section.' : 'The Director or a System Administrator attests this section.'}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: '0 0 280px' }}>
            <div style={panel}>
              <div style={railHead}>Pending proposals</div>
              <div style={kv}>
                {proposals.length > 0
                  ? <span><b style={{ color: G.amberInk }}>{proposals.length}</b> on this section — until approved, the engine runs the previous configuration. </span>
                  : <span>None on this section. </span>}
                <Link to="/admin?tab=updates" style={{ color: C.blue }}>Open the review queue →</Link>
              </div>
            </div>
            <div style={Object.assign({}, panel, { marginTop: 10 })}>
              <div style={railHead}>Integrity findings</div>
              {secFindings.length === 0 ? <div style={kv}>None touching this section. The invariants (clock bands, provenance, no unknown keys) hold regardless of attestation — and the composer refuses what they refuse, before anything is written.</div>
                : secFindings.slice(0, 4).map(function (f, i) {
                  return <div key={i} style={{ borderLeft: '3px solid #C08A7E', paddingLeft: 10, fontSize: 12.5, marginBottom: 7 }}>
                    <b>{f.where}:</b> {f.issue}
                  </div>;
                })}
            </div>
            <div style={Object.assign({}, panel, { marginTop: 10 })}>
              <div style={railHead}>Enforcement</div>
              <div style={kv}>Dev mode: <b style={{ color: summary.devMode ? '#8C3A2B' : G.statute }}>{summary.devMode ? 'ON — gates simulated' : 'OFF — live'}</b>. Turning it off is the go-live act, on the checklist’s front page.</div>
            </div>
          </div>
        </div>

        {composer ? (
          sec.section === 'fees' && !composer.seed.clockType && !composer.seed.field ? (
            <FeeComposerPopup onClose={function () { setComposer(null); }}
              onDone={function () { setComposer(null); reload(); }} />
          ) : (
          <ComposerPopup open={true} onClose={function () { setComposer(null); }}
            section={sec.section} domain={composer.domain} title={composer.title} seed={composer.seed}
            currentConfig={(rules && rules.configs && rules.configs[composer.domain]) || {}}
            legal={isLegalSection} canApply={canApplyContent}
            onDone={function (r) {
              setComposer(null);
              if (r && r.drifted && r.driftNote) setErr(r.driftNote);
              reload();
            }} />
          )
        ) : null}
        <ResearchPopup ruleId={drill} onClose={function () { setDrill(null); }} />
        {err ? <div style={{ color: G.amberInk, fontSize: 12.5, marginTop: 8, background: G.amberBg, border: '1px solid ' + G.amberLine, borderRadius: 5, padding: '7px 10px' }}>{err}</div> : null}
        <ConfirmPopup open={!!popup && popup.kind === 'attest'} onClose={function () { setPopup(null); }}
          title={'Attest ' + (popup ? popup.section : '')}
          actions={[
            <button key="a" type="button" disabled={busy} style={busy ? btnOff : btn}
              onClick={function () { doAttest(popup.section, false); }}>Attest under my name</button>,
            <button key="c" type="button" style={btnQuiet} onClick={function () { setPopup(null); }}>Cancel</button>
          ]}>
          <p style={Object.assign({}, kv, { margin: 0 })}>
            This records the section's current content hash under your name and date. Any later edit to this
            section will show as <b>drift</b> until someone re-attests it.
          </p>
        </ConfirmPopup>
        <ConfirmPopup open={!!popup && popup.kind === 'unattest'} onClose={function () { setPopup(null); }}
          title={'Re-open ' + (popup ? popup.section : '')}
          actions={[
            <button key="a" type="button" disabled={busy} style={busy ? btnOff : btn}
              onClick={function () { doAttest(popup.section, true); }}>Re-open the section</button>,
            <button key="c" type="button" style={btnQuiet} onClick={function () { setPopup(null); }}>Cancel</button>
          ]}>
          <p style={Object.assign({}, kv, { margin: 0 })}>
            The section leaves its attested state and the go-live gate reopens{summary.live ? ' — on a LIVE install, actions gated on this section will refuse until it is re-attested' : ''}.
            The prior attestation record is cleared; re-attesting later is a fresh signature.
          </p>
        </ConfirmPopup>
      </div>
    );
  }

  // ── SCREEN 1 — the readiness index ───────────────────────────────────────────────────────────
  return (
    <div style={page}>
      <h1 style={h1}>Jurisdiction Configuration — {jur.name} ({jur.id})</h1>
      <p style={sub}>The go-live checklist: every decision the statute left to this city, who made it, and what still blocks enforcement.</p>
      <GateSummary summary={summary} />
      <div style={Object.assign({}, panel, { padding: 0, overflowX: 'auto' })}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Section', 'Status', 'Policy settings', 'Owner', '', ''].map(function (h, i) {
                return <th key={i} style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em',
                  color: C.muted, textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid ' + G.line }}>{h}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {(data.sections || []).map(function (sec) {
              var st = rowStatus(sec, summary);
              return (
                <tr key={sec.section}>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid ' + C.surface2, fontWeight: 700, color: G.navy }}>{sec.section}</td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid ' + C.surface2 }}><StatusChip tone={st.tone}>{st.label}</StatusChip></td>
                  <td style={Object.assign({ padding: '8px 10px', borderBottom: '1px solid ' + C.surface2 }, kv)}>
                    {sec.settings.length === 0 ? '—' : (sec.unconfirmed > 0 ? <b style={{ color: G.amberInk }}>{sec.unconfirmed} ⚠</b> : sec.settings.length + ' confirmed')}
                  </td>
                  <td style={Object.assign({ padding: '8px 10px', borderBottom: '1px solid ' + C.surface2 }, kv)}>{sec.owner && sec.owner.label}</td>
                  <td style={Object.assign({ padding: '8px 10px', borderBottom: '1px solid ' + C.surface2 }, kv)}>
                    {sec.attested ? ('attested ' + String(sec.attestedAt || '').slice(0, 10) + ' · ' + sec.attestedBy) : (sec.lastChangedAt ? 'changed ' + String(sec.lastChangedAt).slice(0, 10) : '')}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid ' + C.surface2, whiteSpace: 'nowrap' }}>
                    <button type="button" style={btnSec}
                      onClick={function () { nav('/jurisdiction-config/' + sec.section); }}>
                      {sec.unconfirmed > 0 ? 'Confirm policy settings →' : 'Open →'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={Object.assign({}, panel, { flex: '1 1 380px' })}>
          <div style={railHead}>Pending proposals</div>
          <div style={kv}>
            {summary.proposalsPending > 0
              ? <span><b style={{ color: G.amberInk }}>{summary.proposalsPending}</b> proposal(s) await review — part of go-live, not a separate chore: until approved, the engine runs the previous configuration. </span>
              : <span>None pending. </span>}
            <Link to="/admin?tab=updates" style={{ color: C.blue }}>Open the review queue →</Link>
          </div>
        </div>
        <div style={Object.assign({}, panel, { flex: '1 1 380px' })}>
          <div style={railHead}>Integrity findings</div>
          {findings.length === 0
            ? <div style={kv}>None. The invariants (clock bands, provenance, no unknown keys, no test stamps) hold regardless of attestation.</div>
            : <div>
                {findings.slice(0, 3).map(function (f, i) {
                  return <div key={i} style={{ borderLeft: '3px solid #C08A7E', paddingLeft: 10, fontSize: 12.5, marginBottom: 7 }}>
                    <b>{f.where}:</b> {f.issue}
                  </div>;
                })}
                {findings.length > 3 ? <div style={kv}>+ {findings.length - 3} more.</div> : null}
              </div>}
        </div>
        <div style={Object.assign({}, panel, { flex: '1 1 320px' })}>
          <div style={railHead}>Enforcement — the go-live act</div>
          {summary.devMode ? (
            <div>
              <div style={Object.assign({}, kv, { marginBottom: 8 })}>
                Dev mode is <b style={{ color: '#8C3A2B' }}>ON</b> — every gate is simulated. Turning it off is the
                go-live act itself: a System Administrator's decision, informed by this checklist.
              </div>
              <button type="button" style={summary.ready && isSA ? btn : btnOff} disabled={!summary.ready || !isSA}
                onClick={function () { setPopup({ kind: 'ceremony' }); }}>Begin go-live…</button>
              {!summary.ready ? <span style={Object.assign({}, kv, { marginLeft: 8 })}>blocked: the pills above say why</span>
                : (!isSA ? <span style={Object.assign({}, kv, { marginLeft: 8 })}>System Administrator or Director only</span> : null)}
            </div>
          ) : (
            <div>
              <div style={Object.assign({}, kv, { marginBottom: 8 })}>
                Enforcement is <b style={{ color: G.statute }}>LIVE</b>. The attestation gates refuse for real; drift
                on an attested section blocks the actions that rely on it.
              </div>
              {isSA ? <button type="button" style={btnQuiet} onClick={function () { setPopup({ kind: 'devmode-on' }); }}>Return to dev mode…</button> : null}
            </div>
          )}
        </div>
      </div>
      <Ceremony open={!!popup && popup.kind === 'ceremony'} summary={summary}
        onClose={function () { setPopup(null); }} onDone={function () { setPopup(null); reload(); }} />
      <ConfirmPopup open={!!popup && popup.kind === 'devmode-on'} onClose={function () { setPopup(null); }}
        title="Return to dev mode"
        actions={[
          <button key="a" type="button" disabled={busy} style={busy ? btnOff : btn} onClick={function () {
            setBusy(true);
            api.post('/jurisdiction-profile/enforcement', { devMode: true })
              .then(function () { setPopup(null); reload(); })
              .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Refused.'); })
              .then(function () { setBusy(false); });
          }}>Turn enforcement off</button>,
          <button key="c" type="button" style={btnQuiet} onClick={function () { setPopup(null); }}>Cancel</button>
        ]}>
        <p style={Object.assign({}, kv, { margin: 0 })}>
          Every gate returns to simulation. This un-does the go-live act; the checklist stays as it is.
        </p>
      </ConfirmPopup>
      {err ? <div style={{ color: C.crit, fontSize: 12.5, marginTop: 8 }}>{err}</div> : null}
    </div>
  );
}
