import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';

// THE DELETION PROCESS for a department, a fulfillment team or a staff member (Kevin 2026-09-08). The server
// (services/orgRemoval) names every prerequisite as a step; this dialog shows them with a count and a way to
// the screen that clears each one, re-checks on demand, and only offers Delete once the list is empty. It
// also says, before the click, whether the row will be deleted outright or kept for the record.
//   props: kind 'department' | 'team' | 'staff' · id · name · onClose() · onDone(result)
export default function RemovalDialog(props) {
  var nav = useNavigate();
  var [check, setCheck] = useState(null);
  var [err, setErr] = useState('');
  var [busy, setBusy] = useState('');
  var base = props.kind === 'staff' ? '/staff/' : '/departments/';
  var noun = props.kind === 'staff' ? 'staff member' : props.kind === 'team' ? 'fulfillment team' : 'city department';

  async function load() {
    setErr('');
    try { var r = await api.get(base + props.id + '/removal'); setCheck(r.data); }
    catch (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Could not read the deletion steps.'); }
  }
  useEffect(function () { load(); }, [props.id]);

  async function runAction(b) {
    setBusy(b.code); setErr('');
    try { await api.request({ method: b.where.action.method, url: b.where.action.path, data: b.where.action.body || {} }); await load(); }
    catch (e) { setErr((e.response && e.response.data && e.response.data.error) || 'That step could not be completed.'); }
    setBusy('');
  }
  async function doDelete() {
    setBusy('delete'); setErr('');
    try { var r = await api.delete(base + props.id); props.onDone(r.data); }
    catch (e) {
      var d = e.response && e.response.data;
      if (d && d.check) setCheck(d.check);
      setErr((d && d.error) || 'Could not delete.');
    }
    setBusy('');
  }

  var btn = function (kind, extra) {
    var base2 = { padding: '8px 14px', borderRadius: '7px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' };
    var k = kind === 'danger' ? { background: 'var(--oq-bg-b91c1c)', color: 'var(--oq-fg-ffffff)', border: '1px solid var(--oq-ln-b91c1c)' }
      : kind === 'dis' ? { background: 'var(--oq-bg-f3f4f6)', color: 'var(--oq-fg-9ca3af)', border: '1px solid var(--oq-ln-e5e7eb)', cursor: 'default' }
      : { background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-1f4e79)', border: '1px solid var(--oq-ln-bfdbfe)' };
    return Object.assign(base2, k, extra || {});
  };

  return (
    <div onClick={function () { if (!busy) props.onClose(); }} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(17,24,39,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'var(--oq-bg-ffffff)', borderRadius: '12px', padding: '24px', width: '600px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--oq-fg-111111)' }}>Delete {noun}: {props.name}</div>
        <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-6b7280)', marginTop: '4px' }}>Deleting is a process. Each step below has to be clear before the {noun} can go, so nothing is left pointing at it.</div>

        {!check && !err ? <div style={{ fontSize: '13px', color: 'var(--oq-fg-9ca3af)', marginTop: '16px' }}>Checking what depends on it…</div> : null}

        {check ? (
          <div style={{ marginTop: '16px' }}>
            {check.blockers.length ? (
              <div>
                <div style={{ fontSize: '11px', fontWeight: '800', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--oq-fg-b91c1c)', marginBottom: '8px' }}>Steps still open · {check.blockers.length}</div>
                {check.blockers.map(function (b) {
                  return (
                    <div key={b.code} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 12px', border: '1px solid var(--oq-ln-fecaca)', background: 'var(--oq-bg-fef2f2)', borderRadius: '8px', marginBottom: '8px' }}>
                      <div style={{ minWidth: '26px', height: '26px', borderRadius: '50%', background: 'var(--oq-bg-b91c1c)', color: 'var(--oq-fg-ffffff)', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{b.count}</div>
                      <div style={{ flex: 1, fontSize: '13px', color: 'var(--oq-fg-111111)', lineHeight: 1.45 }}>{b.text}</div>
                      {b.where && b.where.action ? <button type="button" disabled={!!busy} onClick={function () { runAction(b); }} style={btn('sec', { flexShrink: 0 })}>{busy === b.code ? 'Working…' : b.where.label}</button> : null}
                      {b.where && b.where.href ? <button type="button" onClick={function () { props.onClose(); nav(b.where.href); }} style={btn('sec', { flexShrink: 0 })}>Open {b.where.label} →</button> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '10px 12px', border: '1px solid var(--oq-ln-a7f3d0)', background: 'var(--oq-bg-ecfdf5)', borderRadius: '8px', fontSize: '13px', color: 'var(--oq-fg-065f46)' }}>Every step is clear.</div>
            )}

            {check.keeps.length ? (
              <div style={{ marginTop: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: '800', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--oq-fg-6b7280)', marginBottom: '6px' }}>Kept on the record</div>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--oq-fg-374151)', lineHeight: 1.5 }}>
                  {check.keeps.map(function (k) { return <li key={k.code}>{k.text}</li>; })}
                </ul>
              </div>
            ) : null}

            <div style={{ marginTop: '14px', fontSize: '13px', color: check.canDelete ? 'var(--oq-fg-111111)' : 'var(--oq-fg-6b7280)', lineHeight: 1.5 }}>{check.outcome}</div>
          </div>
        ) : null}

        {err ? <div style={{ marginTop: '12px', fontSize: '12.5px', color: 'var(--oq-fg-b91c1c)' }}>{err}</div> : null}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
          <button type="button" onClick={load} disabled={!!busy} style={btn('sec')}>Re-check</button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={props.onClose} disabled={!!busy} style={btn('sec')}>Cancel</button>
            <button type="button" disabled={!(check && check.canDelete) || !!busy} onClick={doDelete} style={btn(check && check.canDelete ? 'danger' : 'dis')}>{busy === 'delete' ? 'Deleting…' : 'Delete'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
