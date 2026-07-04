import React, { useState } from 'react';
import api from '../lib/api';

var PREBUILT = [
  { key: 'fee_revenue_ytd', label: 'Fee Revenue YTD', color: '#03543F', bg: '#DEF7EC' },
  { key: 'volume_by_month', label: 'Volume by Month', color: '#1E40AF', bg: '#E0E7FF' },
  { key: 'processing_time', label: 'Processing Time', color: '#6B21A8', bg: '#F3E8FF' },
  { key: 'overdue_by_dept', label: 'Overdue by Dept', color: '#9B1C1C', bg: '#FDE8E8' },
  { key: 'compliance_rate', label: 'Compliance Rate', color: '#1E40AF', bg: '#EBF3FB' },
  { key: 'self_service_rate', label: 'Self-Service Rate', color: '#92400E', bg: '#FEF3C7' },
  { key: 'top_requestors', label: 'Top Requestors', color: '#374151', bg: '#F3F4F6' }
];
var EXAMPLES = [
  'Show me all overdue requests from the past 60 days grouped by category',
  'Which requestors have submitted the most requests in the past 90 days?',
  'What is the average processing time for complex requests vs. standard?',
  'Show me fee revenue by month year to date',
  'How many requests came in this month compared to last month?'
];

function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

function Bars(props) {
  var rows = props.rows || [];
  var max = Math.max.apply(null, rows.map(function (r) { return num(r.value); }).concat([1]));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {rows.map(function (r, i) {
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '150px', fontSize: '13px', color: '#374151', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
            <div style={{ flex: 1, background: '#F3F4F6', borderRadius: '6px', height: '26px', position: 'relative' }}>
              <div style={{ width: (num(r.value) / max * 100) + '%', minWidth: '2px', height: '100%', background: '#2E75B6', borderRadius: '6px' }} />
            </div>
            <div style={{ width: '70px', fontSize: '13px', fontWeight: '700', color: '#1F2937' }}>{r.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function LineChart(props) {
  var rows = props.rows || [];
  if (rows.length < 2) return <Bars rows={rows} />;
  var vals = rows.map(function (r) { return num(r.value); });
  var max = Math.max.apply(null, vals.concat([1])), min = Math.min.apply(null, vals.concat([0]));
  var W = 640, H = 220, pad = 34;
  var span = (max - min) || 1;
  var pts = rows.map(function (r, i) {
    var x = pad + i * ((W - 2 * pad) / (rows.length - 1));
    var y = H - pad - ((num(r.value) - min) / span) * (H - 2 * pad);
    return { x: x, y: y, r: r };
  });
  var poly = pts.map(function (p) { return p.x + ',' + p.y; }).join(' ');
  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', height: 'auto' }}>
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#E5E7EB" />
      <polyline points={poly} fill="none" stroke="#2E75B6" strokeWidth="2.5" />
      {pts.map(function (p, i) {
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="#1F4E79" />
            <text x={p.x} y={p.y - 10} fontSize="11" fill="#374151" textAnchor="middle">{p.r.value}</text>
            <text x={p.x} y={H - pad + 16} fontSize="10.5" fill="#9CA3AF" textAnchor="middle">{String(p.r.label).slice(-7)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ResultView(props) {
  var res = props.result;
  if (!res) return null;
  if (res.error) return <div style={{ padding: '16px 18px', background: '#FDE8E8', border: '1px solid #FBD5D5', borderRadius: '10px', color: '#9B1C1C', fontSize: '13.5px' }}>{res.error}</div>;
  var rows = res.rows || [];
  return (
    <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px 22px' }}>
      <div style={{ fontSize: '15px', fontWeight: '700', color: '#111', marginBottom: '2px' }}>{res.title}</div>
      {res.question ? <div style={{ fontSize: '12px', color: '#9CA3AF', marginBottom: '16px' }}>&ldquo;{res.question}&rdquo;</div> : <div style={{ marginBottom: '16px' }} />}
      {rows.length === 0 ? (
        <div style={{ color: '#9CA3AF', fontSize: '13px' }}>No data for this report yet.</div>
      ) : res.viz === 'number' ? (
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          {rows.map(function (r, i) {
            return <div key={i} style={{ padding: '16px 20px', background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: '10px', minWidth: '150px' }}>
              <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '6px' }}>{r.label}</div>
              <div style={{ fontSize: '26px', fontWeight: '800', color: '#1F4E79' }}>{r.value}</div>
            </div>;
          })}
        </div>
      ) : res.viz === 'table' ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead><tr>{(res.columns || ['Label', 'Value']).map(function (c, i) { return <th key={i} style={{ textAlign: i ? 'right' : 'left', padding: '8px 10px', borderBottom: '2px solid #E5E7EB', color: '#6B7280', fontWeight: '700' }}>{c}</th>; })}</tr></thead>
          <tbody>{rows.map(function (r, i) { return <tr key={i}><td style={{ padding: '8px 10px', borderBottom: '1px solid #F3F4F6', color: '#374151' }}>{r.label}</td><td style={{ padding: '8px 10px', borderBottom: '1px solid #F3F4F6', textAlign: 'right', fontWeight: '700', color: '#1F2937' }}>{r.value}</td></tr>; })}</tbody>
        </table>
      ) : res.viz === 'line' ? (
        <LineChart rows={rows} />
      ) : (
        <Bars rows={rows} />
      )}
      {res.note ? <div style={{ marginTop: '16px', fontSize: '11.5px', color: '#9CA3AF', lineHeight: 1.5 }}>{res.note}</div> : null}
    </div>
  );
}

export default function AIReportingPage() {
  var [q, setQ] = useState('');
  var [busy, setBusy] = useState(false);
  var [result, setResult] = useState(null);

  async function runAsk(question) {
    var text = (question != null ? question : q).trim();
    if (!text || busy) return;
    setQ(text); setBusy(true); setResult(null);
    try { var r = await api.post('/reports/ask', { question: text }); setResult(r.data); }
    catch (e) { setResult({ error: 'The reporting agent is unavailable right now.' }); }
    setBusy(false);
  }
  async function runPrebuilt(key) {
    if (busy) return;
    setBusy(true); setResult(null); setQ('');
    try { var r = await api.get('/reports/prebuilt/' + key); setResult(r.data); }
    catch (e) { setResult({ error: 'Could not run that report.' }); }
    setBusy(false);
  }

  return (
    <div style={{ maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <div style={{ background: 'linear-gradient(135deg,#1F4E79,#2E75B6)', borderRadius: '14px', padding: '22px 24px', color: 'white' }}>
        <div style={{ fontSize: '18px', fontWeight: '800', marginBottom: '4px' }}>AI Reporting Agent</div>
        <div style={{ fontSize: '13px', opacity: 0.9, lineHeight: 1.5, marginBottom: '16px' }}>Ask any question about your open-records program in plain English, or run a pre-built report below. Numbers are computed from live data.</div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input value={q} onChange={function (e) { setQ(e.target.value); }} onKeyDown={function (e) { if (e.key === 'Enter') runAsk(); }} placeholder={'e.g. "Show me request volume by month, year to date"'} style={{ flex: 1, padding: '12px 14px', borderRadius: '10px', border: 'none', fontSize: '13.5px', outline: 'none' }} />
          <button onClick={function () { runAsk(); }} disabled={busy || !q.trim()} style={{ padding: '12px 22px', borderRadius: '10px', border: 'none', background: (busy || !q.trim()) ? 'rgba(255,255,255,.35)' : 'white', color: '#1F4E79', fontSize: '13.5px', fontWeight: '800', cursor: (busy || !q.trim()) ? 'default' : 'pointer' }}>{busy ? '\u2026' : 'Run'}</button>
        </div>
        <div style={{ fontSize: '11.5px', opacity: 0.75, marginTop: '8px' }}>Press Enter to run &middot; results are always live data</div>
      </div>

      <div>
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#9CA3AF', letterSpacing: '.04em', marginBottom: '10px' }}>PRE-BUILT REPORTS</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '10px' }}>
          {PREBUILT.map(function (p) {
            return <button key={p.key} onClick={function () { runPrebuilt(p.key); }} disabled={busy} style={{ padding: '13px 16px', borderRadius: '10px', border: '1px solid ' + p.bg, background: p.bg, color: p.color, fontSize: '13.5px', fontWeight: '700', cursor: busy ? 'default' : 'pointer', textAlign: 'left' }}>{p.label}</button>;
          })}
        </div>
      </div>

      {busy ? <div style={{ color: '#9CA3AF', fontSize: '13px' }}>Running&hellip;</div> : null}
      <ResultView result={result} />

      {!result && !busy ? (
        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '18px 20px' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151', marginBottom: '12px' }}>Example questions you can ask</div>
          {EXAMPLES.map(function (ex, i) {
            return <button key={i} onClick={function () { runAsk(ex); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 12px', marginBottom: '8px', borderRadius: '8px', border: '1px solid #F3F4F6', background: '#F9FAFB', color: '#374151', fontSize: '13px', cursor: 'pointer' }}>&ldquo;{ex}&rdquo;</button>;
          })}
        </div>
      ) : null}
    </div>
  );
}
