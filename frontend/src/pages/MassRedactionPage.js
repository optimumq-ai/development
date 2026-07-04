import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import MassJobsPanel from '../components/MassJobsPanel';
import { useNavigate } from 'react-router-dom';

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

  // scheduled-job state
  var [scheduleMode, setScheduleMode] = useState(false);
  var [scheduleForm, setScheduleForm] = useState(false);
  var [jobName, setJobName] = useState('');
  var [chunkSize, setChunkSize] = useState(500);
  var [creating, setCreating] = useState(false);
  var [createdJob, setCreatedJob] = useState(null);
  var [cfg, setCfg] = useState(null);
  var [jobsReload, setJobsReload] = useState(0);
  var [status911, setStatus911] = useState(null);
  var [busy911, setBusy911] = useState('');
  var [msg911, setMsg911] = useState('');
  var [viewTpl, setViewTpl] = useState(null);
  var [viewDetail, setViewDetail] = useState(null);
  var [viewSample, setViewSample] = useState(undefined);
  var [newTplOpen, setNewTplOpen] = useState(false);
  var [uploading, setUploading] = useState(false);
  var [uploadErr, setUploadErr] = useState('');
  var navigate = useNavigate();

  useEffect(function () { load(); }, []);
  useEffect(function () { api.get('/mass-jobs/config').then(function (r) { setCfg(r.data); }).catch(function () {}); }, []);
  useEffect(function () { loadStatus911(); }, []);
  async function load() {
    setLoading(true);
    try { var r = await api.get('/redaction-templates'); setTemplates(r.data.templates || []); } catch (e) { console.error(e); }
    setLoading(false);
  }
  async function remove(t) {
    if (!window.confirm('Delete the template "' + t.name + '"? This does not affect any documents already redacted with it.')) return;
    try { await api.delete('/redaction-templates/' + t.id); load(); } catch (e) { alert('Could not delete the template.'); }
  }

  async function openCandidates(t, schedule) {
    setBatchTpl(t); setSelected({}); setCheckResults(null); setBatchResults(null); setBatchErr(''); setCandidates([]);
    setScheduleMode(!!schedule); setScheduleForm(false); setCreatedJob(null);
    setJobName(t.name + ' \u2014 batch'); setChunkSize(500);
    setCandLoading(true);
    try { var r = await api.get('/redaction-templates/' + t.id + '/candidates'); setCandidates(r.data.candidates || []); } catch (e) { setBatchErr('Could not load documents.'); }
    setCandLoading(false);
  }
  function runBatch(t) { openCandidates(t, false); }
  function scheduleJob(t) { openCandidates(t, true); }
  function closeBatch() { if (processing || creating) return; setBatchTpl(null); setScheduleMode(false); setScheduleForm(false); setCreatedJob(null); }
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
  async function createJob() {
    setCreating(true); setBatchErr('');
    try {
      var r = await api.post('/mass-jobs', { name: jobName || (batchTpl.name + ' batch'), template_id: batchTpl.id, file_ids: selIds, chunk_size: parseInt(chunkSize, 10) || 500 });
      setCreatedJob(r.data);
      setJobsReload(function (n) { return n + 1; });
    } catch (e) { setBatchErr('Could not create the job. ' + ((e.response && e.response.data && e.response.data.error) || '')); }
    setCreating(false);
  }
  async function downloadOut(fileId, name) {
    try {
      var r = await api.get('/files/download/' + fileId, { responseType: 'blob' });
      var url = URL.createObjectURL(r.data); var a = document.createElement('a'); a.href = url; a.download = name || 'redacted.pdf'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { alert('Download failed.'); }
  }

  var budget = cfg ? cfg.nightly_budget : 500;
  var effChunk = Math.max(1, Math.min(parseInt(chunkSize, 10) || 500, budget));
  var estNights = selIds.length ? Math.ceil(selIds.length / effChunk) : 0;
  var estDate = '';
  if (estNights > 0) { var d = new Date(); d.setDate(d.getDate() + estNights); estDate = d.toISOString().slice(0, 10); }

  async function handleSampleUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploading(true); setUploadErr('');
    try {
      var fd = new FormData(); fd.append('file', file);
      var r = await api.post('/files/upload/req-template-samples', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      var fid = r.data.fileId;
      var name = (file.name || '').toLowerCase();
      if (name.slice(-4) === '.csv' || name.slice(-4) === '.tsv') navigate('/redact-fields/' + fid);
      else navigate('/redact/' + fid);
    } catch (err) { setUploadErr('Could not upload the sample. ' + ((err.response && err.response.data && err.response.data.error) || '')); setUploading(false); }
  }

  async function openView(t) {
    setViewTpl(t); setViewDetail(null); setViewSample(undefined);
    try { var r = await api.get('/redaction-templates/' + t.id); setViewDetail(r.data.template); } catch (e) { setViewDetail({ error: true }); }
    try { var sm = await api.get('/redaction-templates/' + t.id + '/sample'); setViewSample(sm.data.sample); } catch (e) { setViewSample(null); }
  }
  function closeView() { setViewTpl(null); setViewDetail(null); setViewSample(undefined); }
  async function downloadSample(fileId) {
    try { var resp = await api.get('/files/download/' + fileId, { responseType: 'blob' }); var url = URL.createObjectURL(resp.data); window.open(url, '_blank'); setTimeout(function () { URL.revokeObjectURL(url); }, 60000); }
    catch (e) { alert('Could not open the sample.'); }
  }

  async function loadStatus911() {
    try { var r = await api.get('/mass-jobs/911/status'); setStatus911(r.data); } catch (e) { /* ignore */ }
  }
  async function logCalls() {
    setBusy911('log'); setMsg911('');
    try { var r = await api.post('/mass-jobs/911/generate', { count: 20 }); setStatus911({ sourceTotal: r.data.sourceTotal, newSinceLastPull: r.data.newSinceLastPull }); setMsg911('The 911 system logged 20 new calls.'); }
    catch (e) { setMsg911('Could not log calls.'); }
    setBusy911('');
  }
  async function pullProcess() {
    setBusy911('pull'); setMsg911('');
    try {
      var r = await api.post('/mass-jobs/911/pull', {}); var d = r.data || {};
      setStatus911({ sourceTotal: d.sourceTotal, newSinceLastPull: d.newSinceLastPull });
      setMsg911(d.pulled ? ('Pulled ' + d.pulled + ', born-redacted ' + d.redacted + ' \u2014 published to the library & map.') : 'Nothing new to pull.');
      setJobsReload(function (x) { return x + 1; });
    } catch (e) { setMsg911('Could not pull.'); }
    setBusy911('');
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

      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px 16px', marginBottom: '22px' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: '#92400E', marginBottom: '4px' }}>911 Call Records &mdash; incremental pull demo</div>
        <div style={{ fontSize: '12.5px', color: '#78350F', lineHeight: 1.5, marginBottom: '10px' }}>
          The <strong>911 Call Management System (demo)</strong> accumulates call records on its own side. Optimum Q pulls only what&rsquo;s <strong>new since its last checkpoint</strong>, born-redacts each (caller name, phone, and home address withheld) while the incident type, location, and disposition stay public, and publishes to the library + map. Same incremental-pull pattern a real CAD connector or nightly export uses.
        </div>
        <div style={{ fontSize: '12.5px', color: '#374151', marginBottom: '10px' }}>
          {status911 ? (<span>911 system holds <strong>{status911.sourceTotal}</strong> record{status911.sourceTotal !== 1 ? 's' : ''} &middot; <strong style={{ color: status911.newSinceLastPull ? '#B45309' : '#03543F' }}>{status911.newSinceLastPull}</strong> new since last pull</span>) : <span style={{ color: '#9CA3AF' }}>Loading status\u2026</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={logCalls} disabled={!!busy911} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #B45309', background: 'white', color: '#B45309', fontSize: '13px', fontWeight: '700', cursor: busy911 ? 'default' : 'pointer', opacity: busy911 ? 0.6 : 1 }}>{busy911 === 'log' ? 'Logging\u2026' : 'Log 20 new calls (simulate dispatch)'}</button>
          <button onClick={pullProcess} disabled={!!busy911} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#B45309', color: 'white', fontSize: '13px', fontWeight: '700', cursor: busy911 ? 'default' : 'pointer', opacity: busy911 ? 0.6 : 1 }}>{busy911 === 'pull' ? 'Pulling & processing\u2026' : ('Pull & process new records' + (status911 && status911.newSinceLastPull ? ' (' + status911.newSinceLastPull + ')' : ''))}</button>
          {msg911 ? <span style={{ fontSize: '12.5px', color: '#03543F', fontWeight: '600' }}>{msg911}</span> : null}
        </div>
      </div>

      <MassJobsPanel reloadKey={jobsReload} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151' }}>Templates ({templates.length})</div>
        <button onClick={function () { setUploadErr(''); setNewTplOpen(true); }} style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '12.5px', fontWeight: '700', cursor: 'pointer' }}>+ New template</button>
      </div>
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
                <button onClick={function () { openView(t); }} title="See what this template redacts" style={{ flexShrink: 0, padding: '7px 12px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '12.5px', fontWeight: '700', cursor: 'pointer' }}>View</button>
                <button onClick={function () { scheduleJob(t); }} title="Queue a large batch for overnight processing" style={{ flexShrink: 0, padding: '7px 14px', borderRadius: '8px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '12.5px', fontWeight: '700', cursor: 'pointer' }}>Schedule job</button>
                <button onClick={function () { runBatch(t); }} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '12.5px', fontWeight: '700', cursor: 'pointer' }}>Run batch</button>
                <button onClick={function () { remove(t); }} style={{ flexShrink: 0, padding: '7px 12px', borderRadius: '8px', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Delete</button>
              </div>
            );
          })}
        </div>
      )}

      {newTplOpen ? (
        <div onClick={function () { if (!uploading) setNewTplOpen(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '20px' }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '14px', width: '520px', maxWidth: '100%', padding: '24px' }}>
            <div style={{ fontWeight: '700', fontSize: '16px', marginBottom: '6px' }}>New redaction template</div>
            <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.55, marginBottom: '16px' }}>
              A template is built from one <strong>sample record</strong>. Upload a sample and we&rsquo;ll open the redaction workspace, where you mark what to redact and save it as a reusable template.
              <ul style={{ margin: '10px 0 0', paddingLeft: '18px', color: '#6B7280' }}>
                <li style={{ marginBottom: '4px' }}><strong>CSV export</strong> (structured data like 911 calls) &rarr; mark exempt <em>columns</em>; values are dropped before the record is built (born-redacted).</li>
                <li><strong>PDF</strong> (a form) &rarr; draw <em>boxes</em> over the areas to cover, and attach a rule to each.</li>
              </ul>
            </div>
            {uploadErr ? <div style={{ fontSize: '12.5px', color: '#9B1C1C', marginBottom: '10px' }}>{uploadErr}</div> : null}
            <label style={{ display: 'inline-block', padding: '11px 18px', borderRadius: '8px', background: uploading ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: uploading ? 'default' : 'pointer' }}>
              {uploading ? 'Uploading\u2026' : 'Upload a sample (CSV or PDF)'}
              <input type="file" accept=".csv,.tsv,.pdf" disabled={uploading} onChange={handleSampleUpload} style={{ display: 'none' }} />
            </label>
            <button onClick={function () { if (!uploading) setNewTplOpen(false); }} style={{ marginLeft: '10px', padding: '11px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : null}

      {viewTpl ? (
        <div onClick={closeView} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '20px' }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '14px', width: '560px', maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F3F4F6' }}>
              <div style={{ fontWeight: '700', fontSize: '16px' }}>{viewTpl.name}</div>
              <div style={{ fontSize: '12.5px', color: '#6B7280', marginTop: '3px' }}>{viewTpl.kind === 'fields' ? 'Structured / born-redacted (drops exempt columns)' : 'Page redaction (covers zones on the page)'}{viewTpl.record_type_name ? ' \u00b7 ' + viewTpl.record_type_name : ''} \u00b7 safety threshold {viewTpl.safety_threshold != null ? viewTpl.safety_threshold : 80}%</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
              {!viewDetail ? <div style={{ color: '#9CA3AF', fontSize: '13px' }}>Loading\u2026</div> : viewDetail.error ? <div style={{ color: '#9B1C1C' }}>Could not load template detail.</div> : (
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>{viewTpl.kind === 'fields' ? 'Fields withheld (dropped from every record)' : 'Redaction boxes'}</div>
                  {viewTpl.kind === 'fields' ? (
                    (viewDetail.field_map || []).length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {viewDetail.field_map.map(function (f, i) { return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px' }}>
                            <span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: '700', color: '#991B1B' }}>{f.field}</span>
                            <span style={{ flex: 1 }} />
                            <span style={{ fontSize: '11.5px', color: '#9CA3AF' }}>withheld</span>
                          </div>
                        ); })}
                      </div>
                    ) : <div style={{ color: '#9CA3AF', fontSize: '13px' }}>No fields configured.</div>
                  ) : (
                    (viewDetail.zones || []).length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {viewDetail.zones.map(function (z, i) { return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#F3F4F6', borderRadius: '8px', fontSize: '12.5px' }}>
                            <span style={{ fontWeight: '700' }}>Box {i + 1}</span>
                            <span style={{ color: '#6B7280' }}>page {z.page_no || 1}</span>
                            {z.label ? <span style={{ color: '#6B7280' }}>\u00b7 {z.label}</span> : null}
                          </div>
                        ); })}
                      </div>
                    ) : <div style={{ color: '#9CA3AF', fontSize: '13px' }}>No boxes configured.</div>
                  )}
                  <div style={{ marginTop: '16px', fontSize: '12px', color: '#6B7280', lineHeight: 1.5 }}>
                    {viewTpl.kind === 'fields' ? 'These columns are dropped before the record is rendered, so their values never appear in the released copy. Everything else stays public.' : 'These boxes are stamped over the matching areas on each document that passes the layout check.'}
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding: '16px 22px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <div>
                {viewSample === undefined ? null : viewSample ? <button onClick={function () { downloadSample(viewSample.output_file_id); }} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>View a sample redacted output</button> : <span style={{ fontSize: '12px', color: '#9CA3AF' }}>No processed sample yet</span>}
              </div>
              <button onClick={closeView} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {batchTpl ? (
        <div onClick={closeBatch} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '20px' }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '14px', width: '660px', maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F3F4F6' }}>
              <div style={{ fontWeight: '700', fontSize: '16px' }}>{scheduleMode ? 'Schedule nightly job' : 'Run batch'} &mdash; {batchTpl.name}</div>
              <div style={{ fontSize: '12.5px', color: '#6B7280', marginTop: '3px' }}>{batchTpl.kind === 'fields' ? (batchTpl.field_count + ' field(s)') : (batchTpl.zone_count + ' box(es)')} &middot; safety threshold {batchTpl.safety_threshold != null ? batchTpl.safety_threshold : 80}%. Each document is matched to the template's layout; only documents at or above the threshold are redacted.</div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
              {batchErr ? <div style={{ background: '#FEF2F2', color: '#991B1B', padding: '9px 12px', borderRadius: '8px', fontSize: '12.5px', marginBottom: '12px' }}>{batchErr}</div> : null}

              {createdJob ? (
                <div style={{ textAlign: 'center', padding: '14px 4px' }}>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#03543F', marginBottom: '8px' }}>Job scheduled</div>
                  <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.6 }}>
                    <strong>{createdJob.name}</strong><br />
                    {createdJob.total_items} document(s) queued, up to {createdJob.chunk_size}/night.<br />
                    {createdJob.nights_remaining > 0
                      ? ('Estimated to finish in about ' + createdJob.nights_remaining + ' night' + (createdJob.nights_remaining !== 1 ? 's' : '') + (createdJob.est_completion ? ', around ' + createdJob.est_completion : '') + '.')
                      : 'Ready to process.'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '10px' }}>It will run automatically during the nightly window. Track its progress in "Scheduled jobs" above.</div>
                </div>
              ) : batchResults ? (
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
              ) : scheduleForm ? (
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#374151', marginBottom: '12px' }}>Schedule details</div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '4px' }}>Job name</label>
                  <input value={jobName} onChange={function (e) { setJobName(e.target.value); }} style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px', marginBottom: '14px' }} />
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '4px' }}>Documents per night</label>
                  <input type="number" min="1" value={chunkSize} onChange={function (e) { setChunkSize(e.target.value); }} style={{ width: '160px', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px', marginBottom: '14px' }} />
                  <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '10px', padding: '12px 14px', fontSize: '13px', color: '#075985', lineHeight: 1.6 }}>
                    <strong>{selIds.length}</strong> document(s) selected &rarr; up to <strong>{effChunk}</strong>/night &rarr; finishes in about <strong>{estNights}</strong> night{estNights !== 1 ? 's' : ''}{estDate ? (', around ' + estDate) : ''}.
                    {cfg && parseInt(chunkSize, 10) > budget ? <div style={{ marginTop: '6px', color: '#92400E' }}>Note: the shared nightly budget is {budget}/night, so no more than {budget} will run per night across all jobs.</div> : null}
                  </div>
                  <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '10px' }}>The job processes automatically during the nightly window and resumes where it left off each night until complete. You can pause, resume, or cancel it anytime.</div>
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
                    : candidates.length === 0 ? <div style={{ color: '#9CA3AF', fontSize: '13px', padding: '20px', textAlign: 'center' }}>No documents available.</div>
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
              {createdJob ? (
                <button onClick={function () { setBatchTpl(null); }} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>Done</button>
              ) : batchResults ? (
                <button onClick={function () { setBatchTpl(null); }} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>Done</button>
              ) : checkResults ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={function () { setCheckResults(null); }} disabled={processing} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Back</button>
                  <button onClick={runProcess} disabled={processing || checkResults.summary.passing === 0} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: (processing || checkResults.summary.passing === 0) ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>{processing ? 'Processing...' : 'Redact ' + checkResults.summary.passing + ' matching'}</button>
                </div>
              ) : scheduleForm ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={function () { setScheduleForm(false); }} disabled={creating} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Back</button>
                  <button onClick={createJob} disabled={creating || !selIds.length} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: (creating || !selIds.length) ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>{creating ? 'Scheduling...' : 'Schedule job'}</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={closeBatch} style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
                  {scheduleMode ? (
                    <button onClick={function () { setScheduleForm(true); setBatchErr(''); }} disabled={!selIds.length} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: !selIds.length ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>Next: schedule ({selIds.length})</button>
                  ) : (
                    <button onClick={runCheck} disabled={checking || !selIds.length} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: (checking || !selIds.length) ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>{checking ? 'Checking...' : 'Run safety check'}</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
