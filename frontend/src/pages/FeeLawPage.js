import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

// WHAT THE LAW LETS YOU CHARGE — the hub's `fee_law` screen (canvas approved by Kevin 2026-08-25;
// sources docs/mockups/hub_links/fee_law/). Status strip · two windows (State mandate / Deferral to local
// policy), each split computation vs estimates-deposits-payment · a fee policy document read by AI into the
// deferral rows with references · Approve = fee schedule version n. Data: GET/PUT/POST /api/fee-law.

var C = { ink: '#12232E', mute: '#5C6F7C', faint: '#8296A4', ph: '#A9B7C2', line: '#D2DCE3', edge: '#BECAD3', wash: '#F2F6F9', pri: '#1E6091', red: '#B02A37', ok: '#1B8A5A', amber: '#9A6512' };
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
};
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
function Chip(props) { var b = BIND[props.kind]; if (!b) return null; return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '10.5px', fontWeight: '700', padding: '1px 7px', borderRadius: '4px', whiteSpace: 'nowrap', background: b.bg, color: b.color, border: '1px solid ' + b.border }}>{b.label}</span>; }
function Says(props) { return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '10.5px', fontWeight: '700', padding: '1px 7px', borderRadius: '4px', whiteSpace: 'nowrap', background: 'white', color: C.mute, border: '1px dashed ' + C.edge, marginRight: '6px' }}>{props.text}</span>; }
function errText(e, fb) { return (e && e.response && e.response.data && e.response.data.error) || fb; }
function fmt(n) { n = Number(n); return Number.isInteger(n) ? String(n) : (Math.round(n * 1000) / 1000).toString(); }
function cityText(v) { if (v == null) return ''; if (typeof v === 'object') return Object.keys(v).map(function (k) { return k + ' ' + (v[k] === 'actual' ? 'actual' : v[k] == null ? '—' : fmt(v[k])); }).join(' · '); return String(v); }

