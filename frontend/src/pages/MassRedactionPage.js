import React, { useEffect, useState } from 'react';
import api from '../lib/api';

function scoreColor(pass) { return pass === true ? '#03543F' : pass === false ? '#92400E' : '#6B7280'; }
function scoreBg(pass) { return pass === true ? '#DEF7EC' : pass === false ? '#FEF3C7' : '#F3F4F6'; }

export default function MassRedactionPage() {
  var [templates, setTemplates] = useState([]);
  var [loading, setLoading] = useState(true);

  // batch runner state
  var [batchTpl, setBatchTpl] = useState(null);
  var [candidates, setCandidates] = useState([]);
  var [candLoading, setCandLoading] = useState(false);
  var [selected, setSelected] = useState({});
  var [checking, setChecking] = useState(false);
  var [checkResults, setCheckResults] = useState(null);
  var [processing, setProcessing] = useState(false);
  var [batchResults, setBatchResults] = useState(null);
  var [batchErr, setBatchErr] = useState('');

  useEffect(function () { load(); }, []);
  async function load() {
    setLoading(true);
    try { var r = await api.get('/redaction-templates'); setTemplates(r.data.templates || []); } catch (e) { console.error(e); }
    setLoading(false);
  }
  async function remove(t) {
    if (!window.confirm('Delete the template "' + t.name + '"? This does not affect any documents already redacted with it.')) return;
    try { await api.delete('/redaction-templates/' + t.id); load(); } catch (e) { alert('Could not delete the template.'); }
  }

  async function runBatch(t) {
    setBatchTpl(t); setSelected({}); setCheckResults(null); setBatchResults(null); setBatchErr(''); setCandidates([]); setCandLoading(true);
    try { var r = await api.get('/redaction-templates/' + t.id + '/candidates'); setCandidates(r.data.candidates || []); } catch (e) { setBatchErr('Could not load documents.'); }
    setCandLoading(false);
  }
  function closeBatch() { if (processing) return; setBatchTpl(null); }
  function toggleSel(id) { setSelected(function (m) { var n = Object.assign({}, m); if (n[id]) delete n[id]; else n[id] = true; return n; }); }
  function selectAll() { var n = {}; candidates.forEach(function (c) { n[c.id] = true; }); setSelected(n); }
  function clearSel() { setSelected({}); }
  var selIds = Object.keys(selected);

  async function runCheck() {
    setChecking(true); setBatchErr(''); setCheckResults(null);
    try {
      var r = await api.post('/redaction-templates/' + batchTpl.id + '/apply-batch', { file_ids: selIds, commit: false });
      setCheckResults(r.data);
    } catch (e) { setBatchErr('Safety check failed. ' + ((e.response && e.response.data && e.response.data.error) || '')); }
    setChecking(false);
  }
  async function runProcess() {
    var passing = checkResults.results.filter(function (r) { return r.pass === true; });
    if (!passing.length) { setBatchErr('No documents passed the safety check.'); return; }
    if (!window.confirm('Redact ' + passing.length + ' document(s) with this template and release them? Documents below the safety threshold are skipped.')) return;
    setProcessing(true); setBatchErr('');
    try {
      var ids = passing.map(function (r) { return r.file_id; });
      var r = await api.post('/redaction-templates/' + batchTpl.id + '/apply-batch', { file_ids: ids, commit: true });
      setBatchResults(r.data);
    } catch (e) { setBatchErr('Processing failed. ' + ((e.response && e.response.data && e.response.data.error) || '')); }
    setProcessing(false);
  }
  async function downloadOut(fileId, name) {
    try {
      var r = await api.get('/files/download/' + fileId, { responseType: 'blob' });
      var url = URL.createObjectURL(r.data); var a = document.createElement('a'); a.href = url; a.download = name || 'redacted.pdf'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { alert('Download failed.'); }
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 6px' }}>Mass Redaction</h1>
      <p style={{ color: '#6B7280', fontSize: '13px', margin: '0 0 18px', lineHeight: 1.5 }}>
        Reusable redaction templates for same-format records. Define a template once &mdash; the boxes and the rule each cites &mdash; then run it across a batch of documents of that form type. Every document is checked against the template's layout first, so the boxes are never stamped onto a form they don't fit.
      </p>

      <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#1E40AF', lineHeight: 1.5 }}>
        To create a template: open a sample document in the redaction workspace (the <strong>Redact</strong> button on a PDF in a request's Records tab), place your boxes and attach a rule to each, then choose <strong>Save as Reusable Template</strong>. For a structured CSV record, use <strong>Redact fields</strong> on the record, mark the exempt columns, and choose <strong>Save as reusable template</strong>.
      </div>

      <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151', marginBottom: '10px' }}>Templates ({templates.length})</div>
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>Loading templates...</div>
      ) : templates.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', background: 'white', border: '1px dashed #E5E7EB', borderRadius: '12px', color: '#9CA3AF' }}>
          No templates yet. Define one from a sample document in the redaction workspace using "Save as Reusable Template."
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {templates.map(function (t) {
            return (
              <div key={t.id} style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    <span style={{ fontWeight: '700', fontSize: '14.5px', color: '#1F4E79' }}>{t.name}</span>
                    <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '.03em', padding: '1px 7px', borderRadius: '999px', color: t.kind === 'fields' ? '#3730A3' : '#374151', background: t.kind === 'fields' ? '#E0E7FF' : '#F3F4F6' }}>{t.kind === 'fields' ? 'FIELDS' : 'PAGES'}</span>
                  </div>
                  {t.description ? <div style={{ fontSize: '12.5px', color: '#6B7280', marginBottom: '3px' }}>{t.description}</div> : null}
                  <div style={{ fontSize: '12px', color: '#9CA3AF' }}>
                    {t.kind === 'fields' ? (t.field_count + ' field' + (t.field_count !== 1 ? 's' : '')) : (t.zone_count + ' box' + (t.zone_count !== 1 ? 'es' : ''))}
                    {t.record_type_name ? ' \u00b7 ' + t.record_type_name : ''}
                    {t.source_filename ? ' \u00b7 from ' + t.source_filename : ''}
                    {t.created_at ? ' \u00b7 ' + (t.created_at || '').slice(0, 10) : ''}
                  </div>
                </div>
                <button onClick={function () { runBatch(t); }} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '12.5px', fontWeight: '700', cursor: 'pointer' }}>Run batch</button>
                <button onClick={function () { remove(t); }} style={{ flexShrink: 0, padding: '7px 12px', borderRadius: '8px', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Delete</button>
              </div>
            );
          })}
        </div>
      )}

      {batchTpl ? (
        <div onClick={closeBatch} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '20px' }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '14px', width: '660px', maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F3F4F6' }}>
              <div style={{ fontWeight: '700', fontSize: '16px' }}>Run batch &mdash; {batchTpl.name}</div>
              <div style={{ fontSize: '12.5px', color: '#6B7280', marginTop: '3px' }}>{batchTpl.zone_count} box(es) &middot; safety threshold {batchTpl.safety_threshold != null ? batchTpl.safety_threshold : 80}%. Each document is matched to the template's layout; only documents at or above the threshold are redacted.</div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
              {batchErr ? <div style={{ background: '#FEF2F2', color: '#991B1B', padding: '9px 12px', borderRadius: '8px', fontSize: '12.5px', marginBottom: '12px' }}>{batchErr}</div> : null}

              {batchResults ? (
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151', marginBottom: '10px' }}>Results</div>
                  {batchResults.results.map(function (r) {
                    var ok = r.status === 'redacted';
                    return (
                      <div key={r.file_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '9px 12px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px', color: ok ? '#03543F' : r.status === 'held' ? '#92400E' : '#9B1C1C', background: ok ? '#DEF7EC' : r.status === 'held' ? '#FEF3C7' : '#FDE8E8' }}>{r.status === 'redacted' ? 'Redacted' : r.status === 'held' ? 'Held' : 'Error'}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: '13px', color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}{r.reason ? <span style={{ color: '#92400E', fontSize: '11.5px' }}> &mdash; {r.reason}</span> : null}{r.error ? <span style={{ color: '#9B1C1C', fontSize: '11.5px' }}> &mdash; {r.error}</span> : null}</span>
                        {ok ? <button onClick={function () { downloadOut(r.outputFileId, r.fileName); }} style={{ flexShrink: 0, padding: '5px 10px', borderRadius: '6px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '11.5px', fontWeight: '700', cursor: 'pointer' }}>Download</button> : null}
                      </div>
                    );
                  })}
                  <div style={{ fontSize: '12.5px', color: '#6B7280', marginTop: '10px' }}>{batchResults.summary.redacted} redacted &amp; released, {batchResults.summary.held} held, {batchResults.summary.errors} error(s). Redacted copies are now in Released Records and searchable in the Fulfilled Request Index.</div>
                </div>
              ) : checkResults ? (
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151', marginBottom: '10px' }}>Safety check</div>
                  {checkResults.results.map(function (r) {
                    return (
                      <div key={r.file_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '9px 12px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px', color: scoreColor(r.pass), background: scoreBg(r.pass) }}>{r.pass === true ? 'Match' : r.pass === false ? 'Mismatch' : 'No fingerprint'}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: '13px', color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                        <span style={{ flexShrink: 0, fontSize: '12px', fontWeight: '700', color: scoreColor(r.pass) }}>{r.score == null ? '\u2014' : r.score + '%'}</span>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: '12.5px', color: '#6B7280', marginTop: '10px' }}>{checkResults.summary.passing} of {checkResults.results.length} match the template and will be redacted. Mismatches are skipped &mdash; redact those individually in the workspace.</div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151' }}>Select documents ({selIds.length} selected)</div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={selectAll} style={{ border: 'none', background: 'transparent', color: '#1F4E79', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Select all</button>
                      <button onClick={clearSel} style={{ border: 'none', background: 'transparent', color: '#6B7280', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Clear</button>
                    </div>
                  </div>
                  {candLoading ? <div style={{ color: '#9CA3AF', fontSize: '13px', padding: '20px', textAlign: 'center' }}>Loading documents...</div>
                    : candidates.length === 0 ? <div style={{ color: '#9CA3AF', fontSize: '13px', padding: '20px', textAlign: 'center' }}>No PDF documents available.</div>
                    : candidates.map(function (c) {
                      return (
                        <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '9px 12px', marginBottom: '8px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!selected[c.id]} onChange={function () { toggleSel(c.id); }} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '13px', color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                            {c.request_desc ? <span style={{ display: 'block', fontSize: '11.5px', color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.request_desc}</span> : null}
                          </span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>

            <div style={{ padding: '16px 22px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              {batchResults ? (
                <button onClick={function () { setBatchTpl(null); }} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>Done</button>
              ) : checkResults ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={function () { setCheckResults(null); }} disabled={processing} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Back</button>
                  <button onClick={runProcess} disabled={processing || checkResults.summary.passing === 0} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: (processing || checkResults.summary.passing === 0) ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>{processing ? 'Processing...' : 'Redact ' + checkResults.summary.passing + ' matching'}</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={closeBatch} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
                  <button onClick={runCheck} disabled={checking || !selIds.length} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: (checking || !selIds.length) ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>{checking ? 'Checking...' : 'Run safety check'}</button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
