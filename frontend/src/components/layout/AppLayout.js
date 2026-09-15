import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import api from '../../lib/api';
import HelpAssistant from '../HelpAssistant';
import NotificationBell from '../ui/NotificationBell';
import { THEMES, currentTheme } from '../../lib/theme';

export default function AppLayout() {
  const store = useAuthStore();
  const nav = useNavigate();
  const loc = useLocation();
  // Display colours (account menu). `theme` mirrors what the document wears right now; store.setTheme applies
  // it, remembers it in the browser and saves it on the account.
  const [theme, setThemeState] = useState(currentTheme());
  const [themeErr, setThemeErr] = useState(null);
  useEffect(function () { if (store.user && store.user.ui_theme) setThemeState(currentTheme()); }, [store.user]);
  async function pickTheme(key) { setThemeState(key); setThemeErr(null); var r = await store.setTheme(key); if (r && r.error) setThemeErr(r.error); }
  // NAV PANEL (Kevin 2026-09-08): a 56px icon rail that expands OVER the page while the pointer is on it, so
  // every screen is laid out against the rail's width and keeps the space. "Keep open" pins it in the flow
  // (remembered per browser) — that control replaces the old ✕, which collapsed the panel and then hid
  // itself, leaving no way back. The user block moved to the header (one name on screen, with Sign Out).
  const [pinned, setPinned] = useState(function () { try { return localStorage.getItem('oq_nav_pinned') === '1'; } catch (e) { return false; } });
  const [hover, setHover] = useState(false);
  const [uMenu, setUMenu] = useState(false);
  const hoverTimer = React.useRef(null);
  const open = pinned || hover;
  function enter() { if (hoverTimer.current) clearTimeout(hoverTimer.current); setHover(true); }
  function leave() { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(function () { setHover(false); }, 150); }
  function togglePin() { setPinned(function (p) { try { localStorage.setItem('oq_nav_pinned', p ? '0' : '1'); } catch (e) {} return !p; }); }
  const [taskCount, setTaskCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const user = store.user;
  const agencyName = store.agencyName;
  // S4: "elevated" = any oversight / routing / legal / technical authority (middleware/auth ELEVATED).
  const isElev = store.hasAnyAuthority('act_any_request', 'reassign_any', 'reassign_team', 'override_stage', 'legal_decision', 'system');
  // MENU REORGANIZATION 2026-08-01 (Kevin): 24 links were overwhelming. Daily work stays visible;
  // the two report surfaces became ONE item (top tabs inside), the 13 technical-setup screens live
  // under Administration (tabbed; admin-only tabs hidden per role there), and the Simulator is
  // deleted. Every old URL redirects, so nothing anyone bookmarked breaks. Final grouping awaits
  // real third-party user feedback — this is the dramatic-improvement pass, not the last word.
  const items = [
    { to: '/dashboard', label: 'Dashboard', show: true, icon: 'grid' },
    { to: '/requests', label: 'Request Queue', show: true, icon: 'inbox' },
    // FRONT DESK (Kevin, 2026-09-04): the counter clerk's work — a citizen standing at the window.
    // Same visible-group pattern as the control center below. Cash Drawer MOVED here (was a
    // top-level item); its route is unchanged.
    { header: 'Front Desk', show: true, icon: 'desk', routes: ['/requests/new', '/cash-drawer', '/requestor-ledger'] },
    { to: '/requests/new', label: 'New Request Entry', show: true, child: true },
    { to: '/cash-drawer', label: 'Take a Payment', show: isElev, child: true },
    { to: '/requestor-ledger', label: 'Requestor Ledger', show: isElev, child: true },
    { to: '/reports', label: 'Reports', show: isElev, icon: 'chart' },
    { to: '/org', label: 'Organization', show: isElev, icon: 'org' },
    // PUBLIC READY CONTROL CENTER (Kevin, 2026-08-14): everything that converts internally-stored
    // records into public-facing ones, grouped in PIPELINE order — find the same-format piles,
    // redact them, released, on the map, in the library. A visible group with indented children,
    // deliberately NOT a popup: nothing hidden behind hover state, everything one click.
    { header: 'Public Ready Control Center', show: isElev, icon: 'globe', routes: ['/setup/taxonomy', '/mass-redaction', '/released', '/library-map', '/portal/library'] },
    // The variant-discovery entry point ("Find variants" lives per bucket on the Taxonomy tab).
    { to: '/setup/taxonomy', label: 'Identical Grouping', show: isElev, child: true },
    { to: '/mass-redaction', label: 'Mass Redaction', show: isElev, child: true },
    { to: '/released', label: 'Released Records', show: isElev, child: true },
    // Label renamed from "Records Map" (Kevin); the ROUTE keeps its old name — wire formats do.
    { to: '/library-map', label: 'Public Record Geo Location', show: isElev, child: true },
    // The PUBLIC library page, linked for internal eyes — same page the citizens see.
    { to: '/portal/library', label: 'Public Records Library', show: isElev, child: true },
    { to: '/tickler', label: 'Tickler', show: isElev, icon: 'clock' },
    // BW9a: the go-live checklist. Senior Legal (ATTORNEY_REVIEWER) sees it too — they attest the
    // Legal Rules sections and cannot attest what they cannot see.
    { to: '/jurisdiction-config', label: 'Jurisdiction Configuration', icon: 'scale',
      show: store.hasPermission('compliance_policy', 'legal_rules', 'operations_config') },
    { to: '/admin', label: 'Administration', show: isElev, icon: 'sliders' },
  ].filter(x => x.show);

  const uid = user && user.id;
  useEffect(function () {
    let alive = true;
    async function loadTasks() {
      try {
        const r = await api.get('/requests');
        const mine = (r.data.requests || []).filter(function (x) { return x.assigned_to === uid; });
        const od = mine.filter(function (x) { return x.deadline_date && new Date(x.deadline_date) < new Date(); });
        if (alive) { setTaskCount(mine.length); setOverdueCount(od.length); }
      } catch (e) { /* ignore */ }
    }
    if (uid) { loadTasks(); }
    const t = setInterval(function () { if (uid) loadTasks(); }, 60000);
    return function () { alive = false; clearInterval(t); };
  }, [uid]);

  const RAIL = 56, PANEL = 256;
  const navColor = function (active) { return active ? 'var(--oq-x-1f4e79)' : 'var(--oq-x-374151)'; };
  const groupActive = function (g) { return (g.routes || []).some(function (r) { return loc.pathname === r || loc.pathname.indexOf(r + '/') === 0; }); };
  const asideStyle = {
    position: pinned ? 'relative' : 'absolute', top: 0, left: 0, bottom: 0, zIndex: 60,
    display: 'flex', flexDirection: 'column', background: 'var(--oq-bg-ffffff)', borderRight: '1px solid var(--oq-ln-e5e7eb)',
    width: (open ? PANEL : RAIL) + 'px', transition: 'width .15s', flexShrink: 0, overflow: 'hidden',
    boxShadow: open && !pinned ? '8px 0 24px rgba(0,0,0,.10)' : 'none'
  };
  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--oq-bg-f9fafb)', overflow: 'hidden', position: 'relative' }}>
      {!pinned ? <div style={{ width: RAIL + 'px', flexShrink: 0 }} /> : null}
      <aside style={asideStyle} onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave} aria-label="Main navigation">
        {/* Kevin 2026-09-08: his logo replaces the OPTIMUM Q + agency text (the agency name already heads the
            top bar). Collapsed: the (Q) mark cropped from the same artwork; expanded: the full wordmark. */}
        {/* Kevin 2026-09-14: the logo block is a coloured brand band in every display mode (--oq-t-logoBg: his
            three blues, one per mode) and the mark is the near-white (f9fafb) rendering of the same artwork (brand/*-light.png). */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: open ? 'space-between' : 'center', gap: '8px', padding: open ? '10px 12px' : '10px 0', height: '57px', boxSizing: 'border-box', background: 'var(--oq-t-logoBg)' }}>
          {open
            ? <img src="/brand/optimumq-wordmark-light.png" alt="OPTIMUM Q" style={{ height: '34px', width: 'auto', display: 'block', flexShrink: 1, minWidth: 0, maxWidth: '150px', objectFit: 'contain' }} />
            : <img src="/brand/optimumq-mark-light.png" alt="OPTIMUM Q" title="OPTIMUM Q" style={{ height: '26px', width: 'auto', display: 'block' }} />}
          {open ? (
            <button onClick={togglePin} title={pinned ? 'Let the panel shrink to icons when the pointer leaves it' : 'Keep the panel open all the time'}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', background: pinned ? 'var(--oq-bg-eef3f8)' : 'var(--oq-bg-ffffff)', border: '1px solid ' + (pinned ? 'var(--oq-ln-c5d3e1)' : 'var(--oq-ln-e5e7eb)'), borderRadius: '6px', cursor: 'pointer', color: pinned ? 'var(--oq-fg-1f4e79)' : 'var(--oq-fg-6b7280)', fontSize: '10.5px', fontWeight: '600', padding: '4px 7px', whiteSpace: 'nowrap', flexShrink: 0 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3H7l3-3z"/></svg>
              {pinned ? 'Pinned' : 'Keep open'}
            </button>
          ) : null}
        </div>
        <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {items.map(function (item) {
            if (item.header) {
              return open
                ? <div key={item.header} style={{ margin: '10px 2px 2px', padding: '0 8px', fontSize: '10.5px', fontWeight: '800', letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--oq-fg-9ca3af)', whiteSpace: 'nowrap' }}>{item.header}</div>
                : <div key={item.header} title={item.header} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '36px', margin: '6px 0 0', borderRadius: '8px', color: groupActive(item) ? 'var(--oq-fg-1f4e79)' : 'var(--oq-fg-9ca3af)', background: groupActive(item) ? 'var(--oq-bg-eef3f8)' : 'none' }}>
                    <NavIcon name={item.icon} />
                  </div>;
            }
            if (!open && item.child) return null;
            return (
              <NavLink key={item.to} to={item.to} title={item.label} end={item.to === '/requests'}
                style={function (a) { return { display: 'flex', alignItems: 'center', gap: '10px', justifyContent: open ? 'flex-start' : 'center', padding: open ? '8px 10px' : '8px 0', paddingLeft: open && item.child ? '22px' : (open ? '10px' : '0'), borderRadius: '8px', textDecoration: 'none', fontSize: '13px', fontWeight: a.isActive ? '600' : '500', color: navColor(a.isActive), background: a.isActive ? 'var(--oq-bg-eef3f8)' : 'none', whiteSpace: 'nowrap', minHeight: '36px', boxSizing: 'border-box' }; }}>
                {item.icon ? <NavIcon name={item.icon} /> : null}
                {open ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span> : null}
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <header style={{ background: 'var(--oq-bg-ffffff)', borderBottom: '1px solid var(--oq-ln-e5e7eb)', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, height: '57px', boxSizing: 'border-box' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--oq-fg-9ca3af)' }}>{agencyName} · Public Records Management</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <NavLink to="/my-tasks" style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 12px', borderRadius: '8px', textDecoration: 'none', fontSize: '13px', fontWeight: '600', color: isActive ? 'var(--oq-fg-1f4e79)' : 'var(--oq-fg-374151)', background: isActive ? 'var(--oq-bg-eef3f8)' : 'var(--oq-bg-f3f4f6)', border: '1px solid ' + (isActive ? 'var(--oq-ln-c5d3e1)' : 'var(--oq-ln-e5e7eb)') })}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              My Tasks
              {taskCount > 0 ? <span style={{ minWidth: '18px', height: '18px', padding: '0 5px', borderRadius: '999px', fontSize: '11px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--oq-fg-ffffff)', background: overdueCount > 0 ? 'var(--oq-bg-dc2626)' : 'var(--oq-bg-1f4e79)' }}>{taskCount}</span> : null}
            </NavLink>
            <NotificationBell />
            <HelpAssistant />
            <div style={{ position: 'relative' }}>
              <button onClick={function () { setUMenu(!uMenu); }} aria-label="Account menu"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px 4px 4px', borderRadius: '8px', background: uMenu ? 'var(--oq-bg-f3f4f6)' : 'none', border: '1px solid ' + (uMenu ? 'var(--oq-ln-e5e7eb)' : 'transparent'), cursor: 'pointer' }}>
                <div style={{ width: '28px', height: '28px', background: 'var(--oq-bg-1f4e79)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--oq-fg-ffffff)', fontSize: '12px', fontWeight: '700', flexShrink: 0 }}>
                  {user?.display_name?.[0]?.toUpperCase() || 'U'}
                </div>
                <div style={{ textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--oq-fg-111111)', whiteSpace: 'nowrap' }}>{user?.display_name}</div>
                  <div style={{ fontSize: '10.5px', color: 'var(--oq-fg-9ca3af)', whiteSpace: 'nowrap' }}>{user?.userTypes?.[0]?.displayName || (user?.userTypes?.length === 0 ? 'No user type' : '')}</div>
                </div>
              </button>
              {uMenu ? (
                <div style={{ position: 'absolute', right: 0, top: '44px', minWidth: '240px', background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 50 }}>
                  {/* DISPLAY (Kevin 2026-09-13, docs/SPEC_display_theme.md): three colour schemes, standard by default.
                      The choice applies at once, is remembered in this browser and saved on the account. */}
                  <div style={{ padding: '9px 12px 4px', fontSize: '10.5px', fontWeight: '800', letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--oq-fg-9ca3af)' }}>Display</div>
                  <div role="radiogroup" aria-label="Display colours">
                    {THEMES.map(function (t) {
                      var on = theme === t.key;
                      return (
                        <button key={t.key} role="radio" aria-checked={on} onClick={function () { pickTheme(t.key); }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: on ? 'var(--oq-bg-eef3f8)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: on ? 'var(--oq-fg-1f4e79)' : 'var(--oq-fg-374151)' }}>
                          <span aria-hidden="true" style={{ width: '15px', height: '15px', borderRadius: '50%', boxSizing: 'border-box', flexShrink: 0, border: on ? '5px solid var(--oq-ln-1f4e79)' : '2px solid var(--oq-ln-9ca3af)', background: 'var(--oq-bg-ffffff)' }} />
                          <span>
                            <span style={{ display: 'block', fontSize: '13px', fontWeight: on ? '600' : '500' }}>{t.label}</span>
                            <span style={{ display: 'block', fontSize: '11px', color: on ? 'var(--oq-fg-1f4e79)' : 'var(--oq-fg-6b7280)' }}>{t.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {themeErr ? <div style={{ padding: '4px 12px 6px', fontSize: '11px', color: 'var(--oq-fg-dc2626)' }}>{themeErr}</div> : null}
                  <div style={{ height: '1px', background: 'var(--oq-ln-f3f4f6)', margin: '4px 0' }} />
                  <button onClick={async () => { await store.logout(); nav('/login'); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--oq-fg-dc2626)', fontSize: '13px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Sign Out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px' }}><Outlet /></main>
      </div>
    </div>
  );
}

// Rail icons (stroke outlines, 18px). One per top-level item / group; children carry none.
const ICONS = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  inbox: <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>,
  desk: <><path d="M3 20h18"/><path d="M5 20v-7h14v7"/><path d="M8 13V9a4 4 0 0 1 8 0v4"/><path d="M12 4v1"/></>,
  chart: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
  org: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  globe: <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>,
  clock: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
  scale: <><line x1="12" y1="3" x2="12" y2="21"/><path d="M5 7h14"/><path d="M3 15l2.5-6 2.5 6a2.5 2.5 0 0 1-5 0z"/><path d="M16 15l2.5-6 2.5 6a2.5 2.5 0 0 1-5 0z"/><path d="M8 21h8"/></>,
  sliders: <><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>,
};
function NavIcon(props) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>{ICONS[props.name] || null}</svg>;
}
