import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';

// SETUP SCREEN CHROME — the shared status strip every hub-linked screen wears (the EmailConfigPage pattern,
// lifted into one component for the C11 migration, 2026-08-30: six v1 Configuration tabs became six
// dedicated screens). It loads the screen's hub row (`hubKey`) from /api/setup-hub, shows the row's state
// pill (a link back to the hub), its counted evidence, the lane it belongs to, and the "Attest as
// complete" mark (POST/DELETE /setup-hub/:key/done — the reversible Option-A sign-off). Children get
// { row, can, reload } so a screen can gate its own controls on the hub's canEdit and refresh the strip
// after a save. Nothing in here knows what the screen edits.

export var BLUE = '#1E6091';
export var STATE = {
  ready:           { label: 'Ready',           bg: '#E1F2E9', color: '#1B8A5A' },
  in_progress:     { label: 'In progress',     bg: '#F6EBD6', color: '#9A6512' },
  not_started:     { label: 'Not started',     bg: '#F3F4F6', color: '#4B5563' },
  needs_attention: { label: 'Needs attention', bg: '#FEE2E2', color: '#991B1B' },
  waiting:         { label: 'Waiting',         bg: '#EDE9FE', color: '#5B21B6' },
};
export var lbl = { fontSize: '12.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '5px' };
export var inp = { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', outline: 'none', boxSizing: 'border-box', background: 'white', fontFamily: 'inherit' };
export var hint = { fontSize: '12px', color: '#8296A4', marginTop: '5px', lineHeight: 1.45 };
export var card = { background: 'white', border: '1px solid #D2DCE3', borderRadius: '10px' };
export var field = { marginBottom: '16px' };

export function Msg(props) {
  if (!props.text) return null;
  var ok = props.ok !== false;
  return <div style={{ background: ok ? '#F0FDF4' : '#FEF2F2', border: '1px solid ' + (ok ? '#86EFAC' : '#FCA5A5'), borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: ok ? '#166534' : '#DC2626', marginBottom: '14px' }}>{props.text}</div>;
}

export function PrimaryButton(props) {
  var on = !props.disabled;
  return <button type="button" disabled={!on} onClick={props.onClick}
    style={{ height: '34px', padding: '0 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', background: on ? BLUE : '#F2F6F9', color: on ? 'white' : '#A9B7C2', border: '1px solid ' + (on ? BLUE : '#D2DCE3'), cursor: on ? 'pointer' : 'default' }}>{props.children}</button>;
}

// A row of pill choices (the email screen's provider toggle, generalised).
export function Choice(props) {
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {props.options.map(function (o) {
        var on = props.value === o[0]; var dis = !!props.disabled;
        return <span key={o[0]} onClick={function () { if (!dis) props.onChange(o[0]); }}
          style={{ fontSize: '12.5px', padding: '7px 14px', borderRadius: '999px', cursor: dis ? 'default' : 'pointer', border: '1px solid ' + (on ? BLUE : '#D1D5DB'), background: on ? '#EBF3FB' : 'white', color: on ? BLUE : '#4B5563', fontWeight: on ? 700 : 500, opacity: dis && !on ? 0.6 : 1 }}>{o[1]}</span>;
      })}
    </div>
  );
}

export default function SetupScreen(props) {
  var nav = useNavigate();
  var [row, setRow] = useState(null);
  var [loaded, setLoaded] = useState(false);
  var [busy, setBusy] = useState('');
  var [err, setErr] = useState('');
  var hubKey = props.hubKey;

  var reload = useCallback(function () {
    return api.get('/setup-hub').then(function (h) {
      var found = null;
      (h.data.lanes || []).forEach(function (l) { l.items.forEach(function (x) { if (x.key === hubKey) found = x; }); });
      (h.data.top || []).forEach(function (x) { if (x.key === hubKey) found = x; });
      setRow(found);
    }).catch(function () { /* the strip degrades to Not started; the screen still loads */ }).then(function () { setLoaded(true); });
  }, [hubKey]);
  useEffect(function () { if (hubKey) reload(); else setLoaded(true); }, [reload, hubKey]);

  async function toggleAttest() {
    setBusy('attest'); setErr('');
    try { if (row && row.signoff) await api.delete('/setup-hub/' + hubKey + '/done'); else await api.post('/setup-hub/' + hubKey + '/done'); await reload(); }
    catch (e) { setErr('Could not update the sign-off.'); }
    setBusy('');
  }

  var st = STATE[(row && row.state) || 'not_started'];
  var can = !!(row && row.canEdit);
  var attested = !!(row && row.signoff);

  return (
    <div style={{ maxWidth: props.maxWidth || '860px', color: '#12232E' }}>
      <div style={Object.assign({}, card, { display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 14px', marginBottom: '14px' })}>
        <button type="button" onClick={function () { nav('/admin?tab=setup'); }} title="Back to Settings and Configuration"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 11px', border: 0, borderRadius: '999px', background: hubKey ? st.bg : '#F3F4F6', color: hubKey ? st.color : '#4B5563', fontSize: '11px', fontWeight: '700', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          {hubKey ? st.label : 'Settings and Configuration'}
        </button>
        <span style={{ flexGrow: 1, fontSize: '12px', color: '#5C6F7C', lineHeight: '1.35' }}>{row ? row.evidence : (hubKey ? '' : (props.note || ''))}</span>
        <span style={{ fontSize: '11.5px', color: '#8296A4', whiteSpace: 'nowrap' }}>{props.laneLabel}</span>
        {!hubKey ? null : attested
          ? <button type="button" disabled={busy === 'attest' || !can} onClick={toggleAttest} style={{ height: '30px', padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', background: 'white', color: '#12232E', border: '1px solid #BECAD3', cursor: 'pointer', whiteSpace: 'nowrap' }}>Attested · undo</button>
          : <button type="button" disabled={!can || busy === 'attest'} onClick={toggleAttest} style={{ height: '30px', padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', background: can ? BLUE : '#F2F6F9', color: can ? 'white' : '#A9B7C2', border: '1px solid ' + (can ? BLUE : '#D2DCE3'), cursor: can ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>Attest as complete</button>}
      </div>
      {err ? <Msg text={err} ok={false} /> : null}
      <div style={Object.assign({}, card, { padding: '20px 22px' })}>
        <div style={{ fontSize: '19px', fontWeight: 700, marginBottom: '3px' }}>{props.title}</div>
        <div style={{ fontSize: '12.5px', color: '#5C6F7C', marginBottom: '18px', lineHeight: 1.5 }}>{props.intro}</div>
        {loaded ? props.children({ row: row, can: hubKey ? can : true, reload: reload }) : <div style={{ color: '#9CA3AF', padding: '20px 0' }}>Loading…</div>}
      </div>
    </div>
  );
}
