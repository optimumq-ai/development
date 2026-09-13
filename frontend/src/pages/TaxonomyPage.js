import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import RecordTypeEditor from '../components/RecordTypeEditor';
import SetupScreen from '../components/setup/SetupScreen';

// TAXONOMY — the hub's `taxonomy` row, and the door for `calibration` and `record_owners` too (C17, Kevin
// 2026-08-30: the hidden admin Taxonomy tab becomes this dedicated screen at /setup/taxonomy).
// LIST MODEL (§3e, 2026-08-31): all three rows are lists over the SAME record types, so the body is one
// page — what the ?tab= chooses is which of the three setup items the strip is signing off (the
// Organization pattern, minus the content split, because the content really is shared). Each row keeps
// its own count, health, "Ready for approval" and approval.
var SETUP_ROWS = [
  { tab: 'types', hubKey: 'taxonomy', label: 'Taxonomy', lane: 'System Features and Options' },
  { tab: 'calibration', hubKey: 'calibration', label: 'How much work each record type takes', lane: 'Request Fulfillment Process Setup — Fees, Estimates and Routing' },
  { tab: 'owners', hubKey: 'record_owners', label: 'Which department owns which records', lane: 'Organization Departments, Teams, and Staff Setup' }
];
function rowFor(tab) { for (var i = 0; i < SETUP_ROWS.length; i++) if (SETUP_ROWS[i].tab === tab) return SETUP_ROWS[i]; return SETUP_ROWS[0]; }

var AVAIL = {
  releasable: { label: 'Releasable', bg: 'var(--oq-bg-def7ec)', fg: 'var(--oq-fg-03543f)' },
  review_required: { label: 'Review required', bg: 'var(--oq-bg-fef3c7)', fg: 'var(--oq-fg-92400e)' },
  restricted: { label: 'Restricted', bg: 'var(--oq-bg-fde8e8)', fg: 'var(--oq-fg-9b1c1c)' },
  confidential: { label: 'Confidential', bg: 'var(--oq-bg-fde8e8)', fg: 'var(--oq-fg-9b1c1c)' }
};
var FILTERS = [
  { k: 'all', label: 'All' },
  { k: 'auto', label: 'Auto-release' },
  { k: 'releasable', label: 'Releasable' },
  { k: 'review', label: 'Review required' },
  { k: 'sensitive', label: 'Restricted / confidential' }
];

