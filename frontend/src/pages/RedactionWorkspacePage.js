import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';

var CAT_COLORS = {
  privacy: '#1E40AF', law_enforcement: '#991B1B', health: '#065F46', legal: '#5B21B6',
  personnel: '#3730A3', commercial: '#92400E', security: '#334155', administrative: '#374151'
};

export default function RedactionWorkspacePage() {
  var params = useParams();
  var nav = useNavigate();
  var fileId = params.fileId;
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState('');
  var [job, setJob] = useState(null);
  var [pages, setPages] = useState([]);
  var [zones, setZones] = useState([]);
  var [rules, setRules] = useState([]);
  var [pageIdx, setPageIdx] = useState(0);
  var [ruleId, setRuleId] = useState('');
  var [imgUrls, setImgUrls] = useState({});
  var [draft, setDraft] = useState(null);
  var [applying, setApplying] = useState(false);
  var [result, setResult] = useState(null);
  var wrapRef = useRef(null);

  useEffect(function () { init(); }, [fileId]);
  async function init() {
    setLoading(true); setError('');
    try {
      var jr = await api.post('/redaction-jobs/file/' + fileId + '/job');
      setJob(jr.data.job); setPages(jr.data.pages); setZones(jr.data.zones || []);
      var rr = await api.get('/redaction/rules');
      var active = rr.data.rules.filter(function (r) { return r.approval_status === 'approved' && r.is_active; });
      setRules(active);
      if (active[0]) setRuleId(active[0].id);
      if (jr.data.pages[0]) loadImg(jr.data.pages[0]);
    } catch (e) { setError('Could not open the document for redaction. ' + ((e.response && e.response.data && e.response.data.error) || '')); }
    setLoading(false);
  }
  async function loadImg(page) {
    if (!page || imgUrls[page.id]) return;
    try {
      var r = await api.get('/files/page-image/' + page.id, { responseType: 'blob' });
      var url = URL.createObjectURL(r.data);
      setImgUrls(function (m) { var n = Object.assign({}, m); n[page.id] = url; return n; });
    } catch (e) { /* leave blank */ }
  }
  function gotoPage(i) { if (i < 0 || i >= pages.length) return; setPageIdx(i); loadImg(pages[i]); }

  var page = pages[pageIdx];
  var pageZones = zones.filter(function (z) { return page && z.page_no === page.page_no; });
  function ruleOf(id) { return rules.filter(function (r) { return r.id === id; })[0]; }
  function catColor(id) { var r = ruleOf(id); return (r && CAT_COLORS[r.category]) || '#374151'; }
  function zoneLabel(z) { var r = ruleOf(z.rule_id); return r ? r.category_label : 'REDACTED'; }

  function rel(e) { var rect = wrapRef.current.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) }; }
  function onDown(e) { if (!page) return; var p = rel(e); setDraft({ x: p.x, y: p.y, x2: p.x, y2: p.y }); }
  function onMove(e) { if (!draft) return; var p = rel(e); setDraft(function (d) { return Object.assign({}, d, { x2: p.x, y2: p.y }); }); }
  async function onUp() {
    if (!draft) return;
    var x = Math.min(draft.x, draft.x2), y = Math.min(draft.y, draft.y2), w = Math.abs(draft.x2 - draft.x), h = Math.abs(draft.y2 - draft.y);
    setDraft(null);
    if (w < 0.012 || h < 0.008) return;
    try {
      var r = await api.post('/redaction-jobs/jobs/' + job.id + '/zones', { page_no: page.page_no, x: x, y: y, w: w, h: h, rule_id: ruleId || null });
      setZones(function (z) { return z.concat(r.data.zone); });
    } catch (e) { setError('Could not add box.'); }
  }
  async function setZoneRule(zid, rid) {
    try { await api.patch('/redaction-jobs/zones/' + zid, { rule_id: rid || null }); setZones(function (z) { return z.map(function (x) { return x.id === zid ? Object.assign({}, x, { rule_id: rid || null }) : x; }); }); } catch (e) {}
  }
  async function delZone(zid) {
    try { await api.delete('/redaction-jobs/zones/' + zid); setZones(function (z) { return z.filter(function (x) { return x.id !== zid; }); }); } catch (e) {}
  }
  async function apply() {
    if (!window.confirm('Apply ' + zones.length + ' redaction(s) and generate the released copy? The redacted content will be permanently removed from the output.')) return;
    setApplying(true); setError('');
    try { var r = await api.post('/redaction-jobs/jobs/' + job.id + '/apply'); setResult(r.data); } catch (e) { setError('Apply failed. ' + ((e.response && e.response.data && e.response.data.error) || '')); }
    setApplying(false);
  }
  async function download() {
    if (!result) return;
    var r = await api.get('/files/download/' + result.outputFileId, { responseType: 'blob' });
    var url = URL.createObjectURL(r.data); var a = document.createElement('a'); a.href = url; a.download = result.fileName || 'redacted.pdf'; a.click(); URL.revokeObjectURL(url);
  }

  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF' }}>Opening document...</div>;

  var pct = function (v) { return (v * 100) + '%'; };
  var draftBox = draft ? { left: pct(Math.min(draft.x, draft.x2)), top: pct(Math.min(draft.y, draft.y2)), width: pct(Math.abs(draft.x2 - draft.x)), height: pct(Math.abs(draft.y2 - draft.y)) } : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#F3F4F6' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 20px', background: 'white', borderBottom: '1px solid #E5E7EB', flexShrink: 0 }}>
        <button onClick={function () { job && job.request_id ? nav('/requests/' + job.request_id) : nav(-1); }} style={{ border: '1px solid #E5E7EB', background: 'white', borderRadius: '8px', padding: '7px 12px', fontSize: '13px', fontWeight: '600', color: '#374151', cursor: 'pointer' }}>&larr; Back</button>
        <div style={{ fontWeight: '700', fontSize: '15px', color: '#111', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Redaction Workspace</div>
        {pages.length > 1 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={function () { gotoPage(pageIdx - 1); }} disabled={pageIdx === 0} style={{ border: '1px solid #E5E7EB', background: 'white', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer' }}>&lsaquo;</button>
            <span style={{ fontSize: '13px', color: '#6B7280' }}>Page {pageIdx + 1} / {pages.length}</span>
            <button onClick={function () { gotoPage(pageIdx + 1); }} disabled={pageIdx === pages.length - 1} style={{ border: '1px solid #E5E7EB', background: 'white', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer' }}>&rsaquo;</button>
          </div>
        ) : null}
      </div>

      {error ? <div style={{ background: '#FEF2F2', color: '#991B1B', padding: '10px 20px', fontSize: '13px' }}>{error}</div> : null}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Canvas */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', justifyContent: 'center' }}>
          {page ? (
            <div ref={wrapRef} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={function () { setDraft(null); }}
              style={{ position: 'relative', width: '720px', maxWidth: '100%', alignSelf: 'flex-start', boxShadow: '0 2px 10px rgba(0,0,0,.12)', cursor: 'crosshair', userSelect: 'none', background: 'white' }}>
              {imgUrls[page.id] ? <img src={imgUrls[page.id]} alt={'Page ' + page.page_no} draggable={false} style={{ width: '100%', display: 'block', pointerEvents: 'none' }} /> : <div style={{ width: '100%', aspectRatio: '8.5/11', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>Loading page...</div>}
              {pageZones.map(function (z) {
                return (
                  <div key={z.id} style={{ position: 'absolute', left: pct(z.x), top: pct(z.y), width: pct(z.w), height: pct(z.h), background: 'rgba(0,0,0,.78)', border: '1px solid ' + catColor(z.rule_id), boxSizing: 'border-box', pointerEvents: 'none', overflow: 'hidden' }}>
                    <span style={{ fontSize: '9px', color: 'white', padding: '1px 3px', whiteSpace: 'nowrap' }}>{zoneLabel(z)}</span>
                  </div>
                );
              })}
              {draftBox ? <div style={{ position: 'absolute', left: draftBox.left, top: draftBox.top, width: draftBox.width, height: draftBox.height, background: 'rgba(31,78,121,.25)', border: '1px dashed #1F4E79', pointerEvents: 'none' }} /> : null}
            </div>
          ) : <div style={{ color: '#9CA3AF' }}>No pages.</div>}
        </div>

        {/* Sidebar */}
        <div style={{ width: '320px', flexShrink: 0, background: 'white', borderLeft: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '16px 18px', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#374151', marginBottom: '6px' }}>RULE FOR NEW BOXES</div>
            <select value={ruleId} onChange={function (e) { setRuleId(e.target.value); }} style={{ width: '100%', padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px', background: 'white' }}>
              <option value="">(No rule / manual)</option>
              {rules.map(function (r) { return <option key={r.id} value={r.id}>{r.title} ({r.category_label})</option>; })}
            </select>
            <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '10px 0 0', lineHeight: 1.5 }}>Drag on the page to draw a redaction box. New boxes get the rule selected above.</p>
            {rules.length === 0 ? <p style={{ fontSize: '12px', color: '#B45309', margin: '8px 0 0' }}>No approved + active rules yet. Boxes will be unlabeled until you attach a rule.</p> : null}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#374151', marginBottom: '10px' }}>BOXES ON PAGE {pageIdx + 1} ({pageZones.length})</div>
            {pageZones.length === 0 ? <div style={{ fontSize: '13px', color: '#9CA3AF' }}>None yet.</div> : pageZones.map(function (z, i) {
              return (
                <div key={z.id} style={{ border: '1px solid #E5E7EB', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: catColor(z.rule_id), flexShrink: 0 }} />
                    <span style={{ fontSize: '12px', color: '#6B7280', flex: 1 }}>Box {i + 1}</span>
                    <button onClick={function () { delZone(z.id); }} style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: '13px' }}>Remove</button>
                  </div>
                  <select value={z.rule_id || ''} onChange={function (e) { setZoneRule(z.id, e.target.value); }} style={{ width: '100%', padding: '5px 8px', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '12px', background: 'white' }}>
                    <option value="">(No rule)</option>
                    {rules.map(function (r) { return <option key={r.id} value={r.id}>{r.title}</option>; })}
                  </select>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '16px 18px', borderTop: '1px solid #F3F4F6' }}>
            {result ? (
              <div>
                <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#065F46', marginBottom: '10px', lineHeight: 1.5 }}>
                  Applied {result.zoneCount} redaction(s). Released copy created with a documentation sheet.
                </div>
                <button onClick={download} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer', marginBottom: '8px' }}>Download Redacted PDF</button>
                <button onClick={function () { job && job.request_id ? nav('/requests/' + job.request_id) : nav(-1); }} style={{ width: '100%', padding: '9px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Done</button>
              </div>
            ) : (
              <button onClick={apply} disabled={applying || zones.length === 0} style={{ width: '100%', padding: '11px', borderRadius: '8px', border: 'none', background: (applying || zones.length === 0) ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '14px', fontWeight: '700', cursor: (applying || zones.length === 0) ? 'default' : 'pointer' }}>{applying ? 'Applying...' : 'Apply Redaction (' + zones.length + ')'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
