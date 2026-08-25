import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

// AGENCY SETUP — the first hub-linked screen (H3; WORKING_hub_linked_screens §0–§1, artboards
// docs/mockups/hub_links/agency/{Main,Locked}.dc.html, decided with Kevin 2026-08-25).
//   · status strip = the shared pattern: chip (button back to the hub) · the hub's own evidence line · Attest
//   · one card: agency · street address (+ mailing) · public records contact · the jurisdiction state + LOCK
//   · "Lock state and load its rules" is the click that imports the state's rules file and makes it the
//     city's jurisdiction. Once. Confirmed first. Afterwards the select is read-only.

var C = { ink: '#12232E', mute: '#5C6F7C', faint: '#8296A4', ph: '#A9B7C2', line: '#D2DCE3', edge: '#BECAD3', wash: '#F2F6F9', pri: '#1E6091', red: '#B02A37' };
var STATE = {
  ready:           { label: 'Ready',           bg: '#E1F2E9', color: '#1B8A5A' },
  in_progress:     { label: 'In progress',     bg: '#F6EBD6', color: '#9A6512' },
  not_started:     { label: 'Not started',     bg: '#F3F4F6', color: '#4B5563' },
  needs_attention: { label: 'Needs attention', bg: '#FEE2E2', color: '#991B1B' },
  waiting:         { label: 'Waiting',         bg: '#EDE9FE', color: '#5B21B6' },
};
var lbl = { fontSize: '12.5px', fontWeight: '600', color: C.ink, marginBottom: '5px' };
var hint = { fontSize: '11.5px', color: C.faint, marginTop: '4px', lineHeight: '1.4' };
var sect = { fontSize: '11.5px', fontWeight: '700', color: C.mute, textTransform: 'uppercase', letterSpacing: '0.05em' };
var card = { background: 'white', border: '1px solid ' + C.line, borderRadius: '10px' };
function inp(missing, extra) {
  return Object.assign({ display: 'block', width: '100%', boxSizing: 'border-box', height: '36px', border: '1px solid ' + (missing ? C.red : C.edge), borderRadius: '7px', background: 'white', padding: '0 11px', fontSize: '13.5px', color: C.ink, fontFamily: 'inherit' }, extra || {});
}
function btn(kind, extra) {
  var base = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px', height: '36px', padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: '600', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' };
  var k = kind === 'pri' ? { background: C.pri, color: 'white', border: '1px solid ' + C.pri }
    : kind === 'dis' ? { background: C.wash, color: C.ph, border: '1px solid ' + C.line, cursor: 'default' }
    : { background: 'white', color: C.ink, border: '1px solid ' + C.edge };
  return Object.assign(base, k, extra || {});
}
var Req = function () { return <span style={{ color: C.red, fontWeight: '700' }}> *</span>; };
var JTYPES = [['city', 'City'], ['county', 'County'], ['state', 'State Agency'], ['special', 'Special District'], ['school', 'School District']];
var USSTATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

function errText(e, fallback) { return (e && e.response && e.response.data && e.response.data.error) || fallback; }
function fmtDate(s) { if (!s) return ''; var d = new Date(String(s).replace(' ', 'T') + (String(s).length <= 19 ? 'Z' : '')); return isNaN(d) ? String(s).slice(0, 10) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }

