import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

export default function AppLayout() {
  const store = useAuthStore();
  const nav = useNavigate();
  const [open, setOpen] = useState(true);
  const [uMenu, setUMenu] = useState(false);
  const user = store.user;
  const agencyName = store.agencyName;
  const isAdmin = store.hasAnyRole('SYSTEM_ADMIN');
  const isElev = store.hasAnyRole('SYSTEM_ADMIN','DIRECTOR','SUPERVISOR','DEPT_MANAGER');
  const items = [
    { to: '/dashboard', label: 'Dashboard', show: true },
    { to: '/requests', label: 'Request Queue', show: true },
    { to: '/my-tasks', label: 'My Tasks', show: true },
    { to: '/setup', label: 'Setup', show: isElev },
    { to: '/reports', label: 'Reports (ARIA)', show: isElev },
    { to: '/staff', label: 'Staff Management', show: isElev },
    { to: '/departments', label: 'City Departments & Teams', show: isElev },
    { to: '/taxonomy', label: 'Taxonomy', show: isElev },
    { to: '/workflow', label: 'Workflow', show: isElev },
    { to: '/workflow-map', label: 'Process Map', show: isElev },
    { to: '/workflow-sim', label: 'Simulator', show: isElev },
    { to: '/sources', label: 'Sources', show: isElev },
    { to: '/redaction-rules', label: 'Redaction Rules', show: isElev },
    { to: '/mass-redaction', label: 'Mass Redaction', show: isElev },
    { to: '/released', label: 'Released Records', show: isElev },
    { to: '/fee-config', label: 'Fee Configuration', show: isElev },
    { to: '/cash-drawer', label: 'Cash Drawer', show: isElev },
    { to: '/tickler', label: 'Tickler', show: isElev },
    { to: '/rule-updates', label: 'Update Configuration', show: isElev },
    { to: '/jurisdiction-profile', label: 'Jurisdiction Profile', show: isElev },
    { to: '/config', label: 'Configuration', show: isAdmin },
  ].filter(x => x.show);

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#F9FAFB', overflow: 'hidden' }}>
      <aside style={{ display: 'flex', flexDirection: 'column', background: 'white', borderRight: '1px solid #E5E7EB', width: open ? '220px' : '56px', transition: 'width .2s', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ width: '32px', height: '32px', background: '#1F4E79', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          {open && <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: '700', color: '#1F4E79', fontSize: '13px' }}>OPTIMUM Q</div>
            <div style={{ fontSize: '11px', color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agencyName}</div>
          </div>}
          <button onClick={() => setOpen(!open)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px', flexShrink: 0 }}>
            {open ? '✕' : '☰'}
          </button>
        </div>
        <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {items.map(item => (
            <NavLink key={item.to} to={item.to} style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', borderRadius: '8px', textDecoration: 'none', fontSize: '13px', fontWeight: '500', color: isActive ? '#1F4E79' : '#6B7280', background: isActive ? '#D6E4F0' : 'transparent' })}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ borderTop: '1px solid #F3F4F6', padding: '8px' }}>
          <button onClick={() => setUMenu(!uMenu)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer' }}>
            <div style={{ width: '28px', height: '28px', background: '#1F4E79', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px', fontWeight: '700', flexShrink: 0 }}>
              {user?.display_name?.[0]?.toUpperCase() || 'U'}
            </div>
            {open && <div style={{ textAlign: 'left', minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.display_name}</div>
              <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{user?.functionRoles?.[0]?.replace(/_/g, ' ')}</div>
            </div>}
          </button>
          {uMenu && open && (
            <div style={{ marginTop: '4px', background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
              <button onClick={async () => { await store.logout(); nav('/login'); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: '13px' }}>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <header style={{ background: 'white', borderBottom: '1px solid #E5E7EB', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#9CA3AF' }}>{agencyName} · Public Records Management</div>
          <div style={{ fontSize: '12px', color: '#9CA3AF' }}>{user?.display_name}</div>
        </header>
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px' }}><Outlet /></main>
      </div>
    </div>
  );
}
