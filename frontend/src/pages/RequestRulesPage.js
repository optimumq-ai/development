import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import StatutePopup from '../components/StatutePopup';

// REQUEST RULES — one screen, three hub rows (canvas approved by Kevin 2026-08-27; sources
// docs/mockups/hub_links/clar_exempt_elig/). Tabs: Vague requests and clarification · Exemptions and
// appeals · Who is allowed to request. Each hub row's door opens its matching tab; the status strip
// follows the ACTIVE tab's row. Letters are standard wording in this slice — the editable template
// store is its own later slice. Data: GET /api/request-rules · /api/setup-hub; decisions through
// /api/request-rules/* (clarification, eligibility) and /api/jurisdiction-profile/policy-settings/confirm
// (exemption — Legal Rules scope lives there).

var C = { ink: '#12232E', mute: '#5C6F7C', faint: '#8296A4', ph: '#A9B7C2', line: '#D2DCE3', edge: '#BECAD3', wash: '#F2F6F9', pri: '#1E6091', red: '#B02A37', ok: '#1B8A5A', amber: '#9A6512', navy: '#0E3A5C' };
var STATE = {
  ready:           { label: 'Ready',           bg: '#E1F2E9', color: '#1B8A5A' },
  in_progress:     { label: 'In progress',     bg: '#F6EBD6', color: '#9A6512' },
  not_started:     { label: 'Not started',     bg: '#F3F4F6', color: '#4B5563' },
  needs_attention: { label: 'Needs attention', bg: '#FEE2E2', color: '#991B1B' },
  waiting:         { label: 'Waiting',         bg: '#EDE9FE', color: '#5B21B6' },
};
var TABS = [
  { key: 'clarification', hubKey: 'clarification', label: 'Vague requests and clarification' },
  { key: 'exemptions', hubKey: 'exemptions', label: 'Exemptions and appeals' },
  { key: 'eligibility', hubKey: 'eligibility', label: 'Who is allowed to request' },
  { key: 'deadlines', hubKey: 'deadlines', label: 'Response deadlines and tolling' },
  { key: 'intake', hubKey: 'intake', label: 'Request Intake' },
];
// what pauses a clock, in plain words
var TOLL_LABELS = { clarification_pending: 'clarification', payment_pending: 'payment', extension: 'extension', ag_ruling_pending: 'AG ruling' };
var hint = { fontSize: '11.5px', color: C.faint, lineHeight: '1.4' };
var card = { background: 'white', border: '1px solid ' + C.line, borderRadius: '10px' };
var cite = { fontSize: '11px', color: C.faint, lineHeight: '1.35' };
function btn(kind, extra) {
  var base = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px', height: '36px', padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: '600', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' };
  var k = kind === 'pri' ? { background: C.pri, color: 'white', border: '1px solid ' + C.pri }
    : kind === 'dis' ? { background: C.wash, color: C.ph, border: '1px solid ' + C.line, cursor: 'default' }
    : { background: 'white', color: C.ink, border: '1px solid ' + C.edge };
  return Object.assign(base, k, extra || {});
}
function inp(extra) { return Object.assign({ boxSizing: 'border-box', height: '32px', border: '1px solid ' + C.edge, borderRadius: '7px', background: 'white', padding: '0 10px', fontSize: '13px', color: C.ink, fontFamily: 'inherit' }, extra || {}); }
function Bind(props) {
  var kinds = { fixed: { bg: '#E8EEF4', color: C.navy, border: '#C5D3DF', dashed: false }, soft: { bg: 'white', color: C.mute, border: C.edge, dashed: true } };
  var k = kinds[props.kind || 'soft'];
  return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '10.5px', fontWeight: '700', padding: '1px 7px', borderRadius: '4px', whiteSpace: 'nowrap', background: k.bg, color: k.color, border: '1px ' + (k.dashed ? 'dashed' : 'solid') + ' ' + k.border }}>{props.children}</span>;
}
function Pill(props) { return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '11px', fontWeight: '700', borderRadius: '999px', padding: '2px 9px', whiteSpace: 'nowrap', background: props.bg, color: props.color }}>{props.children}</span>; }
function RuleId(props) { return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', background: C.wash, color: C.mute, border: '1px solid ' + C.line, whiteSpace: 'nowrap' }}>{props.children}</span>; }
function errText(e, fb) { return (e && e.response && e.response.data && e.response.data.error) || fb; }
function fmtDate(s) { if (!s) return ''; var d = new Date(String(s).replace(' ', 'T') + (String(s).length <= 19 ? 'Z' : '')); return isNaN(d) ? String(s).slice(0, 10) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
function decided(c) { return c.confirmed ? <div style={Object.assign({}, hint, { color: C.ok, marginTop: '4px' })}>✓ decided by {c.confirmedBy}{c.confirmedAt ? ', ' + fmtDate(c.confirmedAt) : ''}</div> : null; }

// What the eligibility dimensions mean, in plain words (TX_RULES_READABLE §11; generic fallbacks below).
var DIM_COPY = {
  identity: 'Anyone may request; contact details are only for replying.',
  purpose: 'The city may not ask why — the system never records a purpose.',
  residency: 'No residency requirement.',
  requester_class: 'No special classes of requester are switched on.',
  vexatious: 'Repeat or vexatious requesters are not restricted here — heavy repeat use is handled through time caps, with the fee rules and the requestor ledger.',
  incarceration: 'Requests from incarcerated individuals.'
};

// The law panel shared by all three tabs: rule rows with citations that open the research record.
function LawPanel(props) {
  return (
    <div style={{ borderRight: '1px solid ' + C.line, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.navy} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        <div style={{ flexGrow: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: '700' }}>What {props.stateName} law says</div>
          <div style={hint}>Loaded when the state was locked. Not editable — click a citation to read the statute text behind it.</div>
        </div>
        <Pill bg="#E1F2E9" color={C.ok}>{props.rules.length} rule{props.rules.length === 1 ? '' : 's'}</Pill>
      </div>
      {props.rules.map(function (r) {
        return <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', gap: '10px', alignItems: 'start', padding: '11px 16px', borderTop: '1px solid #EEF2F5', fontSize: '12.5px', lineHeight: '1.45' }}>
          <RuleId>{r.id}</RuleId>
          <div>{r.summary}
            <div style={Object.assign({}, cite, { marginTop: '3px' })}>
              <button type="button" onClick={function () { props.onCite({ title: r.summary.slice(0, 90), authority: r.authority, ruleIds: [r.id] }); }}
                style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: C.pri, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline dotted' }}>{r.authority}</button>
            </div>
          </div>
        </div>;
      })}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #EEF2F5', marginTop: 'auto' }}>
        <span style={hint}>The deadlines here are the state's, not choices. They are shown so the choices on the right make sense.</span>
      </div>
    </div>
  );
}

function ChoiceHead(props) {
  return (
    <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.amber} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
      <div style={{ flexGrow: 1 }}>
        <div style={{ fontSize: '14px', fontWeight: '700' }}>What this city decides</div>
        <div style={hint}>{props.sub}</div>
      </div>
      {props.pill}
    </div>
  );
}

export default function RequestRulesPage() {
  var nav = useNavigate();
  var [params, setParams] = useSearchParams();
  var tab = TABS.some(function (t) { return t.key === params.get('tab'); }) ? params.get('tab') : 'clarification';
  function goTab(k) { setParams(k === 'clarification' ? {} : { tab: k }); }

  var [data, setData] = useState(null);
  var [hub, setHub] = useState({});
  var [edits, setEdits] = useState({});         // path -> value (both tabs)
  var [posture, setPosture] = useState({});     // eligibility radios before confirm, keyed by dimension
  var [err, setErr] = useState('');
  var [msg, setMsg] = useState('');
  var [busy, setBusy] = useState('');
  var [statute, setStatute] = useState(null);
  var [letter, setLetter] = useState(false);

  function load() {
    return Promise.all([api.get('/request-rules'), api.get('/setup-hub')]).then(function (r) {
      setData(r[0].data); setEdits({}); setPosture({});
      var h = {};
      r[1].data.lanes.forEach(function (l) { l.items.forEach(function (x) { if (x.key === 'clarification' || x.key === 'exemptions' || x.key === 'eligibility' || x.key === 'deadlines' || x.key === 'intake') h[x.key] = x; }); });
      setHub(h); setErr('');
    }).catch(function (e) { setErr(errText(e, 'The screen could not load.')); });
  }
  useEffect(function () { load(); }, []);

  if (err && !data) return <div style={{ padding: '24px', color: C.red }}>{err}</div>;
  if (!data) return <div style={{ padding: '24px', color: C.ph }}>Reading the state's rules…</div>;
  if (!data.jurisdiction) return (
    <div style={{ maxWidth: '760px' }}>
      <div style={Object.assign({}, card, { padding: '18px 20px' })}>
        <div style={{ fontSize: '16px', fontWeight: '700' }}>No state locked yet</div>
        <div style={{ fontSize: '13px', color: C.mute, marginTop: '6px' }}>The law's rules arrive when the state is locked on the agency screen.</div>
        <button type="button" onClick={function () { nav('/setup/agency'); }} style={btn('pri', { marginTop: '12px' })}>Go to Agency name, address and contact</button>
      </div>
    </div>
  );

  var t = TABS.filter(function (x) { return x.key === tab; })[0];
  var hubRow = hub[t.hubKey];
  var st = STATE[(hubRow && hubRow.state) || 'not_started'];
  var stateName = data.jurisdiction.stateName || data.jurisdiction.name;
  var td = data.tabs[tab === 'exemptions' ? 'exemptions' : tab];
  var can = !!(data.canEdit && data.canEdit[tab]);
  var attested = hubRow && hubRow.signoff;
  var laneIndex = { clarification: 'item 3 of 10', exemptions: 'item 4 of 10', eligibility: 'item 5 of 10', deadlines: 'item 1 of 10', intake: 'item 6 of 10' }[tab];

  function edited(c) { return edits[c.path] !== undefined ? edits[c.path] : (c.value != null ? c.value : null); }
  function setEdit(path, v) { var o = Object.assign({}, edits); o[path] = v; setEdits(o); setMsg(''); }

  async function toggleEnabled() {
    setBusy('toggle'); setErr('');
    try { await api.post('/request-rules/clarification/enabled', { enabled: !data.tabs.clarification.enabled }); await load(); }
    catch (e) { setErr(errText(e, 'The switch could not be changed.')); }
    setBusy('');
  }

  // Save = record every choice on this tab that HAS an answer (typed, picked, or the suggested one
  // shown in the control). Confirming a suggested answer is a decision, recorded with your name.
  async function saveChoices() {
    setBusy('save'); setErr(''); setMsg('');
    var choices = td.choices || [];
    var done = 0, failed = null;
    for (var i = 0; i < choices.length; i++) {
      var c = choices[i];
      var v = edits[c.path] !== undefined ? edits[c.path] : (c.value != null ? c.value : (c.kind === 'library_ack' || c.kind === 'letter' ? null : c.suggested));
      if (c.kind === 'library_ack' || c.kind === 'letter') { if (edits[c.path] === undefined && !c.confirmed) continue; v = c.ackValue || 'standard_wording'; }
      if (v === null || v === undefined || v === '') continue;
      if (c.confirmed && edits[c.path] === undefined) continue;
      try {
        if (tab === 'clarification') await api.post('/request-rules/clarification/confirm', { path: c.path, value: v });
        else await api.post('/jurisdiction-profile/policy-settings/confirm', { domain: 'exemption', path: c.path, value: v });
        done++;
      } catch (e) { failed = errText(e, 'A decision could not be recorded.'); break; }
    }
    if (failed) setErr(failed);
    else if (done) setMsg(done + ' decision' + (done > 1 ? 's' : '') + ' recorded.');
    else setMsg('Nothing new to record — answer a choice first.');
    await load();
    setBusy('');
  }

  async function confirmPosture(dimKey, gated) {
    setBusy('posture'); setErr('');
    try { await api.post('/request-rules/eligibility/posture', { dimension: dimKey, gated: gated }); setMsg('Decision recorded.'); await load(); }
    catch (e) { setErr(errText(e, 'The decision could not be recorded.')); }
    setBusy('');
  }

  async function toggleAttest() {
    setBusy('attest'); setErr('');
    try {
      if (attested) await api.delete('/setup-hub/' + t.hubKey + '/done'); else await api.post('/setup-hub/' + t.hubKey + '/done');
      await load();
    } catch (e) { setErr(errText(e, 'Could not update.')); }
    setBusy('');
  }

  var clarOn = data.tabs.clarification.enabled;
  var mayAttest = can && hubRow && hubRow.state !== 'waiting' && hubRow.state !== 'needs_attention' &&
    (tab === 'clarification' ? (clarOn && td.unconfirmed === 0)
      : tab === 'deadlines' ? td.calendar.holidayCount > 0   // blank service targets are a valid posture; an empty holiday calendar is not
      : td.unconfirmed === 0);

  function attestBtn() {
    if (attested) return <button type="button" disabled={busy === 'attest' || !can} onClick={toggleAttest} style={btn('sec', { height: '30px' })}>Attested · undo</button>;
    return <button type="button" disabled={!mayAttest || busy === 'attest'} onClick={toggleAttest} style={btn(mayAttest ? 'pri' : 'dis', { height: '30px' })}
      title={mayAttest ? 'Record that this item is complete' : 'Every choice on this tab must be recorded first'}>Attest as complete</button>;
  }

  // ---------------- tab bodies ----------------

  function clarificationBody() {
    var d = data.tabs.clarification;
    var stat = d.statutory;
    function row(label, control, right) {
      return <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr) 150px', gap: '12px', alignItems: 'start', padding: '12px 16px', borderTop: '1px solid #EEF2F5' }}>
        <div style={{ fontSize: '12.5px', fontWeight: '600', lineHeight: '1.35', paddingTop: '2px' }}>{label}</div>
        <div>{control}</div>
        <div style={cite}>{right}</div>
      </div>;
    }
    var byKey = {}; (d.choices || []).forEach(function (c) { byKey[c.key] = c; });
    var bv = byKey['Master.bv'], n2 = byKey['Clarification.n2'], n3 = byKey['Clarification.n3'], close = byKey['Clarification.close'], d4 = byKey['Clarification.d4'];
    return (
      <div>
        <ChoiceHead sub="Five choices. Confirming the suggested answer is still a decision, and it is recorded with your name."
          pill={<Pill bg="#F6EBD6" color={C.amber}>{5 - d.unconfirmed} of 5 decided</Pill>} />

        {/* the master switch — the act that lets this hub row move at all */}
        <div style={{ margin: '0 16px 12px', padding: '12px 14px', background: C.wash, border: '1px solid ' + C.line, borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button type="button" disabled={!can || busy === 'toggle'} onClick={toggleEnabled} title={clarOn ? 'Switch clarification off' : 'Switch clarification on'}
            style={{ width: '34px', height: '20px', borderRadius: '999px', border: 0, padding: 0, position: 'relative', cursor: can ? 'pointer' : 'default', background: clarOn ? C.ok : C.edge, flexShrink: 0 }}>
            <span style={{ width: '16px', height: '16px', borderRadius: '999px', background: 'white', position: 'absolute', top: '2px', left: clarOn ? '16px' : '2px', transition: 'left .15s' }} />
          </button>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: '12.5px', fontWeight: '600' }}>Ask for clarification when a request is unclear</div>
            <div style={hint}>The {stateName} rule load arrived with this switched off. While it is off, staff cannot send a clarification letter and this row never leaves Not started.</div>
          </div>
        </div>

        {clarOn && bv ? row(bv.label,
          <div>
            <textarea value={edited(bv) != null ? edited(bv) : (bv.suggested || '')} disabled={!can} rows={3}
              onChange={function (e) { setEdit(bv.path, e.target.value); }}
              style={Object.assign(inp({ width: '100%', height: 'auto', padding: '8px 10px', lineHeight: '1.45', resize: 'vertical' }))} />
            <div style={hint}>{bv.note}</div>{decided(bv)}
          </div>,
          <span><Bind kind="soft">Statutory standard</Bind></span>) : null}

        {clarOn && n2 ? row(n2.label,
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12.5px', fontWeight: '600' }}>Standard wording</span>
              <button type="button" onClick={function () { setLetter(true); }} style={btn('sec', { height: '28px', fontSize: '12px' })}>View the letter</button>
              {!n2.confirmed ? <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', cursor: can ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={edits[n2.path] !== undefined} disabled={!can} onChange={function (e) { if (e.target.checked) setEdit(n2.path, n2.ackValue || 'standard_wording'); else { var o = Object.assign({}, edits); delete o[n2.path]; setEdits(o); } }} />
                Use the standard wording</label> : null}
            </div>
            <div style={hint}>{stateName} requires the letter to say what happens if the requestor does not reply — the standard letter's warning sentence is shown in the letter view. {n2.note}</div>{decided(n2)}
          </div>,
          <span><Bind kind="fixed">Required content</Bind></span>) : null}

        {clarOn && n3 ? row(n3.label,
          <div>
            {n3.statutoryDays ? <div style={inp({ display: 'flex', alignItems: 'center', width: '220px', background: C.wash, color: C.mute })}>{n3.statutoryDays} days — set by {stateName} law</div>
              : <input type="number" min="1" value={edited(n3) != null ? edited(n3) : ''} placeholder={n3.suggested != null ? String(n3.suggested) + ' (suggested)' : 'days'} disabled={!can}
                  onChange={function (e) { setEdit(n3.path, e.target.value); }} style={inp({ width: '160px' })} />}
            <div style={hint}>{n3.statutoryDays
              ? 'If no written reply arrives by the ' + n3.statutoryDays + 'th day, ' + stateName + ' law treats the request as withdrawn. Not a choice in ' + stateName + '.'
              : 'The statute is silent here — the city sets the window before a request without a reply may be closed.'}</div>{decided(n3)}
          </div>,
          stat ? <span><Bind kind="fixed">Fixed</Bind></span> : <span><Bind kind="soft">City policy</Bind></span>) : null}

        {clarOn && close ? row('When the reply window passes',
          <div>
            <div style={{ fontSize: '12.5px' }}>{stat ? 'The request closes as withdrawn — ' + stateName + ' law decides that, not the city.' : 'The request may be closed under the city\'s policy.'}</div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '7px', fontSize: '12.5px', cursor: can ? 'pointer' : 'default' }}>
              <input type="checkbox" checked={edited(close) != null ? edited(close) === 'yes' : close.suggested === 'yes'} disabled={!can}
                onChange={function (e) { setEdit(close.path, e.target.checked ? 'yes' : 'no'); }} style={{ marginTop: '2px' }} />
              <span>Also send the requestor a short closing notice <span style={{ color: C.faint }}>(suggested)</span></span>
            </label>
            <div style={hint}>{close.note}</div>{decided(close)}
          </div>,
          <span><Bind kind={stat ? 'fixed' : 'soft'}>{stat ? 'Closure: fixed' : 'Closure: city policy'}</Bind> <Bind kind="soft">Notice: city policy</Bind></span>) : null}

        {clarOn && d4 ? row(d4.label,
          <div>
            {(d4.options || []).map(function (o) {
              var cur = edited(d4) != null ? edited(d4) : d4.suggested;
              return <label key={o.value} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12.5px', marginTop: o === d4.options[0] ? 0 : '6px', cursor: can ? 'pointer' : 'default' }}>
                <input type="radio" name="d4" checked={cur === o.value} disabled={!can} onChange={function () { setEdit(d4.path, o.value); }} style={{ marginTop: '2px' }} />
                <span>{o.label}{o.value === d4.suggested ? <span style={{ color: C.faint }}> (suggested)</span> : null}</span>
              </label>;
            })}
            <div style={hint}>{d4.note}</div>{decided(d4)}
          </div>,
          <span><Bind kind="soft">City policy</Bind> the law is silent</span>) : null}
      </div>
    );
  }

  function exemptionsBody() {
    var d = data.tabs.exemptions;
    var byKey = {}; (d.choices || []).forEach(function (c) { byKey[c.key] = c; });
    var nreason = byKey['Denial.nreason'], dlegal = byKey['Denial.dlegal'], ncomm = byKey['Denial.ncomm'], ddl = byKey['Denial.ddl'];
    var libEmpty = !d.redactionLibrary || d.redactionLibrary.approvedRules === 0;
    function cardBox(children, extra) {
      return <div style={Object.assign({ margin: '0 16px 12px', padding: '12px 14px', border: '1px solid ' + C.line, borderRadius: '8px' }, extra || {})}>{children}</div>;
    }
    return (
      <div>
        <ChoiceHead sub="Four choices. Confirming a suggested answer is still a decision, and it is recorded with your name."
          pill={<Pill bg="#F6EBD6" color={C.amber}>{4 - d.unconfirmed} of 4 decided</Pill>} />

        {nreason ? cardBox(<div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '12.5px', fontWeight: '600', flexGrow: 1 }}>{nreason.label}</div>
            <Pill bg={libEmpty ? '#EDE9FE' : '#E1F2E9'} color={libEmpty ? '#5B21B6' : C.ok}>{libEmpty ? 'Not loaded yet' : d.redactionLibrary.approvedRules + ' rules loaded'}</Pill>
          </div>
          <div style={{ fontSize: '12.5px', marginTop: '6px', lineHeight: '1.45' }}>Every denial cites a reason from the <b>Redaction rules library</b>, keyed to the statute it relies on. That library is its own setup row: documents go in, rules come out as drafts, legal approves them.{libEmpty ? ' Nothing is loaded yet.' : ''}</div>
          {!nreason.confirmed ? <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '9px', fontSize: '12.5px', cursor: can ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={edits[nreason.path] !== undefined} disabled={!can} onChange={function (e) { if (e.target.checked) setEdit(nreason.path, nreason.ackValue); else { var o = Object.assign({}, edits); delete o[nreason.path]; setEdits(o); } }} style={{ marginTop: '2px' }} />
            <span>Understood — denials will pick their reasons from that library once it is loaded</span>
          </label> : null}
          {decided(nreason)}
          <div style={hint}><button type="button" onClick={function () { nav('/admin?tab=redaction'); }} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: C.pri, cursor: 'pointer' }}>Open the Redaction rules library →</button></div>
        </div>, { background: '#FDF9F0', borderColor: '#F1D9A8' }) : null}

        {dlegal ? cardBox(<div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: '12.5px', fontWeight: '600' }}>{dlegal.label}</div>
            <select value={edited(dlegal) != null ? edited(dlegal) : (dlegal.suggested || '')} disabled={!can} onChange={function (e) { setEdit(dlegal.path, e.target.value); }}
              style={inp({ width: '340px', marginTop: '7px', display: 'block' })}>
              {(d.approvalGroups || []).map(function (g) { return <option key={g.value} value={g.value}>{g.label}{g.value === dlegal.suggested ? ' (suggested)' : ''}</option>; })}
            </select>
            <div style={hint}>{dlegal.note}</div>{decided(dlegal)}
          </div>
          <span style={cite}><Bind kind="soft">City routing</Bind></span>
        </div>) : null}

        {ncomm ? cardBox(<div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: '12.5px', fontWeight: '600' }}>{ncomm.label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '7px' }}>
              <span style={{ fontSize: '12.5px', fontWeight: '600' }}>Standard wording</span>
              <button type="button" onClick={function () { setLetter('denial'); }} style={btn('sec', { height: '28px', fontSize: '12px' })}>View the letter</button>
              {!ncomm.confirmed ? <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', cursor: can ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={edits[ncomm.path] !== undefined} disabled={!can} onChange={function (e) { if (e.target.checked) setEdit(ncomm.path, ncomm.ackValue); else { var o = Object.assign({}, edits); delete o[ncomm.path]; setEdits(o); } }} />
                Use the standard wording</label> : null}
            </div>
            <div style={hint}>{ncomm.note}</div>{decided(ncomm)}
          </div>
          <span style={cite}><Bind kind="fixed">Required content</Bind></span>
        </div>) : null}

        {ddl ? cardBox(<div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: '12.5px', fontWeight: '600' }}>{ddl.label}</div>
            <input type="number" min="1" value={edited(ddl) != null ? edited(ddl) : ''} placeholder="days after the decision" disabled={!can}
              onChange={function (e) { setEdit(ddl.path, e.target.value); }} style={inp({ width: '190px', marginTop: '7px', display: 'block' })} />
            <div style={hint}>{ddl.note} The attorney-general notices on the left have their own clocks, which the system tracks.</div>{decided(ddl)}
          </div>
          <span style={cite}><Bind kind="soft">City policy</Bind></span>
        </div>) : null}
      </div>
    );
  }

  function eligibilityBody() {
    var d = data.tabs.eligibility;
    var gated = (d.dimensions || []).filter(function (x) { return x.gated || x.key === 'incarceration'; });
    var quiet = (d.dimensions || []).filter(function (x) { return gated.indexOf(x) === -1; });
    return (
      <div>
        <ChoiceHead sub={gated.length === 1 ? 'One decision. Confirming it records who decided, and when.' : gated.length + ' decisions. Confirming each records who decided, and when.'} pill={null} />

        {gated.map(function (dim) {
          var cur = posture[dim.key] !== undefined ? posture[dim.key] : dim.gated;
          var isInc = dim.key === 'incarceration';
          return <div key={dim.key} style={{ margin: '0 16px 12px', padding: '12px 14px', border: '1px solid #F1D9A8', background: '#FDF9F0', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: '600', flexGrow: 1 }}>{isInc ? 'Requests from incarcerated individuals' : 'Eligibility rule: ' + dim.key.replace(/_/g, ' ')}</div>
              {dim.confirmed ? <Pill bg="#E1F2E9" color={C.ok}>Decided</Pill> : <Pill bg="#F6EBD6" color={C.amber}>Confirm the city's posture</Pill>}
            </div>
            <div style={{ fontSize: '12.5px', marginTop: '6px', lineHeight: '1.45' }}>
              {isInc ? <span>{stateName} <b>allows</b> the city to refuse these requests; it does not require it. The system is set up to act on this rule, so the city must decide on the record.</span>
                : <span>The state load marks this rule as one the system may act on. The city decides its posture on the record.</span>}
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '9px', fontSize: '12.5px', cursor: can ? 'pointer' : 'default' }}>
              <input type="radio" name={'posture-' + dim.key} checked={cur === true} disabled={!can} onChange={function () { var o = Object.assign({}, posture); o[dim.key] = true; setPosture(o); }} style={{ marginTop: '2px' }} />
              <span>{isInc ? 'Refuse them, as the statute allows — except through the person\'s attorney' : 'Apply the rule'} <span style={{ color: C.faint }}>(suggested — matches the state load)</span></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '6px', fontSize: '12.5px', cursor: can ? 'pointer' : 'default' }}>
              <input type="radio" name={'posture-' + dim.key} checked={cur === false} disabled={!can} onChange={function () { var o = Object.assign({}, posture); o[dim.key] = false; setPosture(o); }} style={{ marginTop: '2px' }} />
              <span>{isInc ? 'Accept and process them like any other request' : 'Do not apply the rule'}</span>
            </label>
            <div style={{ marginTop: '10px' }}>
              <button type="button" disabled={!can || busy === 'posture'} onClick={function () { confirmPosture(dim.key, cur === true); }} style={btn(can ? 'pri' : 'dis', { height: '30px', fontSize: '12px' })}>
                {dim.confirmed ? 'Record a changed decision' : 'Confirm this decision'}</button>
              {dim.confirmed ? <span style={Object.assign({}, hint, { color: C.ok, marginLeft: '10px' })}>✓ decided by {dim.confirmedBy}{dim.confirmedAt ? ', ' + fmtDate(dim.confirmedAt) : ''}</span> : null}
            </div>
          </div>;
        })}

        <div style={{ padding: '4px 16px 6px' }}>
          <div style={{ fontSize: '13px', fontWeight: '700' }}>Nothing else to decide</div>
          <div style={hint}>{stateName} keeps eligibility simple. Listed so it is clear the decision{gated.length === 1 ? '' : 's'} above {gated.length === 1 ? 'is' : 'are'} all there is.</div>
        </div>
        {quiet.map(function (dim) {
          return <div key={dim.key} style={{ display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: '10px', alignItems: 'start', padding: '9px 16px', borderTop: '1px solid #EEF2F5', fontSize: '12.5px', lineHeight: '1.4' }}>
            <span style={{ fontWeight: '600', textTransform: 'capitalize' }}>{dim.key.replace(/_/g, ' ')}</span>
            <div>{DIM_COPY[dim.key] || 'Not switched on for ' + stateName + '.'} <span style={{ fontSize: '11px', fontWeight: '700', color: C.ok }}>✓ nothing to decide</span></div>
          </div>;
        })}
      </div>
    );
  }

  // ---------------- the deadlines tab (D1) ----------------
  async function setTarget(clockKey) {
    setBusy('target-' + clockKey); setErr(''); setMsg('');
    var v = edits['target/' + clockKey];
    try { await api.post('/request-rules/deadlines/target', { clock: clockKey, days: v === '' ? null : v }); setMsg('Recorded.'); await load(); }
    catch (e) { setErr(errText(e, 'The service target could not be recorded.')); }
    setBusy('');
  }
  async function loadHolidays() {
    setBusy('holidays'); setErr(''); setMsg('');
    try { var r = await api.post('/request-rules/deadlines/holidays', {}); setMsg(r.data.loaded + ' holidays loaded.'); await load(); }
    catch (e) { setErr(errText(e, 'The holiday calendar could not be loaded.')); }
    setBusy('');
  }
  function deadlinesBody() {
    var d = data.tabs.deadlines;
    var statutory = (d.clocks || []).filter(function (r) { return r.kind !== 'operational_target'; });
    var targets = (d.clocks || []).filter(function (r) { return r.kind === 'operational_target'; });
    var cal = d.calendar || { weekend: [0, 6], holidayCount: 0 };
    function clockCite(r) {
      if (!r.citation) return null;
      var short = String(r.citation).split(';')[0];
      return <button type="button" tabIndex={-1} onClick={function () { setStatute({ title: r.label, authority: r.citation, ruleIds: r.sourceRuleIds }); }}
        title="Open the statute text behind this clock" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: C.pri, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline dotted' }}>{short}</button>;
    }
    function grp(title, n) {
      return <div style={{ padding: '12px 16px 6px', fontSize: '12px', fontWeight: '700', background: '#F8FAFC', borderTop: '1px solid ' + C.line }}>{title} <span style={{ fontWeight: '500', color: C.faint }}>· {n}</span></div>;
    }
    return (
      <div>
        <ChoiceHead sub="Statutory figures read as law — changing one is a proposal with a citation. Service targets are the city's own numbers, editable here." pill={null} />
        {grp('Set by ' + stateName + ' law', statutory.length)}
        {statutory.map(function (r) {
          return <div key={r.clockType} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 150px', gap: '12px', alignItems: 'start', padding: '12px 16px', borderTop: '1px solid #EEF2F5', fontSize: '12.5px', lineHeight: '1.45' }}>
            <div>
              <b>{r.label}</b>{r.primary ? <span style={{ color: C.amber, fontWeight: '700' }}> · the primary clock</span> : null}
              <div style={Object.assign({}, cite, { marginTop: '2px' })}>
                <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '10.5px', fontWeight: '700', padding: '1px 7px', borderRadius: '4px', background: '#E8EEF4', color: C.navy, border: '1px solid #C5D3DF', marginRight: '6px' }}>Fixed</span>
                {clockCite(r)}
                {(r.tollReasons || []).length ? <span> · pauses for: {(r.tollReasons || []).map(function (tr) { return TOLL_LABELS[tr] || tr.replace(/_/g, ' '); }).join(' · ')}</span> : null}
              </div>
            </div>
            <div style={{ fontSize: '12px', fontWeight: '700', color: C.navy, background: '#E8EEF4', border: '1px solid #C5D3DF', borderRadius: '6px', padding: '5px 8px', textAlign: 'center', lineHeight: '1.3' }}>{r.duration}</div>
          </div>;
        })}
        {grp("This city's own service targets", targets.length)}
        {targets.map(function (r) {
          var val = edits['target/' + r.clockType] !== undefined ? edits['target/' + r.clockType] : (r.durationRaw != null ? String(r.durationRaw) : '');
          return <div key={r.clockType} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 220px', gap: '12px', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid #EEF2F5', fontSize: '12.5px', lineHeight: '1.45' }}>
            <div>
              <b>{r.label}</b>
              <div style={Object.assign({}, cite, { marginTop: '2px' })}>
                <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '10.5px', fontWeight: '700', padding: '1px 7px', borderRadius: '4px', background: 'white', color: C.mute, border: '1px dashed ' + C.edge, marginRight: '6px' }}>Not a legal deadline</span>
                {r.useCase || 'The city\'s own pacing number.'} Blank = no target.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input value={val} disabled={!can} placeholder="business days"
                onChange={function (e) { setEdit('target/' + r.clockType, e.target.value.replace(/[^\d]/g, '')); }}
                style={{ width: '110px', height: '30px', border: '1px solid ' + C.edge, borderRadius: '7px', padding: '0 10px', fontSize: '13px', fontFamily: 'inherit' }} />
              <button type="button" disabled={!can || busy === 'target-' + r.clockType || edits['target/' + r.clockType] === undefined}
                onClick={function () { setTarget(r.clockType); }}
                style={btn(can && edits['target/' + r.clockType] !== undefined ? 'sec' : 'dis', { height: '28px', fontSize: '12px' })}>Set</button>
            </div>
          </div>;
        })}
        {grp('The calendar the clocks count on', cal.holidayCount ? cal.holidayCount + ' holidays' : 'empty')}
        <div style={{ padding: '12px 16px 14px', fontSize: '12.5px', lineHeight: '1.5' }}>
          <div>Weekends: <b>Saturday and Sunday</b> are not business days.</div>
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {cal.holidayCount
              ? <Pill bg="#E1F2E9" color={C.ok}>Holiday calendar: {cal.holidayCount} days · {String(cal.holidayFirst).slice(0, 4)}–{String(cal.holidayLast).slice(0, 4)}</Pill>
              : <React.Fragment>
                  <Pill bg="#FEE2E2" color="#991B1B">Holiday calendar: 0 days loaded</Pill>
                  <button type="button" disabled={!can || busy === 'holidays'} onClick={loadHolidays} style={btn(can ? 'sec' : 'dis', { height: '28px', fontSize: '12px' })}>{busy === 'holidays' ? 'Loading…' : 'Load the US federal set'}</button>
                </React.Fragment>}
          </div>
          <div style={hint}>{cal.holidayCount
            ? 'Business-day clocks skip these days. Changing a loaded calendar goes through a proposal.'
            : 'Every business-day clock above counts holidays as working days until a calendar is loaded — a 10-day statutory deadline lands EARLIER than the law requires. This is the one item on this tab that needs attention.'}</div>
        </div>
        {(d.unlanded || []).length ? <div style={{ padding: '10px 16px 14px', borderTop: '1px solid ' + C.line }}>
          <span style={hint}>{stateName} law also sets: {(d.unlanded || []).map(function (u) { return u.timerLabel; }).join(' · ')} — it lands on no single clock; when one is declared, the engine pauses every running clock for its duration. Shown so the law's full set is visible; there is nothing to configure.</span>
        </div> : null}
      </div>
    );
  }

  // ---------------- the Request Intake tab (I1) ----------------
  async function confirmIntake(c, value) {
    setBusy('intake-' + c.key); setErr(''); setMsg('');
    try { await api.post('/request-rules/intake/confirm', { path: c.path, value: value }); setMsg('Recorded.'); await load(); }
    catch (e) { setErr(errText(e, 'The choice could not be recorded.')); }
    setBusy('');
  }
  function intakeBody() {
    var d = data.tabs.intake;
    function listVal(c) { return edits[c.path] !== undefined ? edits[c.path] : (Array.isArray(c.value) ? c.value : (Array.isArray(c.suggested) ? c.suggested : [])); }
    function toggleIn(c, v) {
      var cur = listVal(c).slice(); var i = cur.indexOf(v);
      if (i >= 0) cur.splice(i, 1); else cur.push(v);
      setEdit(c.path, cur);
    }
    function row(c, control) {
      return <div key={c.key} style={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr) 110px', gap: '12px', alignItems: 'start', padding: '12px 16px', borderTop: '1px solid #EEF2F5' }}>
        <div style={{ fontSize: '12.5px', fontWeight: '600', lineHeight: '1.35', paddingTop: '2px' }}>{c.label}</div>
        <div>{control}
          <div style={Object.assign({}, cite, { marginTop: '6px' })}><Bind kind="soft">Silent</Bind> {c.note}</div>
          {decided(c)}
        </div>
        <button type="button" disabled={!can || busy === 'intake-' + c.key}
          onClick={function () { confirmIntake(c, c.kind === 'choice' ? (edits[c.path] !== undefined ? edits[c.path] : (c.value != null ? c.value : c.suggested)) : listVal(c)); }}
          style={btn(can ? 'sec' : 'dis', { height: '28px', fontSize: '12px' })}>Confirm</button>
      </div>;
    }
    var g1 = (d.choices || []).filter(function (c) { return c.key === 'Master.g1'; })[0];
    var g4 = (d.choices || []).filter(function (c) { return c.key === 'Master.g4'; })[0];
    var p3 = (d.choices || []).filter(function (c) { return c.key === 'Master.p3'; })[0];
    // channels the loaded rules NAME (display marker only — derived from the rule text, not hardcoded law)
    var ruleText = (d.rules || []).map(function (r) { return r.summary; }).join(' ').toLowerCase();
    var lawNamed = { email: /e-?mail/.test(ruleText), mail: /\bmail\b/.test(ruleText), hand_delivery: /hand deliver/.test(ruleText) };
    function checks(c, markLaw) {
      var cur = listVal(c);
      return <div style={{ display: 'flex', flexWrap: 'wrap', rowGap: '8px' }}>
        {(c.options || []).map(function (o) {
          var on = cur.indexOf(o.value) >= 0;
          var law = markLaw && lawNamed[o.value];
          return <label key={o.value} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', marginRight: '14px', whiteSpace: 'nowrap', cursor: can ? 'pointer' : 'default' }}>
            <input type="checkbox" disabled={!can} checked={on} onChange={function () { toggleIn(c, o.value); }} />
            {o.label}{law ? <span style={{ color: C.faint, fontSize: '10.5px' }}> (law)</span> : null}
          </label>;
        })}
      </div>;
    }
    return (
      <div>
        <ChoiceHead sub="Three choices. Confirming each records who decided, and when." pill={d.unconfirmed ? <Pill bg="#F6EBD6" color={C.amber}>{(d.choices.length - d.unconfirmed) + ' of ' + d.choices.length + ' confirmed'}</Pill> : <Pill bg="#E1F2E9" color={C.ok}>all confirmed</Pill>} />

        {/* the designated addresses — read from the agency screen, never typed here (TX-style § 552.234(c)) */}
        <div style={{ margin: '4px 16px 10px', padding: '10px 12px', background: '#F8FAFC', border: '1px solid ' + C.line, borderRadius: '8px', fontSize: '12.5px', lineHeight: '1.5' }}>
          <Bind kind="fixed">Designated addresses</Bind>{' '}
          {d.addresses && (d.addresses.email || d.addresses.mailing)
            ? <span>Requests count as received at <b>{d.addresses.email || 'the contact e-mail'}</b>{d.addresses.mailing ? <span> and <b>{d.addresses.mailing}</b></span> : null} — the addresses from the agency screen, shown to requestors on the portal and in every letter.</span>
            : <span>The agency screen's contact e-mail and mailing address serve as the designated ones — they are not filled in yet.</span>}
          <button type="button" onClick={function () { nav('/setup/agency'); }} style={btn('sec', { height: '26px', fontSize: '11.5px', marginLeft: '8px' })}>Open the agency screen</button>
        </div>

        {g1 ? row(g1, checks(g1, true)) : null}
        {g4 ? row(g4, (
          <select value={edits[g4.path] !== undefined ? edits[g4.path] : (g4.value != null ? g4.value : g4.suggested)} disabled={!can}
            onChange={function (e) { setEdit(g4.path, e.target.value); }} style={inp({ display: 'block', width: '280px' })}>
            {(g4.options || []).map(function (o) { return <option key={o.value} value={o.value}>{o.label}{o.value === g4.suggested ? ' (suggested)' : ''}</option>; })}
          </select>
        )) : null}
        {p3 ? row(p3, checks(p3, false)) : null}
      </div>
    );
  }

  // ---------------- letter views ----------------
  function letterModal() {
    if (!letter) return null;
    var isDenial = letter === 'denial';
    var L = data.letters && data.letters.clarification;
    return (
      <div onClick={function () { setLetter(false); }} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(18,35,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
        <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '12px', width: '680px', maxWidth: '94%', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 18px', borderBottom: '1px solid ' + C.line, background: '#F8FAFC' }}>
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: '700' }}>{isDenial ? 'The denial letter — standard structure' : 'The clarification letter — standard wording'}</div>
              <div style={hint}>{isDenial ? 'The letter is drafted at denial time in the denial compose step; this is the structure every one carries.' : 'Exactly as the system sends it today, filled in from the request. Read-only in this slice.'}</div>
            </div>
            <button type="button" onClick={function () { setLetter(false); }} style={btn('sec', { height: '30px' })}>Close</button>
          </div>
          {isDenial ? (
            <div style={{ padding: '20px 26px', fontSize: '13px', lineHeight: '1.6' }}>
              <ol style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <li><b>What was requested and what is being withheld</b> — the request, restated, and which records or parts are denied.</li>
                <li><b>The reason relied on</b> — picked from the Redaction rules library, cited to the statute it rests on.</li>
                <li><b>The notices the state requires</b> — where the attorney general was asked: that the city is withholding and has asked, with a copy of the ask; where a previous determination is relied on: which one.</li>
                <li><b>What the requestor can do next</b> — the appeal and complaint paths the state provides.</li>
              </ol>
              <div style={Object.assign({}, hint, { marginTop: '14px' })}>Letter wording a city can edit — with per-state required-content checks — is its own later piece of work.</div>
            </div>
          ) : (
            <div style={{ padding: '20px 26px' }}>
              <div style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '13.5px', lineHeight: '1.55', color: '#111', whiteSpace: 'pre-wrap' }}>{L ? L.text : ''}</div>
              <div style={{ marginTop: '14px', padding: '10px 12px', background: '#FDF9F0', border: '1px solid #F1D9A8', borderRadius: '8px' }}>
                <span style={hint}><b>The reply-window sentence</b> is the warning the law requires — the letter must say what happens if the requestor does not reply.{L && !L.graceDays ? ' It appears once the reply window above is set.' : ''}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------- the page ----------------
  var headSub = {
    clarification: 'What happens when a request is too unclear to search for: what ' + stateName + ' law says, and the few things this city decides.',
    exemptions: 'Withholding information in ' + stateName + ' runs on strict clocks. The clocks are the law\'s; the city decides who approves a denial and how the letter goes out.',
    eligibility: 'In ' + stateName + ', anyone may request. What is left to the city — and what the law already settles.',
    deadlines: 'Every clock a request runs on: the deadlines ' + stateName + ' law sets, the service targets this city sets for itself, and what pauses them. A legal section — Senior Legal signs it off.',
    intake: 'The ways a request may reach the city, where it counts as received, and what happens the moment it arrives: what ' + stateName + ' law says, and the three things this city decides.'
  }[tab];
  var headTitle = { clarification: 'Vague requests and clarification', exemptions: 'Exemptions and appeals', eligibility: 'Who is allowed to request', deadlines: 'Response deadlines and tolling', intake: 'Request Intake' }[tab];
  var showSave = tab !== 'eligibility' && tab !== 'deadlines' && tab !== 'intake' && (tab !== 'clarification' || clarOn);

  return (
    <div style={{ maxWidth: '1220px', color: C.ink }}>
      {/* status strip — the shared pattern; follows the ACTIVE tab's hub row */}
      <div style={Object.assign({}, card, { display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 14px', marginBottom: '14px' })}>
        <button type="button" onClick={function () { nav('/admin?tab=setup'); }} title="Back to Setup and Configuration"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 11px', border: 0, borderRadius: '999px', background: st.bg, color: st.color, fontSize: '11px', fontWeight: '700', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          {st.label}
        </button>
        <span style={{ flexGrow: 1, fontSize: '12px', color: C.mute, lineHeight: '1.35' }}>{hubRow ? hubRow.evidence : ''}</span>
        <span style={{ fontSize: '11.5px', color: C.faint }}>Compliance and Policies Setup · {laneIndex}</span>
        {attestBtn()}
      </div>

      {err ? <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: C.red, marginBottom: '12px' }}>{err}</div> : null}

      <div style={card}>
        {/* tabs: one screen, three hub rows; each dot shows its row's hub state */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid ' + C.line, padding: '0 8px' }}>
          {TABS.map(function (x) {
            var xs = STATE[(hub[x.hubKey] && hub[x.hubKey].state) || 'not_started'];
            var on = x.key === tab;
            return <button key={x.key} type="button" onClick={function () { goTab(x.key); }}
              style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '12px 16px', fontSize: '13px', fontWeight: '600', fontFamily: 'inherit', background: 'none', border: 0, cursor: 'pointer', color: on ? C.ink : C.mute, borderBottom: '2px solid ' + (on ? C.pri : 'transparent'), marginBottom: '-1px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: xs.color }} />
              {x.label}
            </button>;
          })}
        </div>

        <div style={{ padding: '16px 20px', borderBottom: '1px solid ' + C.line, display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: '19px', fontWeight: '700' }}>{headTitle}</div>
            <div style={{ fontSize: '12.5px', color: C.mute, marginTop: '3px' }}>{headSub}</div>
          </div>
          {tab === 'exemptions' && data.tabs.exemptions.redactionLibrary && data.tabs.exemptions.redactionLibrary.approvedRules === 0
            ? <Pill bg="#EDE9FE" color="#5B21B6">Reasons library · not loaded yet</Pill> : null}
          {tab === 'eligibility' && td.unconfirmed > 0
            ? <Pill bg="#F6EBD6" color={C.amber}>{td.unconfirmed === 1 ? '1 decision to confirm' : td.unconfirmed + ' decisions to confirm'}</Pill> : null}
          {tab === 'deadlines' && td.calendar && td.calendar.holidayCount === 0
            ? <Pill bg="#FEE2E2" color="#991B1B">Holiday calendar empty</Pill> : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '480px minmax(0, 1fr)', gap: 0 }}>
          <LawPanel stateName={stateName} rules={td.rules || []} onCite={setStatute} />
          {tab === 'clarification' ? clarificationBody() : tab === 'exemptions' ? exemptionsBody() : tab === 'deadlines' ? deadlinesBody() : tab === 'intake' ? intakeBody() : eligibilityBody()}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid ' + C.line, background: C.wash, borderRadius: '0 0 10px 10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={Object.assign({}, hint, { flexGrow: 1, marginTop: 0 })}>
            {msg ? <span style={{ color: C.ok, fontWeight: '600' }}>{msg} </span> : null}
            {tab === 'clarification' ? 'Attest becomes available once clarification is switched on and all five choices are recorded.'
              : tab === 'exemptions' ? <span>This is a legal section: recording and attesting these choices requires the <b>Legal Rules</b> group — the Senior Legal attorney owns it.</span>
              : tab === 'deadlines' ? <span>This is a legal section — <b>Legal Rules</b> records targets and attests. Statutory figures never edit in place: a change means the law changed, which goes through a proposal with a citation. Attest waits only on the holiday calendar; blank service targets are a valid posture.</span>
              : tab === 'intake' ? 'Attest becomes available once all three choices are confirmed. The designated addresses change on the agency screen, never here.'
              : 'Attest becomes available once the decision above is confirmed.'}
            {!can ? ' · view only for you' : ''}
          </span>
          {showSave ? <button type="button" disabled={!can || busy === 'save'} onClick={saveChoices} style={btn(can ? 'pri' : 'dis')}>{busy === 'save' ? 'Recording…' : 'Save choices'}</button> : null}
        </div>
      </div>

      <StatutePopup info={statute} onClose={function () { setStatute(null); }} />
      {letterModal()}
    </div>
  );
}
