import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

var CAT_COLORS = {
  privacy: '#1E40AF', law_enforcement: '#991B1B', health: '#065F46', legal: '#5B21B6',
  personnel: '#3730A3', commercial: '#92400E', security: '#334155', administrative: '#374151'
};
var ELEVATED = ['SUPERVISOR', 'DIRECTOR', 'SYSTEM_ADMIN', 'DEPT_MANAGER'];
function pct(v) { return (v * 100) + '%'; }
function stagePill(stage) {
  if (stage === 'pending_review') return { c: '#92400E', b: '#FEF3C7', label: 'Awaiting approval' };
  if (stage === 'released') return { c: '#03543F', b: '#DEF7EC', label: 'Released' };
  return { c: '#374151', b: '#F3F4F6', label: 'In review' };
}
function navBtn(dis) { return { padding: '6px 12px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: dis ? '#D1D5DB' : '#374151', fontSize: '12.5px', fontWeight: '600', cursor: dis ? 'default' : 'pointer' }; }
function primaryBtn(dis) { return { width: '100%', padding: '11px', borderRadius: '8px', border: 'none', background: dis ? '#9CB4CC' : '#1F4E79', color: 'white', fontSize: '13.5px', fontWeight: '700', cursor: dis ? 'default' : 'pointer' }; }
function secondaryBtn() { return { width: '100%', padding: '9px', borderRadius: '8px', border: '1px solid #E5E7EB', background: 'white', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }; }

export default function RedactionReviewPage() {
  var params = useParams();
  var fileId = params.fileId;
  var nav = useNavigate();
  var store = useAuthStore();
  var canFinalize = store.hasAnyRole.apply(store, ELEVATED);

  var [loading, setLoading] = useState(true);
  var [error, setError] = useState('');
  var [job, setJob] = useState(null);
  var [pages, setPages] = useState([]);
  var [zones, setZones] = useState([]);
  var [rules, setRules] = useState([]);
  var [pageIdx, setPageIdx] = useState(0);
  var [imgUrls, setImgUrls] = useState({});
  var [busy, setBusy] = useState(false);
  var [applying, setApplying] = useState(false);
  var [result, setResult] = useState(null);
  var [stage, setStage] = useState('editing');

  useEffect(function () { init(); }, [fileId]);
  async function init() {
    setLoading(true); setError('');
    try {
      var jr = await api.post('/redaction-jobs/file/' + fileId + '/job');
      setJob(jr.data.job); setPages(jr.data.pages || []); setZones(jr.data.zones || []);
      setStage((jr.data.job && jr.data.job.review_stage) || 'editing');
      var rr = await api.get('/redaction/rules');
      setRules((rr.data.rules || []).filter(function (r) { return r.approval_status === 'approved' && r.is_active; }));
      if ((jr.data.pages || []).length) loadImg(jr.data.pages[0]);
    } catch (e) { setError('Could not load this document for review.'); }
    setLoading(false);
  }
  async function loadImg(page) {
    if (!page || imgUrls[page.id]) return;
    try {
      var r = await api.get('/files/page-image/' + page.id, { responseType: 'blob' });
      var url = URL.createObjectURL(r.data);
      setImgUrls(function (m) { var n = Object.assign({}, m); n[page.id] = url; return n; });
    } catch (e) {}
  }
  function gotoPage(i) { if (i < 0 || i >= pages.length) return; setPageIdx(i); loadImg(pages[i]); }

  var page = pages[pageIdx];
  function sortReading(a, b) { if (a.page_no !== b.page_no) return a.page_no - b.page_no; if (Math.abs(a.y - b.y) > 0.02) return a.y - b.y; return a.x - b.x; }
  var ordered = zones.slice().sort(sortReading);
  var numById = {}; ordered.forEach(function (z, i) { numById[z.id] = i + 1; });
  var pageZones = zones.filter(function (z) { return page && z.page_no === page.page_no; });
  function ruleOf(id) { return rules.filter(function (r) { return r.id === id; })[0]; }
  function catColor(id) { var r = ruleOf(id); return (r && CAT_COLORS[r.category]) || '#374151'; }
  function labelOf(z) { var r = ruleOf(z.rule_id); return r ? (r.category_label || r.title) : 'Redaction (no rule)'; }
  function isDropped(z) { return z.review_state === 'rejected'; }
  var kept = zones.filter(function (z) { return !isDropped(z); }).length;
  var dropped = zones.length - kept;

  async function setZoneDecision(z, drop) {
    var ns = drop ? 'rejected' : 'approved';
    setZones(function (zs) { return zs.map(function (x) { return x.id === z.id ? Object.assign({}, x, { review_state: ns }) : x; }); });
    try { await api.patch('/redaction-jobs/zones/' + z.id, { review_state: ns }); } catch (e) {}
  }
  async function finalize() {
    if (!window.confirm('Release this record? ' + kept + ' redaction(s) will be applied' + (dropped ? ' and ' + dropped + ' dropped' : '') + ', and the redacted copy will be published to Public Ready.')) return;
    setApplying(true); setError('');
    try {
      var r = await api.post('/redaction-jobs/jobs/' + job.id + '/apply');
      setResult(r.data); setStage('released');
    } catch (e) { setError('Release failed. ' + ((e.response && e.response.data && e.response.data.error) || '')); }
    setApplying(false);
  }
  async function submit() {
    setBusy(true);
    try { await api.post('/redaction-jobs/jobs/' + job.id + '/submit'); setStage('pending_review'); } catch (e) {}
    setBusy(false);
  }
  async function sendBack() {
    setBusy(true);
    try { await api.post('/redaction-jobs/jobs/' + job.id + '/return'); setStage('editing'); } catch (e) {}
    setBusy(false);
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>Loading review...</div>;
  if (error && !job) return <div style={{ padding: '40px', textAlign: 'center', color: '#9B1C1C' }}>{error}</div>;

  var sp = stagePill(stage);
  var imgSrc = page ? imgUrls[page.id] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 24px', borderBottom: '1px solid #E5E7EB', background: 'white', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '17px', fontWeight: '700', color: '#111' }}>Redaction Review</div>
        <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 9px', borderRadius: '999px', color: sp.c, background: sp.b }}>{sp.label}</span>
        <span style={{ flex: 1 }} />
        <button onClick={function () { nav('/redact/' + fileId); }} style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '12.5px', fontWeight: '700', cursor: 'pointer' }}>Edit boxes in workspace</button>
        {pages.length > 1 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={function () { gotoPage(pageIdx - 1); }} disabled={pageIdx === 0} style={navBtn(pageIdx === 0)}>Prev</button>
            <span style={{ fontSize: '12.5px', color: '#374151', fontWeight: '600' }}>Page {pageIdx + 1} / {pages.length}</span>
            <button onClick={function () { gotoPage(pageIdx + 1); }} disabled={pageIdx >= pages.length - 1} style={navBtn(pageIdx >= pages.length - 1)}>Next</button>
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', gap: '16px', padding: '18px 20px', overflow: 'auto', background: '#F9FAFB' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#6B7280', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Original</div>
            <div style={{ position: 'relative', background: 'white', border: '1px solid #E5E7EB', borderRadius: '6px', overflow: 'hidden' }}>
              {imgSrc ? <img src={imgSrc} alt="original" style={{ width: '100%', display: 'block' }} /> : <div style={{ aspectRatio: '8.5/11', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>Loading...</div>}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#1F4E79', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Proposed redactions</div>
            <div style={{ position: 'relative', background: 'white', border: '1px solid #E5E7EB', borderRadius: '6px', overflow: 'hidden' }}>
              {imgSrc ? <img src={imgSrc} alt="redacted" style={{ width: '100%', display: 'block' }} /> : <div style={{ aspectRatio: '8.5/11', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>Loading...</div>}
              {imgSrc ? pageZones.map(function (z) {
                var hc = catColor(z.rule_id);
                if (isDropped(z)) {
                  return <div key={z.id} style={{ position: 'absolute', left: pct(z.x), top: pct(z.y), width: pct(z.w), height: pct(z.h), border: '1.5px dashed #DC2626', background: 'rgba(220,38,38,.08)', boxSizing: 'border-box', borderRadius: '2px' }} />;
                }
                return (
                  <div key={z.id} style={{ position: 'absolute', left: pct(z.x), top: pct(z.y), width: pct(z.w), height: pct(z.h), background: 'rgba(0,0,0,.82)', border: '1px solid ' + hc, boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
                    <span style={{ marginLeft: '2px', width: '15px', height: '15px', minWidth: '15px', borderRadius: '50%', background: 'white', color: '#111', fontSize: '9px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{numById[z.id]}</span>
                  </div>
                );
              }) : null}
            </div>
          </div>
        </div>

        <div style={{ width: '320px', flexShrink: 0, background: 'white', borderLeft: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#374151' }}>{zones.length} redaction(s) proposed</div>
            <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '3px' }}>{kept} to apply{dropped ? ' \u00b7 ' + dropped + ' dropped' : ''}</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {ordered.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#9CA3AF', padding: '10px 0', lineHeight: 1.5 }}>No redactions proposed yet. Use "Edit boxes in workspace" to add them, or run AI detection there, then come back to review.</div>
            ) : ordered.map(function (z) {
              var onPage = page && z.page_no === page.page_no;
              var drop = isDropped(z);
              return (
                <div key={z.id} onClick={function () { gotoPage(pages.findIndex(function (p) { return p.page_no === z.page_no; })); }} style={{ border: '1px solid ' + (onPage ? '#1F4E79' : '#E5E7EB'), borderRadius: '8px', padding: '8px 10px', marginBottom: '8px', cursor: 'pointer', opacity: drop ? 0.65 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ width: '17px', height: '17px', minWidth: '17px', borderRadius: '50%', background: drop ? '#9CA3AF' : '#111', color: 'white', fontSize: '10px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{numById[z.id]}</span>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: catColor(z.rule_id), flexShrink: 0 }} />
                    <span style={{ fontSize: '12px', color: '#374151', flex: 1, textDecoration: drop ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf(z)}</span>
                    <span style={{ fontSize: '11px', color: '#9CA3AF', flexShrink: 0 }}>p{z.page_no}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={function (e) { e.stopPropagation(); setZoneDecision(z, false); }} style={{ flex: 1, padding: '5px', borderRadius: '6px', border: '1px solid ' + (!drop ? '#1F4E79' : '#E5E7EB'), background: !drop ? '#EFF6FF' : 'white', color: !drop ? '#1F4E79' : '#6B7280', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>Keep</button>
                    <button onClick={function (e) { e.stopPropagation(); setZoneDecision(z, true); }} style={{ flex: 1, padding: '5px', borderRadius: '6px', border: '1px solid ' + (drop ? '#DC2626' : '#E5E7EB'), background: drop ? '#FEF2F2' : 'white', color: drop ? '#DC2626' : '#6B7280', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>Drop</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ padding: '14px 16px', borderTop: '1px solid #F3F4F6' }}>
            {result ? (
              <div>
                <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#065F46', marginBottom: '10px', lineHeight: 1.5 }}>Released. {result.zoneCount != null ? result.zoneCount + ' redaction(s) applied. ' : ''}The redacted copy is now in Released Records.</div>
                <button onClick={function () { nav('/released'); }} style={primaryBtn(false)}>View Released Records</button>
                <button onClick={function () { job && job.request_id ? nav('/requests/' + job.request_id) : nav('/mass-redaction'); }} style={Object.assign({ marginTop: '8px' }, secondaryBtn())}>Done</button>
              </div>
            ) : (
              <div>
                {error ? <div style={{ background: '#FEF2F2', color: '#991B1B', padding: '9px 12px', borderRadius: '8px', fontSize: '12.5px', marginBottom: '10px' }}>{error}</div> : null}
                {canFinalize ? (
                  <button onClick={finalize} disabled={applying || kept === 0} style={primaryBtn(applying || kept === 0)}>{applying ? 'Releasing...' : 'Approve & release (' + kept + ')'}</button>
                ) : (
                  <button onClick={submit} disabled={busy || stage === 'pending_review'} style={primaryBtn(busy || stage === 'pending_review')}>{stage === 'pending_review' ? 'Submitted for approval' : (busy ? 'Submitting...' : 'Submit for approval')}</button>
                )}
                {canFinalize && stage !== 'pending_review' ? (
                  <button onClick={submit} disabled={busy} style={Object.assign({ marginTop: '8px' }, secondaryBtn())}>Send for legal review</button>
                ) : null}
                {canFinalize && stage === 'pending_review' ? (
                  <button onClick={sendBack} disabled={busy} style={Object.assign({ marginTop: '8px' }, secondaryBtn())}>Send back to editing</button>
                ) : null}
                <p style={{ fontSize: '11.5px', color: '#9CA3AF', margin: '10px 0 0', lineHeight: 1.5 }}>{canFinalize ? 'Dropped boxes are not applied. Releasing publishes the redacted copy and logs the legal basis for each redaction.' : 'An authorized approver will review and release this record.'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
