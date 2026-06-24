import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

var FLAG = {
  estimate_response_overdue: { label: 'Estimate response overdue', bg: '#FEF3C7', color: '#92400E' },
  estimate_lapsed: { label: 'Estimate lapsed', bg: '#FDE8E8', color: '#9B1C1C' },
  deposit_overdue: { label: 'Deposit overdue', bg: '#FDE8E8', color: '#9B1C1C' },
  stalled: { label: 'Stalled', bg: '#F3F4F6', color: '#6B7280' }
};
function flagBadge(f) {
  var c = FLAG[f] || { label: f, bg: '#F3F4F6', color: '#6B7280' };
  return <span style={{ background: c.bg, color: c.color, fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{c.label}</span>;
}

export default function TicklerPage() {
  var [data, setData] = useState(null);
  var [running, setRunning] = useState(false);
  var [busy, setBusy] = useState(null);

  function load() { api.get('/tickler/status').then(function (r) { setData(r.data); }).catch(function () { setData({ error: true }); }); }
  useEffect(function () { load(); }, []);

  async function runNow() { setRunning(true); try { await api.post('/tickler/run'); } catch (e) {} load(); setRunning(false); }
  async function clearFlag(id) { setBusy(id); try { await api.post('/tickler/clear/' + id); } catch (e) {} load(); setBusy(null); }

  var lr = data && data.lastRun;
  var flagged = (data && data.flagged) || [];
  var act = lr && lr.summary && lr.summary.actions;

  return (
    <div style={{ maxWidth: '980px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Tickler</h1>
        <button onClick={runNow} disabled={running} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: running ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: 700, cursor: running ? 'default' : 'pointer' }}>{running ? 'Running...' : 'Run sweep now'}</button>
      </div>
      <p style={{ color: '#6B7280', fontSize: '14px', margin: '0 0 18px' }}>The tickler is a daily time-sweep that flags requests whose clocks have run out &mdash; an estimate the requestor hasn't answered, an accepted estimate whose deposit is unpaid, or a request that's gone quiet for too long. Flagging is non-destructive; resolving the underlying step clears the flag automatically.</p>

      <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '16px 18px', marginBottom: '18px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#374151', marginBottom: '8px' }}>Last run</div>
        {lr ? (
          <div style={{ fontSize: '13px', color: '#374151' }}>
            <div style={{ color: '#6B7280' }}>{lr.ranAt} &middot; {lr.trigger} &middot; scanned {lr.scanned} active requests</div>
            {act ? <div style={{ display: 'flex', gap: '18px', marginTop: '8px', flexWrap: 'wrap' }}>
              <span>Estimates lapsed: <strong>{act.estimate_lapsed}</strong></span>
              <span>Deposits overdue: <strong>{act.deposit_overdue}</strong></span>
              <span>Stalled: <strong>{act.stalled}</strong></span>
              {act.withdrawn ? <span>Auto-withdrawn: <strong>{act.withdrawn}</strong></span> : null}
            </div> : null}
          </div>
        ) : <div style={{ fontSize: '13px', color: '#9CA3AF' }}>No sweep has run yet. Use &ldquo;Run sweep now&rdquo; to check the clocks.</div>}
      </div>

      <div style={{ fontSize: '13px', fontWeight: 700, color: '#374151', marginBottom: '10px' }}>Flagged requests &middot; {flagged.length}</div>
      {flagged.length === 0 ? (
        <div style={{ fontSize: '13px', color: '#9CA3AF', background: '#F8FAFF', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '18px', textAlign: 'center' }}>Nothing flagged. Every clock is within bounds.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {flagged.map(function (r) {
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', border: '1px solid #E5E7EB', borderRadius: '10px', background: 'white' }}>
                {flagBadge(r.tickler_flag)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#111' }}>{r.request_number}{r.requestor_name ? ' · ' + r.requestor_name : ''}</div>
                  <div style={{ fontSize: '12px', color: '#9CA3AF' }}>stage: {r.stage}{r.tickler_flagged_at ? ' · flagged ' + r.tickler_flagged_at : ''}</div>
                </div>
                <Link to={'/requests/' + r.id} style={{ padding: '6px 13px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#1F4E79', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>Open</Link>
                <button onClick={function () { clearFlag(r.id); }} disabled={busy === r.id} style={{ padding: '6px 13px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#6B7280', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>{busy === r.id ? '...' : 'Clear'}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
