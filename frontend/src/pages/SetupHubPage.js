import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

// SETUP & CONFIGURATION HUB — SPEC_setup_hub.md (H1). The artboard docs/mockups/setup_hub/Main.dc.html, built:
// a header with the five state counts; the "Start here" agency card; five lanes, each a list of rows. The ROW is
// the button (one click into the screen that sets it); the chip is the counted state; the evidence line says what
// the system found. A waiting row stays open and carries a Why button. "Mark it done" is the sign-off.

var STATE = {
  ready:           { label: 'Ready',           bg: '#DCFCE7', color: '#166534' },
  in_progress:     { label: 'In progress',     bg: '#FEF3C7', color: '#92400E' },
  not_started:     { label: 'Not started',     bg: '#F3F4F6', color: '#4B5563' },
  needs_attention: { label: 'Needs attention', bg: '#FEE2E2', color: '#991B1B' },
  waiting:         { label: 'Waiting',         bg: '#EDE9FE', color: '#5B21B6' },
};

function Chip(props) {
  var s = STATE[props.state] || STATE.not_started;
  return <span style={{ display: 'inline-block', background: s.bg, color: s.color, fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '12px', whiteSpace: 'nowrap' }}>{s.label}</span>;
}

export default function SetupHubPage() {
  var nav = useNavigate();
  var [data, setData] = useState(null);
  var [err, setErr] = useState('');
  var [why, setWhy] = useState(null);       // item
  var [busy, setBusy] = useState('');

  function load() {
    api.get('/setup-hub').then(function (r) { setData(r.data); setErr(''); })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'The setup page could not load.'); });
  }
  useEffect(load, []);

  function open(item) {
    if (!item.door) return;
    nav(item.door);
  }
  async function toggleDone(item, e) {
    e.stopPropagation();
    setBusy(item.key);
    try {
      if (item.signoff) await api.delete('/setup-hub/' + item.key + '/done');
      else await api.post('/setup-hub/' + item.key + '/done');
      load();
    } catch (ex) { setErr((ex.response && ex.response.data && ex.response.data.error) || 'Could not update.'); }
    setBusy('');
  }

  if (err && !data) return <div style={{ padding: '24px', color: '#DC2626' }}>{err}</div>;
  if (!data) return <div style={{ padding: '24px', color: '#9CA3AF' }}>Reading what is configured…</div>;

  var c = data.counts;
  var headerCounts = [['ready', c.ready], ['in_progress', c.in_progress], ['not_started', c.not_started], ['waiting', c.waiting], ['needs_attention', c.needs_attention]];

  function Row(props) {
    var it = props.item;
    var dim = it.state === 'waiting';
    var clickable = !!it.door;
    return (
      <div onClick={function () { open(it); }} title={clickable ? 'Open the screen that sets this' : 'No screen for this yet'}
        style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'start', padding: '12px 14px', borderTop: '1px solid #F3F4F6', cursor: clickable ? 'pointer' : 'default', opacity: dim ? 0.72 : 1, background: 'white' }}
        onMouseEnter={function (e) { if (clickable) e.currentTarget.style.background = '#F8FAFC'; }} onMouseLeave={function (e) { e.currentTarget.style.background = 'white'; }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>{it.name}</span>
            <Chip state={it.state} />
            {it.legal ? <span style={{ fontSize: '10px', fontWeight: '700', color: '#6D28D9' }}>LEGAL SECTION</span> : null}
          </div>
          <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '3px', lineHeight: '1.5' }}>{it.evidence}</div>
          {it.note ? <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>{it.note}</div> : null}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {it.state === 'waiting' ? <button type="button" onClick={function (e) { e.stopPropagation(); setWhy(it); }}
            style={{ padding: '4px 10px', background: 'white', color: '#5B21B6', border: '1px solid #DDD6FE', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Why</button> : null}
          {it.canEdit && !it.goLive ? <button type="button" disabled={busy === it.key} onClick={function (e) { toggleDone(it, e); }}
            title={it.signoff ? 'Remove the done mark' : 'Record that this item is ready'}
            style={{ padding: '4px 10px', background: it.signoff ? 'white' : '#1F4E79', color: it.signoff ? '#6B7280' : 'white', border: '1px solid ' + (it.signoff ? '#E5E7EB' : '#1F4E79'), borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
            {it.signoff ? 'Marked done' : 'Mark it done'}</button> : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 0 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <div style={{ maxWidth: '640px' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827' }}>Setup and Configuration</div>
          <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '4px', lineHeight: '1.55' }}>Everything this city has to decide before it can answer records requests for real. Each item opens the screen that sets it.</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {headerCounts.map(function (h) { var s = STATE[h[0]]; return <span key={h[0]} style={{ background: s.bg, color: s.color, fontSize: '12px', fontWeight: '700', padding: '5px 12px', borderRadius: '14px' }}>{h[1]} {s.label.toLowerCase()}</span>; })}
        </div>
      </div>
      {err ? <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: '#DC2626', marginBottom: '12px' }}>{err}</div> : null}

      {data.top.map(function (it) {
        return <div key={it.key} style={{ border: '2px solid #1F4E79', borderRadius: '12px', overflow: 'hidden', marginBottom: '18px', background: 'white' }}>
          <div style={{ padding: '8px 14px', background: '#EFF6FF', fontSize: '11px', fontWeight: '700', color: '#1F4E79', letterSpacing: '0.04em' }}>START HERE</div>
          <Row item={it} />
        </div>;
      })}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '16px' }}>
        {data.lanes.map(function (l) {
          return <div key={l.key} style={{ border: '1px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden', background: 'white' }}>
            <div style={{ padding: '12px 14px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              <div style={{ fontSize: '15px', fontWeight: '700', color: '#111827' }}>{l.title}</div>
              <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>{l.ownerLabel}{l.canEdit ? '' : ' · view only for you'}</div>
              <div style={{ fontSize: '12px', color: '#374151', marginTop: '4px', fontWeight: '600' }}>{l.ready} of {l.total} ready</div>
            </div>
            {l.items.map(function (it) { return <Row key={it.key} item={it} />; })}
          </div>;
        })}
      </div>

      {why ? (
        <div onClick={function () { setWhy(null); }} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(17,24,39,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '12px', padding: '22px', width: '520px', maxWidth: '92%', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: '16px', fontWeight: '700', color: '#111827' }}>{why.name} is waiting</div>
            <div style={{ fontSize: '13px', color: '#374151', marginTop: '10px', lineHeight: '1.6' }}>{why.why}</div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              {why.door ? <button type="button" onClick={function () { setWhy(null); open(why); }} style={{ padding: '8px 14px', background: '#1F4E79', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Open it anyway</button> : null}
              {(why.waitingOn || []).map(function (k) {
                var dep = null; data.lanes.forEach(function (l) { l.items.forEach(function (x) { if (x.key === k) dep = x; }); }); data.top.forEach(function (x) { if (x.key === k) dep = x; });
                return dep && dep.door ? <button key={k} type="button" onClick={function () { setWhy(null); open(dep); }} style={{ padding: '8px 14px', background: 'white', color: '#1F4E79', border: '1px solid #BFDBFE', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Go to {dep.name}</button> : null;
              })}
              <button type="button" onClick={function () { setWhy(null); }} style={{ padding: '8px 14px', background: 'white', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
