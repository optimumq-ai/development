import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
var METHOD_LABEL = { cash: 'Cash', check: 'Check', card: 'Card', money_order: 'Money order', other: 'Other' };

export default function CashDrawerPage() {
  var [date, setDate] = useState(todayStr());
  var [data, setData] = useState(null);
  var [busy, setBusy] = useState(false);
  var [err, setErr] = useState('');

  function load(d) {
    setBusy(true); setErr('');
    api.get('/fee-estimates/payments/drawer?date=' + encodeURIComponent(d)).then(function (r) { setData(r.data); setBusy(false); }).catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || 'Could not load the drawer.'); setBusy(false); });
  }
  useEffect(function () { load(date); }, [date]);

  var tx = (data && data.transactions) || [];
  var totals = (data && data.totalsByMethod) || {};
  var th = { textAlign: 'left', fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.03em', padding: '8px 10px', borderBottom: '1px solid #E5E7EB' };
  var td = { fontSize: '13px', color: '#374151', padding: '8px 10px', borderBottom: '1px solid #F3F4F6' };

  return (
    <div style={{ maxWidth: '1040px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 6px' }}>Cash Drawer</h1>
      <p style={{ color: '#6B7280', fontSize: '14px', margin: '0 0 18px' }}>Payments collected at the counter or by mail for a given day, for daily reconciliation. Count the drawer and match the cash total below; check, card, and money-order totals are shown for deposit reconciliation.</p>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '18px' }}>
        <label style={{ fontSize: '13px', color: '#374151', fontWeight: 600 }}>Drawer date</label>
        <input type="date" value={date} onChange={function (e) { setDate(e.target.value); }} style={{ padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px' }} />
        <button onClick={function () { load(date); }} disabled={busy} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{busy ? 'Loading...' : 'Refresh'}</button>
      </div>

      {err ? <div style={{ fontSize: '13px', color: '#9B1C1C', background: '#FDE8E8', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px' }}>{err}</div> : null}

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
        <div style={{ background: '#1F4E79', color: 'white', borderRadius: '12px', padding: '14px 18px', minWidth: '160px' }}>
          <div style={{ fontSize: '12px', opacity: .85 }}>Cash collected (net)</div>
          <div style={{ fontSize: '24px', fontWeight: 800 }}>{money(data && data.cashCollected)}</div>
        </div>
        {['check', 'card', 'money_order', 'other'].map(function (m) {
          return totals[m] ? <div key={m} style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '14px 18px', minWidth: '130px' }}><div style={{ fontSize: '12px', color: '#6B7280' }}>{METHOD_LABEL[m]}</div><div style={{ fontSize: '20px', fontWeight: 800, color: '#1F4E79' }}>{money(totals[m])}</div></div> : null;
        })}
        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '14px 18px', minWidth: '120px' }}><div style={{ fontSize: '12px', color: '#6B7280' }}>Transactions</div><div style={{ fontSize: '20px', fontWeight: 800, color: '#374151' }}>{(data && data.count) || 0}</div></div>
      </div>

      <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Time</th><th style={th}>Request</th><th style={th}>Target</th><th style={th}>Method</th><th style={Object.assign({}, th, { textAlign: 'right' })}>Amount</th><th style={Object.assign({}, th, { textAlign: 'right' })}>Tendered</th><th style={Object.assign({}, th, { textAlign: 'right' })}>Change</th><th style={th}>Reference</th><th style={th}>Clerk</th></tr></thead>
          <tbody>
            {tx.length === 0 ? <tr><td style={Object.assign({}, td, { color: '#9CA3AF' })} colSpan={9}>No payments recorded for this date.</td></tr> : tx.map(function (p, i) {
              return <tr key={p.id || i}>
                <td style={td}>{(p.created_at || '').slice(11, 16)}</td>
                <td style={td}>{p.request_number ? <Link to={'/requests/' + p.request_id} style={{ color: '#1F4E79', textDecoration: 'none', fontWeight: 600 }}>{p.request_number}</Link> : '\u2014'}</td>
                <td style={td}>{p.target}</td>
                <td style={td}>{METHOD_LABEL[p.method] || p.method}</td>
                <td style={Object.assign({}, td, { textAlign: 'right', fontWeight: 700 })}>{money(p.amount)}</td>
                <td style={Object.assign({}, td, { textAlign: 'right', color: '#6B7280' })}>{p.tendered != null ? money(p.tendered) : '\u2014'}</td>
                <td style={Object.assign({}, td, { textAlign: 'right', color: '#6B7280' })}>{p.change_given ? money(p.change_given) : '\u2014'}</td>
                <td style={td}>{p.reference || '\u2014'}</td>
                <td style={td}>{p.clerk || '\u2014'}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
