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
  var [tplOpen, setTplOpen] = useState(false);
  var [tplName, setTplName] = useState('');
  var [tplDesc, setTplDesc] = useState('');
  var [savingTpl, setSavingTpl] = useState(false);
  var [tplMsg, setTplMsg] = useState(null);
  var [discovering, setDiscovering] = useState(false);
  var [suggestions, setSuggestions] = useState([]);
  var [labelDraft, setLabelDraft] = useState({});
  var [labelBusy, setLabelBusy] = useState({});
  var dragRef = useRef(null);

  useEffect(function () { init(); }, [fileId]);
  useEffect(function () {
    function mv(e) {
      var d = dragRef.current; if (!d) return;
      var p = rel(e); var nb;
      if (d.mode === 'move') {
        var nx = Math.max(0, Math.min(1 - d.orig.w, p.x - d.offx));
        var ny = Math.max(0, Math.min(1 - d.orig.h, p.y - d.offy));
        nb = { x: nx, y: ny, w: d.orig.w, h: d.orig.h };
      } else {
        var L = d.orig.x, T = d.orig.y, R = d.orig.x + d.orig.w, B = d.orig.y + d.orig.h;
        if (d.handle.indexOf('e') >= 0) R = Math.max(L + 0.006, p.x);
        if (d.handle.indexOf('w') >= 0) L = Math.min(R - 0.006, p.x);
        if (d.handle.indexOf('s') >= 0) B = Math.max(T + 0.006, p.y);
        if (d.handle.indexOf('n') >= 0) T = Math.min(B - 0.006, p.y);
        L = Math.max(0, L); T = Math.max(0, T); R = Math.min(1, R); B = Math.min(1, B);
        nb = { x: L, y: T, w: R - L, h: B - T };
      }
      d.last = nb;
      setZones(function (zs) { return zs.map(function (z) { return z.id === d.id ? Object.assign({}, z, nb) : z; }); });
    }
    function up() { var d = dragRef.current; if (!d) return; dragRef.current = null; if (d.last) { api.patch('/redaction-jobs/zones/' + d.id, d.last).catch(function () {}); } }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    return function () { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, []);
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
  function sortReading(a, b) { if (a.page_no !== b.page_no) return a.page_no - b.page_no; if (Math.abs(a.y - b.y) > 0.02) return a.y - b.y; return a.x - b.x; }
  var numById = {}; zones.slice().sort(sortReading).forEach(function (z, i) { numById[z.id] = i + 1; });
  var pageZones = zones.filter(function (z) { return page && z.page_no === page.page_no; }).sort(sortReading);
  var pageSuggestions = suggestions.filter(function (s) { return page && s.page_no === page.page_no; });
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
  function startMove(e, z) { e.stopPropagation(); var p = rel(e); dragRef.current = { mode: 'move', id: z.id, orig: { x: z.x, y: z.y, w: z.w, h: z.h }, offx: p.x - z.x, offy: p.y - z.y, last: null }; }
  function startResize(e, z, handle) { e.stopPropagation(); dragRef.current = { mode: 'resize', id: z.id, handle: handle, orig: { x: z.x, y: z.y, w: z.w, h: z.h }, last: null }; }
  async function pickRuleByLabel(zid) {
    var label = (labelDraft[zid] || '').trim(); if (!label) return;
    setLabelBusy(function (m) { var n = Object.assign({}, m); n[zid] = true; return n; }); setError('');
    try {
      var r = await api.post('/redaction-jobs/suggest-rule', { label: label });
      if (r.data && r.data.rule_id) { await setZoneRule(zid, r.data.rule_id); setLabelDraft(function (m) { var n = Object.assign({}, m); n[zid] = ''; return n; }); }
      else { setError('No matching rule for "' + label + '". A plain name has no standing exemption; pick a context rule manually if one applies.'); }
    } catch (e) { setError('Rule match failed.'); }
    setLabelBusy(function (m) { var n = Object.assign({}, m); n[zid] = false; return n; });
  }

  async function discover() {
    setDiscovering(true); setError('');
    try {
      var r = await api.post('/redaction-jobs/file/' + fileId + '/discover');
      var sug = (r.data.suggestions || []).map(function (s, i) { return Object.assign({}, s, { _k: 'sug_' + Date.now() + '_' + i }); });
      setSuggestions(sug);
      if (!sug.length) setError('No exempt content was detected. You can still draw boxes manually.');
    } catch (e) { setError('AI scan failed. ' + ((e.response && e.response.data && e.response.data.error) || '')); }
    setDiscovering(false);
  }
  async function acceptSuggestion(s) {
    try {
      var r = await api.post('/redaction-jobs/jobs/' + job.id + '/zones', { page_no: s.page_no, x: s.x, y: s.y, w: s.w, h: s.h, rule_id: s.rule_id || null });
      setZones(function (z) { return z.concat(r.data.zone); });
      setSuggestions(function (arr) { return arr.filter(function (x) { return x._k !== s._k; }); });
    } catch (e) { setError('Could not accept the suggestion.'); }
  }
  function dismissSuggestion(s) { setSuggestions(function (arr) { return arr.filter(function (x) { return x._k !== s._k; }); }); }
  async function acceptAllOnPage() {
    var list = suggestions.filter(function (s) { return page && s.page_no === page.page_no; });
    for (var i = 0; i < list.length; i++) { await acceptSuggestion(list[i]); }
  }

  async function apply() {
    if (!window.confirm('Apply ' + zones.length + ' redaction(s) and generate the released copy? The redacted content will be permanently removed from the output.')) return;
    setApplying(true); setError('');
    try { var r = await api.post('/redaction-jobs/jobs/' + job.id + '/apply'); setResult(r.data); } catch (e) { setError('Apply failed. ' + ((e.response && e.response.data && e.response.data.error) || '')); }
    setApplying(false);
  }
  async function saveTemplate() {
    setSavingTpl(true); setTplMsg(null);
    try {
      await api.post('/redaction-templates', {
        name: tplName.trim(), description: tplDesc.trim() || null, source_file_id: fileId,
        zones: zones.map(function (z) { var r = ruleOf(z.rule_id); return { page_no: z.page_no, x: z.x, y: z.y, w: z.w, h: z.h, rule_id: z.rule_id || null, label: r ? r.title : null }; })
      });
      setTplMsg({ ok: true, text: 'Template saved. Find it under Mass Redaction.' });
      setTimeout(function () { setTplOpen(false); setTplMsg(null); setTplName(''); setTplDesc(''); }, 1300);
    } catch (e) { setTplMsg({ ok: false, text: (e.response && e.response.data && e.response.data.error) || 'Could not save template.' }); }
    setSavingTpl(false);
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

      {tplOpen ? (
        <div onClick={function () { if (!savingTpl) setTplOpen(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={function (e) { e.stopPropagation(); }} style={{ background: 'white', borderRadius: '12px', padding: '22px', width: '440px', maxWidth: '92%' }}>
            <div style={{ fontWeight: '700', fontSize: '16px', marginBottom: '4px' }}>Save as Reusable Template</div>
            <p style={{ fontSize: '12.5px', color: '#6B7280', margin: '0 0 14px', lineHeight: 1.5 }}>Saves these {zones.length} box(es) and their rules as a template you can reuse on other documents of the same form type.</p>
            <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>Template name</label>
            <input value={tplName} onChange={function (e) { setTplName(e.target.value); }} placeholder="e.g. PD Incident Report - PII" style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px', margin: '4px 0 12px' }} />
            <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>Description (optional)</label>
            <input value={tplDesc} onChange={function (e) { setTplDesc(e.target.value); }} placeholder="What this template redacts" style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px', margin: '4px 0 16px' }} />
            {tplMsg ? <div style={{ fontSize: '12.5px', color: tplMsg.ok ? '#03543F' : '#9B1C1C', marginBottom: '10px' }}>{tplMsg.text}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={function () { setTplOpen(false); }} disabled={savingTpl} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveTemplate} disabled={savingTpl || !tplName.trim()} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: (savingTpl || !tplName.trim()) ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>{savingTpl ? 'Saving...' : 'Save Template'}</button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Canvas */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', justifyContent: 'center' }}>
          {page ? (
            <div ref={wrapRef} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={function () { setDraft(null); }}
              style={{ position: 'relative', width: '720px', maxWidth: '100%', alignSelf: 'flex-start', boxShadow: '0 2px 10px rgba(0,0,0,.12)', cursor: 'crosshair', userSelect: 'none', background: 'white' }}>
              {imgUrls[page.id] ? <img src={imgUrls[page.id]} alt={'Page ' + page.page_no} draggable={false} style={{ width: '100%', display: 'block', pointerEvents: 'none' }} /> : <div style={{ width: '100%', aspectRatio: '8.5/11', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>Loading page...</div>}
              {pageZones.map(function (z) {
                var hc = catColor(z.rule_id);
                var hbase = { position: 'absolute', width: '11px', height: '11px', background: 'white', border: '1.5px solid ' + hc, borderRadius: '2px', boxSizing: 'border-box', pointerEvents: 'auto', zIndex: 3 };
                var corners = [
                  { k: 'nw', s: { top: '-6px', left: '-6px', cursor: 'nwse-resize' } },
                  { k: 'ne', s: { top: '-6px', right: '-6px', cursor: 'nesw-resize' } },
                  { k: 'sw', s: { bottom: '-6px', left: '-6px', cursor: 'nesw-resize' } },
                  { k: 'se', s: { bottom: '-6px', right: '-6px', cursor: 'nwse-resize' } }
                ];
                return (
                  <div key={z.id} onMouseDown={function (e) { startMove(e, z); }} style={{ position: 'absolute', left: pct(z.x), top: pct(z.y), width: pct(z.w), height: pct(z.h), background: 'rgba(0,0,0,.78)', border: '1px solid ' + hc, boxSizing: 'border-box', pointerEvents: 'auto', cursor: 'move', display: 'flex', alignItems: 'center' }}>
                    <span style={{ marginLeft: '2px', width: '15px', height: '15px', minWidth: '15px', borderRadius: '50%', background: 'white', color: '#111', fontSize: '9px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, pointerEvents: 'none' }}>{numById[z.id]}</span>
                    {corners.map(function (c) { return <div key={c.k} onMouseDown={function (e) { startResize(e, z, c.k); }} style={Object.assign({}, hbase, c.s)} />; })}
                  </div>
                );
              })}
              {pageSuggestions.map(function (s) {
                return <div key={s._k} style={{ position: 'absolute', left: pct(s.x), top: pct(s.y), width: pct(s.w), height: pct(s.h), border: '1.5px dashed ' + (s.category && CAT_COLORS[s.category] ? CAT_COLORS[s.category] : '#B45309'), background: 'rgba(245,158,11,.20)', boxSizing: 'border-box', pointerEvents: 'none', borderRadius: '2px' }} />;
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
            <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '10px 0 0', lineHeight: 1.5 }}>Drag on the page to draw a box. Drag a box to move it, or its corners to resize. New boxes get the rule selected above.</p>
            <button onClick={discover} disabled={discovering} style={{ width: '100%', marginTop: '12px', padding: '9px', borderRadius: '8px', border: 'none', background: discovering ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13px', fontWeight: '700', cursor: discovering ? 'wait' : 'pointer' }}>{discovering ? 'Scanning document...' : 'Find exempt content (AI)'}</button>
            {rules.length === 0 ? <p style={{ fontSize: '12px', color: '#B45309', margin: '8px 0 0' }}>No approved + active rules yet. Boxes will be unlabeled until you attach a rule.</p> : null}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
            {pageSuggestions.length ? (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#B45309' }}>AI SUGGESTIONS ({pageSuggestions.length})</span>
                  <button onClick={acceptAllOnPage} style={{ border: 'none', background: 'transparent', color: '#1F4E79', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Accept all</button>
                </div>
                {pageSuggestions.map(function (s) {
                  return (
                    <div key={s._k} style={{ border: '1px dashed #FCD34D', background: '#FFFBEB', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px' }}>
                      <div style={{ fontSize: '12px', color: '#111', fontWeight: '600', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.text}</div>
                      <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '6px' }}>{s.rule_title ? s.rule_title : 'No matching rule - pick one after accepting'}</div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={function () { acceptSuggestion(s); }} style={{ flex: 1, padding: '5px', borderRadius: '6px', border: 'none', background: '#1F4E79', color: 'white', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Accept</button>
                        <button onClick={function () { dismissSuggestion(s); }} style={{ flex: 1, padding: '5px', borderRadius: '6px', border: '1px solid #E5E7EB', background: 'white', color: '#6B7280', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>Dismiss</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#374151', marginBottom: '10px' }}>BOXES ON PAGE {pageIdx + 1} ({pageZones.length})</div>
            {pageZones.length === 0 ? <div style={{ fontSize: '13px', color: '#9CA3AF' }}>None yet.</div> : pageZones.map(function (z, i) {
              return (
                <div key={z.id} style={{ border: '1px solid #E5E7EB', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: catColor(z.rule_id), flexShrink: 0 }} />
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '17px', height: '17px', minWidth: '17px', borderRadius: '50%', background: '#111', color: 'white', fontSize: '10px', fontWeight: '700', flexShrink: 0 }}>{numById[z.id]}</span>
                    <span style={{ fontSize: '12px', color: '#6B7280', flex: 1 }}>{ruleOf(z.rule_id) ? ruleOf(z.rule_id).category_label : 'No rule attached'}</span>
                    <button onClick={function () { delZone(z.id); }} style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: '13px' }}>Remove</button>
                  </div>
                  <select value={z.rule_id || ''} onChange={function (e) { setZoneRule(z.id, e.target.value); }} style={{ width: '100%', padding: '5px 8px', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '12px', background: 'white' }}>
                    <option value="">(No rule)</option>
                    {rules.map(function (r) { return <option key={r.id} value={r.id}>{r.title}</option>; })}
                  </select>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    <input value={labelDraft[z.id] || ''} onChange={function (e) { var v = e.target.value; setLabelDraft(function (m) { var n = Object.assign({}, m); n[z.id] = v; return n; }); }} onKeyDown={function (e) { if (e.key === 'Enter') pickRuleByLabel(z.id); }} placeholder="Describe field, AI picks rule" style={{ flex: 1, minWidth: 0, padding: '5px 8px', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '11.5px' }} />
                    <button onClick={function () { pickRuleByLabel(z.id); }} disabled={labelBusy[z.id] || !(labelDraft[z.id] || '').trim()} style={{ padding: '5px 9px', borderRadius: '6px', border: 'none', background: (labelBusy[z.id] || !(labelDraft[z.id] || '').trim()) ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '11.5px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}>{labelBusy[z.id] ? '...' : 'AI rule'}</button>
                  </div>
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
              <div>
                <button onClick={apply} disabled={applying || zones.length === 0} style={{ width: '100%', padding: '11px', borderRadius: '8px', border: 'none', background: (applying || zones.length === 0) ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '14px', fontWeight: '700', cursor: (applying || zones.length === 0) ? 'default' : 'pointer' }}>{applying ? 'Applying...' : 'Apply Redaction (' + zones.length + ')'}</button>
                <button onClick={function () { setTplMsg(null); setTplOpen(true); }} disabled={zones.length === 0} style={{ width: '100%', marginTop: '8px', padding: '9px', borderRadius: '8px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '13px', fontWeight: '600', cursor: zones.length === 0 ? 'default' : 'pointer', opacity: zones.length === 0 ? 0.5 : 1 }}>Save as Reusable Template</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
