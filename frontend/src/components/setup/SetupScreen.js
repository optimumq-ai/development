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

export var BLUE = 'var(--oq-x-1e6091)';
export var STATE = {
  ready:           { label: 'Ready',           bg: 'var(--oq-bg-e1f2e9)', color: 'var(--oq-fg-1b8a5a)' },
  in_progress:     { label: 'In progress',     bg: 'var(--oq-bg-f6ebd6)', color: 'var(--oq-fg-9a6512)' },
  not_started:     { label: 'Not started',     bg: 'var(--oq-bg-f3f4f6)', color: 'var(--oq-fg-4b5563)' },
  needs_attention: { label: 'Needs attention', bg: 'var(--oq-bg-fee2e2)', color: 'var(--oq-fg-991b1b)' },
  waiting:         { label: 'Waiting',         bg: 'var(--oq-bg-ede9fe)', color: 'var(--oq-fg-5b21b6)' },
};
export var APPROVAL = {
  red:    { label: 'Not started',       bg: 'var(--oq-bg-fee2e2)', color: 'var(--oq-fg-991b1b)' },
  yellow: { label: 'Awaiting approval', bg: 'var(--oq-bg-f6ebd6)', color: 'var(--oq-fg-9a6512)' },
  green:  { label: 'Approved',          bg: 'var(--oq-bg-e1f2e9)', color: 'var(--oq-fg-1b8a5a)' },
};
export var lbl = { fontSize: '12.5px', fontWeight: 600, color: 'var(--oq-fg-374151)', display: 'block', marginBottom: '5px' };
export var inp = { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--oq-ln-d1d5db)', fontSize: '13px', outline: 'none', boxSizing: 'border-box', background: 'var(--oq-bg-ffffff)', fontFamily: 'inherit' };
export var hint = { fontSize: '12px', color: 'var(--oq-fg-8296a4)', marginTop: '5px', lineHeight: 1.45 };
export var card = { background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-d2dce3)', borderRadius: '10px' };
export var field = { marginBottom: '16px' };

export function Msg(props) {
  if (!props.text) return null;
  var ok = props.ok !== false;
  return <div style={{ background: ok ? 'var(--oq-bg-f0fdf4)' : 'var(--oq-bg-fef2f2)', border: '1px solid ' + (ok ? 'var(--oq-ln-86efac)' : 'var(--oq-ln-fca5a5)'), borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: ok ? 'var(--oq-fg-166534)' : 'var(--oq-fg-dc2626)', marginBottom: '14px' }}>{props.text}</div>;
}

export function PrimaryButton(props) {
  var on = !props.disabled;
  return <button type="button" disabled={!on} onClick={props.onClick}
    style={{ height: '34px', padding: '0 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', background: on ? BLUE : 'var(--oq-bg-f2f6f9)', color: on ? 'var(--oq-fg-ffffff)' : 'var(--oq-fg-a9b7c2)', border: '1px solid ' + (on ? BLUE : 'var(--oq-ln-d2dce3)'), cursor: on ? 'pointer' : 'default' }}>{props.children}</button>;
}

