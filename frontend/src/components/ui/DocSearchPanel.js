import React, { useState } from 'react';
import api from '../../lib/api';

export default function DocSearchPanel({ requestId }) {
  var [q, setQ] = useState('');
  var [results, setResults] = useState(null);
  var [loading, setLoading] = useState(false);
  var [err, setErr] = useState('');

  async function run() {
    var query = q.trim();
    if (!query) return;
    setLoading(true); setErr(''); setResults(null);
    try {
      var r = await api.post('/semantic-search/documents', { query: query, requestId: requestId, topN: 8 });
      setResults(r.data.results || []);
    } catch (e) {
      setErr((e.response && e.response.data && e.response.data.error) || 'Search failed');
    }
    setLoading(false);
  }
  async function viewDoc(fileId) {
    try {
      var r = await api.get('/files/download/' + fileId, { responseType: 'blob' });
      var url = URL.createObjectURL(r.data);
      window.open(url, '_blank');
    } catch (e) { alert('Could not open the document.'); }
  }

  return (
    <div>
      <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--oq-fg-1f4e79)', marginBottom: '4px' }}>Search inside documents</div>
      <div style={{ fontSize: '12px', color: 'var(--oq-fg-6b7280)', marginBottom: '14px' }}>Ask in plain language and the assistant finds the most relevant pages across the documents attached to this request &mdash; by meaning, not just exact words.</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input value={q} onChange={function(e){ setQ(e.target.value); }} onKeyDown={function(e){ if (e.key === 'Enter') run(); }}
          placeholder='e.g. "filing status and dependents" or "health coverage dates"'
          style={{ flex: '1 1 320px', padding: '9px 12px', border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '8px', fontSize: '14px', outline: 'none' }} />
        <button onClick={run} disabled={loading || !q.trim()}
          style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: (loading || !q.trim()) ? 'var(--oq-bg-9ca3af)' : 'var(--oq-bg-1f4e79)', color: 'var(--oq-fg-ffffff)', fontSize: '13px', fontWeight: '600', cursor: (loading || !q.trim()) ? 'default' : 'pointer' }}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>
      {err ? <div style={{ fontSize: '13px', color: 'var(--oq-fg-9b1c1c)', marginTop: '12px' }}>{err}</div> : null}
      {(results !== null && !err) ? (
        results.length === 0 ? <div style={{ fontSize: '13px', color: 'var(--oq-fg-9ca3af)', marginTop: '14px' }}>No matching pages. This request may not have documents with extracted text yet.</div> : (
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {results.map(function(r, idx) {
            var pct = Math.max(0, Math.min(100, Math.round(r.score * 100)));
            return (
              <div key={r.pageId} style={{ border: '1px solid var(--oq-ln-e5e7eb)', borderRadius: '10px', padding: '12px 14px', background: idx === 0 ? 'var(--oq-bg-f8faff)' : 'var(--oq-bg-ffffff)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--oq-fg-111111)' }}>{r.fileName} &middot; page {r.pageNo}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    <div style={{ width: '90px' }}>
                      <div style={{ height: '6px', background: 'var(--oq-bg-e5e7eb)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: pct + '%', height: '100%', background: 'var(--oq-bg-1f4e79)' }}></div>
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--oq-fg-6b7280)', textAlign: 'right', marginTop: '2px' }}>{r.score.toFixed(2)} match</div>
                    </div>
                    {r.fileId ? <button onClick={function(){ viewDoc(r.fileId); }} style={{ padding: '5px 12px', borderRadius: '8px', border: '1px solid var(--oq-ln-1f4e79)', background: 'var(--oq-bg-ffffff)', color: 'var(--oq-fg-1f4e79)', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>View</button> : null}
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--oq-fg-4b5563)', marginTop: '8px', lineHeight: '1.5' }}>{r.snippet}{(r.snippet && r.snippet.length >= 300) ? '...' : ''}</div>
              </div>
            );
          })}
          <div style={{ fontSize: '11px', color: 'var(--oq-fg-9ca3af)', marginTop: '2px' }}>Ranked by semantic similarity to your query.</div>
        </div>
        )
      ) : null}
    </div>
  );
}
