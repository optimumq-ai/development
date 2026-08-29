import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import StatutePopup from '../components/StatutePopup';

// FEE RULES — the hub's `fee_law` screen (canvas approved by Kevin 2026-08-25; split into
// tabs on his direction 2026-08-26). Status strip · four tabs: State mandate · City decisions (deferral) ·
// Fee policy document (AI reads it into decisions with references) · Test an estimate (the live fee-engine
// sandbox, moved here from Fee Configuration). Authority citations open the research record (statute text).
// Approve = fee schedule version n. Data: GET/PUT/POST /api/fee-law · /api/fee-sandbox/preview ·
// /api/onboarding/fees/test-result · /api/jurisdiction-profile/rules-research/:id.

var C = { ink: '#12232E', mute: '#5C6F7C', faint: '#8296A4', ph: '#A9B7C2', line: '#D2DCE3', edge: '#BECAD3', wash: '#F2F6F9', pri: '#1E6091', red: '#B02A37', ok: '#1B8A5A', amber: '#9A6512', navy: '#0E3A5C' };
var STATE = {
  ready:           { label: 'Ready',           bg: '#E1F2E9', color: '#1B8A5A' },
  in_progress:     { label: 'In progress',     bg: '#F6EBD6', color: '#9A6512' },
  not_started:     { label: 'Not started',     bg: '#F3F4F6', color: '#4B5563' },
  needs_attention: { label: 'Needs attention', bg: '#FEE2E2', color: '#991B1B' },
  waiting:         { label: 'Waiting',         bg: '#EDE9FE', color: '#5B21B6' },
};
var BIND = {
  fixed:    { label: 'Fixed',   bg: '#E8EEF4', color: '#0E3A5C', border: '#C5D3DF' },
  ceiling:  { label: 'Ceiling', bg: '#FFF4E0', color: '#9A6512', border: '#F1D9A8' },
  floor:    { label: 'Floor',   bg: '#E1F2E9', color: '#1B8A5A', border: '#B5E0C9' },
  discretionary: { label: 'Discretionary', bg: 'white', color: '#5C6F7C', border: '#BECAD3', dashed: true },
};
var TABS = [
  { key: 'mandate', label: 'State mandate' },
  { key: 'city', label: 'City decisions' },
  { key: 'document', label: 'Fee policy document' },
  { key: 'test', label: 'Test an estimate' },
];
var hint = { fontSize: '11.5px', color: C.faint, lineHeight: '1.4' };
var card = { background: 'white', border: '1px solid ' + C.line, borderRadius: '10px' };
var cite = { fontSize: '11px', color: C.faint, lineHeight: '1.35' };
var lbl = { fontSize: '11px', fontWeight: '600', color: C.mute, display: 'block', marginBottom: '3px' };
function btn(kind, extra) {
  var base = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px', height: '36px', padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: '600', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' };
  var k = kind === 'pri' ? { background: C.pri, color: 'white', border: '1px solid ' + C.pri }
    : kind === 'dis' ? { background: C.wash, color: C.ph, border: '1px solid ' + C.line, cursor: 'default' }
    : { background: 'white', color: C.ink, border: '1px solid ' + C.edge };
  return Object.assign(base, k, extra || {});
}
function inp(missing, extra) { return Object.assign({ display: 'block', width: '100%', boxSizing: 'border-box', height: '32px', border: '1px solid ' + (missing ? C.red : C.edge), borderRadius: '7px', background: 'white', padding: '0 10px', fontSize: '13px', color: C.ink, fontFamily: 'inherit' }, extra || {}); }
function Chip(props) { var b = BIND[props.kind]; if (!b) return null; return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '10.5px', fontWeight: '700', padding: '1px 7px', borderRadius: '4px', whiteSpace: 'nowrap', background: b.bg, color: b.color, border: '1px ' + (b.dashed ? 'dashed' : 'solid') + ' ' + b.border }}>{b.label}</span>; }
function Says(props) { return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '10.5px', fontWeight: '700', padding: '1px 7px', borderRadius: '4px', whiteSpace: 'nowrap', background: 'white', color: C.mute, border: '1px dashed ' + C.edge, marginRight: '6px' }}>{props.text}</span>; }
function Pill(props) { return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '11px', fontWeight: '700', borderRadius: '999px', padding: '2px 9px', whiteSpace: 'nowrap', background: props.bg, color: props.color }}>{props.children}</span>; }
function Group(props) { return <div style={{ padding: '10px 12px 4px', fontSize: '12px', fontWeight: '700', color: C.ink, background: '#F8FAFC', borderTop: '1px solid ' + C.line }}>{props.title} <span style={{ fontWeight: '500', color: C.faint }}>· {props.n}</span></div>; }
function errText(e, fb) { return (e && e.response && e.response.data && e.response.data.error) || fb; }
function fmt(n) { n = Number(n); return Number.isInteger(n) ? String(n) : (Math.round(n * 1000) / 1000).toString(); }
function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
function num(x) { x = Number(x); return isFinite(x) ? x : 0; }
function cityText(v) { if (v == null) return ''; if (typeof v === 'object') return Object.keys(v).map(function (k) { return k + ' ' + (v[k] === 'actual' ? 'actual' : v[k] == null ? '—' : fmt(v[k])); }).join(' · '); return String(v); }

