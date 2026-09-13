import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../lib/api';

var PAGE_LABELS = {
  '/dashboard': 'Dashboard', '/requests': 'Request Queue', '/my-tasks': 'My Tasks',
  '/reports': 'Reports', '/staff': 'Staff Management', '/departments': 'City Departments & Teams',
  '/mass-redaction': 'Mass Redaction',
  '/released': 'Released Records', '/library-map': 'Records Map',
  '/cash-drawer': 'Cash Drawer', '/tickler': 'Tickler',
  '/admin': 'Administration' // the 13 technical-setup screens, tabbed (menu reorganization 2026-08-01)
};
var EXAMPLES = [
  'How do I bulk-redact a set of records?',
  'How do I build a redaction template?',
  'How does a request get routed to a department?'
];

export default function HelpAssistant() {
  var [open, setOpen] = useState(false);
  var [msgs, setMsgs] = useState([]);
  var [input, setInput] = useState('');
  var [busy, setBusy] = useState(false);
  var loc = useLocation();
  var endRef = useRef(null);
  useEffect(function () { if (open && endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' }); }, [msgs, open, busy]);

  function pageLabel() {
    var p = loc.pathname || '';
    var best = null, bestLen = 0;
    for (var k in PAGE_LABELS) { if (p.indexOf(k) === 0 && k.length > bestLen) { best = PAGE_LABELS[k]; bestLen = k.length; } }
    return best;
  }
  async function send(q) {
    q = (q != null ? q : input).trim();
    if (!q || busy) return;
    var next = msgs.concat([{ role: 'user', content: q }]);
    setMsgs(next); setInput(''); setBusy(true);
    try {
      var r = await api.post('/help/ask', { messages: next, page: pageLabel() });
      setMsgs(next.concat([{ role: 'assistant', content: (r.data && r.data.answer) || 'Sorry, I could not answer that.' }]));
    } catch (e) { setMsgs(next.concat([{ role: 'assistant', content: 'The help assistant is unavailable right now.' }])); }
    setBusy(false);
  }
  function fmt(text) {
    var h = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return { __html: h };
  }

  return (
    <React.Fragment>
      <button onClick={function () { setOpen(true); }} title="AI Help" style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--oq-ln-e5e7eb)', background: 'var(--oq-bg-f3f4f6)', color: 'var(--oq-fg-374151)', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        AI Help
      </button>

      {open ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={function () { setOpen(false); }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.25)' }} />
          <div style={{ position: 'relative', width: '400px', maxWidth: '100%', height: '100%', background: 'var(--oq-bg-ffffff)', boxShadow: '-4px 0 24px rgba(0,0,0,.12)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--oq-ln-f3f4f6)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: 'var(--oq-bg-1f4e79)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--oq-fg-ffffff)" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: '700', fontSize: '14px', color: 'var(--oq-fg-111111)' }}>AI Help</div>
                <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-9ca3af)' }}>Ask how to use Optimum Q</div>
              </div>
              <button onClick={function () { setOpen(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--oq-fg-9ca3af)', fontSize: '18px', lineHeight: 1 }}>&times;</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {msgs.length === 0 ? (
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--oq-fg-374151)', lineHeight: 1.5, marginBottom: '14px' }}>
                    Hi! I can help you find your way around Optimum Q &mdash; where to go and how to do things. Ask me anything, or try one of these:
                  </div>
                  {EXAMPLES.map(function (ex, i) {
                    return <button key={i} onClick={function () { send(ex); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: '8px', borderRadius: '8px', border: '1px solid var(--oq-ln-e5e7eb)', background: 'var(--oq-bg-f9fafb)', color: 'var(--oq-fg-1f4e79)', fontSize: '12.5px', fontWeight: '600', cursor: 'pointer' }}>{ex}</button>;
                  })}
                </div>
              ) : null}
              {msgs.map(function (m, i) {
                var isUser = m.role === 'user';
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '86%', padding: '9px 13px', borderRadius: '12px', fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap', color: isUser ? 'var(--oq-fg-ffffff)' : 'var(--oq-fg-1f2937)', background: isUser ? 'var(--oq-bg-1f4e79)' : 'var(--oq-bg-f3f4f6)' }} dangerouslySetInnerHTML={isUser ? undefined : fmt(m.content)}>
                      {isUser ? m.content : undefined}
                    </div>
                  </div>
                );
              })}
              {busy ? <div style={{ fontSize: '12px', color: 'var(--oq-fg-9ca3af)' }}>Thinking&hellip;</div> : null}
              <div ref={endRef} />
            </div>

            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--oq-ln-f3f4f6)', display: 'flex', gap: '8px' }}>
              <input value={input} onChange={function (e) { setInput(e.target.value); }} onKeyDown={function (e) { if (e.key === 'Enter') send(); }} placeholder="Ask a question&hellip;" style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--oq-ln-e5e7eb)', fontSize: '13px', outline: 'none' }} />
              <button onClick={function () { send(); }} disabled={busy || !input.trim()} style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: (busy || !input.trim()) ? 'var(--oq-bg-9cb4cc)' : 'var(--oq-bg-1f4e79)', color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: '700', cursor: (busy || !input.trim()) ? 'default' : 'pointer' }}>Send</button>
            </div>
          </div>
        </div>
      ) : null}
    </React.Fragment>
  );
}
