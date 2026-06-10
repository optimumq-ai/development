import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';

export default function StructuredRedactionFieldsPage() {
  var params = useParams();
  var nav = useNavigate();
  var fileId = params.fileId;
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState('');
  var [columns, setColumns] = useState([]);
  var [sample, setSample] = useState(null);
  var [rowCount, setRowCount] = useState(0);
  var [rules, setRules] = useState([]);
  var [fieldMap, setFieldMap] = useState({});
  var [busy, setBusy] = useState(false);
  var [result, setResult] = useState(null);
  var [tplOpen, setTplOpen] = useState(false);
  var [tplName, setTplName] = useState('');
  var [tplDesc, setTplDesc] = useState('');
  var [savingTpl, setSavingTpl] = useState(false);
  var [tplMsg, setTplMsg] = useState(null);

  useEffect(function () { init(); }, [fileId]);
  async function init() {
    setLoading(true); setError('');
    try {
      var pr = await api.post('/structured-redaction/preview', { file_id: fileId });
      setColumns(pr.data.columns || []);
      setSample((pr.data.sampleRows || [])[0] || {});
      setRowCount(pr.data.rowCount || 0);
      var rr = await api.get('/redaction/rules');
      setRules((rr.data.rules || []).filter(function (r) { return r.approval_status === 'approved' && r.is_active; }));
    } catch (e) { setError('Could not read this record. ' + ((e.response && e.response.data && e.response.data.error) || 'Make sure it is a CSV export.')); }
    setLoading(false);
  }

  function toggle(col) { setFieldMap(function (m) { var n = Object.assign({}, m); if (n[col]) delete n[col]; else n[col] = { rule_id: '' }; return n; }); }
  function setRule(col, rid) { setFieldMap(function (m) { var n = Object.assign({}, m); n[col] = Object.assign({}, n[col], { rule_id: rid }); return n; }); }
  var withheld = Object.keys(fieldMap);

  async function generate() {
    if (!withheld.length && !window.confirm('No fields are marked to withhold. Generate the record with everything visible?')) return;
    setBusy(true); setError('');
    try {
      var field_map = withheld.map(function (c) { return { field: c, rule_id: fieldMap[c].rule_id || null }; });
      var r = await api.post('/structured-redaction/apply', { file_id: fileId, field_map: field_map });
      setResult(r.data);
    } catch (e) { setError('Could not generate the redacted record. ' + ((e.response && e.response.data && e.response.data.error) || '')); }
    setBusy(false);
  }
  async function saveTemplate() {
    setSavingTpl(true); setTplMsg(null);
    try {
      var field_map = withheld.map(function (c) { return { field: c, rule_id: fieldMap[c].rule_id || null }; });
      await api.post('/redaction-templates', { name: tplName.trim(), description: tplDesc.trim() || null, kind: 'fields', source_file_id: fileId, field_map: field_map });
      setTplMsg({ ok: true, text: 'Template saved. Find it under Mass Redaction.' });
      setTimeout(function () { setTplOpen(false); setTplMsg(null); setTplName(''); setTplDesc(''); }, 1300);
    } catch (e) { setTplMsg({ ok: false, text: (e.response && e.response.data && e.response.data.error) || 'Could not save template.' }); }
    setSavingTpl(false);
  }
  async function download() {
    if (!result) return;
    try {
      var r = await api.get('/files/download/' + result.outputFileId, { responseType: 'blob' });
      var url = URL.createObjectURL(r.data); var a = document.createElement('a'); a.href = url; a.download = result.fileName || 'redacted.pdf'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setError('Download failed.'); }
  }

  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF' }}>Reading record...</div>;

  return (
    <div style={{ padding: '24px 28px', maxWidth: '860px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <button onClick={function () { nav(-1); }} style={{ border: '1px solid #E5E7EB', background: 'white', borderRadius: '8px', padding: '7px 12px', fontSize: '13px', fontWeight: '600', color: '#374151', cursor: 'pointer' }}>&larr; Back</button>
        <h1 style={{ fontSize: '20px', fontWeight: '700', margin: 0 }}>Field Redaction</h1>
      </div>
      <p style={{ color: '#6B7280', fontSize: '13px', margin: '0 0 18px', lineHeight: 1.5 }}>
        Structured record with {rowCount} row{rowCount !== 1 ? 's' : ''}. Mark the columns that are exempt; their values are dropped <strong>before</strong> the released document is built, so they never appear in the output file at all. The result is a clean PDF plus a Fields Withheld index.
      </p>

      {error ? <div style={{ background: '#FEF2F2', color: '#991B1B', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '14px' }}>{error}</div> : null}

      {result ? (
        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px' }}>
          <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '8px', padding: '12px 14px', fontSize: '13px', color: '#065F46', marginBottom: '14px', lineHeight: 1.5 }}>
            Released record generated &mdash; {result.recordCount} record(s), {result.pageCount} page(s).
            {result.withheldFields && result.withheldFields.length ? ' Withheld: ' + result.withheldFields.join(', ') + '.' : ' No fields withheld.'} It is now in Released Records and the Fulfilled Request Index.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={download} style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>Download Redacted PDF</button>
            <button onClick={function () { nav(-1); }} style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Done</button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', padding: '10px 16px', borderBottom: '1px solid #F3F4F6', fontSize: '11px', fontWeight: '700', color: '#9CA3AF', letterSpacing: '.03em' }}>
              <div style={{ width: '90px', flexShrink: 0 }}>WITHHOLD</div>
              <div style={{ flex: 1 }}>COLUMN</div>
              <div style={{ flex: 1.4 }}>RULE (IF WITHHELD)</div>
            </div>
            {columns.map(function (col) {
              var on = !!fieldMap[col];
              var hint = sample && sample[col] != null ? String(sample[col]) : '';
              return (
                <div key={col} style={{ display: 'flex', alignItems: 'center', padding: '11px 16px', borderBottom: '1px solid #F3F4F6' }}>
                  <div style={{ width: '90px', flexShrink: 0 }}>
                    <input type="checkbox" checked={on} onChange={function () { toggle(col); }} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingRight: '10px' }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#111' }}>{col}</div>
                    {hint ? <div style={{ fontSize: '11.5px', color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>e.g. {hint}</div> : null}
                  </div>
                  <div style={{ flex: 1.4 }}>
                    {on ? (
                      <select value={fieldMap[col].rule_id || ''} onChange={function (e) { setRule(col, e.target.value); }} style={{ width: '100%', padding: '6px 8px', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '12.5px', background: 'white' }}>
                        <option value="">(No rule / manual)</option>
                        {rules.map(function (r) { return <option key={r.id} value={r.id}>{r.title}</option>; })}
                      </select>
                    ) : <span style={{ fontSize: '12px', color: '#D1D5DB' }}>&mdash;</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button onClick={generate} disabled={busy} style={{ padding: '11px 18px', borderRadius: '8px', border: 'none', background: busy ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '14px', fontWeight: '700', cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Generating...' : 'Generate Redacted Record'}</button>
            <button onClick={function(){ setTplMsg(null); setTplOpen(true); }} disabled={!withheld.length} style={{ padding: '11px 16px', borderRadius: '8px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '13px', fontWeight: '600', cursor: withheld.length ? 'pointer' : 'default', opacity: withheld.length ? 1 : 0.5 }}>Save as reusable template</button>
            <span style={{ fontSize: '12.5px', color: '#6B7280' }}>{withheld.length} of {columns.length} column(s) marked to withhold</span>
          </div>
          {tplOpen ? (
            <div onClick={function(){ if(!savingTpl) setTplOpen(false); }} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50 }}>
              <div onClick={function(e){ e.stopPropagation(); }} style={{ background:'white', borderRadius:'12px', padding:'22px', width:'440px', maxWidth:'92%' }}>
                <div style={{ fontWeight:'700', fontSize:'16px', marginBottom:'4px' }}>Save as Reusable Template</div>
                <p style={{ fontSize:'12.5px', color:'#6B7280', margin:'0 0 14px', lineHeight:1.5 }}>Saves the {withheld.length} withheld field(s) and their rules as a template you can run across other records of this report type under Mass Redaction.</p>
                <label style={{ fontSize:'12px', fontWeight:'600', color:'#374151' }}>Template name</label>
                <input value={tplName} onChange={function(e){ setTplName(e.target.value); }} placeholder="e.g. CAD Call Log - PII" style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #E5E7EB', borderRadius:'8px', fontSize:'13px', margin:'4px 0 12px' }} />
                <label style={{ fontSize:'12px', fontWeight:'600', color:'#374151' }}>Description (optional)</label>
                <input value={tplDesc} onChange={function(e){ setTplDesc(e.target.value); }} placeholder="What this template withholds" style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid #E5E7EB', borderRadius:'8px', fontSize:'13px', margin:'4px 0 16px' }} />
                {tplMsg ? <div style={{ fontSize:'12.5px', color: tplMsg.ok?'#03543F':'#9B1C1C', marginBottom:'10px' }}>{tplMsg.text}</div> : null}
                <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
                  <button onClick={function(){ setTplOpen(false); }} disabled={savingTpl} style={{ padding:'8px 14px', borderRadius:'8px', border:'1px solid #E5E7EB', background:'white', color:'#374151', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>Cancel</button>
                  <button onClick={saveTemplate} disabled={savingTpl || !tplName.trim()} style={{ padding:'8px 14px', borderRadius:'8px', border:'none', background:(savingTpl||!tplName.trim())?'#9CB4CC':'#1F4E79', color:'white', fontSize:'13px', fontWeight:'700', cursor:'pointer' }}>{savingTpl?'Saving...':'Save Template'}</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