export default function FeeLawPage() {
  var nav = useNavigate();
  var [params, setParams] = useSearchParams();
  var tab = TABS.some(function (t) { return t.key === params.get('tab'); }) ? params.get('tab') : 'mandate';
  function goTab(k) { setParams(k === 'mandate' ? {} : { tab: k }); }

  var [data, setData] = useState(null);
  var [hub, setHub] = useState(null);       // { fee_law, fee_test }
  var [edits, setEdits] = useState({});
  var [err, setErr] = useState('');
  var [msg, setMsg] = useState('');
  var [busy, setBusy] = useState('');
  var [docText, setDocText] = useState('');
  var [docName, setDocName] = useState('');
  var [approved, setApproved] = useState(null);
  var [statute, setStatute] = useState(null);
  var [wEdits, setWEdits] = useState({});       // waiver-choice edits before save
  var [sentences, setSentences] = useState(false);
  var [clockEdits, setClockEdits] = useState({}); // clock-setting edits before confirm

  function load() {
    return Promise.all([api.get('/fee-law'), api.get('/setup-hub')]).then(function (r) {
      setData(r[0].data); setEdits({}); setWEdits({}); setClockEdits({});
      var h = {}; r[1].data.lanes.forEach(function (l) { l.items.forEach(function (x) { if (x.key === 'fee_law' || x.key === 'fee_test') h[x.key] = x; }); });
      setHub(h); setErr('');
    }).catch(function (e) { setErr(errText(e, 'The fee-law screen could not load.')); });
  }
  useEffect(function () { load(); }, []);

  if (err && !data) return <div style={{ padding: '24px', color: C.red }}>{err}</div>;
  if (!data) return <div style={{ padding: '24px', color: C.ph }}>Reading what the law allows…</div>;
  if (!data.jurisdiction) return (
    <div style={{ maxWidth: '760px' }}>
      <div style={Object.assign({}, card, { padding: '18px 20px' })}>
        <div style={{ fontSize: '16px', fontWeight: '700' }}>No state locked yet</div>
        <div style={{ fontSize: '13px', color: C.mute, marginTop: '6px' }}>The law's fee figures arrive when the state is locked on the agency screen.</div>
        <button type="button" onClick={function () { nav('/setup/agency'); }} style={btn('pri', { marginTop: '12px' })}>Go to Agency name, address and contact</button>
      </div>
    </div>
  );

  var can = !!data.canEdit;
  var hubRow = hub && hub.fee_law;
  var st = STATE[(hubRow && hubRow.state) || 'not_started'];
  var c = data.counts;
  var rows = data.rows;
  var dirty = Object.keys(edits).length > 0;
  var attested = hubRow && hubRow.signoff;
  var waiver = data.waiver || { choices: [], decided: 0, sentences: [] };
  var waiverOpen = waiver.choices.length - waiver.decided;
  var clock = data.clock || { enabled: false, choices: [], confirmed: 0 };
  var clockOpen = clock.enabled ? clock.choices.length - clock.confirmed : 0;  // off is itself a configured posture
  var mayAttest = can && !!data.version && waiverOpen === 0 && clockOpen === 0 && hubRow && hubRow.state !== 'waiting' && hubRow.state !== 'needs_attention';
  var stateName = data.jurisdiction.stateName || data.jurisdiction.name;
  var nextVersion = data.version ? data.version.version + 1 : 1;

  function valueOf(r) { return edits[r.key] !== undefined ? edits[r.key] : cityText(r.city && r.city.value); }
  function setVal(k, v) { var e = Object.assign({}, edits); e[k] = v; setEdits(e); setMsg(''); }
  function itemsFromEdits() {
    var items = {};
    Object.keys(edits).forEach(function (k) {
      var s = String(edits[k]).trim();
      var v = s === '' ? null : /^(none|no)$/i.test(s) ? 'none' : /^actual/i.test(s) ? 'actual' : /^-?\d+(\.\d+)?$/.test(s.replace(/^\$/, '')) ? Number(s.replace(/^\$/, '')) : s;
      items[k] = { value: v };
    });
    return items;
  }
  async function save() {
    setBusy('save'); setErr('');
    try {
      var r = await api.put('/fee-law/decisions', { items: itemsFromEdits() });
      if (r.data.refused && r.data.refused.length) setErr(r.data.refused.map(function (x) { return (rows.filter(function (q) { return q.key === x.key; })[0] || {}).label + ': ' + x.why; }).join(' · '));
      else setMsg('Saved.');
      await load();
    } catch (e) { setErr(errText(e, 'Could not save.')); }
    setBusy('');
  }
  async function approve() {
    setBusy('approve'); setErr('');
    try {
      if (dirty) await api.put('/fee-law/decisions', { items: itemsFromEdits() });
      var r = await api.post('/fee-law/approve', {});
      setApproved(r.data.profile);
      await load();
    } catch (e) { setErr(errText(e, 'Could not approve.')); }
    setBusy('');
  }
  async function readDoc() {
    setBusy('doc'); setErr('');
    try {
      var r = await api.post('/fee-law/read-document', { text: docText, name: docName || 'pasted text' });
      setMsg((r.data.found.length) + ' figure(s) read from ' + (docName || 'the text') + (r.data.skipped.length ? ' · ' + r.data.skipped.length + ' item(s) not in the document' : '') + (r.data.notes ? ' · ' + r.data.notes : ''));
      setDocText('');
      await load();
    } catch (e) { setErr(errText(e, 'The document could not be read.')); }
    setBusy('');
  }
  function onFile(e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    if (!/\.(txt|md|text|csv)$/i.test(f.name)) { setErr('Upload a text file (.txt or .md), or paste the policy text. PDF reading is not available yet.'); return; }
    var rd = new FileReader(); rd.onload = function () { setDocText(String(rd.result || '')); setDocName(f.name); }; rd.readAsText(f);
  }
  // The deposit & payment clock (F3): the switch and each confirm write through to the policy store
  // the engine reads. Values shown before confirming: an edit > the recorded decision > the state's answer.
  function clockVal(ch) {
    if (clockEdits[ch.key] !== undefined) return clockEdits[ch.key];
    if (ch.value != null) return ch.kind === 'bool' ? (ch.value ? 'yes' : 'no') : String(ch.value);
    if (ch.prefill && ch.prefill.value != null) return ch.kind === 'bool' ? (ch.prefill.value ? 'yes' : 'no') : String(ch.prefill.value);
    return '';
  }
  function setClockVal(k, v) { var e = Object.assign({}, clockEdits); e[k] = v; setClockEdits(e); setMsg(''); }
  async function setClockEnabled(on) {
    setBusy('clock'); setErr('');
    try { await api.post('/fee-law/clock', { enabled: on }); await load(); }
    catch (e) { setErr(errText(e, 'Could not update the clock switch.')); }
    setBusy('');
  }
  async function confirmClock(ch) {
    var v = clockVal(ch);
    if (v === '') { setErr(ch.label + ' — enter a value first.'); return; }
    var value = ch.kind === 'bool' ? v === 'yes' : ch.kind === 'days' ? Number(v) : v;
    setBusy('clock'); setErr('');
    try { await api.post('/fee-law/clock', { confirm: { key: ch.key, value: value } }); setMsg('Confirmed.'); await load(); }
    catch (e) { setErr(errText(e, 'Could not record the setting.')); }
    setBusy('');
  }
  async function toggleAttest() {
    setBusy('attest');
    try { if (attested) await api.delete('/setup-hub/fee_law/done'); else await api.post('/setup-hub/fee_law/done'); await load(); }
    catch (e) { setErr(errText(e, 'Could not update.')); }
    setBusy('');
  }
  async function saveWaiver() {
    setBusy('waiver'); setMsg('');
    try {
      var body = {};
      if (wEdits.decider !== undefined) body.decider = wEdits.decider;
      if (wEdits.denialWording !== undefined) body.denialWording = wEdits.denialWording;
      await api.post('/fee-law/waiver', body);
      setWEdits({}); setMsg('Waiver choices recorded.');
      await load();
    } catch (e) { setErr(errText(e, 'The waiver choices could not be recorded.')); }
    setBusy('');
  }

  function Authority(props) {
    var r = props.row;
    var hasRules = r.law.rules && r.law.rules.length;
    return <span style={cite}>
      {props.pre}
      {hasRules ? <button type="button" tabIndex={-1} onClick={function () { setStatute({ title: r.label, authority: r.law.authority, ruleIds: r.law.rules }); }} title="Open the statute text behind this figure" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: C.pri, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline dotted' }}>{r.law.authority}</button> : r.law.authority}
      {r.gap ? <span style={{ fontSize: '10.5px', fontWeight: '700', color: C.red }}> · {r.gap}</span> : null}
    </span>;
  }
  function CityCell(props) {
    var r = props.row;
    if (!r.editable) return <div style={inp(false, { display: 'flex', alignItems: 'center', background: C.wash, color: C.mute, fontSize: '12px' })}>{r.city && typeof r.city.value === 'string' ? r.city.value : 'as law'}</div>;
    if (r.city && r.city.value && typeof r.city.value === 'object' && edits[r.key] === undefined) {
      return <div style={inp(false, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.wash, color: C.mute, fontSize: '11.5px' })}>{cityText(r.city.value)}<span style={{ fontSize: '10px', color: C.faint, fontWeight: '700' }}>AS LOADED</span></div>;
    }
    var v = valueOf(r);
    var missing = r.binding === 'deferral' && v === '';
    var tag = edits[r.key] !== undefined ? null : r.city && r.city.source === 'default' && r.city.value != null ? (r.binding === 'floor' ? 'MINIMUM' : 'DEFAULT') : r.city && r.city.source === 'document' ? (r.city.ref ? r.city.ref : 'from document') : null;
    return <div style={{ position: 'relative' }}>
      <input value={v} disabled={!can} placeholder={r.binding === 'deferral' ? (r.actualOk ? r.unit + ', or actual' : r.noneOk ? r.unit + ' or none' : r.unit) : r.unit}
        onChange={function (e) { setVal(r.key, e.target.value); }} style={inp(missing, tag ? { paddingRight: '78px' } : {})} />
      {tag ? <span title={tag === 'DEFAULT' ? 'Default = the ceiling. Lower it if this city charges less.' : tag} style={{ position: 'absolute', right: '8px', top: '9px', fontSize: '9.5px', fontWeight: '700', color: r.city.source === 'document' ? C.ok : C.faint, maxWidth: '68px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span> : null}
    </div>;
  }
  var grid5 = '230px 190px 78px 190px minmax(0, 1fr)', grid3 = '260px 220px minmax(0, 1fr)';
  function MandateRow(props) {
    var r = props.row;
    return <div style={{ display: 'grid', gridTemplateColumns: grid5, gap: '10px', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid #EEF2F5', fontSize: '12.5px' }}>
      <span>{r.label}</span>
      <span style={{ fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>{r.binding === 'ceiling' && r.ceiling != null ? 'up to ' : r.binding === 'floor' && r.floor != null ? 'at least ' : ''}{r.law.display}
        {r.law.ag != null ? <div style={Object.assign({}, hint, { fontWeight: '500' })}>AG rate ${fmt(r.law.ag)} + 25% for cities</div> : null}</span>
      <Chip kind={r.binding} />
      {CityCell({ row: r })}
      {Authority({ row: r })}
    </div>;
  }
  function DeferralRow(props) {
    var r = props.row;
    return <div style={{ display: 'grid', gridTemplateColumns: grid3, gap: '10px', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid #EEF2F5', fontSize: '12.5px' }}>
      <span>{r.label}</span>
      {CityCell({ row: r })}
      {Authority({ row: r, pre: <Says text={r.law.says} /> })}
    </div>;
  }
  var head5 = <div style={{ display: 'grid', gridTemplateColumns: grid5, gap: '10px', padding: '6px 12px', fontSize: '11px', fontWeight: '700', color: C.faint, textTransform: 'uppercase', letterSpacing: '0.04em' }}><span>Item</span><span>{data.jurisdiction.code} allows</span><span>Binding</span><span>This city charges</span><span>Authority</span></div>;
  var head3 = <div style={{ display: 'grid', gridTemplateColumns: grid3, gap: '10px', padding: '6px 12px', fontSize: '11px', fontWeight: '700', color: C.faint, textTransform: 'uppercase', letterSpacing: '0.04em' }}><span>Item</span><span>This city</span><span>What the law says</span></div>;
  var mand = rows.filter(function (r) { return r.binding !== 'deferral'; }), defr = rows.filter(function (r) { return r.binding === 'deferral'; });
  var by = function (list, b) { return list.filter(function (r) { return r.bucket === b; }); };
  var docRows = rows.filter(function (r) { return r.city && r.city.source === 'document'; });

  function Footer() {
    return <div style={{ padding: '12px 20px', borderTop: '1px solid ' + C.line, background: C.wash, borderRadius: '0 0 10px 10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
      <span style={Object.assign({}, hint, { flexGrow: 1 })}>
        {msg ? <span style={{ color: C.ok, fontWeight: '600' }}>{msg} </span> : null}
        Approving records every figure — the state's and the city's — as <b>fee schedule v{nextVersion}</b>, the schedule estimates price from.{!can ? ' · view only for you' : ''}
      </span>
      <button type="button" onClick={function () { load(); setMsg(''); }} style={btn('sec')}>Cancel</button>
      <button type="button" disabled={!can || !dirty || busy === 'save'} onClick={save} style={btn(can && dirty ? 'sec' : 'dis')}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
      <button type="button" disabled={!can || c.undecided > 0 || busy === 'approve'} onClick={approve} style={btn(can && !c.undecided ? 'pri' : 'dis')} title={c.undecided ? c.undecided + ' city decisions still undecided' : ''}>
        {busy === 'approve' ? 'Approving…' : 'Approve as fee schedule v' + nextVersion + (c.undecided ? ' · ' + c.undecided + ' undecided' : '')}
      </button>
    </div>;
  }

  return (
    <div style={{ maxWidth: '1420px', color: C.ink }}>
      <div style={Object.assign({}, card, { display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 14px', marginBottom: '14px' })}>
        <button type="button" onClick={function () { nav('/admin?tab=setup'); }} title="Back to Setup and Configuration"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 11px', border: 0, borderRadius: '999px', background: st.bg, color: st.color, fontSize: '11px', fontWeight: '700', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>{st.label}
        </button>
        <span style={{ flexGrow: 1, fontSize: '12px', color: C.mute, lineHeight: '1.35' }}>{hubRow ? hubRow.evidence : ''}</span>
        <span style={{ fontSize: '11.5px', color: C.faint }}>Compliance and Policies Setup</span>
        {attested
          ? <button type="button" disabled={busy === 'attest' || !can} onClick={toggleAttest} style={btn('sec', { height: '30px' })}>Attested · undo</button>
          : <button type="button" disabled={!mayAttest || busy === 'attest'} onClick={toggleAttest} style={btn(mayAttest ? 'pri' : 'dis', { height: '30px' })} title={mayAttest ? 'Record that this item is complete' : (!data.version ? 'Approve a fee schedule version first' : waiverOpen ? 'Record the fee-waiver choices first' : 'Confirm the deposit & payment clock settings first')}>Attest as complete</button>}
      </div>

      {err ? <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: C.red, marginBottom: '12px' }}>{err}</div> : null}
      {approved ? <div style={{ background: '#E1F2E9', border: '1px solid #A7D9BF', borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', fontSize: '13px' }}>
        <b style={{ color: C.ok }}>Fee schedule v{approved.version} approved.</b> Estimates now price from it. Later changes create v{approved.version + 1}; nothing is edited in place.
        <button type="button" onClick={function () { setApproved(null); goTab('test'); }} style={btn('sec', { height: '30px', marginLeft: '12px' })}>Test an estimate against it</button>
        <button type="button" onClick={function () { nav('/admin?tab=setup'); }} style={btn('sec', { height: '30px', marginLeft: '8px' })}>See it on the hub</button>
      </div> : null}

      <div style={card}>
        <div style={{ padding: '16px 20px 0', borderBottom: '1px solid ' + C.line }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: '19px', fontWeight: '700' }}>Fee rules</div>
              <div style={{ fontSize: '12.5px', color: C.mute, marginTop: '3px' }}>Everything about fees in one place: what {stateName} law sets, what this city decides, and when a fee is waived. Together they become the fee schedule the estimates use.</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              {data.version ? <Pill bg="#E1F2E9" color={C.ok}>Fee schedule v{data.version.version} · active</Pill> : <Pill bg="#EDE9FE" color="#5B21B6">Fee schedule · no version yet</Pill>}
              <span style={hint}>{data.version ? 'approved by ' + data.version.by + ', ' + String(data.version.at).slice(0, 10) + ' · approving again creates v' + nextVersion : "Approving the city's figures creates version 1"}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '2px', marginTop: '12px' }}>
            {TABS.map(function (t) {
              var active = tab === t.key;
              var badge = t.key === 'mandate' ? c.mandate + ' loaded' : t.key === 'city' ? (c.decided + waiver.decided + (clock.enabled ? clock.confirmed : 0)) + ' of ' + (c.deferral + waiver.choices.length + (clock.enabled ? clock.choices.length : 0)) + ' decided' : t.key === 'document' ? (data.document ? data.document.found + ' from document' : 'none read') : (data.version ? 'v' + data.version.version : 'no version');
              return <button key={t.key} type="button" onClick={function () { goTab(t.key); }}
                style={{ padding: '9px 16px', background: 'none', border: 'none', borderBottom: active ? '2px solid ' + C.pri : '2px solid transparent', marginBottom: '-1px', fontSize: '13.5px', fontWeight: active ? '700' : '500', color: active ? C.pri : C.mute, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                {t.label}<span style={{ fontSize: '10.5px', fontWeight: '700', color: active ? C.pri : C.faint, background: active ? '#E8EEF4' : C.wash, borderRadius: '999px', padding: '1px 7px' }}>{badge}</span>
              </button>;
            })}
          </div>
        </div>

        {tab === 'mandate' ? <div>
          <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0E3A5C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: '700' }}>State mandate</div>
              <div style={hint}>Set by {stateName} law, loaded when the state was locked. The law's figure is not editable here — a change means the law changed, which goes through a proposal with a citation. Where the law sets a ceiling, the city's rate starts at the ceiling — lower it if you charge less. Click an authority to read the statute.</div>
            </div>
          </div>
          <Group title="Fee computation — the numbers the engine multiplies" n={by(mand, 'computation').length} />
          {head5}{by(mand, 'computation').map(function (r) { return <React.Fragment key={r.key}>{MandateRow({ row: r })}</React.Fragment>; })}
          <Group title="Estimates, deposits, payment and their clocks" n={by(mand, 'estimate_payment').length} />
          {head5}{by(mand, 'estimate_payment').map(function (r) { return <React.Fragment key={r.key}>{MandateRow({ row: r })}</React.Fragment>; })}
          {by(mand, 'waiver').length ? <React.Fragment>
            <Group title="Fee waiver" n={by(mand, 'waiver').length} />
            {head5}{by(mand, 'waiver').map(function (r) { return <React.Fragment key={r.key}>{MandateRow({ row: r })}</React.Fragment>; })}
          </React.Fragment> : null}
          <div style={{ padding: '10px 16px 14px', borderTop: '1px solid ' + C.line }}>
            <span style={hint}><b>Ceiling</b> rows: the figure shown is this city's ceiling and its rate is pre-filled there; an entry above it is refused. <b>Fixed</b> rows apply as written.{c.gaps ? <span> Items marked <span style={{ color: C.red, fontWeight: '700' }}>needs requestor ledger</span> are law today but have no home in the engine yet — shown so the gap is visible.</span> : null}</span>
          </div>
          {Footer()}
        </div> : null}

        {tab === 'city' ? <div>
          <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9A6512" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: '700' }}>Guidelines and deferral to local policy</div>
              <div style={hint}>{stateName} says "actual cost", "reasonable", or nothing. This city decides. Every row needs a figure or a deliberate "none" — type them here, or have them read from a fee policy document on the next tab.</div>
            </div>
            <Pill bg={c.undecided ? '#F6EBD6' : '#E1F2E9'} color={c.undecided ? C.amber : C.ok}>{c.decided} of {c.deferral} decided</Pill>
          </div>
          <Group title="Fee computation" n={by(defr, 'computation').length} />
          {head3}{by(defr, 'computation').map(function (r) { return <React.Fragment key={r.key}>{DeferralRow({ row: r })}</React.Fragment>; })}
          <Group title="Estimates, deposits, payment and their clocks" n={by(defr, 'estimate_payment').length + (clock.enabled ? clock.choices.length : 0)} />
          {head3}{by(defr, 'estimate_payment').map(function (r) { return <React.Fragment key={r.key}>{DeferralRow({ row: r })}</React.Fragment>; })}

          {/* Deposit & payment clock (F3): the master switch, then the six settings pre-filled with the
              state's answers. The switch arms automation that stops clocks and withdraws requests, so it
              is its own explicit act — and off is itself a valid, attestable posture. */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 12px 10px', borderTop: '1px solid #EEF2F5', background: '#FBFCFD' }}>
            <button type="button" disabled={!can || busy === 'clock'} onClick={function () { setClockEnabled(!clock.enabled); }}
              title={clock.enabled ? 'Turn the deposit & payment clock automation off' : 'Turn the deposit & payment clock automation on'}
              style={{ width: '38px', height: '22px', borderRadius: '999px', border: 0, padding: 0, background: clock.enabled ? C.ok : C.edge, position: 'relative', flexShrink: 0, marginTop: '2px', cursor: can ? 'pointer' : 'default' }}>
              <span style={{ position: 'absolute', top: '2px', left: clock.enabled ? '18px' : '2px', width: '18px', height: '18px', borderRadius: '999px', background: 'white' }}></span>
            </button>
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: '700' }}>Deposit &amp; payment clock — <span style={{ color: clock.enabled ? C.ok : C.faint }}>{clock.enabled ? 'on' : 'off'}</span>
                {clock.switchedBy ? <span style={{ fontWeight: '400', fontSize: '11px', color: C.faint }}> · by {clock.switchedBy}{clock.switchedAt ? ', ' + String(clock.switchedAt).slice(0, 10) : ''}</span> : null}</div>
              <div style={hint}>{clock.enabled
                ? 'The six settings below arrived pre-filled with the ' + stateName + ' answers — confirm each one. Nothing automated happens until this switch is on and Fee rules is attested.'
                : 'Turning this on lets the system act while the city waits to be paid: hold or restart the response clock, and close a request when the payment window passes. Off is today’s behavior: staff see flags, the clock is never touched, nothing closes on its own.'}</div>
            </div>
            {!clock.enabled && can ? <button type="button" disabled={busy === 'clock'} onClick={function () { setClockEnabled(true); }} style={btn('pri', { height: '30px' })}>{busy === 'clock' ? 'Turning on…' : 'Turn on'}</button> : null}
          </div>
          {clock.enabled ? clock.choices.map(function (ch) {
            var decided = ch.value != null && clockEdits[ch.key] === undefined;
            var pre = ch.prefill;
            return <div key={ch.key} style={{ display: 'grid', gridTemplateColumns: grid3, gap: '10px', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid #EEF2F5', fontSize: '12.5px' }}>
              <span>{ch.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {ch.kind === 'choice' ? (
                  <select value={clockVal(ch)} disabled={!can} onChange={function (e) { setClockVal(ch.key, e.target.value); }} style={inp(false, { color: C.ink })}>
                    <option value="">—</option>
                    {(ch.options || []).map(function (o) { return <option key={o.value} value={o.value}>{o.label}{pre && pre.value === o.value ? ' (' + stateName + ' answer)' : ''}</option>; })}
                  </select>
                ) : ch.kind === 'bool' ? (
                  <select value={clockVal(ch)} disabled={!can} onChange={function (e) { setClockVal(ch.key, e.target.value); }} style={inp(false, { color: C.ink })}>
                    <option value="">—</option>
                    <option value="yes">Yes{pre && pre.value === true ? ' (' + stateName + ' answer)' : ''}</option>
                    <option value="no">No{pre && pre.value === false ? ' (' + stateName + ' answer)' : ''}</option>
                  </select>
                ) : (
                  <input value={clockVal(ch)} disabled={!can} onChange={function (e) { setClockVal(ch.key, e.target.value.replace(/[^\d]/g, '')); }}
                    placeholder="days" style={inp(false, { width: '120px' })} />
                )}
                {ch.kind === 'days' && pre && pre.businessDays ? <span style={hint}>business days</span> : null}
                <button type="button" disabled={!can || busy === 'clock'} onClick={function () { confirmClock(ch); }} style={btn(can ? 'sec' : 'dis', { height: '28px', fontSize: '12px' })}>Confirm</button>
              </div>
              <span style={cite}>
                {pre ? <Chip kind="fixed" /> : <Says text="Silent" />}{' '}
                {pre && pre.authority ? <button type="button" tabIndex={-1} onClick={function () { setStatute({ title: ch.label, authority: pre.authority, ruleIds: pre.rules }); }} title="Open the statute text behind this answer" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: C.pri, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline dotted' }}>{pre.authority}</button> : 'the state template does not answer this — a city choice'}
                {decided ? <span style={{ color: C.ok, fontWeight: '600' }}> · ✓ confirmed by {ch.by}{ch.at ? ', ' + String(ch.at).slice(0, 10) : ''}</span> : null}
              </span>
            </div>;
          }) : null}
          {clock.enabled ? <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderTop: '1px solid #EEF2F5' }}>
            <span style={Object.assign({}, hint, { flexGrow: 1 })}>All six write through to the policy the engine reads, and they gate <b>Attest</b> — but not <b>Approve</b>: the fee schedule waits only on the money figures above. Automation runs only while the switch is on <b>and</b> this screen is attested.</span>
          </div> : null}
          {waiver.choices.length ? <React.Fragment>
            <Group title="Fee waiver" n={waiver.choices.length} />
            {head3}
            {waiver.choices.map(function (w) {
              var decided = w.value != null && wEdits[w.key === 'waiver.decider' ? 'decider' : 'denialWording'] === undefined;
              return <div key={w.key} style={{ display: 'grid', gridTemplateColumns: grid3, gap: '10px', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid #EEF2F5', fontSize: '12.5px' }}>
                <span>{w.label}</span>
                {w.key === 'waiver.decider' ? (
                  <select value={wEdits.decider !== undefined ? wEdits.decider : (w.value || w.current.mode)} disabled={!can}
                    onChange={function (e) { setWEdits(Object.assign({}, wEdits, { decider: e.target.value })); setMsg(''); }}
                    style={inp(false, { color: C.ink })}>
                    {w.options.map(function (o) { return <option key={o.value} value={o.value}>{o.label}{o.value === w.current.mode && !w.value ? ' (current)' : ''}</option>; })}
                  </select>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: can ? 'pointer' : 'default' }}>
                      <input type="checkbox" disabled={!can}
                        checked={wEdits.denialWording !== undefined ? wEdits.denialWording : w.value != null}
                        onChange={function (e) { setWEdits(Object.assign({}, wEdits, { denialWording: e.target.checked })); setMsg(''); }} />
                      Standard wording
                    </label>
                    <button type="button" onClick={function () { setSentences(true); }} style={btn('sec', { height: '28px', fontSize: '12px' })}>View the {waiver.sentences.length} sentences</button>
                  </div>
                )}
                <span style={cite}><Says text="Silent" />{w.key === 'waiver.decider'
                  ? 'city routing — the estimate cannot go out while a waiver request is undecided'
                  : 'the sentence a denial folds into the estimate notice; editable wording comes with the letter templates'}
                  {decided ? <span style={{ color: C.ok, fontWeight: '600' }}> · ✓ decided by {w.by}{w.at ? ', ' + String(w.at).slice(0, 10) : ''}</span> : null}</span>
              </div>;
            })}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderTop: '1px solid #EEF2F5' }}>
              <span style={Object.assign({}, hint, { flexGrow: 1 })}>These two are recorded like every other decision and gate <b>Attest</b> — but not <b>Approve</b>: the fee schedule waits only on the money figures above.</span>
              <button type="button" disabled={!can || busy === 'waiver' || (wEdits.decider === undefined && wEdits.denialWording === undefined)} onClick={saveWaiver}
                style={btn(can && (wEdits.decider !== undefined || wEdits.denialWording !== undefined) ? 'pri' : 'dis', { height: '30px' })}>{busy === 'waiver' ? 'Recording…' : 'Record waiver choices'}</button>
            </div>
          </React.Fragment> : null}
          <div style={{ padding: '10px 16px 14px', borderTop: '1px solid ' + C.line }}>
            <span style={hint}>Type a figure, <b>none</b>, or <b>actual</b> where the law allows actual cost. "none" is a valid decision and is recorded as one when you approve. <b>actual</b> leaves the item unpriced on every estimate ("actual TBD") for staff to settle at billing. A green reference on a value means it came from the fee policy document.</span>
          </div>
          {Footer()}
        </div> : null}

        {tab === 'document' ? <div style={{ padding: '16px 20px' }}>
          <div style={{ maxWidth: '900px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700' }}>{data.document ? 'Read from ' + data.document.name : 'Have a written fee policy?'}</div>
            <div style={Object.assign({}, hint, { marginTop: '3px' })}>{data.document
              ? data.document.found + ' figures were read on ' + String(data.document.at).slice(0, 10) + ' by ' + data.document.by + '. Each carries its reference on the City decisions tab. Items the document did not cover are still yours to decide.' + (data.document.notes ? ' Notes: ' + data.document.notes : '')
              : 'Upload it as a text file or paste the text, and the city\'s figures are filled in from the document — each with its reference — for you to approve. Nothing is charged differently until you approve.'}</div>
            <div style={{ marginTop: '14px', padding: '12px 14px', background: C.wash, border: '1px solid ' + C.line, borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input type="file" accept=".txt,.md,.text,.csv" onChange={onFile} disabled={!can} style={{ fontSize: '12px' }} />
                <span style={hint}>text files now; PDF reading is a follow-up</span>
              </div>
              <textarea value={docText} disabled={!can} onChange={function (e) { setDocText(e.target.value); }} placeholder="…or paste the fee policy / ordinance text here" rows={10} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid ' + C.edge, borderRadius: '7px', padding: '8px 10px', fontSize: '12.5px', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                {msg ? <span style={{ color: C.ok, fontSize: '12px', fontWeight: '600', flexGrow: 1 }}>{msg}</span> : null}
                <button type="button" disabled={!can || !docText.trim() || busy === 'doc'} onClick={readDoc} style={btn(can && docText.trim() ? 'pri' : 'dis', { height: '32px' })}>{busy === 'doc' ? 'Reading…' : (data.document ? 'Read this instead' : 'Read it and propose figures')}</button>
              </div>
            </div>
            {docRows.length ? <div style={{ marginTop: '18px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: '700', marginBottom: '6px' }}>Figures taken from the document · {docRows.length}</div>
              <div style={Object.assign({}, card, { overflow: 'hidden' })}>
                {docRows.map(function (r, i) { return <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '260px 160px minmax(0,1fr)', gap: '10px', padding: '7px 12px', borderTop: i ? '1px solid #EEF2F5' : 0, fontSize: '12.5px', alignItems: 'center' }}><span>{r.label}</span><span style={{ fontWeight: '600' }}>{cityText(r.city.value)}</span><span style={cite}>{r.city.ref || 'no reference recorded'}</span></div>; })}
              </div>
              <div style={Object.assign({}, hint, { marginTop: '6px' })}>Change any of these on the City decisions tab; the reference stays until you overwrite the value.</div>
            </div> : null}
          </div>
        </div> : null}

        {tab === 'test' ? <TestTab data={data} hubTest={hub && hub.fee_test} can={can} onChanged={load} goTab={goTab} /> : null}
      </div>

      <StatutePopup info={statute} onClose={function () { setStatute(null); }} />
      {sentences ? (
        <div onClick={function () { setSentences(false); }} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(18,35,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '12px', padding: '20px 22px', width: '620px', maxWidth: '94%', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: '15px', fontWeight: '700' }}>The waiver-denial explanation — standard wording</div>
            <div style={Object.assign({}, hint, { marginTop: '3px' })}>The sentence staff pick when a fee-waiver request is denied; it folds into the estimate notice. Editable wording comes with the letter templates, as its own piece of work.</div>
            <ol style={{ margin: '14px 0 0', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', lineHeight: '1.5' }}>
              {(waiver.sentences || []).map(function (x) { return <li key={x.id}>{x.text}</li>; })}
            </ol>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}><button type="button" onClick={function () { setSentences(false); }} style={btn('sec')}>Close</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// TEST AN ESTIMATE — the live fee-engine sandbox (formerly on Fee Configuration): prices hypothetical
// quantities against the ACTIVE fee schedule through the real engine, shows the requestor notice, and
// records the outcome the hub's "Try a test estimate" row reads (POST /onboarding/fees/test-result).
function TestTab(props) {
  var data = props.data, can = props.can, ht = props.hubTest;
  var [q, setQ] = useState({ searchHours: 2, reviewHours: 1, programmingHours: 0, bwPages: 120, colorPages: 0, oversizedPages: 0 });
  var [opt, setOpt] = useState({ delivery: 'email', purpose: '', waived: false, payment: 0, certification: 0, other: 0 });
  var [out, setOut] = useState(null);
  var [err, setErr] = useState('');
  var [busy, setBusy] = useState('');
  var [showNotice, setShowNotice] = useState(false);
  var [against, setAgainst] = useState(data.version ? 'active' : 'draft');
  var run = useCallback(function () {
    api.post('/fee-law/preview', { against: against, quantities: q, delivery: { method: opt.delivery }, purpose: opt.purpose || null, waived: opt.waived, payment: num(opt.payment), certification: { count: num(opt.certification) }, other: { amount: num(opt.other), description: 'Extra cost' } })
      .then(function (r) { setOut(r.data); setErr(''); })
      .catch(function (e) { setErr(errText(e, 'The estimate could not be computed.')); });
  }, [q, opt, against]);
  useEffect(function () { var t = setTimeout(run, 300); return function () { clearTimeout(t); }; }, [run]);
  async function record(outcome) {
    setBusy(outcome);
    try { await api.post('/onboarding/fees/test-result', { outcome: outcome, notes: outcome === 'issues' ? 'Reported from the fee-law test tab' : undefined }); await props.onChanged(); }
    catch (e) { setErr(errText(e, 'Could not record the outcome.')); }
    setBusy('');
  }
  function setQ1(k, v) { setQ(Object.assign({}, q, (function () { var o = {}; o[k] = v; return o; })())); }
  function setO(k, v) { setOpt(Object.assign({}, opt, (function () { var o = {}; o[k] = v; return o; })())); }
  var numInp = function (k) { return <input type="number" step="any" value={q[k]} onChange={function (e) { setQ1(k, e.target.value === '' ? 0 : parseFloat(e.target.value)); }} style={inp(false)} />; };
  var R = out && out.requestLevel;
  var tst = STATE[(ht && ht.state) || 'not_started'];

  var draftOnly = !data.version;
  return <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '380px minmax(0, 1fr)', gap: '20px' }}>
    <div>
      <div style={{ fontSize: '14px', fontWeight: '700' }}>Sample request</div>
      <div style={Object.assign({}, hint, { marginTop: '3px', marginBottom: '10px' })}>Priced through the real fee engine — the same code path as a real estimate. Nothing is saved.</div>
      <div style={{ marginBottom: '12px', padding: '8px 10px', background: C.wash, border: '1px solid ' + C.line, borderRadius: '8px', fontSize: '12.5px' }}>
        <div style={{ fontWeight: '600', marginBottom: '4px' }}>Price against</div>
        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px' }}><input type="radio" name="against" checked={against === 'draft'} onChange={function () { setAgainst('draft'); }} />the figures as they stand now (unapproved draft{draftOnly ? '' : ''})</label>
        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', color: draftOnly ? C.ph : C.ink }}><input type="radio" name="against" disabled={draftOnly} checked={against === 'active'} onChange={function () { setAgainst('active'); }} />the approved schedule{data.version ? ' · v' + data.version.version : ' · none yet'}</label>
        {draftOnly ? <div style={Object.assign({}, hint, { marginTop: '4px' })}>Undecided city items price as "none" until you decide them. Approve version 1 to make this the schedule real estimates use.</div> : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div><label style={lbl}>Search hours</label>{numInp('searchHours')}</div>
        <div><label style={lbl}>Review / redaction hours</label>{numInp('reviewHours')}</div>
        <div><label style={lbl}>Programming hours</label>{numInp('programmingHours')}</div>
        <div><label style={lbl}>B&W pages</label>{numInp('bwPages')}</div>
        <div><label style={lbl}>Color pages</label>{numInp('colorPages')}</div>
        <div><label style={lbl}>Oversized pages</label>{numInp('oversizedPages')}</div>
        <div><label style={lbl}>Delivery</label><select value={opt.delivery} onChange={function (e) { setO('delivery', e.target.value); }} style={inp(false)}><option value="email">Email</option><option value="pickup">Pickup</option><option value="mail">Mail</option></select></div>
        <div><label style={lbl}>Purpose</label><select value={opt.purpose} onChange={function (e) { setO('purpose', e.target.value); }} style={inp(false)}><option value="">Standard</option><option value="commercial">Commercial</option><option value="inspection">Inspection only</option></select></div>
        <div><label style={lbl}>Certified copies</label><input type="number" value={opt.certification} onChange={function (e) { setO('certification', e.target.value); }} style={inp(false)} /></div>
        <div><label style={lbl}>Extra cost ($)</label><input type="number" step="any" value={opt.other} onChange={function (e) { setO('other', e.target.value); }} style={inp(false)} /></div>
        <div><label style={lbl}>Payment received ($)</label><input type="number" step="any" value={opt.payment} onChange={function (e) { setO('payment', e.target.value); }} style={inp(false)} /></div>
        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '6px' }}><label style={{ fontSize: '12.5px', display: 'flex', gap: '6px', alignItems: 'center' }}><input type="checkbox" checked={opt.waived} onChange={function (e) { setO('waived', e.target.checked); }} />Fee waived</label></div>
      </div>
      <div style={{ marginTop: '18px', padding: '12px 14px', background: C.wash, border: '1px solid ' + C.line, borderRadius: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', height: '22px', padding: '0 9px', borderRadius: '999px', background: tst.bg, color: tst.color, fontSize: '11px', fontWeight: '700' }}>{tst.label}</span>
          <span style={{ fontSize: '12px', fontWeight: '600' }}>Try a test estimate</span>
        </div>
        <div style={Object.assign({}, hint, { marginTop: '4px' })}>{ht ? ht.evidence : ''} — the hub row this records to. {draftOnly ? 'The outcome can be recorded once a version is approved.' : 'Does the estimate on the right look right for this city?'}</div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
          <button type="button" disabled={!can || draftOnly || busy !== ''} onClick={function () { record('confirmed'); }} style={btn(can && !draftOnly ? 'pri' : 'dis', { height: '32px' })}>{busy === 'confirmed' ? 'Recording…' : 'It behaves correctly'}</button>
          <button type="button" disabled={!can || draftOnly || busy !== ''} onClick={function () { record('issues'); }} style={btn(can && !draftOnly ? 'sec' : 'dis', { height: '32px' })}>{busy === 'issues' ? 'Recording…' : 'Something is off'}</button>
        </div>
      </div>
    </div>
    <div style={Object.assign({}, card, { background: '#F9FAFB', padding: '14px 16px', alignSelf: 'start' })}>
      <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px' }}>Estimate {out ? <span style={{ fontSize: '11px', fontWeight: '700', color: out.against === 'active' ? C.ok : C.amber, background: out.against === 'active' ? '#E1F2E9' : '#F6EBD6', borderRadius: '999px', padding: '2px 8px', marginLeft: '6px' }}>{out.against === 'active' ? 'approved ' + out.configVersion : 'unapproved draft'}</span> : null}</div>
      {err ? <div style={{ fontSize: '12.5px', color: C.red }}>{err}</div> : null}
      {!out && !err ? <div style={{ fontSize: '12px', color: C.ph }}>Calculating…</div> : null}
      {R ? <div style={{ fontSize: '12.5px' }}>
        {(R.components || (out.components || [])).length ? null : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <Line k="Labor" v={money(R.laborSubtotal)} />
          <Line k="Duplication" v={money(R.duplicationSubtotal)} />
          <Line k="Media" v={money(R.mediaSubtotal)} />
          {R.deliverySubtotal ? <Line k="Delivery" v={money(R.deliverySubtotal)} /> : null}
          {R.certificationSubtotal ? <Line k="Certification" v={money(R.certificationSubtotal)} /> : null}
          {R.otherSubtotal ? <Line k="Extra cost" v={money(R.otherSubtotal)} /> : null}
          <Line k="Gross subtotal" v={money(R.grossSubtotal)} />
          {R.freeAllowances && (R.freeAllowances.freePageAllowance || R.freeAllowances.freeLaborHours) ? <Line k="Free allowances" v={(R.freeAllowances.freePageAllowance || 0) + ' pg / ' + (R.freeAllowances.freeLaborHours || 0) + ' hr'} muted /> : null}
          <Line k="Adjusted subtotal" v={money(R.adjustedSubtotal)} />
          {out.flags && out.flags.floorApplied ? <Line k="Minimum fee applied" v="" muted /> : null}
          {out.flags && out.flags.ceilingApplied ? <Line k="Request ceiling applied" v="" amber /> : null}
          {out.flags && out.flags.deMinimisWaived ? <Line k="De minimis — waived" v="" amber /> : null}
          {out.waived ? <Line k="Fee waived" v="" amber /> : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: '800', color: C.navy, marginTop: '8px', paddingTop: '8px', borderTop: '2px solid ' + C.navy }}><span>TOTAL</span><span>{money(out.effectiveTotal)}</span></div>
        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <Line k={'Deposit due' + (out.deposit && out.deposit.basis ? ' (' + out.deposit.basis + ')' : '')} v={money(out.deposit && out.deposit.required)} />
          <Line k="Balance after payment" v={money(out.payment && out.payment.balanceDue)} />
          <Line k="Estimate notice to requestor" v={R.estimateNotifyTriggered ? 'required' : 'not required'} muted={!R.estimateNotifyTriggered} />
          {out.paymentPlan ? <Line k="Payment plan" v={(out.paymentPlan.mode || out.paymentPlan.gate || '') + (out.paymentTimingSource === 'derived' ? ' (derived from the schedule)' : '')} muted /> : null}
        </div>
        {out.requestorNotice ? <div style={{ marginTop: '12px' }}>
          <button type="button" onClick={function () { setShowNotice(!showNotice); }} style={btn('sec', { height: '30px' })}>{showNotice ? 'Hide' : 'Show'} the notice the requestor would receive</button>
          {showNotice ? <div style={{ marginTop: '8px', background: 'white', border: '1px solid ' + C.line, borderRadius: '8px', padding: '10px 12px', fontSize: '12px', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}><b>{out.requestorNotice.subject}</b>{'\n\n'}{out.requestorNotice.text}</div> : null}
        </div> : null}
      </div> : null}
    </div>
  </div>;
}
function Line(props) { return <div style={{ display: 'flex', justifyContent: 'space-between', color: props.amber ? '#92400E' : props.muted ? '#8296A4' : '#374151' }}><span>{props.k}</span><span>{props.v}</span></div>; }
