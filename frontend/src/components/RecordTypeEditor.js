import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import EstimateProfilePanel from './EstimateProfilePanel';

var AVAIL_OPTS = ['releasable', 'review_required', 'restricted', 'confidential'];

function arrToStr(a) { return Array.isArray(a) ? a.join(', ') : ''; }
function strToArr(s) { return (s || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean); }

export default function RecordTypeEditor(props) {
  var init = props.initial || {};
  var [f, setF] = useState({
    category_id: init.category_id || (props.categories[0] && props.categories[0].id) || '',
    name: init.name || '',
    code: init.code || '',
    intent: init.intent || '',
    expected_content: init.expected_content || '',
    typical_request_reason: init.typical_request_reason || '',
    public_availability: init.public_availability || 'review_required',
    auto_release_eligible: init.auto_release_eligible === 1,
    auto_publish: init.auto_publish === 1,
    is_structured_data: init.is_structured_data === 1,
    fulfillment_method: init.fulfillment_method || 'electronic_search',
    medium: init.medium || 'electronic',
    synonyms: arrToStr(init.synonyms),
    disambiguators: arrToStr(init.disambiguators),
    keywords: arrToStr(init.keywords),
    identifying_facets: arrToStr(init.identifying_facets),
    formats: arrToStr(init.formats),
    status: init.status || 'active'
  });
  var [saving, setSaving] = useState(false);
  var [err, setErr] = useState('');
  var [owningDeptId, setOwningDeptId] = useState(init.owner_department_id || '');
  var [teamOverrideId, setTeamOverrideId] = useState(init.fulfillment_team_is_override ? (init.fulfillment_team_id || '') : '');
  var [bizDepts, setBizDepts] = useState([]);
  var [teams, setTeams] = useState([]);
  useEffect(function(){
    api.get('/departments').then(function(r){
      var ds = (r.data && r.data.departments) || [];
      setBizDepts(ds.filter(function(d){ return d.kind !== 'team'; }));
      setTeams(ds.filter(function(d){ return d.kind === 'team'; }));
    }).catch(function(){});
  }, []);
  var [sources, setSources] = useState([]);
  var [selectedSources, setSelectedSources] = useState([]);
  useEffect(function(){
    api.get('/repositories').then(function(r){
      var rs = (r.data && (r.data.repositories || r.data)) || [];
      setSources(Array.isArray(rs) ? rs : []);
    }).catch(function(){});
    if (props.mode !== 'create' && init.id) {
      api.get('/taxonomy/record-types/' + init.id).then(function(r){
        var reps = (r.data && r.data.repositories) || [];
        setSelectedSources(reps.map(function(x){ return x.repository_id; }));
      }).catch(function(){});
    }
  }, []);
  function set(k, v) { setF(function(p){ var n = Object.assign({}, p); n[k] = v; return n; }); }
  function toggleSource(id) { setSelectedSources(function(prev){ return prev.indexOf(id) >= 0 ? prev.filter(function(x){ return x !== id; }) : prev.concat([id]); }); }

  async function save() {
    if (!f.name.trim() || !f.category_id) { setErr('Name and category are required.'); return; }
    if (props.mode === 'create' && !f.code.trim()) { setErr('Code is required for a new type.'); return; }
    setSaving(true); setErr('');
    var payload = {
      category_id: f.category_id, name: f.name.trim(), intent: f.intent,
      expected_content: f.expected_content, typical_request_reason: f.typical_request_reason,
      public_availability: f.public_availability, auto_release_eligible: f.auto_release_eligible, auto_publish: f.auto_publish,
      is_structured_data: f.is_structured_data, fulfillment_method: f.fulfillment_method, medium: f.medium, synonyms: strToArr(f.synonyms),
      disambiguators: strToArr(f.disambiguators), keywords: strToArr(f.keywords),
      identifying_facets: strToArr(f.identifying_facets), formats: strToArr(f.formats), status: f.status
    };
    try {
      var rid = init.id;
      if (props.mode === 'create') { payload.code = f.code.trim(); var resp = await api.post('/taxonomy/record-types', payload); rid = resp.data && resp.data.id; }
      else { await api.patch('/taxonomy/record-types/' + init.id, payload); }
      if (rid) { await api.patch('/taxonomy/record-types/' + rid + '/routing', { owning_department_id: owningDeptId || null, fulfillment_team_id: teamOverrideId || null }); }
      if (rid) { await api.patch('/taxonomy/record-types/' + rid + '/sources', { repository_ids: selectedSources }); }
      props.onSaved();
    } catch (e) {
      setErr((e.response && e.response.data && e.response.data.error) || 'Save failed');
      setSaving(false);
    }
  }

  var overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', zIndex: 50, overflowY: 'auto' };
  var modal = { background: 'white', borderRadius: '12px', width: '100%', maxWidth: '640px', padding: '24px', boxShadow: '0 10px 40px rgba(0,0,0,.2)' };
  var lab = { fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '4px', marginTop: '14px' };
  var inp = { width: '100%', padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' };

  function field(lbl, key, opts) {
    opts = opts || {};
    return (
      <div>
        <label style={lab}>{lbl}{opts.hint ? <span style={{ color: '#9CA3AF', fontWeight: '400' }}> \u00b7 {opts.hint}</span> : null}</label>
        {opts.area
          ? <textarea value={f[key]} onChange={function(e){ set(key, e.target.value); }} style={Object.assign({}, inp, { minHeight: '60px', resize: 'vertical' })} />
          : <input value={f[key]} onChange={function(e){ set(key, e.target.value); }} disabled={opts.disabled} style={Object.assign({}, inp, opts.disabled ? { background: '#F9FAFB', color: '#9CA3AF' } : {})} />}
      </div>
    );
  }

  var selOwner = bizDepts.filter(function(d){ return d.id === owningDeptId; })[0];
  var derivedTeam = selOwner ? teams.filter(function(t){ return t.id === selOwner.processed_by; })[0] : null;

  return (
    <div style={overlay} onClick={props.onClose}>
      <div style={modal} onClick={function(e){ e.stopPropagation(); }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>{props.mode === 'create' ? 'New record type' : 'Edit record type'}</h2>
          <button onClick={props.onClose} style={{ border: 'none', background: 'none', fontSize: '22px', color: '#9CA3AF', cursor: 'pointer', lineHeight: 1 }}>\u00d7</button>
        </div>
        <label style={lab}>Category</label>
        <select value={f.category_id} onChange={function(e){ set('category_id', e.target.value); }} style={inp}>
          {props.categories.map(function(c){ return <option key={c.id} value={c.id}>{c.name}</option>; })}
        </select>
        <label style={lab}>Owning City Department</label>
        <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '4px', marginTop: '-2px' }}>The org-chart department that owns these records. The AI matches requests to this.</div>
        <select value={owningDeptId} onChange={function(e){ setOwningDeptId(e.target.value); }} style={inp}>
          <option value="">- None -</option>
          {bizDepts.map(function(d){ return <option key={d.id} value={d.id}>{d.name}</option>; })}
        </select>
        <label style={lab}>Request Fulfillment Team</label>
        <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '4px', marginTop: '-2px' }}>Leave on default unless this record type is handled by a different team than its owning department.</div>
        <select value={teamOverrideId} onChange={function(e){ setTeamOverrideId(e.target.value); }} style={inp}>
          <option value="">Use owning City Department default{derivedTeam ? ' (' + derivedTeam.name + ')' : ''}</option>
          {teams.map(function(t){ return <option key={t.id} value={t.id}>{t.name} (override)</option>; })}
        </select>
        <label style={lab}>Found in these sources</label>
        <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '6px', marginTop: '-2px' }}>Which connected systems hold this record type. Auto-filled by AI scans for scannable sources; set API systems (Axon, Tyler) here by hand. Powers search targeting.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {sources.length === 0 ? <span style={{ fontSize: '12px', color: '#9CA3AF' }}>No sources configured yet.</span> : sources.map(function(s){
            var on = selectedSources.indexOf(s.id) >= 0;
            return (
              <label key={s.id} style={{ fontSize: '13px', color: '#374151', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={on} onChange={function(){ toggleSource(s.id); }} /> {s.name} <span style={{ color: '#9CA3AF' }}>({s.connector_type})</span>
              </label>
            );
          })}
        </div>
        {field('Name', 'name')}
        {field('Code', 'code', { disabled: props.mode !== 'create', hint: props.mode === 'create' ? 'kebab-case, unique' : 'fixed after creation' })}
        {field('Intent', 'intent', { area: true })}
        {field('Expected content', 'expected_content', { area: true })}
        {field('Typical request reason', 'typical_request_reason', { area: true })}
        <label style={lab}>Availability</label>
        <select value={f.public_availability} onChange={function(e){ set('public_availability', e.target.value); }} style={inp}>
          {AVAIL_OPTS.map(function(o){ return <option key={o} value={o}>{o}</option>; })}
        </select>
        <div style={{ display: 'flex', gap: '20px', marginTop: '14px' }}>
          <label style={{ fontSize: '13px', color: '#374151', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={f.auto_release_eligible} onChange={function(e){ set('auto_release_eligible', e.target.checked); }} /> Auto-release eligible
          </label>
          <label style={{ fontSize: '13px', color: '#374151', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={f.is_structured_data} onChange={function(e){ set('is_structured_data', e.target.checked); }} /> Structured data
          </label>
          <label style={{ fontSize: '13px', color: '#374151', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={f.auto_publish} onChange={function(e){ set('auto_publish', e.target.checked); }} /> Auto-publish to public library
          </label>
        </div>
        <label style={lab}>Fulfillment method</label>
        <select value={f.fulfillment_method} onChange={function(e){ set('fulfillment_method', e.target.value); }} style={inp}>
          <option value="electronic_search">electronic_search — retrieved by system/connector search</option>
          <option value="paper_index">paper_index — physical record located via index</option>
          <option value="manual_collection">manual_collection — gathered by hand from devices/systems</option>
          <option value="bulk_export">bulk_export — produced as a data extract or copy</option>
        </select>
        <label style={lab}>Medium</label>
        <select value={f.medium} onChange={function(e){ set('medium', e.target.value); }} style={inp}>
          <option value="electronic">electronic</option>
          <option value="paper">paper</option>
          <option value="mixed">mixed</option>
        </select>
        {field('Synonyms', 'synonyms', { hint: 'comma-separated' })}
        {field('Disambiguators', 'disambiguators', { hint: 'comma-separated' })}
        {field('Keywords', 'keywords', { hint: 'comma-separated' })}
        {field('Identifying facets', 'identifying_facets', { hint: 'comma-separated' })}
        {field('Formats', 'formats', { hint: 'document, video, audio, structured_data' })}
        <label style={lab}>Status</label>
        <select value={f.status} onChange={function(e){ set('status', e.target.value); }} style={inp}>
          <option value="active">active</option>
          <option value="draft">draft</option>
          <option value="inactive">inactive</option>
        </select>
        {props.mode !== 'create' && init.id ? <EstimateProfilePanel recordTypeId={init.id} /> : null}
        {err ? <div style={{ color: '#DC2626', fontSize: '13px', marginTop: '14px' }}>{err}</div> : null}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button onClick={props.onClose} style={{ padding: '9px 18px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '14px', fontWeight: '600', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