export default function FeeLawPage() {
  var nav = useNavigate();
  var [data, setData] = useState(null);
  var [hub, setHub] = useState(null);
  var [edits, setEdits] = useState({});     // key → string as typed
  var [err, setErr] = useState('');
  var [msg, setMsg] = useState('');
  var [busy, setBusy] = useState('');
  var [docOpen, setDocOpen] = useState(false);
  var [docText, setDocText] = useState('');
  var [docName, setDocName] = useState('');
  var [approved, setApproved] = useState(null);

  function load() {
    return Promise.all([api.get('/fee-law'), api.get('/setup-hub')]).then(function (r) {
      setData(r[0].data); setEdits({});
      var it = null; r[1].data.lanes.forEach(function (l) { l.items.forEach(function (x) { if (x.key === 'fee_law') it = x; }); });
      setHub(it); setErr('');
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
  var st = STATE[(hub && hub.state) || 'not_started'];
  var c = data.counts;
  var rows = data.rows;
  var dirty = Object.keys(edits).length > 0;
  var attested = hub && hub.signoff;
  var mayAttest = can && !!data.version && hub && hub.state !== 'waiting' && hub.state !== 'needs_attention';

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
      setDocOpen(false); setDocText('');
      await load();
    } catch (e) { setErr(errText(e, 'The document could not be read.')); }
    setBusy('');
  }
  function onFile(e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    if (!/\.(txt|md|text|csv)$/i.test(f.name)) { setErr('Upload a text file (.txt or .md), or paste the policy text. PDF reading is not available yet.'); return; }
    var rd = new FileReader(); rd.onload = function () { setDocText(String(rd.result || '')); setDocName(f.name); }; rd.readAsText(f);
  }
  async function toggleAttest() {
    setBusy('attest');
    try { if (attested) await api.delete('/setup-hub/fee_law/done'); else await api.post('/setup-hub/fee_law/done'); await load(); }
    catch (e) { setErr(errText(e, 'Could not update.')); }
    setBusy('');
  }

  var inp = function (missing, extra) { return Object.assign({ display: 'block', width: '100%', boxSizing: 'border-box', height: '32px', border: '1px solid ' + (missing ? C.red : C.edge), borderRadius: '7px', background: 'white', padding: '0 10px', fontSize: '13px', color: C.ink, fontFamily: 'inherit' }, extra || {}); };

  function CityCell(props) {
    var r = props.row;
    if (!r.editable) return <div style={inp(false, { display: 'flex', alignItems: 'center', background: C.wash, color: C.mute })}>as law</div>;
    if (r.city && r.city.value && typeof r.city.value === 'object' && edits[r.key] === undefined) {
      return <div style={inp(false, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.wash, color: C.mute, fontSize: '11.5px' })}>{cityText(r.city.value)}<span style={{ fontSize: '10px', color: C.faint, fontWeight: '700' }}>AS LOADED</span></div>;
    }
    var v = valueOf(r);
    var missing = r.binding === 'deferral' && v === '' ;
    var tag = edits[r.key] !== undefined ? null : r.city && r.city.source === 'default' ? 'DEFAULT' : r.city && r.city.source === 'document' ? (r.city.ref ? r.city.ref : 'from document') : null;
    if (r.binding === 'floor' && tag === 'DEFAULT') tag = 'MINIMUM';
    return <div style={{ position: 'relative' }}>
      <input value={v} disabled={!can} placeholder={r.binding === 'deferral' ? (r.noneOk ? r.unit + ' or none' : r.unit) : r.unit}
        onChange={function (e) { setVal(r.key, e.target.value); }} style={inp(missing, tag ? { paddingRight: '78px' } : {})} />
      {tag ? <span title={tag === 'DEFAULT' ? 'Default = the ceiling. Lower it if this city charges less.' : tag} style={{ position: 'absolute', right: '8px', top: '9px', fontSize: '9.5px', fontWeight: '700', color: r.city.source === 'document' ? C.ok : C.faint, maxWidth: '68px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span> : null}
    </div>;
  }
  function MandateRow(props) {
    var r = props.row;
    return <div style={{ display: 'grid', gridTemplateColumns: '230px 190px 78px 190px minmax(0, 1fr)', gap: '10px', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid #EEF2F5', fontSize: '12.5px' }}>
      <span>{r.label}</span>
      <span style={{ fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>{r.binding === 'ceiling' && r.ceiling != null ? 'up to ' : r.binding === 'floor' && r.floor != null ? 'at least ' : ''}{r.law.display}
        {r.law.ag != null ? <div style={Object.assign({}, hint, { fontWeight: '500' })}>AG rate ${fmt(r.law.ag)} + 25% for cities</div> : null}</span>
      <Chip kind={r.binding} />
      <CityCell row={r} />
      <span style={cite}>{r.law.authority}{r.gap ? <span style={{ fontSize: '10.5px', fontWeight: '700', color: C.red }}> · {r.gap}</span> : null}</span>
    </div>;
  }
  function DeferralRow(props) {
    var r = props.row;
    return <div style={{ display: 'grid', gridTemplateColumns: '260px 220px minmax(0, 1fr)', gap: '10px', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid #EEF2F5', fontSize: '12.5px' }}>
      <span>{r.label}</span>
      <CityCell row={r} />
      <span style={cite}><Says text={r.law.says} />{r.law.authority}</span>
    </div>;
  }
  function Group(props) { return <div style={{ padding: '10px 12px 4px', fontSize: '12px', fontWeight: '700', color: C.ink, background: '#F8FAFC', borderTop: '1px solid ' + C.line }}>{props.title} <span style={{ fontWeight: '500', color: C.faint }}>· {props.n}</span></div>; }
  var head5 = <div style={{ display: 'grid', gridTemplateColumns: '230px 190px 78px 190px minmax(0, 1fr)', gap: '10px', padding: '6px 12px', fontSize: '11px', fontWeight: '700', color: C.faint, textTransform: 'uppercase', letterSpacing: '0.04em' }}><span>Item</span><span>{data.jurisdiction.code} allows</span><span>Binding</span><span>This city charges</span><span>Authority</span></div>;
  var head3 = <div style={{ display: 'grid', gridTemplateColumns: '260px 220px minmax(0, 1fr)', gap: '10px', padding: '6px 12px', fontSize: '11px', fontWeight: '700', color: C.faint, textTransform: 'uppercase', letterSpacing: '0.04em' }}><span>Item</span><span>This city</span><span>What the law says</span></div>;
  var mand = rows.filter(function (r) { return r.binding !== 'deferral'; }), defr = rows.filter(function (r) { return r.binding === 'deferral'; });
  var by = function (list, b) { return list.filter(function (r) { return r.bucket === b; }); };
  var stateName = data.jurisdiction.stateName || data.jurisdiction.name;

  return (
    <div style={{ maxWidth: '1420px', color: C.ink }}>
      <div style={Object.assign({}, card, { display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 14px', marginBottom: '14px' })}>
        <button type="button" onClick={function () { nav('/admin?tab=setup'); }} title="Back to Setup and Configuration"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 11px', border: 0, borderRadius: '999px', background: st.bg, color: st.color, fontSize: '11px', fontWeight: '700', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>{st.label}
        </button>
        <span style={{ flexGrow: 1, fontSize: '12px', color: C.mute, lineHeight: '1.35' }}>{hub ? hub.evidence : ''}</span>
        <span style={{ fontSize: '11.5px', color: C.faint }}>Compliance and Policies Setup</span>
        {attested
          ? <button type="button" disabled={busy === 'attest' || !can} onClick={toggleAttest} style={btn('sec', { height: '30px' })}>Attested · undo</button>
          : <button type="button" disabled={!mayAttest || busy === 'attest'} onClick={toggleAttest} style={btn(mayAttest ? 'pri' : 'dis', { height: '30px' })} title={mayAttest ? 'Record that this item is complete' : 'Approve a fee schedule version first'}>Attest as complete</button>}
      </div>

      {err ? <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: C.red, marginBottom: '12px' }}>{err}</div> : null}
      {approved ? <div style={{ background: '#E1F2E9', border: '1px solid #A7D9BF', borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', fontSize: '13px' }}>
        <b style={{ color: C.ok }}>Fee schedule v{approved.version} approved.</b> Estimates now price from it. Later changes create v{approved.version + 1}; nothing is edited in place.
        <button type="button" onClick={function () { nav('/admin?tab=setup'); }} style={btn('sec', { height: '30px', marginLeft: '12px' })}>See it on the hub</button>
      </div> : null}

      <div style={card}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid ' + C.line, display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: '19px', fontWeight: '700' }}>What the law lets you charge</div>
            <div style={{ fontSize: '12.5px', color: C.mute, marginTop: '3px' }}>Every fee figure in one place: the ones {stateName} law sets, and the ones it leaves to this city. Together they become the fee schedule the estimates use.</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            {data.version
              ? <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '11px', fontWeight: '700', borderRadius: '999px', padding: '2px 9px', background: '#E1F2E9', color: C.ok }}>Fee schedule v{data.version.version} · active</span>
              : <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '11px', fontWeight: '700', borderRadius: '999px', padding: '2px 9px', background: '#EDE9FE', color: '#5B21B6' }}>Fee schedule · no version yet</span>}
            <span style={hint}>{data.version ? 'approved by ' + data.version.by + ', ' + String(data.version.at).slice(0, 10) + ' · approving again creates v' + (data.version.version + 1) : "Approving the city's figures creates version 1"}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* STATE MANDATE */}
          <div style={{ borderBottom: '1px solid ' + C.line }}>
            <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0E3A5C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              <div style={{ flexGrow: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '700' }}>State mandate</div>
                <div style={hint}>Set by {stateName} law, loaded when the state was locked. The law's figure is not editable here — a change means the law changed, which goes through a proposal with a citation. Where the law sets a ceiling, the city's rate starts at the ceiling — lower it if you charge less.</div>
              </div>
              <span style={{ display: 'inline-flex', fontSize: '11px', fontWeight: '700', borderRadius: '999px', padding: '2px 9px', background: '#E1F2E9', color: C.ok, whiteSpace: 'nowrap' }}>{c.mandate} loaded</span>
            </div>
            <Group title="Fee computation — the numbers the engine multiplies" n={by(mand, 'computation').length} />
            {head5}{by(mand, 'computation').map(function (r) { return <MandateRow key={r.key} row={r} />; })}
            <Group title="Estimates, deposits, payment and their clocks" n={by(mand, 'estimate_payment').length} />
            {head5}{by(mand, 'estimate_payment').map(function (r) { return <MandateRow key={r.key} row={r} />; })}
            <div style={{ padding: '10px 16px 14px', borderTop: '1px solid ' + C.line }}>
              <span style={hint}><b>Ceiling</b> rows: the figure shown is this city's ceiling and its rate is pre-filled there; an entry above it is refused. <b>Fixed</b> rows apply as written.{c.gaps ? <span> Items marked <span style={{ color: C.red, fontWeight: '700' }}>needs requestor ledger</span> are law today but have no home in the engine yet — shown so the gap is visible.</span> : null}</span>
            </div>
          </div>

          {/* DEFERRAL */}
          <div>
            <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9A6512" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              <div style={{ flexGrow: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '700' }}>Guidelines and deferral to local policy</div>
                <div style={hint}>{stateName} says "actual cost", "reasonable", or nothing. This city decides. Every row needs a figure or a deliberate "none".</div>
              </div>
              <span style={{ display: 'inline-flex', fontSize: '11px', fontWeight: '700', borderRadius: '999px', padding: '2px 9px', background: c.undecided ? '#F6EBD6' : '#E1F2E9', color: c.undecided ? C.amber : C.ok, whiteSpace: 'nowrap' }}>{c.decided} of {c.deferral} decided</span>
            </div>

            <div style={{ margin: '0 16px 12px', padding: '12px 14px', background: C.wash, border: '1px solid ' + C.line, borderRadius: '8px', maxWidth: '900px' }}>
              {!docOpen ? <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ flexGrow: 1 }}>
                  <div style={{ fontSize: '12.5px', fontWeight: '600' }}>{data.document ? 'Read from ' + data.document.name + ' · ' + data.document.found + ' figures · ' + String(data.document.at).slice(0, 10) : 'Have a written fee policy?'}</div>
                  <div style={hint}>{data.document ? 'Each figure it set carries its reference. Items it did not cover are still yours to decide.' : 'Upload it (text) or paste it, and the figures below are filled in from the document, each with its reference, for you to approve. Or type them in by hand.'}</div>
                </div>
                <button type="button" disabled={!can} onClick={function () { setDocOpen(true); }} style={btn(can ? (data.document ? 'sec' : 'pri') : 'dis', { height: '32px' })}>{data.document ? 'Read a different document' : 'Read a fee policy document'}</button>
              </div> : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input type="file" accept=".txt,.md,.text,.csv" onChange={onFile} style={{ fontSize: '12px' }} />
                  <span style={hint}>text files now; PDF reading is a follow-up</span>
                </div>
                <textarea value={docText} onChange={function (e) { setDocText(e.target.value); }} placeholder="…or paste the fee policy / ordinance text here" rows={7} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid ' + C.edge, borderRadius: '7px', padding: '8px 10px', fontSize: '12.5px', fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={function () { setDocOpen(false); }} style={btn('sec', { height: '32px' })}>Cancel</button>
                  <button type="button" disabled={!docText.trim() || busy === 'doc'} onClick={readDoc} style={btn(docText.trim() ? 'pri' : 'dis', { height: '32px' })}>{busy === 'doc' ? 'Reading…' : 'Read it and propose figures'}</button>
                </div>
              </div>}
            </div>

            <Group title="Fee computation" n={by(defr, 'computation').length} />
            {head3}{by(defr, 'computation').map(function (r) { return <DeferralRow key={r.key} row={r} />; })}
            <Group title="Estimates, deposits, payment" n={by(defr, 'estimate_payment').length} />
            {head3}{by(defr, 'estimate_payment').map(function (r) { return <DeferralRow key={r.key} row={r} />; })}
            <div style={{ padding: '10px 16px 14px', borderTop: '1px solid ' + C.line }}>
              <span style={hint}>Type a figure, <b>none</b>, or <b>actual</b> where the law allows actual cost. "none" is a valid decision and is recorded as one when you approve.</span>
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid ' + C.line, background: C.wash, borderRadius: '0 0 10px 10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={Object.assign({}, hint, { flexGrow: 1 })}>
            {msg ? <span style={{ color: C.ok, fontWeight: '600' }}>{msg} </span> : null}
            Approving records every figure — the state's and the city's — as <b>fee schedule v{data.version ? data.version.version + 1 : 1}</b>, the schedule estimates price from.{!can ? ' · view only for you' : ''}
          </span>
          <button type="button" onClick={function () { load(); setMsg(''); }} style={btn('sec')}>Cancel</button>
          <button type="button" disabled={!can || !dirty || busy === 'save'} onClick={save} style={btn(can && dirty ? 'sec' : 'dis')}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
          <button type="button" disabled={!can || c.undecided > 0 || busy === 'approve'} onClick={approve} style={btn(can && !c.undecided ? 'pri' : 'dis')} title={c.undecided ? c.undecided + ' rows still undecided' : ''}>
            {busy === 'approve' ? 'Approving…' : 'Approve as fee schedule v' + (data.version ? data.version.version + 1 : 1) + (c.undecided ? ' · ' + c.undecided + ' undecided' : '')}
          </button>
        </div>
      </div>
    </div>
  );
}