export default function TaxonomyPage() {
  var navigate = useNavigate();
  var [params, setParams] = useSearchParams();
  var setupRow = rowFor(params.get('tab'));
  var [cats, setCats] = useState([]);
  var [types, setTypes] = useState([]);
  var [loading, setLoading] = useState(true);
  var [q, setQ] = useState('');
  var [filter, setFilter] = useState('all');
  var [collapsed, setCollapsed] = useState({});
  var [editor, setEditor] = useState(null);
  var [semQ, setSemQ] = useState('');
  var [semResults, setSemResults] = useState(null);
  // VARIANT GROUPINGS (#14 slice 2): scan a bucket's holdings, show proposals, approve as drafts.
  var [scanning, setScanning] = useState(null);        // record type id being scanned
  var [scanResult, setScanResult] = useState(null);    // { bucket, groupings, ... }
  async function previewExample(ex) {
    try {
      var r = await api.get('/taxonomy/preview-source-file', { params: { repository_id: ex.repository_id, filename: ex.filename }, responseType: 'blob' });
      window.open(URL.createObjectURL(r.data), '_blank');
    } catch (e) { alert('The example could not be opened.'); }
  }
  var [scanErr, setScanErr] = useState('');
  var [applied, setApplied] = useState({});            // proposal code -> 'done' | 'busy'

  async function findVariants(t) {
    setScanning(t.id); setScanErr(''); setScanResult(null); setApplied({});
    try {
      var r = await api.post('/taxonomy/record-types/' + t.id + '/discover-variants');
      setScanResult(r.data);
    } catch (e) {
      setScanErr((e.response && e.response.data && e.response.data.error) || 'The scan failed.');
    }
  }
  async function approveProposal(g) {
    setApplied(function (a) { return { ...a, [g.code]: 'busy' }; });
    try {
      // repos ride along so a mass-redaction candidate's Mass-Redaction card can say WHERE the pile lives.
      await api.post('/taxonomy/record-types/' + scanResult.bucket.id + '/variants', Object.assign({}, g, { repos: scanResult.repos || [] }));
      setApplied(function (a) { return { ...a, [g.code]: 'done' }; });
      load();
    } catch (e) {
      setApplied(function (a) { return { ...a, [g.code]: undefined }; });
      setScanErr((e.response && e.response.data && e.response.data.error) || 'Could not add the variant.');
    }
  }
  var [semLoading, setSemLoading] = useState(false);
  var [semErr, setSemErr] = useState('');

  useEffect(function() { load(); }, []);

  async function runSemantic() {
    var query = semQ.trim();
    if (!query) return;
    setSemLoading(true); setSemErr(''); setSemResults(null);
    try {
      var r = await api.post('/semantic-search/record-types', { query: query, topN: 8 });
      setSemResults(r.data.results || []);
    } catch (e) {
      setSemErr((e.response && e.response.data && e.response.data.error) || 'Search failed');
    }
    setSemLoading(false);
  }
  function openType(id) {
    var t = null;
    for (var i = 0; i < types.length; i++) { if (types[i].id === id) { t = types[i]; break; } }
    if (t) setEditor({ mode: 'edit', initial: t });
  }
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
    <SetupScreen hubKey={setupRow.hubKey} laneLabel={setupRow.lane} title="Taxonomy" maxWidth="960px"
      intro="The record types this city holds, grouped by category, with each type's release posture, owning department and estimate calibration. Three setup rows open here: Taxonomy, how much work each record type takes, and which department owns which records.">
    {function () { return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--oq-fg-9ca3af)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Setting up</span>
        {SETUP_ROWS.map(function (r) {
          var on = r.tab === setupRow.tab;
          return <button key={r.tab} onClick={function () { setParams(r.tab === 'types' ? {} : { tab: r.tab }); }}
            style={{ fontSize: '12.5px', padding: '6px 13px', borderRadius: '999px', cursor: 'pointer', fontFamily: 'inherit', border: '1px solid ' + (on ? 'var(--oq-ln-1f4e79)' : 'var(--oq-ln-d1d5db)'), background: on ? 'var(--oq-bg-ebf3fb)' : 'var(--oq-bg-ffffff)', color: on ? 'var(--oq-fg-1f4e79)' : 'var(--oq-fg-4b5563)', fontWeight: on ? 700 : 500 }}>{r.label}</button>;
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <p style={{ color: 'var(--oq-fg-5c6f7c)', fontSize: '13px', margin: 0 }}>Current, live taxonomy &mdash; {types.length} record types across {cats.filter(function(c){ return types.some(function(t){ return t.category_id === c.id; }); }).length} categories</p>
        <div style={{ border: '1px solid var(--oq-ln-dbeafe)', borderRadius: '10px', padding: '12px 14px', background: 'var(--oq-bg-f8faff)', minWidth: '300px', flexShrink: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--oq-fg-374151)', marginBottom: '8px' }}>Add, delete, or edit taxonomy records</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={function(){ setEditor({ mode: 'create', initial: null }); }} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--oq-bg-1f4e79)', color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Manual</button>
            <button onClick={function(){ navigate('/discovery'); }} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--oq-ln-1f4e79)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-1f4e79)', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>AI Auto Discovery</button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {[['Total types', types.length], ['Auto-release', autoCount], ['Review required', reviewCount], ['Restricted / conf.', sensCount]].map(function(c) {
          return (
            <div key={c[0]} style={{ flex: '1 1 140px', background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', padding: '12px 16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--oq-fg-9ca3af)' }}>{c[0]}</div>
              <div style={{ fontSize: '22px', fontWeight: '700', color: 'var(--oq-fg-111111)', marginTop: '2px' }}>{c[1]}</div>
            </div>
          );
        })}
      </div>

      <div style={{ background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-dbeafe)', borderRadius: '12px', padding: '16px 18px' }}>
        <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--oq-fg-1f4e79)', marginBottom: '4px' }}>AI semantic search</div>
        <div style={{ fontSize: '12px', color: 'var(--oq-fg-6b7280)', marginBottom: '10px' }}>Describe a request the way a citizen might &mdash; the assistant finds the closest record types by meaning, not just matching words.</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input value={semQ} onChange={function(e){ setSemQ(e.target.value); }} onKeyDown={function(e){ if (e.key === 'Enter') runSemantic(); }}
            placeholder='e.g. "body cam video from a traffic stop last March"'
            style={{ flex: '1 1 320px', padding: '9px 12px', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '8px', fontSize: '14px', outline: 'none' }} />
          <button onClick={runSemantic} disabled={semLoading || !semQ.trim()}
            style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: (semLoading || !semQ.trim()) ? 'var(--oq-bg-9ca3af)' : 'var(--oq-bg-1f4e79)', color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: '600', cursor: (semLoading || !semQ.trim()) ? 'default' : 'pointer' }}>
            {semLoading ? 'Searching...' : 'Search'}
          </button>
          {(semResults !== null || semErr) ? <button onClick={function(){ setSemResults(null); setSemErr(''); setSemQ(''); }} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--oq-ln-e5e7eb)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-6b7280)', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Clear</button> : null}
        </div>
        {semErr ? <div style={{ fontSize: '13px', color: 'var(--oq-fg-9b1c1c)', marginTop: '10px' }}>{semErr}</div> : null}
        {(semResults !== null && !semErr) ? (
          semResults.length === 0 ? <div style={{ fontSize: '13px', color: 'var(--oq-fg-9ca3af)', marginTop: '10px' }}>No matches found.</div> : (
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {semResults.map(function(r, idx) {
              var pct = Math.max(0, Math.min(100, Math.round(r.score * 100)));
              var full = null; for (var i = 0; i < types.length; i++) { if (types[i].id === r.id) { full = types[i]; break; } }
              var catName = full ? (full.category_name || '') : '';
              return (
                <div key={r.id} onClick={function(){ openType(r.id); }} title="Open this record type"
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '8px', cursor: 'pointer', background: idx === 0 ? 'var(--oq-bg-f8faff)' : 'var(--oq-bg-ffffff)' }}>
                  <div style={{ width: '20px', fontSize: '12px', fontWeight: '700', color: 'var(--oq-fg-9ca3af)' }}>{idx + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--oq-fg-111111)' }}>{r.name}</div>
                    {catName ? <div style={{ fontSize: '12px', color: 'var(--oq-fg-9ca3af)' }}>{catName}</div> : null}
                  </div>
                  <div style={{ width: '120px', flexShrink: 0 }}>
                    <div style={{ height: '6px', background: 'var(--oq-bg-e5e7eb)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: pct + '%', height: '100%', background: 'var(--oq-bg-1f4e79)' }}></div>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--oq-fg-6b7280)', textAlign: 'right', marginTop: '2px' }}>{r.score.toFixed(2)} match</div>
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: '11px', color: 'var(--oq-fg-9ca3af)', marginTop: '2px' }}>Ranked by semantic similarity. Click a result to open that record type.</div>
          </div>
          )
        ) : null}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
        <input value={q} onChange={function(e){ setQ(e.target.value); }} placeholder="Search names, synonyms, keywords..."
          style={{ flex: '1 1 240px', padding: '8px 12px', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '8px', fontSize: '14px', outline: 'none' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {FILTERS.map(function(f) {
            var active = filter === f.k;
            return (
              <button key={f.k} onClick={function(){ setFilter(f.k); }}
                style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', border: '1px solid ' + (active ? 'var(--oq-ln-1f4e79)' : 'var(--oq-ln-e5e7eb)'), background: active ? 'var(--oq-bg-d6e4f0)' : 'var(--oq-bg-ffffff)', color: active ? 'var(--oq-fg-1f4e79)' : 'var(--oq-fg-6b7280)' }}>
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: 'var(--oq-fg-9ca3af)' }}>Loading taxonomy...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {cats.map(function(cat) {
            var catTypes = shown.filter(function(t){ return t.category_id === cat.id; });
            if (catTypes.length === 0) return null;
            // TAXONOMY VARIANTS (#14): variants ride directly under their bucket. A variant whose
            // bucket is filtered out (search matched only the child) still shows, styled as a variant.
            var kidsOf = {};
            catTypes.forEach(function(t){ if (t.parent_record_type_id) { (kidsOf[t.parent_record_type_id] = kidsOf[t.parent_record_type_id] || []).push(t); } });
            var ordered = [];
            catTypes.forEach(function(t){
              if (t.parent_record_type_id && catTypes.some(function(p){ return p.id === t.parent_record_type_id; })) return;
              ordered.push(t);
              (kidsOf[t.id] || []).forEach(function(k){ ordered.push(k); });
            });
            catTypes = ordered;
            var isCollapsed = collapsed[cat.id];
            var owner = ownerFor(cat.id);
            return (
              <div key={cat.id} style={{ background: 'var(--oq-bg-ffffff)', borderRadius: '12px', border: '1px solid var(--oq-ln-e5e7eb)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                <div onClick={function(){ toggle(cat.id); }} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px', cursor: 'pointer' }}
                  onMouseOver={function(e){ e.currentTarget.style.background = 'var(--oq-x-f9fafb)'; }}
                  onMouseOut={function(e){ e.currentTarget.style.background = 'var(--oq-bg-ffffff)'; }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--oq-fg-111111)' }}>{cat.name}</span>
                      <span style={{ fontSize: '12px', color: 'var(--oq-fg-9ca3af)' }}>{catTypes.length} type{catTypes.length !== 1 ? 's' : ''}</span>
                      {owner ? pill('var(--oq-bg-ebf3fb)', 'var(--oq-fg-1f4e79)', 'Owning dept: ' + owner) : pill('var(--oq-bg-f3f4f6)', 'var(--oq-fg-6b7280)', 'No owning dept')}
                    </div>
                  </div>
                  <div style={{ fontSize: '20px', color: 'var(--oq-fg-9ca3af)', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform .2s' }}>⌄</div>
                </div>
                {!isCollapsed && (
                  <div style={{ borderTop: '1px solid var(--oq-ln-f3f4f6)' }}>
                    {catTypes.map(function(t) {
                      var av = AVAIL[t.public_availability] || { label: t.public_availability, bg: 'var(--oq-bg-f3f4f6)', fg: 'var(--oq-fg-6b7280)' };
                      var isVariant = !!t.parent_record_type_id;
                      var kidCount = (kidsOf[t.id] || []).length;
                      var parentName = isVariant ? (types.filter(function(p){ return p.id === t.parent_record_type_id; })[0] || {}).name : null;
                      return (
                        <div key={t.id} style={{ padding: '14px 20px', borderBottom: '1px solid var(--oq-ln-f9fafb)',
                          ...(isVariant ? { paddingLeft: '38px', borderLeft: '4px solid var(--oq-ln-c9d6e2)', background: 'var(--oq-bg-fafcfe)' } : {}) }}>
                          {isVariant ? <div style={{ fontSize: '10.5px', letterSpacing: '.07em', color: 'var(--oq-fg-6b7280)', fontWeight: '700', marginBottom: '2px' }}>VARIANT{parentName ? ' OF ' + parentName.toUpperCase() : ''}</div> : null}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                            <div style={{ fontWeight: '600', fontSize: '14px', color: 'var(--oq-fg-111111)' }}>{t.name}
                              {kidCount ? <span style={{ marginLeft: '8px' }}>{pill('var(--oq-bg-1f4e79)', 'var(--oq-fg-ffffff)', 'Bucket · ' + kidCount + ' variant' + (kidCount > 1 ? 's' : ''))}</span> : null}</div>
                            <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              {t.auto_release_eligible === 1 ? pill('var(--oq-bg-e1effe)', 'var(--oq-fg-1e429f)', 'Auto-release') : null}
                              {pill(av.bg, av.fg, av.label)}
                              {t.fulfillment_method && t.fulfillment_method !== 'electronic_search' ? pill('var(--oq-bg-f5f3ff)', 'var(--oq-fg-6d28d9)', t.fulfillment_method === 'paper_index' ? 'Paper \u00b7 on-site' : (t.fulfillment_method === 'bulk_export' ? 'Bulk export' : 'Manual collection')) : null}
                              {!isVariant ? <button onClick={function(){ findVariants(t); }} title="Scan this type's holdings and let the AI propose variants, with document counts"
                                style={{ marginLeft: '4px', padding: '2px 10px', borderRadius: '20px', border: '1px solid var(--oq-ln-c9d6e2)', background: 'var(--oq-bg-ebf3fb)', color: 'var(--oq-fg-1f4e79)', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Find variants</button> : null}
                              <button onClick={function(){ setEditor({ mode: 'edit', initial: t }); }} style={{ marginLeft: '4px', padding: '2px 10px', borderRadius: '20px', border: '1px solid var(--oq-ln-e5e7eb)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-374151)', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Edit</button>
                            </div>
                          </div>
                          {t.intent ? <div style={{ fontSize: '13px', color: 'var(--oq-fg-4b5563)', marginTop: '4px' }}>{t.intent}</div> : null}
                          <div style={{ fontSize: '12px', color: 'var(--oq-fg-9ca3af)', marginTop: '6px' }}>
                            <span style={{ color: 'var(--oq-fg-6b7280)', fontWeight: '600' }}>{(t.formats || []).join(', ')}</span>
                            {(t.synonyms && t.synonyms.length) ? ' \u00b7 ' + t.synonyms.join(', ') : ''}
                          </div>
                          {(t.identifying_facets && t.identifying_facets.length) ? (
                            <div style={{ fontSize: '12px', color: 'var(--oq-fg-9ca3af)', marginTop: '2px' }}>Pinned by: {t.identifying_facets.join(' \u00b7 ')}</div>
                          ) : null}
                          <div style={{ fontSize: '12px', color: 'var(--oq-fg-6b7280)', marginTop: '4px' }}>
                            Routing: <strong>{t.owner_department_name || 'No owning dept'}</strong>{t.fulfillment_team_name ? ' -> ' + t.fulfillment_team_name : ''}{t.fulfillment_team_is_override ? ' (override)' : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {shown.length === 0 ? <div style={{ padding: '48px', textAlign: 'center', color: 'var(--oq-fg-9ca3af)' }}>No record types match your search or filter.</div> : null}
        </div>
      )}
      {editor ? <RecordTypeEditor mode={editor.mode} initial={editor.initial} categories={cats} allTypes={types} onClose={function(){ setEditor(null); }} onSaved={function(){ setEditor(null); load(); }} /> : null}

      {scanning ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,32,43,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '30px 16px', zIndex: 60, overflowY: 'auto' }}
          onMouseDown={function(e){ if (e.target === e.currentTarget) { setScanning(null); setScanResult(null); } }}>
          <div style={{ width: '100%', maxWidth: '760px', background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-c9d6e2)', borderRadius: '14px', boxShadow: '0 10px 32px rgba(20,32,43,.18)', padding: '24px 26px' }} role="dialog" aria-modal="true">
            {!scanResult && !scanErr ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--oq-fg-5b6b7a)', fontSize: '14px' }}>
                Scanning this type's holdings and asking the AI to group them… this can take up to a minute.
              </div>
            ) : null}
            {scanErr ? <div style={{ background: 'var(--oq-bg-fef2f2)', border: '1px solid var(--oq-ln-fca5a5)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: 'var(--oq-fg-dc2626)', marginBottom: '12px' }}>{scanErr}</div> : null}
            {scanResult ? (
              <div>
                <div style={{ fontWeight: 800, fontSize: '18px', color: 'var(--oq-fg-1f4e79)' }}>Discovered groupings in "{scanResult.bucket.name}"</div>
                <div style={{ fontSize: '13px', color: 'var(--oq-fg-5b6b7a)', margin: '4px 0 16px' }}>
                  {scanResult.method === 'fingerprint'
                    ? <>Read and fingerprinted every document — {scanResult.sampled} of {scanResult.totalDocuments} in {scanResult.repos.join(', ')}{scanResult.unreadable ? ' (' + scanResult.unreadable + ' unreadable or image-only, excluded)' : ''} · counts are exact</>
                    : <>Sampled {scanResult.sampled} documents from {scanResult.repos.join(', ')}{scanResult.totalDocuments != null ? ' · about ' + scanResult.totalDocuments + ' documents in the holdings' : ' · totals unavailable for these sources'}</>}
                  {' '}· the AI proposes, you approve — nothing changes until you say so.
                </div>
                {(scanResult.recognized || []).length ? (
                  <div style={{ background: 'var(--oq-bg-f0fdf4)', border: '1px solid var(--oq-ln-bbf7d0)', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--oq-fg-166534)', marginBottom: '6px' }}>Already known — recognized, not re-proposed</div>
                    {scanResult.recognized.map(function (r) {
                      return (
                        <div key={r.record_type_id} style={{ fontSize: '13px', color: 'var(--oq-fg-14532d)', marginBottom: '3px' }}>
                          <strong>{r.count.toLocaleString()}</strong> document{r.count !== 1 ? 's' : ''} match the existing variant "{r.name}"
                          {r.template_ready
                            ? <span style={{ color: 'var(--oq-fg-166534)', fontWeight: 700 }}> — its redaction template is ready; they can go straight to a mass job.</span>
                            : <span style={{ color: 'var(--oq-fg-92400e)' }}> — no redaction template yet (see Mass Redaction).</span>}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {(scanResult.groupings || []).length === 0 ? (
                  <div style={{ color: 'var(--oq-fg-5b6b7a)', fontSize: '14px', padding: '10px 0' }}>No clear groupings — the samples look like one kind of document.</div>
                ) : scanResult.groupings.map(function (g) {
                  return (
                    <div key={g.code} style={{ display: 'flex', gap: '14px', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', padding: '14px 16px', marginBottom: '10px', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: '86px', textAlign: 'right' }}>
                        <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--oq-fg-1f4e79)' }}>{g.estimated_count != null ? g.estimated_count.toLocaleString() : Math.round((g.sample_share || 0) * 100) + '%'}</div>
                        <div style={{ fontSize: '11px', color: 'var(--oq-fg-8a97a5)', fontWeight: 600 }}>{g.counted ? 'documents (counted)' : g.estimated_count != null ? 'documents (est.)' : 'of the sample'}</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '14.5px' }}>{g.name}</div>
                        <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-5b6b7a)', marginTop: '2px' }}>{g.reasoning || g.intent}</div>
                        {(g.example_sources || []).length ? (
                          <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', color: 'var(--oq-fg-8a97a5)', fontWeight: 600 }}>See a real document:</span>
                            {g.example_sources.map(function (ex) {
                              return <button key={ex.repository_id + '/' + ex.filename} type="button" onClick={function(){ previewExample(ex); }}
                                title="Opens the actual source document in a new tab"
                                style={{ background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-c9d6e2)', borderRadius: '6px', fontSize: '11.5px', color: 'var(--oq-fg-1f4e79)', padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>{ex.filename}</button>;
                            })}
                          </div>
                        ) : null}
                        {g.mass_redaction_candidate
                          ? <div style={{ marginTop: '7px', display: 'inline-block', fontSize: '12.5px', fontWeight: 700, color: 'var(--oq-fg-b23a3a)', background: 'var(--oq-bg-f9e4e4)', borderRadius: '8px', padding: '4px 10px' }}>⚡ Mass-redaction candidate — consistent layout</div>
                          : <div style={{ marginTop: '7px', fontSize: '12px', color: 'var(--oq-fg-8a97a5)' }}>Varied layouts — per-document review.</div>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {applied[g.code] === 'done'
                          ? <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--oq-fg-17803d)', background: 'var(--oq-bg-e6f4ec)', borderRadius: '8px', padding: '8px 14px' }}>{g.mass_redaction_candidate ? 'Added as draft — suggested on Mass Redaction ✓' : 'Added as draft ✓'}</span>
                          : <button disabled={applied[g.code] === 'busy'} onClick={function(){ approveProposal(g); }}
                              style={{ background: 'var(--oq-bg-1f4e79)', color: 'var(--oq-fg-ffffff)', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, padding: '8px 14px', cursor: 'pointer', opacity: applied[g.code] === 'busy' ? .6 : 1 }}>
                              {applied[g.code] === 'busy' ? 'Adding…' : 'Approve as draft variant'}</button>}
                      </div>
                    </div>
                  );
                })}
                {scanResult.ungroupedShare > 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--oq-fg-8a97a5)', marginTop: '4px' }}>
                    About {Math.round(scanResult.ungroupedShare * 100)}% of the {scanResult.method === 'fingerprint' ? 'documents' : 'sample'} didn't {scanResult.method === 'fingerprint' ? 'match any layout grouping' : 'fit any grouping'} and stay{scanResult.method === 'fingerprint' ? '' : 's'} on "{scanResult.bucket.name}".
                  </div>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
                  <button onClick={function(){ setScanning(null); setScanResult(null); }}
                    style={{ background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-1f4e79)', border: '1px solid var(--oq-ln-c9d6e2)', borderRadius: '8px', fontSize: '13px', fontWeight: 700, padding: '9px 16px', cursor: 'pointer' }}>Close</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
    ); }}
    </SetupScreen>
  );
}
