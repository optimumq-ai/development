import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import { Link } from 'react-router-dom';

var CAT_COLORS = {
  privacy: { bg: '#DBEAFE', fg: '#1E40AF' },
  law_enforcement: { bg: '#FEE2E2', fg: '#991B1B' },
  health: { bg: '#D1FAE5', fg: '#065F46' },
  legal: { bg: '#EDE9FE', fg: '#5B21B6' },
  personnel: { bg: '#E0E7FF', fg: '#3730A3' },
  commercial: { bg: '#FEF3C7', fg: '#92400E' },
  security: { bg: '#E2E8F0', fg: '#334155' },
  administrative: { bg: '#F3F4F6', fg: '#374151' }
};
var STATUS = {
  approved: { label: 'Approved', bg: '#DEF7EC', fg: '#03543F' },
  pending_review: { label: 'Pending Review', bg: '#FEF3C7', fg: '#92400E' },
  rejected: { label: 'Rejected', bg: '#FDE8E8', fg: '#9B1C1C' }
};

function Shield(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={props.color || '#6B7280'} strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function Chevron(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"
      style={{ transform: props.open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s' }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function Scale() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1F4E79" strokeWidth="2">
      <path d="M12 3v18M5 7h14M7 7l-3 7h6l-3-7zM17 7l-3 7h6l-3-7z" />
    </svg>
  );
}
function Pill(props) {
  return <span style={{ background: props.bg, color: props.fg, fontSize: '11px', fontWeight: '700', padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{props.children}</span>;
}

export default function RedactionRulesPage() {
  var [rules, setRules] = useState([]);
  var [stats, setStats] = useState({ total: 0, active: 0, pending: 0, categories: 0 });
  var [cats, setCats] = useState([]);
  var [loading, setLoading] = useState(true);
  var [filter, setFilter] = useState('all');
  var [expanded, setExpanded] = useState({});
  var [busy, setBusy] = useState({});
  var [showAdd, setShowAdd] = useState(false);
  var [addForm, setAddForm] = useState({ title: '', description: '', legal_basis: '', category: 'privacy' });
  var [adding, setAdding] = useState(false);
  var [showSources, setShowSources] = useState(false);
  var [sources, setSources] = useState(null);
  var [srcOpen, setSrcOpen] = useState({});
  var [discovering, setDiscovering] = useState(false);
  var [notice, setNotice] = useState(null);
  var [tplReminder, setTplReminder] = useState(false);
  var [tplRemindedOnce, setTplRemindedOnce] = useState(false);
  function remindTemplates() { if (!tplRemindedOnce) { setTplReminder(true); setTplRemindedOnce(true); } }

  useEffect(function () { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      var r = await Promise.all([api.get('/redaction/rules'), api.get('/redaction/categories')]);
      setRules(r[0].data.rules); setStats(r[0].data.stats); setCats(r[1].data.categories);
    } catch (e) { console.error(e); }
    setLoading(false);
  }
  function catLabel(key) { var c = cats.filter(function (x) { return x.key === key; })[0]; return c ? c.label : key; }
  function setB(id, v) { setBusy(function (b) { var n = Object.assign({}, b); n[id] = v; return n; }); }
  function toggle(id) { setExpanded(function (e) { var n = Object.assign({}, e); n[id] = !n[id]; return n; }); }

  async function approve(id) { setB(id, true); try { await api.patch('/redaction/rules/' + id + '/approve'); await load(); remindTemplates(); } catch (e) { alert('Approve failed (supervisor role required).'); } setB(id, false); }
  async function toggleActive(r) { setB(r.id, true); try { await api.patch('/redaction/rules/' + r.id, { is_active: !r.is_active }); await load(); remindTemplates(); } catch (e) { alert('Update failed (supervisor role required).'); } setB(r.id, false); }
  async function del(r) { if (!window.confirm('Permanently delete "' + r.title + '"? This cannot be undone.')) return; setB(r.id, true); try { await api.delete('/redaction/rules/' + r.id); await load(); remindTemplates(); } catch (e) { alert('Delete failed (supervisor role required).'); } setB(r.id, false); }
  async function submitAdd() {
    if (!addForm.title.trim() || !addForm.description.trim()) return;
    setAdding(true);
    try { await api.post('/redaction/rules', addForm); setShowAdd(false); setAddForm({ title: '', description: '', legal_basis: '', category: 'privacy' }); await load(); remindTemplates(); }
    catch (e) { alert('Could not add rule.'); }
    setAdding(false);
  }
  async function openSources() {
    setShowSources(true); setSources(null);
    try { var r = await api.get('/redaction/legal-sources'); setSources(r.data); var o = {}; if (r.data.sources[0]) o[r.data.sources[0].id] = true; setSrcOpen(o); }
    catch (e) { console.error(e); }
  }

  async function discover() {
    setDiscovering(true); setNotice(null);
    try {
      var r = await api.post('/redaction/discover');
      await load();
      setFilter('pending');
      setNotice(r.data.added > 0 ? ('Added ' + r.data.added + ' AI-suggested rule(s) as Pending Review. Verify each citation against current law, then approve or delete.') : 'No new exemptions were found to add.');
    } catch (e) { setNotice('Auto-populate failed (supervisor role required).'); }
    setDiscovering(false);
  }

  var shown = rules.filter(function (r) {
    if (filter === 'all') return true;
    if (filter === 'pending') return r.approval_status === 'pending_review';
    return r.category === filter;
  });

  var tabBtn = function (key, label, badge) {
    var active = filter === key;
    return (
      <button key={key} onClick={function () { setFilter(key); }}
        style={{ padding: '6px 13px', borderRadius: '20px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', border: '1px solid ' + (active ? '#1F4E79' : '#E5E7EB'), background: active ? '#1F4E79' : 'white', color: active ? 'white' : '#6B7280', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        {label}
        {badge > 0 ? <span style={{ background: '#F59E0B', color: 'white', borderRadius: '10px', fontSize: '10px', padding: '1px 6px' }}>{badge}</span> : null}
      </button>
    );
  };

  return (
    <div style={{ padding: '28px 32px', maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '20px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 6px' }}>Redaction Rules Library</h1>
          <p style={{ color: '#6B7280', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>The redaction rules library defines what information must be withheld or redacted from public records before release. Rules are applied during AI redaction review and staff processing. All changes are logged.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button onClick={openSources} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>View Legal Sources</button>
          <button disabled={discovering} onClick={discover} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '13px', fontWeight: '600', cursor: discovering ? 'wait' : 'pointer' }}>{discovering ? 'Checking...' : 'Check for Updates'}</button>
          <button onClick={load} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Refresh</button>
          <button onClick={function () { setShowAdd(true); }} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>+ Add Rule</button>
        </div>
      </div>

      {notice ? (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', color: '#1E40AF', flex: 1 }}>{notice}</span>
          <button onClick={function () { setNotice(null); }} style={{ border: 'none', background: 'transparent', color: '#1E40AF', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>&times;</button>
        </div>
      ) : null}

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px', background: 'white', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px 18px' }}>
          <div style={{ fontSize: '26px', fontWeight: '700', color: '#111' }}>{stats.total}</div>
          <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Total Rules</div>
        </div>
        <div style={{ flex: '1 1 160px', background: 'white', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px 18px' }}>
          <div style={{ fontSize: '26px', fontWeight: '700', color: '#059669' }}>{stats.active}</div>
          <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Active Rules</div>
        </div>
        <div style={{ flex: '1 1 160px', background: 'white', border: '1px solid ' + (stats.pending > 0 ? '#F59E0B' : '#E5E7EB'), borderRadius: '10px', padding: '14px 18px' }}>
          <div style={{ fontSize: '26px', fontWeight: '700', color: stats.pending > 0 ? '#B45309' : '#111' }}>{stats.pending}</div>
          <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Pending Review</div>
        </div>
        <div style={{ flex: '1 1 160px', background: 'white', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px 18px' }}>
          <div style={{ fontSize: '26px', fontWeight: '700', color: '#111' }}>{stats.categories}</div>
          <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Categories</div>
        </div>
      </div>

      {/* Auto-update notice */}
      <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '10px', padding: '12px 16px', marginBottom: '18px', display: 'flex', gap: '10px' }}>
        <div style={{ flexShrink: 0, marginTop: '1px' }}><Scale /></div>
        <p style={{ margin: 0, fontSize: '12.5px', color: '#1E40AF', lineHeight: 1.5 }}>
          <strong>Keeping Rules Current:</strong> Toggle "Auto-Check for Updates" in System Settings to have the system periodically search for new open records exemption laws and regulations. New content is held for your review before activation. Alternatively, enable the 6-month email reminder to prompt a manual review. All rule changes are recorded in the activity log.
        </p>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {tabBtn('all', 'All Rules', 0)}
        {tabBtn('pending', 'Pending Review', stats.pending)}
        {cats.map(function (c) { return tabBtn(c.key, c.label, 0); })}
      </div>

      {/* Rules list */}
      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF' }}>Loading rules...</div>
      ) : shown.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF' }}>No rules in this view.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {shown.map(function (r) {
            var open = !!expanded[r.id];
            var cc = CAT_COLORS[r.category] || CAT_COLORS.administrative;
            var st = STATUS[r.approval_status] || STATUS.pending_review;
            return (
              <div key={r.id} style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,.04)', opacity: r.is_active ? 1 : 0.6 }}>
                <div onClick={function () { toggle(r.id); }} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', cursor: 'pointer' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: cc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Shield color={cc.fg} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: '700', fontSize: '14.5px', color: '#1F4E79' }}>{r.title}</span>
                      <Pill bg={cc.bg} fg={cc.fg}>{r.category_label}</Pill>
                      <Pill bg={st.bg} fg={st.fg}>{st.label}</Pill>
                      {r.source === 'ai' ? <Pill bg="#EDE9FE" fg="#5B21B6">AI-suggested</Pill> : null}
                      {!r.is_active ? <Pill bg="#F3F4F6" fg="#6B7280">Inactive</Pill> : null}
                    </div>
                    {!open ? <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.description}</div> : null}
                  </div>
                  <Chevron open={open} />
                </div>
                {open ? (
                  <div style={{ borderTop: '1px solid #F3F4F6', padding: '14px 18px' }}>
                    <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5, marginBottom: '12px' }}>{r.description}</div>
                    <div style={{ fontSize: '12px', color: '#9CA3AF', fontWeight: '600', marginBottom: '4px' }}>Legal Basis / Citation</div>
                    <div style={{ fontSize: '13px', color: '#111', marginBottom: '12px' }}>
                      {r.legal_sources.length ? r.legal_sources.map(function (s) { return s.citation; }).join('; ') : <span style={{ color: '#9CA3AF' }}>No legal citation provided</span>}
                    </div>
                    {r.effective_date ? <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '12px' }}>Effective: {r.effective_date}</div> : null}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button disabled={!!busy[r.id]} onClick={function () { toggleActive(r); }} style={{ padding: '7px 13px', borderRadius: '7px', fontSize: '12.5px', fontWeight: '600', cursor: 'pointer', border: '1px solid ' + (r.is_active ? '#E5E7EB' : '#1F4E79'), background: r.is_active ? 'white' : '#1F4E79', color: r.is_active ? '#6B7280' : 'white' }}>{r.is_active ? 'Deactivate Rule' : 'Activate Rule'}</button>
                      {r.approval_status === 'pending_review' ? <button disabled={!!busy[r.id]} onClick={function () { approve(r.id); }} style={{ padding: '7px 13px', borderRadius: '7px', fontSize: '12.5px', fontWeight: '600', cursor: 'pointer', border: 'none', background: '#059669', color: 'white' }}>Approve Rule</button> : null}
                      <button disabled={!!busy[r.id]} onClick={function () { del(r); }} style={{ padding: '7px 13px', borderRadius: '7px', fontSize: '12.5px', fontWeight: '600', cursor: 'pointer', border: '1px solid #FCA5A5', background: 'white', color: '#B91C1C' }}>Delete</button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Rule modal */}
      {showAdd ? (
        <div onClick={function () { setShowAdd(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.45)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '14px', padding: '24px', width: '440px', maxWidth: '92vw', boxShadow: '0 10px 40px rgba(0,0,0,.2)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 16px' }}>Add Redaction Rule</h2>
            <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Rule Title *</label>
            <input value={addForm.title} onChange={function (e) { var v = e.target.value; setAddForm(function (f) { return Object.assign({}, f, { title: v }); }); }} placeholder="e.g. Social Security Numbers"
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '14px', margin: '6px 0 14px', outline: 'none' }} />
            <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Description *</label>
            <textarea value={addForm.description} onChange={function (e) { var v = e.target.value; setAddForm(function (f) { return Object.assign({}, f, { description: v }); }); }} rows={3} placeholder="Describe what must be redacted and under what circumstances..."
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '14px', margin: '6px 0 14px', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
            <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Legal Basis / Citation</label>
            <input value={addForm.legal_basis} onChange={function (e) { var v = e.target.value; setAddForm(function (f) { return Object.assign({}, f, { legal_basis: v }); }); }} placeholder="e.g. Tex. Gov't Code Sec. 552.147 (separate multiple with ;)"
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '14px', margin: '6px 0 14px', outline: 'none' }} />
            <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Category</label>
            <select value={addForm.category} onChange={function (e) { var v = e.target.value; setAddForm(function (f) { return Object.assign({}, f, { category: v }); }); }}
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '14px', margin: '6px 0 14px', outline: 'none', background: 'white' }}>
              {cats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}
            </select>
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#1E40AF', marginBottom: '16px', lineHeight: 1.5 }}>
              New rules are added with "Pending Review" status and must be approved by an authorized supervisor before being applied to redaction review.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={function () { setShowAdd(false); }} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
              <button disabled={adding || !addForm.title.trim() || !addForm.description.trim()} onClick={submitAdd}
                style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: (adding || !addForm.title.trim() || !addForm.description.trim()) ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>{adding ? 'Adding...' : 'Add Rule'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Legal Source Index modal */}
      {showSources ? (
        <div onClick={function () { setShowSources(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.45)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '40px 16px', overflowY: 'auto' }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '14px', width: '720px', maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,.2)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 4px' }}>Redaction Rules &mdash; Legal Source Index</h2>
                <p style={{ margin: 0, fontSize: '13px', color: '#6B7280' }}>Statutes, regulations, and case law that authorize each redaction category.</p>
              </div>
              <button onClick={function () { setShowSources(false); }} style={{ border: 'none', background: 'transparent', fontSize: '20px', color: '#9CA3AF', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
            </div>
            {!sources ? <div style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>Loading...</div> : (
              <div style={{ overflowY: 'auto' }}>
                <div style={{ display: 'flex', gap: '20px', padding: '12px 24px', background: '#F9FAFB', borderBottom: '1px solid #F3F4F6', fontSize: '12.5px', color: '#6B7280', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span><strong style={{ color: '#111' }}>{stats.total}</strong> rules total</span>
                  <span><strong style={{ color: '#059669' }}>{stats.active}</strong> active</span>
                  <span><strong style={{ color: '#111' }}>{rules.filter(function (r) { return r.approval_status === 'approved'; }).length}</strong> approved</span>
                  <span><strong style={{ color: '#111' }}>{sources.total_sources}</strong> distinct legal sources</span>
                  <span style={{ marginLeft: 'auto', fontStyle: 'italic', color: '#9CA3AF' }}>Built-in statutory defaults &middot; Upload your agency's ordinance to customize</span>
                </div>
                <div style={{ padding: '12px 24px 20px' }}>
                  {sources.sources.map(function (s) {
                    var o = !!srcOpen[s.id];
                    var approved = s.rules.filter(function (x) { return x.approval_status === 'approved'; }).length;
                    var pending = s.rules.length - approved;
                    return (
                      <div key={s.id} style={{ border: '1px solid #E5E7EB', borderRadius: '10px', marginBottom: '8px', overflow: 'hidden' }}>
                        <div onClick={function () { setSrcOpen(function (m) { var n = Object.assign({}, m); n[s.id] = !n[s.id]; return n; }); }} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', cursor: 'pointer' }}>
                          <Scale />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: '700', fontSize: '14px', color: '#111' }}>{s.citation}</div>
                            <div style={{ fontSize: '12px', color: '#9CA3AF' }}>{s.rules.length} rule{s.rules.length !== 1 ? 's' : ''} &middot; {approved} approved{pending ? ' / ' + pending + ' pending' : ''}</div>
                          </div>
                          <Chevron open={o} />
                        </div>
                        {o ? (
                          <div style={{ borderTop: '1px solid #F3F4F6', padding: '8px 16px 12px' }}>
                            {s.rules.map(function (rr) {
                              var cc = CAT_COLORS[rr.category] || CAT_COLORS.administrative;
                              var st = STATUS[rr.approval_status] || STATUS.pending_review;
                              return (
                                <div key={rr.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0' }}>
                                  <div style={{ width: '26px', height: '26px', borderRadius: '7px', background: cc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Shield color={cc.fg} /></div>
                                  <span style={{ fontSize: '13px', color: '#111', flex: 1 }}>{rr.title}</span>
                                  <Pill bg={st.bg} fg={st.fg}>{st.label}</Pill>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tplReminder ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 60 }} onClick={function () { setTplReminder(false); }}>
          <div style={{ background: 'white', borderRadius: '12px', maxWidth: '520px', width: '100%', padding: '24px' }} onClick={function (e) { e.stopPropagation(); }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111', margin: '0 0 12px' }}>Remember to check your redaction templates</h2>
            <div style={{ background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: '8px', padding: '14px 16px', fontSize: '13px', color: '#92400E', lineHeight: 1.55 }}>
              You changed a redaction rule. The redaction rules engine affects <strong>template creation and document redaction going forward only</strong> &mdash; it does not change documents already redacted, and it does not automatically update existing redaction templates. If this change should also apply to mass redaction, update the affected redaction template(s) so they match.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <Link to="/mass-redaction" style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#1F4E79', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>Go to templates</Link>
              <button onClick={function () { setTplReminder(false); }} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Got it</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
