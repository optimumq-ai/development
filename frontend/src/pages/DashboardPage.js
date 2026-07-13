import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../lib/api';
import { STAGE_LABELS as STAGES, STAGE_COLORS as SC } from '../lib/stages';


export default function DashboardPage() {
  const store = useAuthStore();
  const user = store.user;
  const [stats, setStats] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/requests/stats/dashboard'), api.get('/requests')])
      .then(([s, r]) => { setStats(s.data); setReqs(r.data.requests.slice(0, 8)); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '256px' }}>
      <div style={{ fontSize: '16px', color: '#6B7280' }}>Loading dashboard...</div>
    </div>
  );

  const cards = [
    { label: 'Active Requests', value: stats?.total ?? 0, bg: '#EBF3FB', color: '#1F4E79', link: '/requests' },
    { label: 'Overdue', value: stats?.overdue ?? 0, bg: stats?.overdue > 0 ? '#FEF2F2' : '#F0FDF4', color: stats?.overdue > 0 ? '#DC2626' : '#16A34A', link: '/requests' },
    { label: 'In Redaction', value: stats?.byStage?.redaction_review ?? 0, bg: '#FFFBEB', color: '#D97706', link: '/requests' },
    { label: 'Ready to Deliver', value: stats?.byStage?.delivery ?? 0, bg: '#F0FDF4', color: '#16A34A', link: '/requests' },
  ];

  return (
    <div style={{ maxWidth: '1200px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: '700', margin: '0 0 4px' }}>{greet()}, {user?.display_name?.split(' ')[0]}</h1>
        <p style={{ color: '#9CA3AF', fontSize: '14px', margin: '0' }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '16px' }}>
        {cards.map(({ label, value, bg, color, link }) => (
          <Link key={label} to={link} style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'white', borderRadius: '12px', border: '1px solid #E5E7EB', padding: '20px', textDecoration: 'none', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
            <div style={{ width: '52px', height: '52px', borderRadius: '12px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: color, fontSize: '22px', fontWeight: '700', flexShrink: 0 }}>{value}</div>
            <div style={{ fontSize: '14px', color: '#6B7280', fontWeight: '500' }}>{label}</div>
          </Link>
        ))}
      </div>
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E5E7EB', padding: '24px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', margin: '0 0 16px' }}>Requests by Stage</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '12px' }}>
          {Object.entries(STAGES).map(([k, v]) => (
            <Link key={k} to={'/requests?stage=' + k} style={{ textAlign: 'center', padding: '12px', borderRadius: '10px', border: '1px solid #F3F4F6', textDecoration: 'none' }}>
              <div style={{ fontSize: '26px', fontWeight: '700', color: '#111' }}>{stats?.byStage?.[k] ?? 0}</div>
              <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px', lineHeight: '1.3' }}>{v}</div>
            </Link>
          ))}
        </div>
      </div>
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E5E7EB', overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '15px', fontWeight: '600', margin: '0' }}>Recent Requests</h2>
          <Link to="/requests" style={{ fontSize: '13px', color: '#1F4E79', textDecoration: 'none' }}>View all →</Link>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#F9FAFB' }}>
              {['Request #','Requestor','Stage','Request Fulfillment Team','Deadline',''].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.05em', padding: '10px 16px' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {reqs.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: '#9CA3AF', fontSize: '14px' }}>No active requests</td></tr>
              ) : reqs.map(r => {
                const od = r.deadline_date && new Date(r.deadline_date) < new Date();
                const sc = SC[r.stage];
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: '600', color: '#1F4E79', fontSize: '13px' }}>{r.request_number}</span>
                        {r.is_mrr ? <span style={{ background: '#CCFBF1', color: '#0F766E', fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '20px' }}>MRR</span> : null}
                        {r.legal_flag ? <span style={{ background: '#FEF2F2', color: '#DC2626', fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '20px' }}>Legal</span> : null}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: '500', fontSize: '14px' }}>{r.requestor_name}</div>
                      <div style={{ fontSize: '12px', color: '#9CA3AF' }}>{r.requestor_email}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {sc ? <span style={{ background: sc.bg, color: sc.color, fontSize: '12px', fontWeight: '500', padding: '3px 10px', borderRadius: '20px' }}>{STAGES[r.stage]}</span> : <span style={{ fontSize: '12px', color: '#6B7280' }}>{r.stage}</span>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: r.department_color || '#9CA3AF' }}/>
                        <span style={{ fontSize: '14px' }}>{r.department_name || '—'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: '13px', color: od ? '#DC2626' : '#6B7280', fontWeight: od ? '600' : '400' }}>{r.deadline_date || '—'}{od ? ' ⚠' : ''}</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Link to={'/requests/' + r.id} style={{ fontSize: '12px', color: '#1F4E79', textDecoration: 'none', fontWeight: '500' }}>Open →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
