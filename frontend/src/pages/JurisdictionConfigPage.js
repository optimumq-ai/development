import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { G, StatusChip, GateChecklist, ConfirmPopup } from '../components/primitives';
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

  var isSA = store.hasAnyRole('SYSTEM_ADMIN');
  var isDir = store.hasAnyRole('SYSTEM_ADMIN', 'DIRECTOR');
  var isLegal = store.hasAnyRole('ATTORNEY_REVIEWER');

  useEffect(function () {
    var alive = true;
    setErr('');
    Promise.all([
      api.get('/jurisdiction-profile/policy-settings'),
      api.get('/jurisdiction-profile/go-live'),
      api.get('/config-integrity').catch(function () { return null; })
    ]).then(function (r) {
      if (!alive) return;
      setData(r[0].data); setSummary(r[1].data);
      setIntegrity(r[2] && r[2].data ? r[2].data : null);
    }).catch(function (e) {
      if (alive) setErr((e.response && e.response.data && e.response.data.error) || 'This screen could not load.');
    });
    return function () { alive = false; };
  }, [tick]);

  function reload() { setTick(function (t) { return t + 1; }); }
  function canAttest(sectionKey) { return isDir || (isLegal && LEGAL_SECTIONS[sectionKey]); }
  function canConfirm(domain) { return isDir || (isLegal && LEGAL_DOMAINS[domain]); }

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

  // ── SCREEN 2 — section detail ────────────────────────────────────────────────────────────────
  if (params.section) {
    var sec = (data.sections || []).filter(function (s) { return s.section === params.section; })[0];
    if (!sec) return <div style={page}><div style={panel}>Unknown section.</div></div>;
    var status = rowStatus(sec, summary);
    var openCount = sec.unconfirmed;
    var attestable = sec.status !== 'not_configured' && openCount === 0;
    var secFindings = findings.filter(function (f) { return String(f.where || '').indexOf('/' + (sec.section === 'fees' ? 'fee' : sec.section)) >= 0 || String(f.where || '').indexOf(sec.section) >= 0; });
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
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 560px', minWidth: 0 }}>
            <div style={Object.assign({}, panel, { background: C.surface2 })}>
              <p style={Object.assign({}, kv, { margin: 0 })}>
                <b style={{ color: C.ink }}>What the statute decided is already config</b> — imported with citations,
                edited only through its own rule editors. <b style={{ color: C.ink }}>What the statute left to the
                city</b> is below{sec.settings.length
                  ? ': each setting carries the template’s suggested default — a starting point, never an answer. The section cannot be attested until each is confirmed.'
                  : ' — and this section has no such settings.'}
              </p>
            </div>
            {sec.settings.length === 0 ? (
              <div style={panel}><span style={kv}>No local policy settings on this section. {sec.status === 'not_configured'
                ? 'The section itself is not configured yet — configure it in its own editor; nothing here is an alarm.'
                : 'Its configuration is statute-derived or lives in its own editor.'}</span></div>
            ) : sec.settings.map(function (st) {
              return <SettingCard key={st.domain + '/' + st.path} setting={st} onChanged={reload}
                canConfirm={canConfirm(st.domain)} ownerLabel={sec.owner && sec.owner.label} />;
            })}
            <div style={panel}>
              <div style={railHead}>Attest this section</div>
              <div style={Object.assign({}, kv, { marginBottom: 7 })}>
                {openCount > 0
                  ? <span><b>{openCount}</b> policy setting(s) unconfirmed — <b>attestation refuses until every one is</b> (the attest() gate, not a UI nicety).</span>
                  : sec.status === 'not_configured'
                    ? <span>This section has no configuration yet, so there is nothing to sign off on.</span>
                    : <span>When you attest, the section's content hash is recorded under your name; any later edit shows as drift until re-attested.</span>}
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
          </div>
          <div style={{ flex: '0 0 280px' }}>
            <div style={panel}>
              <div style={railHead}>Pending proposals</div>
              <div style={kv}>
                {summary.proposalsPending > 0
                  ? <span><b style={{ color: G.amberInk }}>{summary.proposalsPending}</b> configuration proposal(s) await review — until approved, the engine runs the previous configuration. </span>
                  : <span>None pending. </span>}
                <Link to="/admin?tab=updates" style={{ color: C.blue }}>Open the review queue →</Link>
              </div>
            </div>
            <div style={Object.assign({}, panel, { marginTop: 10 })}>
              <div style={railHead}>Integrity findings</div>
              {secFindings.length === 0 ? <div style={kv}>None touching this section. The invariants (clock bands, provenance, no unknown keys) hold regardless of attestation.</div>
                : secFindings.slice(0, 4).map(function (f, i) {
                  return <div key={i} style={{ borderLeft: '3px solid #C08A7E', paddingLeft: 10, fontSize: 12.5, marginBottom: 7 }}>
                    <b>{f.where}:</b> {f.issue}
                  </div>;
                })}
            </div>
            <div style={Object.assign({}, panel, { marginTop: 10 })}>
              <div style={railHead}>Enforcement</div>
              <div style={kv}>Dev mode: <b style={{ color: summary.devMode ? '#8C3A2B' : G.statute }}>{summary.devMode ? 'ON — gates simulated' : 'OFF — live'}</b>. Turning it off is the go-live act, on the checklist's front page.</div>
            </div>
          </div>
        </div>
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
                : (!isSA ? <span style={Object.assign({}, kv, { marginLeft: 8 })}>System Administrator only</span> : null)}
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