// A row of pill choices (the email screen's provider toggle, generalised).
export function Choice(props) {
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {props.options.map(function (o) {
        var on = props.value === o[0]; var dis = !!props.disabled;
        return <span key={o[0]} onClick={function () { if (!dis) props.onChange(o[0]); }}
          style={{ fontSize: '12.5px', padding: '7px 14px', borderRadius: '999px', cursor: dis ? 'default' : 'pointer', border: '1px solid ' + (on ? BLUE : 'var(--oq-ln-d1d5db)'), background: on ? 'var(--oq-bg-ebf3fb)' : 'var(--oq-bg-ffffff)', color: on ? BLUE : 'var(--oq-fg-4b5563)', fontWeight: on ? 700 : 500, opacity: dis && !on ? 0.6 : 1 }}>{o[1]}</span>;
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

  async function toggleReady() {
    setBusy('ready'); setErr('');
    try { if (row && row.ready) await api.delete('/setup-hub/' + hubKey + '/ready'); else await api.post('/setup-hub/' + hubKey + '/ready'); await reload(); }
    catch (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Could not update.'); }
    setBusy('');
  }
  async function toggleAttest() {
    setBusy('attest'); setErr('');
    try { if (row && row.signoff) await api.delete('/setup-hub/' + hubKey + '/done'); else await api.post('/setup-hub/' + hubKey + '/done'); await reload(); }
    catch (e) { setErr('Could not update the sign-off.'); }
    setBusy('');
  }

  // APPROVAL MODEL (Kevin 2026-08-31): when the hub row carries an approval colour, the pill is that colour and
  // the line is why; the button approves (or re-approves). Rows without one keep the five-state pill.
  var ap = row && row.approval;
  var st = ap ? APPROVAL[ap] : STATE[(row && row.state) || 'not_started'];
  var can = !!(row && row.canEdit);
  var attested = !!(row && row.signoff) && !(row && row.changedSinceApproval) && ap !== 'red';
  var redLock = ap === 'red';
  var approveLabel = row && row.changedSinceApproval ? 'Re-approve — attest as complete' : (ap ? 'Approve — attest as complete' : 'Attest as complete');

  return (
    <div style={{ maxWidth: props.maxWidth || '860px', color: 'var(--oq-fg-12232e)' }}>
      {/* flexWrap + a real flex-basis on the status line (2026-09-04, Kevin's Mass Redaction screenshot):
          the pill, nowrap lane label and two buttons are all unshrinkable, and on long-evidence rows they
          exceeded the row width — the ONLY flexible item (the status text) collapsed to min-content, one
          word per line, ballooning the strip into a tall column. Wrapping keeps every line short instead. */}
      <div style={Object.assign({}, card, { display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: '8px', gap: '14px', padding: '10px 14px', marginBottom: '14px' })}>
        <button type="button" onClick={function () { nav('/admin?tab=setup'); }} title="Back to Settings and Configuration"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 11px', border: 0, borderRadius: '999px', background: hubKey ? st.bg : 'var(--oq-bg-f3f4f6)', color: hubKey ? st.color : 'var(--oq-fg-4b5563)', fontSize: '11px', fontWeight: '700', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          {hubKey ? st.label : 'Settings and Configuration'}
        </button>
        <span style={{ flex: '1 1 260px', minWidth: '220px', fontSize: '12px', color: 'var(--oq-fg-5c6f7c)', lineHeight: '1.35' }}>{row ? (row.approvalWhy || row.evidence) : (hubKey ? '' : (props.note || ''))}</span>
        <span style={{ fontSize: '11.5px', color: 'var(--oq-fg-8296a4)', whiteSpace: 'nowrap', marginLeft: 'auto' }}>{props.laneLabel}</span>
        {hubKey && row && row.approvalModel === 'list' && ap === 'yellow' && !attested && can
          ? <button type="button" disabled={busy === 'ready'} onClick={toggleReady} title={row.ready ? 'Withdraw the declaration that this list is complete' : 'Tell the approver this list is complete'}
              style={{ height: '30px', padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', background: row.ready ? 'var(--oq-bg-ffffff)' : 'var(--oq-bg-f6ebd6)', color: row.ready ? 'var(--oq-fg-12232e)' : 'var(--oq-fg-9a6512)', border: '1px solid ' + (row.ready ? 'var(--oq-ln-becad3)' : 'var(--oq-ln-e5c98a)'), cursor: 'pointer', whiteSpace: 'nowrap' }}>{row.ready ? 'Ready · withdraw' : 'Ready for approval'}</button>
          : null}
        {!hubKey ? null : attested
          ? <button type="button" disabled={busy === 'attest' || !can} onClick={toggleAttest} style={{ height: '30px', padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-12232e)', border: '1px solid var(--oq-ln-becad3)', cursor: 'pointer', whiteSpace: 'nowrap' }}>{ap ? 'Approved · undo' : 'Attested · undo'}</button>
          : <button type="button" disabled={!can || redLock || busy === 'attest'} onClick={toggleAttest} title={redLock ? 'Fill and save every required item first' : ''} style={{ height: '30px', padding: '0 14px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', background: (can && !redLock) ? BLUE : 'var(--oq-bg-f2f6f9)', color: (can && !redLock) ? 'var(--oq-fg-ffffff)' : 'var(--oq-fg-a9b7c2)', border: '1px solid ' + ((can && !redLock) ? BLUE : 'var(--oq-ln-d2dce3)'), cursor: (can && !redLock) ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>{approveLabel}</button>}
      </div>
      {err ? <Msg text={err} ok={false} /> : null}
      {row && row.changedSinceApproval ? <div style={{ background: 'var(--oq-bg-fff8e8)', border: '1px solid var(--oq-ln-f0d9a8)', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: 'var(--oq-fg-7a5210)', marginBottom: '14px' }}><strong>Changed since approval.</strong> {row.approvalWhy}. The lane owner has been notified to approve again.</div> : null}
      <div style={Object.assign({}, card, { padding: '20px 22px' })}>
        <div style={{ fontSize: '19px', fontWeight: 700, marginBottom: '3px' }}>{props.title}</div>
        <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-5c6f7c)', marginBottom: '18px', lineHeight: 1.5 }}>{props.intro}</div>
        {loaded ? props.children({ row: row, can: hubKey ? can : true, reload: reload }) : <div style={{ color: 'var(--oq-fg-9ca3af)', padding: '20px 0' }}>Loading…</div>}
      </div>
    </div>
  );
}
