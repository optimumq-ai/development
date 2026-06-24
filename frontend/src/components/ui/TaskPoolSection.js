import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';

var TYPE_LABEL = { estimate: 'Estimate', record_search: 'Record Search', redaction: 'Redaction' };
var TYPE_COLOR = {
  estimate: { bg: '#D1FAE5', color: '#065F46' },
  record_search: { bg: '#EDE9FE', color: '#6D28D9' },
  redaction: { bg: '#FEF3C7', color: '#92400E' }
};

function typeBadge(t) {
  var c = TYPE_COLOR[t] || { bg: '#F3F4F6', color: '#6B7280' };
  return <span style={{ background: c.bg, color: c.color, fontSize: '11px', fontWeight: '700', padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{TYPE_LABEL[t] || t}</span>;
}

export default function TaskPoolSection() {
  var [pool, setPool] = useState([]);
  var [mine, setMine] = useState([]);
  var [loading, setLoading] = useState(true);
  var [busy, setBusy] = useState(null);
  var [msg, setMsg] = useState('');

  useEffect(function () { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      var p = await api.get('/tasks/pool');
      var m = await api.get('/tasks/mine');
      setPool(p.data.tasks || []);
      setMine(m.data.tasks || []);
    } catch (e) { /* tasks API optional */ }
    setLoading(false);
  }

  async function claim(id) {
    setBusy(id); setMsg('');
    try {
      await api.post('/tasks/' + id + '/claim');
      await load();
    } catch (e) {
      setMsg((e.response && e.response.data && e.response.data.error) || 'Could not claim the task.');
      await load();
    }
    setBusy(null);
  }

  if (loading) return null;
  if (!pool.length && !mine.length) return null;

  function row(t, claimable) {
    return (
      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', border: '1px solid #E5E7EB', borderRadius: '10px', background: 'white' }}>
        {typeBadge(t.type)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#111' }}>{t.title || TYPE_LABEL[t.type] || t.type}</div>
          <div style={{ fontSize: '12px', color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.request_number ? t.request_number + ' · ' : ''}{t.request_description || ''}
          </div>
          <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>
            {t.team_name ? t.team_name : ''}{t.role_required ? ' · role: ' + t.role_required : ''}
            {!claimable && t.assignment_basis === 'smart_routing' ? ' · routed to you by specialization match' : ''}
          </div>
        </div>
        {claimable ? (
          <button onClick={function () { claim(t.id); }} disabled={busy === t.id} style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer', opacity: busy === t.id ? 0.6 : 1 }}>
            {busy === t.id ? 'Claiming...' : 'Claim'}
          </button>
        ) : (
          <Link to={'/requests/' + t.request_id} style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#1F4E79', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>Open</Link>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {msg ? <div style={{ fontSize: '13px', color: '#9B1C1C', background: '#FDE8E8', border: '1px solid #FBD5D5', borderRadius: '8px', padding: '9px 12px' }}>{msg}</div> : null}
      {mine.length ? (
        <div>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>My tasks &middot; {mine.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>{mine.map(function (t) { return row(t, false); })}</div>
        </div>
      ) : null}
      {pool.length ? (
        <div>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151', marginBottom: '2px' }}>Available to claim &middot; {pool.length}</div>
          <div style={{ fontSize: '12px', color: '#9CA3AF', marginBottom: '8px' }}>Open tasks for your team and role. First to claim takes it.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>{pool.map(function (t) { return row(t, true); })}</div>
        </div>
      ) : null}
    </div>
  );
}