export default function AgencySetupPage() {
  var nav = useNavigate();
  var [data, setData] = useState(null);      // GET /agency
  var [hub, setHub] = useState(null);        // the agency item off GET /setup-hub
  var [form, setForm] = useState(null);
  var [pickState, setPickState] = useState('');
  var [err, setErr] = useState('');
  var [msg, setMsg] = useState('');
  var [busy, setBusy] = useState('');
  var [confirm, setConfirm] = useState(false);
  var [loaded, setLoaded] = useState(null);  // the lock-state result

  function load() {
    return Promise.all([api.get('/agency'), api.get('/setup-hub')]).then(function (r) {
      setData(r[0].data); setForm(r[0].data.fields); setPickState(r[0].data.state || '');
      var it = null; (r[1].data.top || []).forEach(function (x) { if (x.key === 'agency') it = x; });
      setHub(it); setErr('');
    }).catch(function (e) { setErr(errText(e, 'The agency setup could not load.')); });
  }
  useEffect(function () { load(); }, []);

  function set(k, v) { setForm(Object.assign({}, form, (function () { var o = {}; o[k] = v; return o; })())); setMsg(''); }
  var can = !!(data && data.canEdit);
  var lock = data && data.lock;
  var f = form || {};
  var mailing = f.mailing_differs === '1';
  var miss = {
    agency_name: !f.agency_name, agency_short_name: !f.agency_short_name, jurisdiction_type: !f.jurisdiction_type,
    address_line1: !f.address_line1, address_city: !f.address_city, address_state: !f.address_state, address_zip: !f.address_zip,
    contact_email: !f.contact_email, contact_phone: !f.contact_phone,
    mailing_line1: mailing && !f.mailing_line1, mailing_city: mailing && !f.mailing_city, mailing_state: mailing && !f.mailing_state, mailing_zip: mailing && !f.mailing_zip
  };
  var complete = Object.keys(miss).every(function (k) { return !miss[k]; });
  var attested = hub && hub.signoff;
  var mayAttest = can && complete && !!lock && hub && hub.state !== 'waiting' && hub.state !== 'needs_attention';

  async function save() {
    setBusy('save'); setMsg('');
    try {
      var r = await api.put('/agency', Object.assign({}, form, lock ? {} : { state: pickState }));
      setData(r.data); setForm(r.data.fields); setMsg('Saved.');
      var h = await api.get('/setup-hub'); (h.data.top || []).forEach(function (x) { if (x.key === 'agency') setHub(x); });
    } catch (e) { setErr(errText(e, 'Could not save.')); }
    setBusy('');
  }
  async function doLock() {
    setConfirm(false); setBusy('lock'); setErr('');
    try {
      // Save the fields first so the lock never races an unsaved state pick.
      await api.put('/agency', Object.assign({}, form, { state: pickState }));
      var r = await api.post('/agency/lock-state', { state: pickState });
      setLoaded(r.data.loaded);
      await load();
    } catch (e) { setErr(errText(e, 'The rules could not be loaded.')); }
    setBusy('');
  }
  async function toggleAttest() {
    setBusy('attest');
    try {
      if (attested) await api.delete('/setup-hub/agency/done'); else await api.post('/setup-hub/agency/done');
      await load();
    } catch (e) { setErr(errText(e, 'Could not update.')); }
    setBusy('');
  }

  if (err && !data) return <div style={{ padding: '24px', color: C.red }}>{err}</div>;
  if (!data || !form) return <div style={{ padding: '24px', color: C.ph }}>Reading the agency setup…</div>;

  var st = STATE[(hub && hub.state) || 'not_started'];
  var pickName = (data.states.filter(function (s) { return s.code === pickState; })[0] || {}).name || pickState;
  var pickHasRules = !!(data.states.filter(function (s) { return s.code === pickState; })[0] || {}).rulesAvailable;

  function Field(props) {
    return <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={lbl}>{props.label}{props.req ? <Req /> : null}</div>
      {props.children}
      {props.hint ? <div style={hint}>{props.hint}</div> : null}
    </div>;
  }
  function Text(props) {
    return <input value={f[props.k] || ''} disabled={!can} onChange={function (e) { set(props.k, e.target.value); }} placeholder={props.ph || ''}
      style={inp(props.req && miss[props.k])} />;
  }
  function StateSel(props) {
    return <select value={f[props.k] || ''} disabled={!can} onChange={function (e) { set(props.k, e.target.value); }} style={inp(props.req && miss[props.k], { color: f[props.k] ? C.ink : C.ph })}>
      <option value="">Select</option>{USSTATES.map(function (s) { return <option key={s} value={s}>{s}</option>; })}
    </select>;
  }

  return (
    <div style={{ maxWidth: '1000px', color: C.ink }}>
      {/* status strip — the shared pattern */}
      <div style={Object.assign({}, card, { display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 14px', marginBottom: '14px' })}>
        <button type="button" onClick={function () { nav('/admin?tab=setup'); }} title="Back to Setup and Configuration"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 11px', border: 0, borderRadius: '999px', background: st.bg, color: st.color, fontSize: '11px', fontWeight: '700', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          {st.label}
        </button>
        <span style={{ flexGrow: 1, fontSize: '12px', color: C.mute, lineHeight: '1.35' }}>{hub ? hub.evidence : ''}</span>
        <span style={{ fontSize: '11.5px', color: C.faint }}>Setup and Configuration · start here</span>
        {attested
          ? <button type="button" disabled={busy === 'attest' || !can} onClick={toggleAttest} style={btn('sec', { height: '30px' })}>Attested · undo</button>
          : <button type="button" disabled={!mayAttest || busy === 'attest'} onClick={toggleAttest} style={btn(mayAttest ? 'pri' : 'dis', { height: '30px' })}
              title={mayAttest ? 'Record that this item is complete' : 'Fill every required field and lock the state first'}>Attest as complete</button>}
      </div>

      {err ? <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: C.red, marginBottom: '12px' }}>{err}</div> : null}

      {loaded ? (
        <div style={{ background: '#E1F2E9', border: '1px solid #A7D9BF', borderRadius: '10px', padding: '14px 16px', marginBottom: '14px', fontSize: '13px', lineHeight: '1.55' }}>
          <div style={{ fontWeight: '700', color: '#1B8A5A' }}>{lock ? lock.name : pickName} rules loaded</div>
          <div style={{ color: C.ink, marginTop: '4px' }}>
            Written into the review items on the Setup hub: <b>{loaded.written.length}</b> sections
            ({loaded.written.join(', ')}){loaded.proposed.length ? <span> · {loaded.proposed.length} staged as proposals because this city already had values ({loaded.proposed.join(', ')})</span> : null}.
          </div>
          <div style={{ color: C.mute, marginTop: '4px' }}>
            {loaded.primaryClock ? 'Statutory response clock: ' + loaded.primaryClock + '. ' : 'This state sets no statutory response clock — any due date is a city service target, never the legal deadline. '}
            {loaded.serviceTargets.length ? 'The city must choose a number for: ' + loaded.serviceTargets.join(', ') + '. ' : ''}
            {loaded.cityChoices ? loaded.cityChoices + ' choices the statute left to the city arrived unconfirmed — each is reviewed on its own hub row.' : ''}
          </div>
          <div style={{ marginTop: '8px' }}><button type="button" onClick={function () { nav('/admin?tab=setup'); }} style={btn('sec', { height: '30px' })}>See what changed on the hub</button></div>
        </div>
      ) : null}

      <div style={card}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid ' + C.line }}>
          <div style={{ fontSize: '19px', fontWeight: '700' }}>Agency name, address and contact</div>
          <div style={{ fontSize: '12.5px', color: C.mute, marginTop: '3px' }}>Who this city is, where mail goes, and how the public reaches the records office. Shown on letters, the public portal and every request.</div>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={sect}>Agency</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
              <Field label="Agency name" req hint="Shown throughout the application and on correspondence"><Text k="agency_name" req ph="City of …" /></Field>
              <Field label="Short name" req hint="Used in email subjects and compact displays"><Text k="agency_short_name" req /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
              <Field label="Jurisdiction type" req>
                <select value={f.jurisdiction_type || ''} disabled={!can} onChange={function (e) { set('jurisdiction_type', e.target.value); }} style={inp(miss.jurisdiction_type, { color: f.jurisdiction_type ? C.ink : C.ph })}>
                  <option value="">Select</option>{JTYPES.map(function (t) { return <option key={t[0]} value={t[0]}>{t[1]}</option>; })}
                </select>
              </Field>
              <div />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={sect}>Street address</div>
            <Field label="Address line 1" req><Text k="address_line1" req ph="Street number and name" /></Field>
            <Field label="Address line 2"><Text k="address_line2" ph="Suite, floor, building (optional)" /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '14px' }}>
              <Field label="City" req><Text k="address_city" req ph="City" /></Field>
              <Field label="State" req><StateSel k="address_state" req /></Field>
              <Field label="ZIP" req><Text k="address_zip" req ph="ZIP" /></Field>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: can ? 'pointer' : 'default' }}>
              <input type="checkbox" checked={mailing} disabled={!can} onChange={function (e) { set('mailing_differs', e.target.checked ? '1' : '0'); }} />
              Mailing address is different
            </label>
            {mailing ? <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 14px', border: '1px dashed ' + C.edge, borderRadius: '8px' }}>
              <Field label="Mailing line 1" req><Text k="mailing_line1" req ph="PO Box or street" /></Field>
              <Field label="Mailing line 2"><Text k="mailing_line2" /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '14px' }}>
                <Field label="City" req><Text k="mailing_city" req /></Field>
                <Field label="State" req><StateSel k="mailing_state" req /></Field>
                <Field label="ZIP" req><Text k="mailing_zip" req /></Field>
              </div>
            </div> : null}
            <div style={Object.assign({}, hint, { marginTop: '-6px' })}>The address state is only for mail. The state whose law applies is set below and locked separately.</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={sect}>Public records contact</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
              <Field label="Contact email" req><Text k="contact_email" req ph="openrecords@city.gov" /></Field>
              <Field label="Contact phone" req><Text k="contact_phone" req ph="(555) 000-0000" /></Field>
            </div>
          </div>

          {/* jurisdiction state + lock */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px 16px', background: C.wash, border: '1px solid ' + C.line, borderRadius: '8px' }}>
            <div style={sect}>State whose public records law applies</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', width: '320px' }}>
                <div style={lbl}>State{lock ? null : <Req />}</div>
                {lock
                  ? <div style={inp(false, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.wash, color: C.mute })}>{lock.name}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.mute} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg></div>
                  : <select value={pickState} disabled={!can} onChange={function (e) { setPickState(e.target.value); setMsg(''); }} style={inp(!pickState, { color: pickState ? C.ink : C.ph })}>
                      <option value="">Select</option>
                      {data.states.map(function (s) { return <option key={s.code} value={s.code} disabled={!s.rulesAvailable}>{s.name}{s.rulesAvailable ? '' : ' — rules file not available yet'}</option>; })}
                    </select>}
              </div>
              {lock
                ? <span style={{ display: 'inline-flex', alignItems: 'center', height: '36px', padding: '0 12px', borderRadius: '999px', background: '#E1F2E9', color: '#1B8A5A', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' }}>Locked · by {lock.by} · {fmtDate(lock.at)}</span>
                : <button type="button" disabled={!can || !pickState || !pickHasRules || busy === 'lock'} onClick={function () { setConfirm(true); }} style={btn(can && pickState && pickHasRules ? 'pri' : 'dis')}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                    {busy === 'lock' ? 'Loading rules…' : 'Lock state and load its rules'}
                  </button>}
            </div>
            <div style={Object.assign({}, hint, { marginTop: 0 })}>
              {lock
                ? <span>{lock.name} rules were loaded when the state was locked. To bring in later changes to the law, use <a href="/jurisdiction-config" onClick={function (e) { e.preventDefault(); nav('/jurisdiction-config'); }} style={{ color: C.pri }}>Regenerate from state rules</a> — it proposes changes for review and never overwrites your choices.</span>
                : 'Locking loads this state\'s public records rules — deadlines, what may be charged, exemptions, appeals — into the review items on the Setup hub. It happens once and cannot be undone from this screen. You will be asked to confirm.'}
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid ' + C.line, background: C.wash, borderRadius: '0 0 10px 10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={Object.assign({}, hint, { flexGrow: 1, marginTop: 0 })}>
            {msg ? <span style={{ color: '#1B8A5A', fontWeight: '600' }}>{msg} </span> : null}
            {lock ? 'Fields stay editable after attesting. Changing the address or contact does not reload rules.'
              : <span><span style={{ color: C.red, fontWeight: '700' }}>*</span> Required to attest. Attest becomes available when every required field is filled and the state is locked.</span>}
            {!can ? ' · view only for you' : ''}
          </span>
          <button type="button" onClick={function () { load(); setMsg(''); }} style={btn('sec')}>Cancel</button>
          <button type="button" disabled={!can || busy === 'save'} onClick={save} style={btn(can ? 'pri' : 'dis')}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {confirm ? (
        <div onClick={function () { setConfirm(false); }} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(18,35,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '12px', padding: '22px', width: '520px', maxWidth: '92%', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: '16px', fontWeight: '700' }}>Lock the state to {pickName}?</div>
            <div style={{ fontSize: '13px', color: '#374151', marginTop: '10px', lineHeight: '1.6' }}>
              {pickName}'s public records rules will be loaded into the Setup hub's review items — response deadlines, what may be charged, deposits, fee waivers, exemptions and appeals — and {pickName} becomes the law this city follows.
              This happens once. It cannot be undone from this screen; later changes in the law come in as proposals for review.
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button type="button" onClick={function () { setConfirm(false); }} style={btn('sec')}>Cancel</button>
              <button type="button" onClick={doLock} style={btn('pri')}>Lock {pickState} and load its rules</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
