import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

// FRONT DESK — REQUESTOR LEDGER (Kevin 2026-09-04). The read-only counter view of the WS5
// cross-request ledger: prior balance, free-time allowances, frequency counters, standing flags,
// and every request anchored to the person standing at the window. Mutations stay at the gates
// (services/requestorLedger.js); this screen only answers questions.

var card = { background: 'white', border: '1px solid #D2DCE3', borderRadius: '10px', padding: '16px 18px' };
var lbl = { fontSize: '11px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8296A4', marginBottom: '8px' };
function money(n) { return '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }

export default function RequestorLedgerPage() {
  var [q, setQ] = useState('');
  var [results, setResults] = useState(null);
  var [busy, setBusy] = useState(false);
  var [detail, setDetail] = useState(null);
  var [err, setErr] = useState('');

  async function search(e) {
    if (e) e.preventDefault();
    setBusy(true); setErr(''); setDetail(null);
    try { var r = await api.get('/requestor-ledger/search', { params: { q: q } }); setResults(r.data.profiles || []); }
    catch (e2) { setErr('Search failed.'); }
    setBusy(false);
  }
  async function open(p) {
    setBusy(true); setErr('');
    try { var r = await api.get('/requestor-ledger/profile/' + p.id); setDetail(r.data); }
    catch (e2) { setErr('The profile could not be loaded.'); }
    setBusy(false);
  }

  var d = detail;
  return (
    <div style={{ maxWidth: '860px', color: '#12232E' }}>
      <div style={{ fontSize: '19px', fontWeight: 700, marginBottom: '3px' }}>Requestor Ledger</div>
      <div style={{ fontSize: '12.5px', color: '#5C6F7C', marginBottom: '14px', lineHeight: 1.5 }}>
        What crosses requests for one person: unpaid balances from earlier requests, free staff-time allowances, request-frequency counts, and any standing status. Read-only — changes happen through the request gates.
      </div>
      <form onSubmit={search} style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
        <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="Search by name or email…"
          style={{ flex: 1, padding: '9px 12px', borderRadius: '8px', border: '1px solid #BECAD3', fontSize: '13px', fontFamily: 'inherit' }} />
        <button type="submit" disabled={busy || q.trim().length < 2}
          style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: '#1E6091', color: 'white', fontSize: '13px', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
          {busy ? 'Searching…' : 'Search'}</button>
      </form>
      {err ? <div style={{ color: '#B02A37', fontSize: '13px', marginBottom: '10px' }}>{err}</div> : null}

      {results && !detail ? (
        <div style={card}>
          <div style={lbl}>Matches ({results.length})</div>
          {results.length === 0 ? <div style={{ fontSize: '13px', color: '#8296A4' }}>No requestor profile matches. A profile exists once a person has a verified request — anonymous requests never create one.</div> :
            results.map(function (p) {
              return (
                <div key={p.id} onClick={function () { open(p); }} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', border: '1px solid #EDF1F4', borderRadius: '8px', marginBottom: '6px', cursor: 'pointer' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 600 }}>{p.display_name || '(no name)'} <span style={{ color: '#8296A4', fontWeight: 400 }}>· {p.primary_email || 'no email'}</span></div>
                    <div style={{ fontSize: '11.5px', color: '#8296A4' }}>{p.request_count} request{p.request_count === 1 ? '' : 's'} · identity: {p.identity_basis || 'unknown'}</div>
                  </div>
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: (p.balance && p.balance.outstanding > 0) ? '#B02A37' : '#1B8A5A' }}>{money(p.balance && p.balance.outstanding)}</div>
                </div>
              );
            })}
        </div>
      ) : null}

      {d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={Object.assign({}, card, { display: 'flex', alignItems: 'center', gap: '14px' })}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '16px', fontWeight: 700 }}>{d.profile.display_name || '(no name)'}</div>
              <div style={{ fontSize: '12.5px', color: '#5C6F7C' }}>{d.profile.primary_email || 'no email'} · identity: {d.profile.identity_basis || 'unknown'} · profile since {(d.profile.created_at || '').slice(0, 10)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#8296A4', textTransform: 'uppercase', letterSpacing: '.05em' }}>Prior balance</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: (d.balance && d.balance.outstanding > 0) ? '#B02A37' : '#1B8A5A' }}>{money(d.balance && d.balance.outstanding)}</div>
              <div style={{ fontSize: '11px', color: '#8296A4' }}>invoiced {money(d.balance && d.balance.invoiced)} · paid {money(d.balance && d.balance.paid)} · waived {money(d.balance && d.balance.waived)}</div>
            </div>
            <button onClick={function () { setDetail(null); }} style={{ border: '1px solid #BECAD3', background: 'white', borderRadius: '7px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>Back</button>
          </div>

          {(d.flags || []).length ? (
            <div style={Object.assign({}, card, { borderColor: '#EAD9B0', background: '#FFFDF7' })}>
              <div style={lbl}>Standing status</div>
              {d.flags.map(function (f, i) { return <div key={i} style={{ fontSize: '13px', color: '#9A6512' }}><b>{f.flag || f.name}</b>{f.expires_at ? ' · until ' + String(f.expires_at).slice(0, 10) : ''}{f.reason ? ' · ' + f.reason : ''}</div>; })}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={Object.assign({}, card, { flex: 1 })}>
              <div style={lbl}>Free-time allowances</div>
              {(d.allowances || []).length === 0 ? <div style={{ fontSize: '12.5px', color: '#8296A4' }}>None configured for this city.</div> :
                d.allowances.map(function (a) {
                  var used = Number(a.consumed) || 0, cap = Number(a.allowance) || 0;
                  return (
                    <div key={a.name} style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '12.5px', fontWeight: 600 }}>{a.name} <span style={{ color: '#8296A4', fontWeight: 400 }}>· {used} of {cap} {a.unit || ''} used · {a.window_spec || ''}</span></div>
                      <div style={{ height: '6px', background: '#F2F6F9', borderRadius: '3px', marginTop: '4px' }}>
                        <div style={{ height: '6px', width: (cap ? Math.min(100, Math.round(used / cap * 100)) : 0) + '%', background: used >= cap ? '#B02A37' : '#1E6091', borderRadius: '3px' }}></div>
                      </div>
                    </div>
                  );
                })}
            </div>
            <div style={Object.assign({}, card, { flex: 1 })}>
              <div style={lbl}>Request frequency</div>
              {(d.counters || []).length === 0 ? <div style={{ fontSize: '12.5px', color: '#8296A4' }}>No frequency rules in force.</div> :
                d.counters.map(function (c) { return <div key={c.name} style={{ fontSize: '12.5px', marginBottom: '5px' }}><b>{c.count}</b> · {c.name} <span style={{ color: '#8296A4' }}>({c.window_spec || ''})</span></div>; })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={Object.assign({}, card, { flex: 1.1 })}>
              <div style={lbl}>Ledger events</div>
              {(d.events || []).length === 0 ? <div style={{ fontSize: '12.5px', color: '#8296A4' }}>No money events recorded.</div> :
                d.events.map(function (ev, i) { return <div key={i} style={{ fontSize: '12.5px', marginBottom: '5px' }}><b style={{ color: '#12232E' }}>{String(ev.created_at || '').slice(0, 10)}</b> · {ev.type} {ev.amount != null ? '· ' + money(ev.amount) : ''} {ev.reason ? <span style={{ color: '#8296A4' }}>· {ev.reason}</span> : null}</div>; })}
            </div>
            <div style={Object.assign({}, card, { flex: 1 })}>
              <div style={lbl}>Requests ({(d.requests || []).length})</div>
              {(d.requests || []).map(function (r) {
                return <div key={r.id} style={{ fontSize: '12.5px', marginBottom: '5px' }}><Link to={'/requests/' + r.id} style={{ fontWeight: 600 }}>{r.request_number}</Link> <span style={{ color: '#8296A4' }}>· {r.stage || '—'} · linked {(r.linked_at || '').slice(0, 10)}</span></div>;
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
