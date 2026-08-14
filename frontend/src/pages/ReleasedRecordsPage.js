import React, { useEffect, useState } from 'react';
import api from '../lib/api';

var AVAIL = {
  redacted: { label: 'Redacted', bg: '#FEF3C7', fg: '#92400E' },
  released: { label: 'Released', bg: '#DEF7EC', fg: '#03543F' }
};

export default function ReleasedRecordsPage() {
  var [records, setRecords] = useState([]);
  var [loading, setLoading] = useState(true);
  var [q, setQ] = useState('');
  var [busy, setBusy] = useState({});

  // Shelve-and-publish: publishing needs a public library section (department + record type).
  // For records that arrived without one (ad-hoc batches), a small picker collects it first.
  var [shelving, setShelving] = useState(null); // the record being shelved
  var [depts, setDepts] = useState([]);
  var [recTypes, setRecTypes] = useState([]);
  var [shelfDept, setShelfDept] = useState('');
  var [shelfRt, setShelfRt] = useState('');
  var [shelfErr, setShelfErr] = useState('');
  var [shelfBusy, setShelfBusy] = useState(false);

  useEffect(function () { load(); }, []);
  useEffect(function () {
    api.get('/departments').then(function (r) { setDepts(r.data.departments || []); }).catch(function () {});
    api.get('/taxonomy/record-types').then(function (r) { setRecTypes(r.data.record_types || []); }).catch(function () {});
  }, []);
  async function load() {
    setLoading(true);
    try { var r = await api.get('/redaction-jobs/released'); setRecords(r.data.records || []); } catch (e) { console.error(e); }
    setLoading(false);
  }
  async function download(r) {
    if (!r.output_file_id) return;
    setBusy(function (b) { var n = Object.assign({}, b); n[r.id] = true; return n; });
    try {
      var resp = await api.get('/files/download/' + r.output_file_id, { responseType: 'blob' });
      var url = URL.createObjectURL(resp.data);
      var a = document.createElement('a'); a.href = url; a.download = (r.title || 'released') + '.pdf'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { alert('Could not download the released copy.'); }
    setBusy(function (b) { var n = Object.assign({}, b); n[r.id] = false; return n; });
  }

  async function togglePublish(r) {
    if (!r.published && (!r.record_type_id || !r.department_id)) {
      // No library section yet — collect one before publishing.
      setShelving(r); setShelfDept(r.department_id || ''); setShelfRt(r.record_type_id || ''); setShelfErr('');
      return;
    }
    try {
      var resp = await api.post('/redaction-jobs/released/' + r.id + '/publish', { published: !r.published });
      setRecords(function (rs) { return rs.map(function (x) { return x.id === r.id ? Object.assign({}, x, { published: resp.data.published ? 1 : 0 }) : x; }); });
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || 'Could not update publication.'); }
  }

  async function shelveAndPublish() {
    if (!shelfDept || !shelfRt) { setShelfErr('Pick both a department and a record type.'); return; }
    setShelfBusy(true); setShelfErr('');
    try {
      await api.post('/redaction-jobs/released/' + shelving.id + '/publish', { published: true, record_type_id: shelfRt, department_id: shelfDept });
      setShelving(null);
      load();
    } catch (e) { setShelfErr((e.response && e.response.data && e.response.data.error) || 'Could not publish the record.'); }
    setShelfBusy(false);
  }

  var shown = records.filter(function (r) {
    if (!q.trim()) return true;
    var s = q.toLowerCase();
    return ((r.title || '') + ' ' + (r.record_type_name || '') + ' ' + (r.department_name || '')).toLowerCase().indexOf(s) >= 0;
  });

  function Pill(p) { return <span style={{ background: p.bg, color: p.fg, fontSize: '11px', fontWeight: '700', padding: '2px 9px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{p.children}</span>; }

  return (
    <div style={{ padding: '28px 32px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '8px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 6px' }}>Released Records</h1>
        <p style={{ color: '#6B7280', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>
          The Fulfilled Request Index &mdash; records already processed and released. These surface first in search so previously-released records can be handed over immediately and similar future requests fast-tracked.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '12px', margin: '18px 0 16px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px', background: 'white', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px 18px' }}>
          <div style={{ fontSize: '26px', fontWeight: '700', color: '#111' }}>{records.length}</div>
          <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Released Records</div>
        </div>
        <div style={{ flex: '1 1 160px', background: 'white', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px 18px' }}>
          <div style={{ fontSize: '26px', fontWeight: '700', color: '#B45309' }}>{records.filter(function (r) { return r.public_availability === 'redacted'; }).length}</div>
          <div style={{ fontSize: '12px', color: '#9CA3AF' }}>With Redactions</div>
        </div>
        <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="Search released records..."
          style={{ flex: '2 1 240px', padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '14px', outline: 'none' }} />
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF' }}>Loading released records...</div>
      ) : records.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', background: 'white', border: '1px dashed #E5E7EB', borderRadius: '12px', color: '#9CA3AF' }}>
          No released records yet. A record appears here after you apply a redaction (or release a record) from a request's Records tab.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {shown.map(function (r) {
            var av = AVAIL[r.public_availability] || AVAIL.released;
            var unshelved = !r.record_type_id || !r.department_id;
            return (
              <div key={r.id} style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '3px' }}>
                    <span style={{ fontWeight: '700', fontSize: '14.5px', color: '#1F4E79' }}>{r.title}</span>
                    <Pill bg={av.bg} fg={av.fg}>{av.label}</Pill>
                    {r.published ? <Pill bg="#DEF7EC" fg="#03543F">In public library</Pill> : <Pill bg="#F3F4F6" fg="#6B7280">Not published</Pill>}
                    {unshelved && !r.published ? <Pill bg="#FEF3C7" fg="#92400E">No library section</Pill> : null}
                  </div>
                  <div style={{ fontSize: '12px', color: '#9CA3AF' }}>
                    {r.record_type_name ? r.record_type_name + ' · ' : ''}{r.department_name ? r.department_name + ' · ' : ''}{r.page_count ? r.page_count + ' page' + (r.page_count !== 1 ? 's' : '') + ' · ' : ''}{r.released_at ? 'released ' + (r.released_at || '').slice(0, 10) : ''}
                  </div>
                </div>
                <button onClick={function () { togglePublish(r); }}
                  style={{ flexShrink: 0, padding: '8px 14px', borderRadius: '8px', border: '1px solid ' + (r.published ? '#FDE68A' : '#BBF7D0'), background: 'white', color: r.published ? '#92400E' : '#03543F', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>{r.published ? 'Unpublish' : 'Publish to library'}</button>
                <button disabled={!!busy[r.id] || !r.output_file_id} onClick={function () { download(r); }}
                  style={{ flexShrink: 0, padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>{busy[r.id] ? 'Downloading...' : 'Download'}</button>
              </div>
            );
          })}
          {shown.length === 0 ? <div style={{ padding: '24px', textAlign: 'center', color: '#9CA3AF' }}>No records match your search.</div> : null}
        </div>
      )}

      {shelving ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div style={{ background: 'white', borderRadius: '14px', width: '440px', maxWidth: '92vw', boxShadow: '0 12px 40px rgba(0,0,0,.18)' }}>
            <div style={{ padding: '18px 22px 0' }}>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#111', marginBottom: '4px' }}>Pick a public library section</div>
              <div style={{ fontSize: '12.5px', color: '#6B7280', lineHeight: 1.55 }}>
                &ldquo;{shelving.title}&rdquo; was released without a library section, so citizens would have no place to find it. Choose the department and record type it belongs under, and it will be published there.
              </div>
            </div>
            <div style={{ padding: '16px 22px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '4px' }}>Department</label>
              <select value={shelfDept} onChange={function (e) { setShelfDept(e.target.value); }} style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px', background: 'white', marginBottom: '12px' }}>
                <option value="">Select a department...</option>
                {depts.map(function (d) { return <option key={d.id} value={d.id}>{d.name}</option>; })}
              </select>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '4px' }}>Record type</label>
              <select value={shelfRt} onChange={function (e) { setShelfRt(e.target.value); }} style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px', background: 'white' }}>
                <option value="">Select a record type...</option>
                {recTypes.map(function (t) { return <option key={t.id} value={t.id}>{t.name}</option>; })}
              </select>
              {shelfErr ? <div style={{ fontSize: '12.5px', color: '#B91C1C', marginTop: '10px' }}>{shelfErr}</div> : null}
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={function () { if (!shelfBusy) setShelving(null); }} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
              <button onClick={shelveAndPublish} disabled={shelfBusy} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: shelfBusy ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>{shelfBusy ? 'Publishing...' : 'Publish to library'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
