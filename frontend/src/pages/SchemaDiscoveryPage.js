import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import RecordTypeEditor from '../components/RecordTypeEditor';

var AVAIL = {
  releasable: { label: 'Releasable', bg: 'var(--oq-bg-def7ec)', fg: 'var(--oq-fg-03543f)' },
  review_required: { label: 'Review required', bg: 'var(--oq-bg-fef3c7)', fg: 'var(--oq-fg-92400e)' },
  restricted: { label: 'Restricted', bg: 'var(--oq-bg-fde8e8)', fg: 'var(--oq-fg-9b1c1c)' },
  confidential: { label: 'Confidential', bg: 'var(--oq-bg-fde8e8)', fg: 'var(--oq-fg-9b1c1c)' }
};

export default function SchemaDiscoveryPage() {
  var navigate = useNavigate();
  var [text, setText] = useState('');
  var [discovering, setDiscovering] = useState(false);
  var [result, setResult] = useState(null);
  var [error, setError] = useState('');
  var [drafts, setDrafts] = useState([]);
  var [loading, setLoading] = useState(true);
  var [busy, setBusy] = useState(null);
  var [cats, setCats] = useState([]);
  var [editor, setEditor] = useState(null);
  var [repos, setRepos] = useState([]);
  var [selRepo, setSelRepo] = useState('');
  var [scanning, setScanning] = useState(false);
  var [scanResult, setScanResult] = useState(null);

  useEffect(function(){ loadDrafts(); }, []);

  async function loadDrafts() {
    setLoading(true);
    try { var r = await api.get('/taxonomy/record-types', { params: { status: 'draft' } }); setDrafts(r.data.record_types); var cr = await api.get('/taxonomy/categories'); setCats(cr.data.categories); var rr = await api.get('/taxonomy/repositories'); setRepos(rr.data.repositories); if (rr.data.repositories.length && !selRepo) setSelRepo(rr.data.repositories[0].id); }
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

  async function scan() {
    if (!selRepo || scanning) return;
    setScanning(true); setScanResult(null); setError('');
    try {
      var r = await api.post('/taxonomy/discover-scan', { repository_id: selRepo });
      setScanResult(r.data);
      await loadDrafts();
    } catch (e) {
      setError((e.response && e.response.data && e.response.data.error) || 'Scan failed');
    }
    setScanning(false);
  }

  function renderScanResult() {
    var sr = scanResult;
    return (
      <div style={{ marginTop: '12px', padding: '12px', background: 'var(--oq-bg-f9fafb)', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '8px', fontSize: '13px' }}>
        <div style={{ fontWeight: '600', marginBottom: '6px' }}>Scanned {sr.scanned} record{sr.scanned!==1?'s':''} from {sr.repository}: {(sr.created||[]).length} new draft{(sr.created||[]).length!==1?'s':''}, {(sr.matched||[]).length} already in taxonomy.</div>
        {(sr.created||[]).length ? <div style={{ color: 'var(--oq-fg-059669)' }}>New: {(sr.created||[]).map(function(c){ return c.name; }).join(', ')}</div> : null}
        {(sr.matched||[]).length ? <div style={{ color: 'var(--oq-fg-6b7280)', marginTop: '4px' }}>Matched existing: {(sr.matched||[]).map(function(m){ return m.name; }).join(', ')}</div> : null}
      </div>
    );
  }

  async function approve(id) {
    setBusy(id);
    try { await api.patch('/taxonomy/record-types/' + id, { status: 'active' }); await loadDrafts(); }
    catch (e) { setError((e.response && e.response.data && e.response.data.error) || 'Could not approve the draft'); }
    setBusy(null);
  }
  async function reject(id) {
    setBusy(id);
    try { await api.delete('/taxonomy/record-types/' + id); await loadDrafts(); }
    catch (e) { setError((e.response && e.response.data && e.response.data.error) || 'Could not reject the draft'); }
    setBusy(null);
  }

  function pill(bg, fg, t) {
    return React.createElement('span', { style: { background: bg, color: fg, fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap' } }, t);
  }

  function draftCard(d) {
    var av = AVAIL[d.public_availability] || { label: d.public_availability, bg: 'var(--oq-bg-f3f4f6)', fg: 'var(--oq-fg-6b7280)' };
    return (
      <div key={d.id} style={{ border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', padding: '14px 16px', background: 'var(--oq-bg-fffdf5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <div style={{ fontWeight: '700', fontSize: '15px', color: 'var(--oq-fg-111111)' }}>{d.name}</div>
            <div style={{ fontSize: '12px', color: 'var(--oq-fg-9ca3af)', marginTop: '2px' }}>{d.category_name} · code: {d.code}</div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {d.auto_release_eligible === 1 ? pill('var(--oq-x-e1effe)', 'var(--oq-x-1e429f)', 'Auto-release') : null}
            {pill(av.bg, av.fg, av.label)}
            {typeof d.confidence === 'number' ? pill('var(--oq-x-ede9fe)', 'var(--oq-x-5b21b6)', 'AI ' + d.confidence + '%') : null}
          </div>
        </div>
        {d.intent ? <div style={{ fontSize: '13px', color: 'var(--oq-fg-4b5563)', marginTop: '8px' }}>{d.intent}</div> : null}
        <div style={{ fontSize: '12px', color: 'var(--oq-fg-9ca3af)', marginTop: '6px' }}>{(d.formats || []).join(', ')}{(d.synonyms && d.synonyms.length) ? ' \u00b7 ' + d.synonyms.join(', ') : ''}</div>
        {(d.identifying_facets && d.identifying_facets.length) ? <div style={{ fontSize: '12px', color: 'var(--oq-fg-9ca3af)', marginTop: '2px' }}>Pinned by: {d.identifying_facets.join(' \u00b7 ')}</div> : null}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button onClick={function(){ approve(d.id); }} disabled={busy === d.id} style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: 'var(--oq-bg-059669)', color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: '600', cursor: 'pointer', opacity: busy === d.id ? 0.6 : 1 }}>Approve</button>
          <button onClick={function(){ setEditor(d); }} style={{ padding: '7px 16px', borderRadius: '8px', border: '1px solid var(--oq-ln-e5e7eb)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-374151)', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Edit</button>
          <button onClick={function(){ reject(d.id); }} disabled={busy === d.id} style={{ padding: '7px 16px', borderRadius: '8px', border: '1px solid var(--oq-ln-e5e7eb)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-dc2626)', fontSize: '13px', fontWeight: '600', cursor: 'pointer', opacity: busy === d.id ? 0.6 : 1 }}>Reject</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '860px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <button onClick={function(){ navigate('/taxonomy'); }} style={{ background: 'none', border: 'none', color: 'var(--oq-fg-1f4e79)', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '0 0 6px' }}>&larr; Back to Taxonomy</button>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 4px' }}>AI Schema Discovery</h1>
        <p style={{ color: 'var(--oq-fg-9ca3af)', fontSize: '14px', margin: 0 }}>Paste a document or describe a record. The AI proposes a record type as a draft for your review. Nothing is added to the taxonomy until you approve it.</p>
      </div>
      <div style={{ background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '12px', padding: '16px' }}>
        <textarea value={text} onChange={function(e){ setText(e.target.value); }} placeholder="Paste document text or describe the record type..."
          style={{ width: '100%', minHeight: '120px', padding: '10px 12px', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px' }}>
          <button onClick={discover} disabled={discovering || !text.trim()} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: 'var(--oq-bg-1f4e79)', color: 'var(--oq-fg-ffffff)', fontSize: '14px', fontWeight: '600', cursor: 'pointer', opacity: (discovering || !text.trim()) ? 0.6 : 1 }}>
            {discovering ? 'Analyzing...' : 'Discover record type'}
          </button>
          {error ? <span style={{ color: 'var(--oq-fg-dc2626)', fontSize: '13px' }}>{error}</span> : null}
        </div>
        {result && result.matched_existing ? (
          <div style={{ marginTop: '12px', padding: '12px', background: 'var(--oq-bg-eff6ff)', border: '1px solid var(--oq-ln-bfdbfe)', borderRadius: '8px', fontSize: '13px', color: 'var(--oq-fg-1e40af)' }}>
            This looks like an existing record type: <strong>{result.matched_name}</strong> ({result.matched_code}). No draft was created.
          </div>
        ) : null}
        {result && !result.matched_existing && result.draft ? (
          <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--oq-fg-059669)' }}>Draft created and added to the review queue below.</div>
        ) : null}
      </div>
      <div style={{ background: 'var(--oq-bg-ffffff)', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontWeight: '700', fontSize: '15px', marginBottom: '4px' }}>Scan a source</div>
        <p style={{ color: 'var(--oq-fg-9ca3af)', fontSize: '13px', margin: '0 0 12px' }}>Point the AI at a connected repository. It samples the records, identifies the distinct record types, and adds any new ones as drafts below.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <select value={selRepo} onChange={function(e){ setSelRepo(e.target.value); }} style={{ flex: 1, minWidth: '220px', padding: '9px 11px', border: '1px solid var(--oq-ln-d1d5db)', borderRadius: '8px', fontSize: '14px' }}>
            {repos.map(function(rp){ return <option key={rp.id} value={rp.id}>{rp.name} ({rp.connector_type})</option>; })}
          </select>
          <button onClick={scan} disabled={scanning || !selRepo} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: 'var(--oq-bg-1f4e79)', color: 'var(--oq-fg-ffffff)', fontSize: '14px', fontWeight: '600', cursor: 'pointer', opacity: (scanning || !selRepo) ? 0.6 : 1 }}>{scanning ? 'Scanning...' : 'Scan source'}</button>
        </div>
        {scanning ? <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--oq-fg-6b7280)' }}>Sampling records and identifying types — this can take up to a minute.</div> : null}
        {scanResult ? renderScanResult() : null}
      </div>
      <div>
        <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 4px' }}>Review queue {drafts.length ? '(' + drafts.length + ')' : ''}</h2>
        <p style={{ color: 'var(--oq-fg-9ca3af)', fontSize: '13px', margin: '0 0 12px' }}>Draft record types awaiting approval.</p>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--oq-fg-9ca3af)' }}>Loading drafts...</div>
        ) : drafts.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--oq-fg-9ca3af)', border: '1px dashed var(--oq-ln-e5e7eb)', borderRadius: '10px' }}>No drafts awaiting review.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {drafts.map(draftCard)}
          </div>
        )}
      </div>
      {editor ? <RecordTypeEditor mode="edit" initial={editor} categories={cats} onClose={function(){ setEditor(null); }} onSaved={function(){ setEditor(null); loadDrafts(); }} /> : null}
    </div>
  );
}
