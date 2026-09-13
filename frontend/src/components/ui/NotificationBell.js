import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';

// The notification bell (Tasks spec §1-2). Notifications are request-independent heads-ups — a title + body +
// a link to a screen, no completion UI. This is the minimal surface; the full My-Tasks notifications area is
// item #8. Polls every 60s, mirroring the task-count loader in AppLayout.
export default function NotificationBell() {
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  async function load() {
    try { const r = await api.get('/notifications'); setItems(r.data.notifications || []); setUnread(r.data.unread || 0); }
    catch (e) { /* ignore */ }
  }
  useEffect(function () {
    load();
    const t = setInterval(load, 60000);
    // lib/api fires this after any successful write — an approval withdraws its notice at once, a save that
    // completes a setup screen shows the owner's notice at once.
    window.addEventListener('oq:notifications-changed', load);
    return function () { clearInterval(t); window.removeEventListener('oq:notifications-changed', load); };
  }, []);
  useEffect(function () {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return function () { document.removeEventListener('mousedown', onDoc); };
  }, []);

  async function openItem(n) {
    try { await api.post('/notifications/' + n.id + '/read'); } catch (e) {}
    setUnread(function (u) { return Math.max(0, u - (n.read_at ? 0 : 1)); });
    setItems(function (list) { return list.map(function (x) { return x.id === n.id ? Object.assign({}, x, { read_at: x.read_at || 'now' }) : x; }); });
    if (n.link) { setOpen(false); if (/^https?:\/\//.test(n.link)) window.location.href = n.link; else nav(n.link); }
  }
  async function dismiss(e, n) {
    e.stopPropagation();
    try { await api.post('/notifications/' + n.id + '/dismiss'); } catch (e2) {}
    setItems(function (list) { return list.filter(function (x) { return x.id !== n.id; }); });
    if (!n.read_at) setUnread(function (u) { return Math.max(0, u - 1); });
  }
  async function markAll() { try { await api.post('/notifications/read-all'); } catch (e) {} setUnread(0); setItems(function (l) { return l.map(function (x) { return Object.assign({}, x, { read_at: x.read_at || 'now' }); }); }); }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button onClick={function () { setOpen(function (o) { return !o; }); }} aria-label="Notifications"
        style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '34px', borderRadius: '8px', background: open ? 'var(--oq-bg-f3f4f6)' : 'none', border: '1px solid ' + (open ? 'var(--oq-ln-e5e7eb)' : 'transparent'), cursor: 'pointer', color: 'var(--oq-fg-374151)' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        {unread > 0 ? <span style={{ position: 'absolute', top: '2px', right: '2px', minWidth: '16px', height: '16px', padding: '0 4px', borderRadius: '999px', fontSize: '10px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--oq-fg-ffffff)', background: 'var(--oq-bg-dc2626)' }}>{unread}</span> : null}
      </button>
      {open ? (
        <div style={{ position: 'absolute', right: 0, top: '40px', width: '340px', maxHeight: '420px', overflowY: 'auto', background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 50 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--oq-ln-f3f4f6)' }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--oq-fg-111111)' }}>Notifications</div>
            {unread > 0 ? <button onClick={markAll} style={{ fontSize: '11px', color: 'var(--oq-fg-1f4e79)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>Mark all read</button> : null}
          </div>
          {items.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: '12px', color: 'var(--oq-fg-9ca3af)' }}>You're all caught up.</div>
          ) : items.map(function (n) {
            return (
              <div key={n.id} onClick={function () { openItem(n); }}
                style={{ display: 'flex', gap: '8px', padding: '10px 12px', borderBottom: '1px solid var(--oq-ln-f9fafb)', cursor: n.link ? 'pointer' : 'default', background: n.read_at ? 'var(--oq-bg-ffffff)' : 'var(--oq-bg-f5f9ff)' }}>
                {!n.read_at ? <span style={{ marginTop: '5px', width: '7px', height: '7px', borderRadius: '999px', background: 'var(--oq-bg-1f4e79)', flexShrink: 0 }} /> : <span style={{ width: '7px', flexShrink: 0 }} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '12.5px', fontWeight: '600', color: 'var(--oq-fg-111111)' }}>{n.title}</div>
                  {n.body ? <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-6b7280)', marginTop: '2px' }}>{n.body}</div> : null}
                  <div style={{ fontSize: '10.5px', color: 'var(--oq-fg-9ca3af)', marginTop: '3px' }}>{(n.created_at || '').replace('T', ' ').slice(0, 16)}</div>
                </div>
                <button onClick={function (e) { dismiss(e, n); }} aria-label="Dismiss this notification" title="Remove this notification from your list"
                  style={{ alignSelf: 'flex-start', flexShrink: 0, background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-d1d5db)', borderRadius: '6px', color: 'var(--oq-fg-374151)', fontSize: '11px', fontWeight: '600', lineHeight: 1, padding: '5px 8px', cursor: 'pointer' }}>Dismiss</button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
