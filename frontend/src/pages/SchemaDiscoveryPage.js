import React, { useEffect, useState } from 'react';
import api from '../lib/api';

var AVAIL = {
  releasable: { label: 'Releasable', bg: '#DEF7EC', fg: '#03543F' },
  review_required: { label: 'Review required', bg: '#FEF3C7', fg: '#92400E' },
  restricted: { label: 'Restricted', bg: '#FDE8E8', fg: '#9B1C1C' },
  confidential: { label: 'Confidential', bg: '#FDE8E8', fg: '#9B1C1C' }
};

export default function SchemaDiscoveryPage() {
  var [text, setText] = useState('');
  var [discovering, setDiscovering] = useState(false);
  var [result, setResult] = useState(null);
  var [error, setError] = useState('');
  var [drafts, setDrafts] = useState([]);
  var [loading, setLoading] = useState(true);
  var [busy, setBusy] = useState(null);

  useEffect(function(){ loadDrafts(); }, []);

  async function loadDrafts() {
    setLoading(true);
    try { var r = await api.get('/taxonomy/record-types', { params: { status: 'draft' } }); setDrafts(r.data.record_types); }
    catch (e) { console.error(e); }
    setLoading(false);
  }

  async function discover() {
    if (!text.trim() || discovering) return;
    setDiscovering(true); setError(''); setResult(null);
    try {
      var r = await api.post('/taxonomy/discover', { text: text });
      setResult(r.data);
      await loadDrafts();
    } catch (e) {
      setError((e.response && e.response.data && e.response.data.error) || 'Discovery failed');
    }
    setDiscovering(false);
  }

  async function approve(id) {
    setBusy(id);
    try { await api.patch('/taxonomy/record-types/' + id, { status: 'active' }); await loadDrafts(); }
    catch (e) { console.error(e); }
    setBusy(null);
  }
  async function reject(id) {
    setBusy(id);
    try { await api.delete('/taxonomy/record-types/' + id); await loadDrafts(); }
    catch (e) { console.error(e); }
    setBusy(null);
  }

  function pill(bg, fg, t) {
    return React.createElement('span', { style: { background: bg, color: fg, fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap' } }, t);
  }

  function draftCard(d) {
    var av = AVAIL[d.public_availability] || { label: d.public_availability, bg: '#F3F4F6', fg: '#6B7280' };
    return (
      <div key={d.id} style={{ border: '1px solid #E5E7EB', borderRadius: '10px', padding: '14px 16px', background: '#FFFDF5' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <div style={{ fontWeight: '700', fontSize: '15px', color: '#111' }}>{d.name}</div>
            <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>{d.category_name} \u00b7 code: {d.code}</div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {d.auto_release_eligible === 1 ? pill('#E1EFFE', '#1E429F', 'Auto-release') : null}
            {pill(av.bg, av.fg, av.label)}
            {typeof d.confidence === 'number' ? pill('#EDE9FE', '#5B21B6', 'AI ' + d.confidence + '%') : null}
          </div>
        </div>
        {d.intent ? <div style={{ fontSize: '13px', color: '#4B5563', marginTop: '8px' }}>{d.intent}</div> : null}
        <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '6px' }}>{(d.formats || []).join(', ')}{(d.synonyms && d.synonyms.length) ? ' \u00b7 ' + d.synonyms.join(', ') : ''}</div>
        {(d.identifying_facets && d.identifying_facets.length) ? <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>Pinned by: {d.identifying_facets.join(' \u00b7 ')}</div> : null}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button onClick={function(){ approve(d.id); }} disabled={busy === d.id} style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: '#059669', color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer', opacity: busy === d.id ? 0.6 : 1 }}>Approve</button>
          <button onClick={function(){ reject(d.id); }} disabled={busy === d.id} style={{ padding: '7px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', opacity: busy === d.id ? 0.6 : 1 }}>Reject</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '860px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 4px' }}>AI Schema Discovery</h1>
        <p style={{ color: '#9CA3AF', fontSize: '14px', margin: 0 }}>Paste a document or describe a record. The AI proposes a record type as a draft for your review. Nothing is added to the taxonomy until you approve it.</p>
      </div>
      <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '16px' }}>
        <textarea value={text} onChange={function(e){ setText(e.target.value); }} placeholder="Paste document text or describe the record type..."
          style={{ width: '100%', minHeight: '120px', padding: '10px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px' }}>
          <button onClick={discover} disabled={discovering || !text.trim()} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '14px', fontWeight: '600', cursor: 'pointer', opacity: (discovering || !text.trim()) ? 0.6 : 1 }}>
            {discovering ? 'Analyzing...' : 'Discover record type'}
          </button>
          {error ? <span style={{ color: '#DC2626', fontSize: '13px' }}>{error}</span> : null}
        </div>
        {result && result.matched_existing ? (
          <div style={{ marginTop: '12px', padding: '12px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', fontSize: '13px', color: '#1E40AF' }}>
            This looks like an existing record type: <strong>{result.matched_name}</strong> ({result.matched_code}). No draft was created.
          </div>
        ) : null}
        {result && !result.matched_existing && result.draft ? (
          <div style={{ marginTop: '12px', fontSize: '13px', color: '#059669' }}>Draft created and added to the review queue below.</div>
        ) : null}
      </div>
      <div>
        <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 4px' }}>Review queue {drafts.length ? '(' + drafts.length + ')' : ''}</h2>
        <p style={{ color: '#9CA3AF', fontSize: '13px', margin: '0 0 12px' }}>Draft record types awaiting approval.</p>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#9CA3AF' }}>Loading drafts...</div>
        ) : drafts.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#9CA3AF', border: '1px dashed #E5E7EB', borderRadius: '10px' }}>No drafts awaiting review.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {drafts.map(draftCard)}
          </div>
        )}
      </div>
    </div>
  );
}
