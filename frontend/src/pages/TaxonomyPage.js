import React, { useEffect, useState } from 'react';
import api from '../lib/api';

var AVAIL = {
  releasable: { label: 'Releasable', bg: '#DEF7EC', fg: '#03543F' },
  review_required: { label: 'Review required', bg: '#FEF3C7', fg: '#92400E' },
  restricted: { label: 'Restricted', bg: '#FDE8E8', fg: '#9B1C1C' },
  confidential: { label: 'Confidential', bg: '#FDE8E8', fg: '#9B1C1C' }
};
var FILTERS = [
  { k: 'all', label: 'All' },
  { k: 'auto', label: 'Auto-release' },
  { k: 'releasable', label: 'Releasable' },
  { k: 'review', label: 'Review required' },
  { k: 'sensitive', label: 'Restricted / confidential' }
];

export default function TaxonomyPage() {
  var [cats, setCats] = useState([]);
  var [types, setTypes] = useState([]);
  var [loading, setLoading] = useState(true);
  var [q, setQ] = useState('');
  var [filter, setFilter] = useState('all');
  var [collapsed, setCollapsed] = useState({});

  useEffect(function() { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      var r = await Promise.all([api.get('/taxonomy/categories'), api.get('/taxonomy/record-types')]);
      setCats(r[0].data.categories);
      setTypes(r[1].data.record_types);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  function matchFilter(t) {
    if (filter === 'all') return true;
    if (filter === 'auto') return t.auto_release_eligible === 1;
    if (filter === 'releasable') return t.public_availability === 'releasable';
    if (filter === 'review') return t.public_availability === 'review_required';
    if (filter === 'sensitive') return t.public_availability === 'restricted' || t.public_availability === 'confidential';
    return true;
  }
  function matchSearch(t) {
    if (!q.trim()) return true;
    var s = q.toLowerCase();
    var hay = [t.name, (t.synonyms || []).join(' '), (t.keywords || []).join(' '), t.category_name || ''].join(' ').toLowerCase();
    return hay.indexOf(s) >= 0;
  }
  function visible(t) { return matchFilter(t) && matchSearch(t); }
  function toggle(id) { setCollapsed(function(c) { var n = Object.assign({}, c); n[id] = !n[id]; return n; }); }

  var shown = types.filter(visible);
  var autoCount = types.filter(function(t){ return t.auto_release_eligible === 1; }).length;
  var reviewCount = types.filter(function(t){ return t.public_availability === 'review_required'; }).length;
  var sensCount = types.filter(function(t){ return t.public_availability === 'restricted' || t.public_availability === 'confidential'; }).length;

  function ownerFor(catId) {
    var names = {};
    types.forEach(function(t){ if (t.category_id === catId && t.owner_department_name) names[t.owner_department_name] = 1; });
    var keys = Object.keys(names);
    if (keys.length === 1) return keys[0];
    if (keys.length > 1) return keys.length + ' departments';
    return null;
  }

  function pill(bg, fg, text) {
    return React.createElement('span', { style: { background: bg, color: fg, fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap' } }, text);
  }

  return (
    <div style={{ maxWidth: '960px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 4px' }}>Taxonomy</h1>
        <p style={{ color: '#9CA3AF', fontSize: '14px', margin: 0 }}>{types.length} record types across {cats.filter(function(c){ return types.some(function(t){ return t.category_id === c.id; }); }).length} categories</p>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {[['Total types', types.length], ['Auto-release', autoCount], ['Review required', reviewCount], ['Restricted / conf.', sensCount]].map(function(c) {
          return (
            <div key={c[0]} style={{ flex: '1 1 140px', background: 'white', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '12px 16px' }}>
              <div style={{ fontSize: '12px', color: '#9CA3AF' }}>{c[0]}</div>
              <div style={{ fontSize: '22px', fontWeight: '700', color: '#111', marginTop: '2px' }}>{c[1]}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
        <input value={q} onChange={function(e){ setQ(e.target.value); }} placeholder="Search names, synonyms, keywords..."
          style={{ flex: '1 1 240px', padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '14px', outline: 'none' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {FILTERS.map(function(f) {
            var active = filter === f.k;
            return (
              <button key={f.k} onClick={function(){ setFilter(f.k); }}
                style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', border: '1px solid ' + (active ? '#1F4E79' : '#E5E7EB'), background: active ? '#D6E4F0' : 'white', color: active ? '#1F4E79' : '#6B7280' }}>
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF' }}>Loading taxonomy...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {cats.map(function(cat) {
            var catTypes = shown.filter(function(t){ return t.category_id === cat.id; });
            if (catTypes.length === 0) return null;
            var isCollapsed = collapsed[cat.id];
            var owner = ownerFor(cat.id);
            return (
              <div key={cat.id} style={{ background: 'white', borderRadius: '12px', border: '1px solid #E5E7EB', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                <div onClick={function(){ toggle(cat.id); }} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px', cursor: 'pointer' }}
                  onMouseOver={function(e){ e.currentTarget.style.background = '#F9FAFB'; }}
                  onMouseOut={function(e){ e.currentTarget.style.background = 'white'; }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: '700', fontSize: '15px', color: '#111' }}>{cat.name}</span>
                      <span style={{ fontSize: '12px', color: '#9CA3AF' }}>{catTypes.length} type{catTypes.length !== 1 ? 's' : ''}</span>
                      {owner ? pill('#EBF3FB', '#1F4E79', 'Owner: ' + owner) : pill('#F3F4F6', '#6B7280', 'No owner dept')}
                    </div>
                  </div>
                  <div style={{ fontSize: '20px', color: '#9CA3AF', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform .2s' }}>⌄</div>
                </div>
                {!isCollapsed && (
                  <div style={{ borderTop: '1px solid #F3F4F6' }}>
                    {catTypes.map(function(t) {
                      var av = AVAIL[t.public_availability] || { label: t.public_availability, bg: '#F3F4F6', fg: '#6B7280' };
                      return (
                        <div key={t.id} style={{ padding: '14px 20px', borderBottom: '1px solid #F9FAFB' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                            <div style={{ fontWeight: '600', fontSize: '14px', color: '#111' }}>{t.name}</div>
                            <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              {t.auto_release_eligible === 1 ? pill('#E1EFFE', '#1E429F', 'Auto-release') : null}
                              {pill(av.bg, av.fg, av.label)}
                            </div>
                          </div>
                          {t.intent ? <div style={{ fontSize: '13px', color: '#4B5563', marginTop: '4px' }}>{t.intent}</div> : null}
                          <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '6px' }}>
                            <span style={{ color: '#6B7280', fontWeight: '600' }}>{(t.formats || []).join(', ')}</span>
                            {(t.synonyms && t.synonyms.length) ? ' \u00b7 ' + t.synonyms.join(', ') : ''}
                          </div>
                          {(t.identifying_facets && t.identifying_facets.length) ? (
                            <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>Pinned by: {t.identifying_facets.join(' \u00b7 ')}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {shown.length === 0 ? <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF' }}>No record types match your search or filter.</div> : null}
        </div>
      )}
    </div>
  );
}
