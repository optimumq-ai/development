import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useWorkTimer, WorkTimerBadge, WorkTimerCompleteModal, useTimeCaptureMode } from '../components/ui/WorkTimer';

// Redaction task screen (SPEC_redaction_automation.md slice 7 / SPEC_redaction_task_screen.md).
// Full-bleed workstation a redaction/legal_redaction task opens into (not the generic request page).
// Reuses the proven redaction canvas engine (job/pages/zones/discover/apply/template) and adds: a
// responsive-file worklist, the per-file disposition badge, a 3-box accordion (AI / Manual / Finalize),
// an informational side-by-side, and an in-document semantic search modal.
//
// REVIEWER MODE (slice 8): a `redaction_qa` task — the mandatory second review the slice-4 gate requires
// for Elevated/Legal dispositions — opens this SAME screen with the same canvas, file picker and
// side-by-side, but the right rail becomes review-shaped: the author's proposed redactions (page-anchored,
// click to jump), an optional second-pass AI check for anything they missed, and an approve/return
// decision instead of Finalize. The author can never approve their own work (backend gate + UI).

var CAT_COLORS = {
  privacy: '#1E40AF', law_enforcement: '#991B1B', health: '#065F46', legal: '#5B21B6',
  personnel: '#3730A3', commercial: '#92400E', security: '#334155', administrative: '#374151'
};
var DISPO = {
  bypass: { label: 'No redaction required', bg: '#E4F3EC', fg: '#177A54' },
  simple: { label: 'Simple', bg: '#E4F3EC', fg: '#177A54' },
  standard: { label: 'Standard', bg: '#E7EFF7', fg: '#1F4E79' },
  elevated: { label: 'Elevated', bg: '#FBEEDD', fg: '#B4690E' },
  legal: { label: 'Legal', bg: '#EEE7F8', fg: '#6D3BB5' }
};

export default function RedactionTaskPage() {
  var params = useParams();
  var nav = useNavigate();
  var taskId = params.taskId;
  var timer = useWorkTimer(taskId);            // actual-labor work timer (Slice D) — heartbeat always runs
  var tcm = useTimeCaptureMode('legal_redaction'); // city's per-UI capture mode (Slice E): off|discretion|always
  var [laborModal, setLaborModal] = useState(null); // {action:'submit'|'apply'} while the completion popup is open
  async function doComplete(action) { timer.markFinalized(); if (action === 'apply') { await apply(); } else { await submitForReview(); } }
  async function requestComplete(action) {
    timer.flush();
    // off: no log window — finalize with no billable time and complete straight through. else: the log window.
    if (tcm.mode === 'off') { await timer.skip(); await doComplete(action); return; }
    setLaborModal({ action: action });
  }

  var [task, setTask] = useState(null);
  var [files, setFiles] = useState([]);
  var [fileId, setFileId] = useState(null);
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
  var [suggestions, setSuggestions] = useState([]);
  var [selected, setSelected] = useState({});      // _k -> true (AI checkbox select)
  var [discovering, setDiscovering] = useState(false);
  var [applying, setApplying] = useState(false);
  var [result, setResult] = useState(null);
  var [matchTpl, setMatchTpl] = useState(null);
  var [open, setOpen] = useState('ai');             // accordion: ai | manual | finalize
  var [sxs, setSxs] = useState(false);              // side-by-side
  var [searchOpen, setSearchOpen] = useState(false);
  var [busy, setBusy] = useState('');
  var [returnNote, setReturnNote] = useState('');
  var wrapRef = useRef(null);
  var dragRef = useRef(null);
  var me = useAuthStore(function (s) { return s.user; });
  var reviewMode = !!(task && task.type === 'redaction_qa');

  // ---- load task + its responsive files ----
  useEffect(function () { loadTask(); }, [taskId]);
  async function loadTask() {
    setLoading(true); setError('');
    try {
      var tr = await api.get('/tasks/' + taskId);
      var t = tr.data.task; setTask(t);
      api.post('/tasks/' + taskId + '/begin').catch(function () {}); // begin-work: owner-gated server-side (Slice A)
      var fr = await api.get('/files/' + t.request_id);
      var resp = (fr.data.files || []).filter(function (f) { return f.responsive; });
      setFiles(resp);
      if (resp.length) setFileId(resp[0].id);
      else setError('This request has no records marked for inclusion yet. Mark records "Include in Response" in Record Search first.');
    } catch (e) { setError('Could not open the redaction task. ' + msg(e)); }
    setLoading(false);
  }

  // ---- open a file for redaction (ensure job, pages, zones; auto-run AI) ----
  useEffect(function () { if (fileId) openFile(fileId); }, [fileId]);
  async function openFile(fid) {
    setError(''); setJob(null); setPages([]); setZones([]); setSuggestions([]); setSelected({}); setResult(null); setPageIdx(0); setMatchTpl(null); setReturnNote('');
    var isReview = !!(task && task.type === 'redaction_qa');
    try {
      var jr = await api.post('/redaction-jobs/file/' + fid + '/job');
      var j = jr.data.job;
      setPages(jr.data.pages); setZones(jr.data.zones || []);
      var rr = await api.get('/redaction/rules');
      var active = rr.data.rules.filter(function (r) { return r.approval_status === 'approved' && r.is_active; });
      setRules(active); if (active[0]) setRuleId(active[0].id);
      if (jr.data.pages[0]) loadImg(jr.data.pages[0]);
      if (isReview) {
        // Reviewer opens a submitted document: claim it (pending_review -> in_review) and show the author's
        // work as-is. No auto AI scan and no template prompt — the author already made those calls; the
        // reviewer asks for a second pass deliberately.
        setOpen('proposed');
        if (j && j.review_stage === 'pending_review') {
          try { var br = await api.post('/redaction-jobs/jobs/' + j.id + '/begin-review'); j = Object.assign({}, j, { review_stage: br.data.review_stage }); } catch (e) {}
        }
      } else if (j && j.review_stage !== 'released') {
        setOpen('ai');
        if (!(jr.data.zones || []).length) checkMatch(fid);
        // Entry contract (Slice A): auto-run the AI read ONCE — never re-scan a record that already has work or
        // that was discovered before. Prevents re-entry / conveyor-next from re-spending the call or re-surfacing
        // dismissed suggestions. (checkMatch above is likewise gated to zero-zones.)
        if (!j.discovered_at && !(jr.data.zones || []).length) discover(fid);
      }
      setJob(j);
    } catch (e) { setError('Could not open this document. ' + msg(e)); }
  }

  // ---- drag to move/resize existing zones ----
  useEffect(function () {
    function mv(e) {
      var d = dragRef.current; if (!d) return; var p = rel(e); var nb;
      if (d.mode === 'move') {
        nb = { x: Math.max(0, Math.min(1 - d.orig.w, p.x - d.offx)), y: Math.max(0, Math.min(1 - d.orig.h, p.y - d.offy)), w: d.orig.w, h: d.orig.h };
      } else {
        var L = d.orig.x, T = d.orig.y, R = d.orig.x + d.orig.w, B = d.orig.y + d.orig.h;
        if (d.handle.indexOf('e') >= 0) R = Math.max(L + 0.006, p.x);
        if (d.handle.indexOf('w') >= 0) L = Math.min(R - 0.006, p.x);
        if (d.handle.indexOf('s') >= 0) B = Math.max(T + 0.006, p.y);
        if (d.handle.indexOf('n') >= 0) T = Math.min(B - 0.006, p.y);
        nb = { x: Math.max(0, L), y: Math.max(0, T), w: Math.min(1, R) - Math.max(0, L), h: Math.min(1, B) - Math.max(0, T) };
      }
      d.last = nb;
      setZones(function (zs) { return zs.map(function (z) { return z.id === d.id ? Object.assign({}, z, nb) : z; }); });
    }
    function up() { var d = dragRef.current; if (!d) return; dragRef.current = null; if (d.last) api.patch('/redaction-jobs/zones/' + d.id, d.last).catch(function () {}); }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    return function () { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, []);

  function msg(e) { return (e && e.response && e.response.data && e.response.data.error) || ''; }
  async function loadImg(page) {
    if (!page || imgUrls[page.id]) return;
    try { var r = await api.get('/files/page-image/' + page.id, { responseType: 'blob' }); var url = URL.createObjectURL(r.data); setImgUrls(function (m) { var n = Object.assign({}, m); n[page.id] = url; return n; }); } catch (e) {}
  }
  function gotoPage(i) { if (i < 0 || i >= pages.length) return; setPageIdx(i); loadImg(pages[i]); }
  // Every rail list is document-wide, so each entry carries the page it lives on and jumps the canvas
  // there. Without it a proposal on page 37 is a line of text with nowhere to go.
  function jumpToPageNo(pageNo) {
    var i = pages.map(function (p) { return p.page_no; }).indexOf(pageNo);
    if (i >= 0) gotoPage(i);
  }
  function PageChip(props) {
    return (
      <button type="button" title={'Go to page ' + props.pageNo} style={sty.pgchip}
        onClick={function (e) { e.preventDefault(); e.stopPropagation(); jumpToPageNo(props.pageNo); }}>
        p. {props.pageNo}
      </button>
    );
  }

  var page = pages[pageIdx];
  function sortReading(a, b) { if (a.page_no !== b.page_no) return a.page_no - b.page_no; if (Math.abs(a.y - b.y) > 0.02) return a.y - b.y; return a.x - b.x; }
  var numById = {}; zones.slice().sort(sortReading).forEach(function (z, i) { numById[z.id] = i + 1; });
  var pageZones = zones.filter(function (z) { return page && z.page_no === page.page_no; }).sort(sortReading);
  var pageSuggestions = suggestions.filter(function (s) { return page && s.page_no === page.page_no; });
  // The side-by-side caption must never let an un-redacted page read as a clean one: it states
  // exactly what the right pane is showing, and flags proposals as previewed-but-not-applied.
  var sxsCaption = pageSuggestions.length
    ? 'Preview — the right pane shows ' + (pageZones.length ? pageZones.length + ' applied and ' : '')
      + pageSuggestions.length + ' proposed (dashed) redaction' + (pageSuggestions.length === 1 && !pageZones.length ? '' : 's')
      + '. The proposed boxes are not applied yet — approve them under AI Redaction to commit them.'
    : pageZones.length
      ? 'Read-only — original at left, the redacted release at right. ' + pageZones.length + ' applied redaction' + (pageZones.length === 1 ? '' : 's') + ' on this page.'
      : 'Read-only — nothing is redacted on this page, so the release would be identical to the original.';
  function ruleOf(id) { return rules.filter(function (r) { return r.id === id; })[0]; }
  function catColor(id) { var r = ruleOf(id); return (r && CAT_COLORS[r.category]) || '#374151'; }

  function rel(e) { var rect = wrapRef.current.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) }; }
  function onDown(e) { if (!page || sxs) return; var p = rel(e); setDraft({ x: p.x, y: p.y, x2: p.x, y2: p.y }); }
  function onMove(e) { if (!draft) return; var p = rel(e); setDraft(function (d) { return Object.assign({}, d, { x2: p.x, y2: p.y }); }); }
  async function onUp() {
    if (!draft) return;
    var x = Math.min(draft.x, draft.x2), y = Math.min(draft.y, draft.y2), w = Math.abs(draft.x2 - draft.x), h = Math.abs(draft.y2 - draft.y);
    setDraft(null); if (w < 0.012 || h < 0.008) return;
    try { var r = await api.post('/redaction-jobs/jobs/' + job.id + '/zones', { page_no: page.page_no, x: x, y: y, w: w, h: h, rule_id: ruleId || null }); setZones(function (z) { return z.concat(r.data.zone); }); }
    catch (e) { setError('Could not add box. ' + msg(e)); }
  }
  async function setZoneRule(zid, rid) { try { await api.patch('/redaction-jobs/zones/' + zid, { rule_id: rid || null }); setZones(function (z) { return z.map(function (x) { return x.id === zid ? Object.assign({}, x, { rule_id: rid || null }) : x; }); }); } catch (e) {} }
  async function delZone(zid) { try { await api.delete('/redaction-jobs/zones/' + zid); setZones(function (z) { return z.filter(function (x) { return x.id !== zid; }); }); } catch (e) {} }
  function startMove(e, z) { e.stopPropagation(); var p = rel(e); dragRef.current = { mode: 'move', id: z.id, orig: { x: z.x, y: z.y, w: z.w, h: z.h }, offx: p.x - z.x, offy: p.y - z.y, last: null }; }
  function startResize(e, z, h) { e.stopPropagation(); dragRef.current = { mode: 'resize', id: z.id, handle: h, orig: { x: z.x, y: z.y, w: z.w, h: z.h }, last: null }; }

  async function checkMatch(fid) { try { var r = await api.post('/redaction-templates/match', { file_id: fid }); if (r.data && r.data.matched) setMatchTpl(r.data.template); } catch (e) {} }
  async function applyTemplate() {
    if (!matchTpl || !job) return; setBusy('tpl');
    try { var r = await api.post('/redaction-templates/' + matchTpl.id + '/stage', { job_id: job.id, file_id: fileId }); setZones(function (z) { return z.concat(r.data.zones || []); }); setMatchTpl(null); } catch (e) { setError('Could not apply the template. ' + msg(e)); }
    setBusy('');
  }
  async function discover(fid) {
    setDiscovering(true);
    try { var r = await api.post('/redaction-jobs/file/' + (fid || fileId) + '/discover'); var sug = (r.data.suggestions || []).map(function (s, i) { return Object.assign({}, s, { _k: 'sug_' + Date.now() + '_' + i }); }); setSuggestions(sug); }
    catch (e) { setError('AI scan failed. ' + msg(e)); }
    setDiscovering(false);
  }
  async function acceptSuggestion(s) {
    try { var r = await api.post('/redaction-jobs/jobs/' + job.id + '/zones', { page_no: s.page_no, x: s.x, y: s.y, w: s.w, h: s.h, rule_id: s.rule_id || null }); setZones(function (z) { return z.concat(r.data.zone); }); setSuggestions(function (arr) { return arr.filter(function (x) { return x._k !== s._k; }); }); setSelected(function (m) { var n = Object.assign({}, m); delete n[s._k]; return n; }); }
    catch (e) { setError('Could not apply the suggestion. ' + msg(e)); }
  }
  async function applySelected() {
    var chosen = suggestions.filter(function (s) { return selected[s._k]; });
    var list = chosen.length ? chosen : suggestions; // nothing ticked -> apply all
    for (var i = 0; i < list.length; i++) { await acceptSuggestion(list[i]); }
  }
  function toggleSel(k) { setSelected(function (m) { var n = Object.assign({}, m); if (n[k]) delete n[k]; else n[k] = true; return n; }); }
  function toggleSelAll(on) { var n = {}; if (on) suggestions.forEach(function (s) { n[s._k] = true; }); setSelected(n); }

  // Reviewer sends it back. The reason is required (backend enforces it too) — it is the only thing the
  // author gets to work from, and it lands on the request's history.
  async function returnToAuthor() {
    var note = returnNote.trim();
    if (!note) { setError('Say what needs to change before returning this redaction to the author.'); return; }
    setBusy('return');
    try {
      await api.post('/redaction-jobs/jobs/' + job.id + '/return', { note: note });
      nav('/my-tasks');
    } catch (e) { setError('Could not return this redaction. ' + msg(e)); }
    setBusy('');
  }

  async function apply() {
    if (!window.confirm('Approve and release ' + zones.length + ' redaction(s)? The redacted content is permanently removed from the released copy.')) return;
    setApplying(true);
    // The job row drives the rail's released state, so advance it here — the server has already
    // moved it to `released` and a stale job leaves the operator on the pre-release rail.
    try { var r = await api.post('/redaction-jobs/jobs/' + job.id + '/apply'); setResult(r.data); setJob(function (j) { return Object.assign({}, j, { review_stage: 'released' }); }); }
    catch (e) { setError((e.response && e.response.status === 403 ? 'Blocked: ' : e.response && e.response.status === 409 ? 'Not ready: ' : 'Release failed. ') + (msg(e) || '')); }
    setApplying(false);
  }
  async function submitForReview() {
    setBusy('submit');
    try { await api.post('/redaction-jobs/jobs/' + job.id + '/submit'); await openFile(fileId); setError(''); }
    catch (e) { setError('Could not submit for review. ' + msg(e)); }
    setBusy('');
  }

  var selCount = Object.keys(selected).filter(function (k) { return selected[k]; }).length;
  var dispo = job && job.disposition ? DISPO[job.disposition] : null;
  var reviewGated = job && (job.disposition === 'elevated' || job.disposition === 'legal');
  var released = job && job.review_stage === 'released';
  // Reviewer-mode state: is this document actually awaiting me, and am I its author (who may never
  // self-approve — the backend gate returns 403; the UI says so before they try).
  var awaitingReview = job && (job.review_stage === 'pending_review' || job.review_stage === 'in_review');
  var iAmAuthor = !!(job && job.submitted_by && me && String(job.submitted_by) === String(me.name || me.email));
  var allZones = zones.slice().sort(sortReading);
  var allSuggestions = suggestions.slice().sort(sortReading);   // reading order, so the list tracks the document

  if (loading) return <div style={sty.center}>Opening redaction task…</div>;

  return (
    <div style={sty.root}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      {/* command bar */}
      <div style={sty.bar}>
        <div style={sty.grp}>
          <button style={sty.back} onClick={function () { nav('/my-tasks'); }}>‹ My Tasks</button>
          <span style={sty.reqid}>{task && task.request_number}</span>
          {tcm.mode !== 'off' ? <WorkTimerBadge timer={timer} /> : null}
          {files.length ? (
            <select value={fileId || ''} onChange={function (e) { setFileId(e.target.value); }} style={sty.filepick} title="Records included in the response">
              {files.map(function (f, i) { return <option key={f.id} value={f.id}>{f.original_name} · file {i + 1} of {files.length}</option>; })}
            </select>
          ) : null}
        </div>
        <div style={sty.grp}>
          <div style={sty.seg}>
            <button style={seg(!sxs)} onClick={function () { setSxs(false); }}>▭ Single page</button>
            <button style={seg(sxs)} onClick={function () { if (pages.length) { setSxs(true); loadImg(page); } }}>▥ Side by side</button>
          </div>
        </div>
        <div style={sty.grp}>
          <button style={sty.icon} onClick={function () { setSearchOpen(true); }}>⌕ Search inside document</button>
          {pages.length > 1 ? (
            <div style={sty.pager}>
              <button style={sty.pgbtn} disabled={pageIdx === 0} onClick={function () { gotoPage(pageIdx - 1); }}>‹</button>
              <span style={sty.pg}>Page {pageIdx + 1} / {pages.length}</span>
              <button style={sty.pgbtn} disabled={pageIdx >= pages.length - 1} onClick={function () { gotoPage(pageIdx + 1); }}>›</button>
            </div>
          ) : null}
        </div>
      </div>

      {/* disposition strip */}
      <div style={sty.strip}>
        {dispo ? <span style={badge(dispo)}><span style={dot(dispo)} />{dispo.label}</span> : <span style={{ fontSize: '12px', color: '#8792A0' }}>Triaging…</span>}
        {reviewMode ? <span style={sty.revTag}>Second review</span> : null}
        <span style={{ fontSize: '13px', color: '#48535F' }}>
          {reviewMode
            ? (released ? 'Released.'
              : job && job.submitted_by ? 'Submitted by ' + job.submitted_by + ' for review. Approve to release, or return it to them.'
                : 'Approve this redaction for release, or return it to the author.')
            : (task && task.type === 'legal_redaction' ? 'Legal (advanced) redaction · ' : '') +
              (reviewGated ? 'A second reviewer must approve before release.' : released ? 'Released.' : 'Review the AI suggestions, redact, and release.')}
        </span>
      </div>

      {error ? <div style={sty.err}>{error}</div> : null}
      {/* Author-side returned-for-rework banner (R10, 8b): the reviewer sent this back — show why, up top. */}
      {!reviewMode && task && task.return_reason ? (
        <div style={{ margin: '10px 16px 0', background: '#FBEBEB', border: '1px solid #F0B4B4', borderLeft: '4px solid #C22B2B', borderRadius: '8px', padding: '11px 14px' }}>
          <div style={{ fontSize: '11.5px', fontWeight: 800, letterSpacing: '.04em', color: '#C22B2B' }}>⚠ RETURNED FOR CORRECTIONS</div>
          <div style={{ fontSize: '13px', color: '#7A1F1F', marginTop: '3px' }}>{task.returned_by ? task.returned_by + ' returned this — ' : ''}“{task.return_reason}”</div>
          <div style={{ fontSize: '11px', color: '#9A5A5A', marginTop: '2px' }}>Make the fixes below, then re-submit for review.</div>
        </div>
      ) : null}
      {matchTpl && !sxs ? (
        <div style={sty.tplbar}>
          <span style={{ flex: 1 }}>Template <strong>{matchTpl.name}</strong> matches this form ({matchTpl.score}%). Apply it to pre-place its boxes for review.</span>
          <button style={sty.tplApply} disabled={busy === 'tpl'} onClick={applyTemplate}>{busy === 'tpl' ? 'Applying…' : 'Apply template'}</button>
          <button style={sty.tplNo} onClick={function () { setMatchTpl(null); }}>Not this form</button>
        </div>
      ) : null}

      <div style={sty.stage}>
        {/* canvas */}
        <div style={Object.assign({}, sty.canvas, sxs ? { alignItems: 'flex-start' } : null)}>
          {sxs ? (
            <div style={{ width: '100%' }}>
              <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                <button style={sty.returnBtn} onClick={function () { setSxs(false); }}>‹ Return to single page view</button>
                <div style={{ fontSize: '12.5px', color: '#48535F', marginTop: '6px' }}>{sxsCaption}</div>
              </div>
              <div style={{ display: 'flex', gap: '22px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <div><div style={sty.colHead}>Original</div>{docImg(page, imgUrls, null, null)}</div>
                <div><div style={sty.colHead}>Proposed release</div>{docImg(page, imgUrls, pageZones, pageSuggestions)}</div>
              </div>
            </div>
          ) : page ? (
            <div ref={wrapRef} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={function () { setDraft(null); }} style={sty.doc}>
              {imgUrls[page.id] ? <img src={imgUrls[page.id]} alt={'Page ' + page.page_no} draggable={false} style={{ width: '100%', display: 'block', pointerEvents: 'none' }} /> : <div style={sty.docLoad}>Loading page…</div>}
              {pageZones.map(function (z) {
                var hc = catColor(z.rule_id);
                var hbase = { position: 'absolute', width: '11px', height: '11px', background: 'white', border: '1.5px solid ' + hc, borderRadius: '2px', boxSizing: 'border-box', pointerEvents: 'auto', zIndex: 3 };
                var corners = [{ k: 'nw', s: { top: '-6px', left: '-6px', cursor: 'nwse-resize' } }, { k: 'ne', s: { top: '-6px', right: '-6px', cursor: 'nesw-resize' } }, { k: 'sw', s: { bottom: '-6px', left: '-6px', cursor: 'nesw-resize' } }, { k: 'se', s: { bottom: '-6px', right: '-6px', cursor: 'nwse-resize' } }];
                return (
                  <div key={z.id} onMouseDown={function (e) { startMove(e, z); }} style={{ position: 'absolute', left: pct(z.x), top: pct(z.y), width: pct(z.w), height: pct(z.h), background: 'rgba(16,21,27,.86)', border: '1px solid ' + hc, boxSizing: 'border-box', cursor: 'move', display: 'flex', alignItems: 'center' }}>
                    <span style={sty.znum}>{numById[z.id]}</span>
                    {corners.map(function (c) { return <div key={c.k} onMouseDown={function (e) { startResize(e, z, c.k); }} style={Object.assign({}, hbase, c.s)} />; })}
                  </div>
                );
              })}
              {pageSuggestions.map(function (s) { return <div key={s._k} style={{ position: 'absolute', left: pct(s.x), top: pct(s.y), width: pct(s.w), height: pct(s.h), border: '1.5px solid ' + (s.category && CAT_COLORS[s.category] ? CAT_COLORS[s.category] : 'rgba(200,120,20,.95)'), background: 'rgba(224,140,32,.30)', boxSizing: 'border-box', pointerEvents: 'none', borderRadius: '2px' }} />; })}
              {draft ? <div style={{ position: 'absolute', left: pct(Math.min(draft.x, draft.x2)), top: pct(Math.min(draft.y, draft.y2)), width: pct(Math.abs(draft.x2 - draft.x)), height: pct(Math.abs(draft.y2 - draft.y)), background: 'rgba(31,78,121,.25)', border: '1px dashed #1F4E79', pointerEvents: 'none' }} /> : null}
            </div>
          ) : <div style={{ color: '#8792A0' }}>No document.</div>}
        </div>

        {/* right rail accordion */}
        {sxs ? null : (
          <aside style={sty.rail}>
            {released ? (
              <div style={{ padding: '18px' }}>
                <div style={sty.releasedBox}>✓ Released. {result ? 'A redacted copy + documentation sheet were generated.' : 'This document has been released.'}</div>
                {reviewMode && files.length > 1 ? <div style={{ fontSize: '12.5px', color: '#48535F', marginBottom: '12px' }}>Use the file picker above to review the other documents on this request.</div> : null}
                <button style={sty.railGhost} onClick={function () { nav('/my-tasks'); }}>Back to My Tasks</button>
              </div>
            ) : reviewMode ? (
              <div style={sty.acc}>
                {/* What the author proposes to redact — page-anchored, click to jump */}
                <AccBox id="proposed" open={open} setOpen={setOpen} title="Proposed redactions" count={allZones.length} sub="What the author is asking to black out">
                  <div style={sty.ailist}>
                    {allZones.length === 0 ? (
                      <div style={sty.warnBox}>The author proposed <b>no redactions at all</b>. Releasing now publishes this document unchanged — read every page before you approve.</div>
                    ) : allZones.map(function (z) {
                      var pi = pages.map(function (p) { return p.page_no; }).indexOf(z.page_no);
                      var r = ruleOf(z.rule_id);
                      return (
                        <div key={z.id} style={Object.assign({}, sty.item, { cursor: 'pointer' })} onClick={function () { if (pi >= 0) gotoPage(pi); }}>
                          <span style={Object.assign({}, sty.znumList, { background: catColor(z.rule_id) })}>{numById[z.id]}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={sty.itemTxt}>{r ? r.title : 'No rule cited'}</span>
                            <span style={sty.itemWhy}>{r ? r.category_label || r.category : 'Ask the author which exemption this claims — an uncited box has no legal basis on the documentation sheet.'}</span>
                          </span>
                          <PageChip pageNo={z.page_no} />
                          <button style={sty.remove} onClick={function (e) { e.stopPropagation(); delZone(z.id); }}>Remove</button>
                        </div>
                      );
                    })}
                  </div>
                  <div style={sty.pad}>
                    <div style={sty.divider} />
                    <div style={{ fontSize: '12.5px', color: '#48535F', lineHeight: 1.5 }}>Spotted something the author missed? Pick a rule, then draw a box on the page — it joins the release you approve.</div>
                    <select value={ruleId} onChange={function (e) { setRuleId(e.target.value); }} style={sty.select}>
                      <option value="">(No rule / manual)</option>
                      {rules.map(function (r) { return <option key={r.id} value={r.id}>{r.title} ({r.category_label})</option>; })}
                    </select>
                  </div>
                </AccBox>

                {/* Optional second-pass AI check — not auto-run; the reviewer asks for it */}
                <AccBox id="ai" open={open} setOpen={setOpen} title="Second-pass AI check" count={suggestions.length} sub="Ask the AI what the author may have missed">
                  <div style={sty.aisub}>
                    <label style={sty.selall}><input type="checkbox" checked={suggestions.length > 0 && selCount === suggestions.length} onChange={function (e) { toggleSelAll(e.target.checked); }} /> Select all</label>
                    <span style={{ flex: 1 }} />
                    <button style={btnPrimary(suggestions.length === 0)} disabled={suggestions.length === 0} onClick={applySelected}>Add selected ({selCount})</button>
                  </div>
                  <div style={sty.ailist}>
                    {discovering ? <div style={sty.scan}><div style={sty.spin} />Re-scanning the document…</div>
                      : suggestions.length === 0 ? (
                        <div style={sty.pad}>
                          <div style={{ fontSize: '12.5px', color: '#48535F', lineHeight: 1.5 }}>Run the detector again to see whether anything exempt is still in the clear. Anything already redacted by the author won’t come back.</div>
                          <button style={sty.railGhost} onClick={function () { discover(); }}>↻ Run AI check</button>
                        </div>
                      ) : allSuggestions.map(function (s) {
                        return (
                          <label key={s._k} style={Object.assign({}, sty.item, selected[s._k] ? sty.itemOn : null)}>
                            <input type="checkbox" checked={!!selected[s._k]} onChange={function () { toggleSel(s._k); }} style={{ marginTop: '2px' }} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={sty.itemTxt}>{s.text}</span>
                              {s.reason ? <span style={sty.itemWhy}>{s.reason}</span> : null}
                              <span style={sty.itemRule}>{s.category ? <span style={sty.cat}>{s.category}</span> : null}{s.rule_title || 'No standing rule — pick one after adding'}</span>
                            </span>
                            <PageChip pageNo={s.page_no} />
                          </label>
                        );
                      })}
                  </div>
                </AccBox>

                {/* The decision */}
                <AccBox id="decision" open={open} setOpen={setOpen} title="Decision" sub="Approve for release, or return it to the author">
                  <div style={sty.pad}>
                    {iAmAuthor ? (
                      <div style={sty.warnBox}>You submitted this redaction, so you cannot approve it. A different reviewer has to. You can still return it to yourself for rework.</div>
                    ) : !awaitingReview ? (
                      <div style={sty.finban}>This document is not awaiting review right now (status: {(job && job.review_stage) || 'editing'}). Nothing to approve.</div>
                    ) : (
                      <div style={Object.assign({}, sty.finban, { background: '#FBEEDD', color: '#B4690E' })}>
                        <b>{job && job.disposition === 'legal' ? 'Legal.' : 'Elevated.'}</b> You are the second reviewer. Approving releases the document — the black boxes are burned in permanently and a documentation sheet is generated.
                      </div>
                    )}
                    <button style={btnPrimary(applying || iAmAuthor || !awaitingReview || zones.length === 0)}
                      disabled={applying || iAmAuthor || !awaitingReview || zones.length === 0}
                      onClick={apply}>{applying ? 'Releasing…' : 'Approve & release (' + zones.length + ')'}</button>
                    <div style={sty.divider} />
                    <div style={sty.lbl}>Return to the author</div>
                    <textarea value={returnNote} onChange={function (e) { setReturnNote(e.target.value); }} rows={3}
                      placeholder="What has to change? e.g. “The complainant’s DOB on page 2 is still in the clear, and box 4 cites no rule.”"
                      style={sty.textarea} />
                    <button style={Object.assign({}, sty.returnToAuthor, (busy === 'return' || !returnNote.trim()) ? { background: '#F3F6F9', color: '#8792A0', borderColor: '#D9E0E8', cursor: 'default' } : null)}
                      disabled={busy === 'return' || !returnNote.trim()} onClick={returnToAuthor}>
                      {busy === 'return' ? 'Returning…' : '↩ Return for rework'}
                    </button>
                  </div>
                </AccBox>
              </div>
            ) : (
              <div style={sty.acc}>
                {/* AI Redaction */}
                <AccBox id="ai" open={open} setOpen={setOpen} title="AI Redaction" count={suggestions.length} sub="Exempt content the AI proposes to redact">
                  <div style={sty.aisub}>
                    <label style={sty.selall}><input type="checkbox" checked={suggestions.length > 0 && selCount === suggestions.length} onChange={function (e) { toggleSelAll(e.target.checked); }} /> Select all</label>
                    <span style={{ flex: 1 }} />
                    <button style={btnPrimary(suggestions.length === 0)} disabled={suggestions.length === 0} onClick={applySelected}>Apply selected ({selCount})</button>
                  </div>
                  <div style={sty.ailist}>
                    {discovering ? <div style={sty.scan}><div style={sty.spin} />Scanning document for exempt content…<div style={{ fontSize: '11.5px', color: '#8792A0', marginTop: '6px' }}>AI · runs automatically on open</div></div>
                      : suggestions.length === 0 ? <div style={{ fontSize: '13px', color: '#8792A0', padding: '10px 2px' }}>No AI suggestions{zones.length ? ' remaining' : ''}. Draw boxes manually if needed.</div>
                        : allSuggestions.map(function (s) {
                          return (
                            <label key={s._k} style={Object.assign({}, sty.item, selected[s._k] ? sty.itemOn : null)}>
                              <input type="checkbox" checked={!!selected[s._k]} onChange={function () { toggleSel(s._k); }} style={{ marginTop: '2px' }} />
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={sty.itemTxt}>{s.text}</span>
                                {s.reason ? <span style={sty.itemWhy}>{s.reason}</span> : null}
                                <span style={sty.itemRule}>{s.category ? <span style={sty.cat}>{s.category}</span> : null}{s.rule_title || 'No standing rule — pick one after adding'}</span>
                              </span>
                              <PageChip pageNo={s.page_no} />
                            </label>
                          );
                        })}
                  </div>
                  <div style={{ textAlign: 'center', paddingTop: '8px' }}><button style={sty.link} onClick={function () { discover(); }} disabled={discovering}>↻ Re-run AI detection</button></div>
                </AccBox>

                {/* Manual Redaction */}
                <AccBox id="manual" open={open} setOpen={setOpen} title="Manual Redaction" sub="Draw a box on the page to add a redaction">
                  <div style={sty.pad}>
                    <div style={{ fontSize: '12.5px', color: '#48535F', lineHeight: 1.5 }}>Draw a box on the page to add a redaction the AI didn’t catch. New boxes get the rule selected below; drag a box to move it, corners to resize.</div>
                    <div>
                      <div style={sty.lbl}>Rule for new boxes</div>
                      <select value={ruleId} onChange={function (e) { setRuleId(e.target.value); }} style={sty.select}>
                        <option value="">(No rule / manual)</option>
                        {rules.map(function (r) { return <option key={r.id} value={r.id}>{r.title} ({r.category_label})</option>; })}
                      </select>
                    </div>
                    <div style={sty.lbl}>Boxes on page {pageIdx + 1} ({pageZones.length})</div>
                    {pageZones.length === 0 ? <div style={{ fontSize: '12.5px', color: '#8792A0' }}>None yet.</div> : pageZones.map(function (z) {
                      return (
                        <div key={z.id} style={sty.zrow}>
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '17px', height: '17px', minWidth: '17px', borderRadius: '50%', background: '#10151B', color: 'white', fontSize: '10px', fontWeight: 700 }}>{numById[z.id]}</span>
                          <select value={z.rule_id || ''} onChange={function (e) { setZoneRule(z.id, e.target.value); }} style={Object.assign({}, sty.select, { flex: 1, fontSize: '12px', padding: '5px 8px' })}>
                            <option value="">(No rule)</option>
                            {rules.map(function (r) { return <option key={r.id} value={r.id}>{r.title}</option>; })}
                          </select>
                          <button style={sty.remove} onClick={function () { delZone(z.id); }}>Remove</button>
                        </div>
                      );
                    })}
                  </div>
                </AccBox>

                {/* Finalize & Release */}
                <AccBox id="finalize" open={open} setOpen={setOpen} title="Finalize & Release" sub="Template, review, and release">
                  <div style={sty.pad}>
                    <div style={Object.assign({}, sty.finban, reviewGated ? { background: '#FBEEDD', color: '#B4690E' } : { background: '#E7EFF7', color: '#1F4E79' })}>
                      {reviewGated ? <span><b>{job.disposition === 'legal' ? 'Legal.' : 'Elevated.'}</b> A different reviewer must approve this before it can be released.</span>
                        : <span><b>{job && job.disposition === 'simple' ? 'Simple.' : 'Standard.'}</b> Redact and release; a second review is optional.</span>}
                    </div>
                    <button style={sty.railGhost} disabled={zones.length === 0} onClick={function () { saveTpl(); }}>⧉ Generate reusable template</button>
                    <div style={sty.divider} />
                    {reviewGated ? (
                      <button style={btnPrimary(busy === 'submit')} disabled={busy === 'submit'} onClick={function () { requestComplete('submit'); }}>{busy === 'submit' ? 'Submitting…' : 'Submit for review →'}</button>
                    ) : (
                      <button style={btnPrimary(applying || zones.length === 0)} disabled={applying || zones.length === 0} onClick={function () { requestComplete('apply'); }}>{applying ? 'Releasing…' : 'Approve & release (' + zones.length + ')'}</button>
                    )}
                    {job && job.disposition !== 'legal' ? <button style={sty.legalBtn} onClick={function () { requestComplete('submit'); }} disabled={busy === 'submit'}>Send for legal review</button> : null}
                  </div>
                </AccBox>
              </div>
            )}
          </aside>
        )}
      </div>

      {searchOpen ? <SearchModal requestId={task && task.request_id} onClose={function () { setSearchOpen(false); }} /> : null}
      {laborModal ? <WorkTimerCompleteModal open taskId={taskId} seconds={timer.seconds} allowSkip={tcm.mode === 'discretion'}
        contextLabel={(reviewMode ? 'Redaction review' : 'Redaction') + ' · ' + ((task && task.request_number) || '')}
        confirmLabel={laborModal.action === 'apply' ? 'Log time & release' : 'Log time & submit'}
        onConfirm={async function () { await doComplete(laborModal.action); setLaborModal(null); }}
        onClose={function () { setLaborModal(null); }} /> : null}
    </div>
  );

  // ---- save-template (simple prompt-based; mirrors the workspace) ----
  async function saveTpl() {
    var name = window.prompt('Name this reusable template (saves the current boxes + rules for the same form type):');
    if (!name || !name.trim()) return;
    try {
      await api.post('/redaction-templates', { name: name.trim(), source_file_id: fileId, zones: zones.map(function (z) { var r = ruleOf(z.rule_id); return { page_no: z.page_no, x: z.x, y: z.y, w: z.w, h: z.h, rule_id: z.rule_id || null, label: r ? r.title : null }; }) });
      setError('');
    } catch (e) { setError('Could not save template. ' + msg(e)); }
  }
}

// ---- accordion box ----
function AccBox(props) {
  var isOpen = props.open === props.id;
  return (
    <section style={Object.assign({}, sty.box, isOpen ? sty.boxOpen : null)}>
      <button style={sty.head} onClick={function () { props.setOpen(isOpen ? '' : props.id); }}>
        <span style={Object.assign({}, sty.caret, isOpen ? { transform: 'rotate(90deg)' } : null)}>▸</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={sty.htitle}>{props.title}{typeof props.count === 'number' ? <span style={sty.count}>{props.count}</span> : null}</span>
          <span style={sty.hsub}>{props.sub}</span>
        </span>
      </button>
      {isOpen ? <div style={sty.body}>{props.children}</div> : null}
    </section>
  );
}

// ---- side-by-side page render (read-only) ----
// `zones` are applied redactions; `pending` are AI proposals not yet applied. Both black out the
// content, because the pane answers "what would release look like" — a proposal left un-previewed
// makes an unredacted page look like a clean one. Pending boxes carry a dashed edge so the operator
// can still tell what is committed from what is only proposed.
function docImg(page, imgUrls, zones, pending) {
  if (!page) return <div style={{ width: '340px', height: '440px', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8792A0', boxShadow: '0 1px 8px rgba(20,30,45,.12)' }}>No page</div>;
  return (
    <div style={{ position: 'relative', width: '360px', maxWidth: '100%', background: 'white', boxShadow: '0 1px 8px rgba(20,30,45,.12)' }}>
      {imgUrls[page.id] ? <img src={imgUrls[page.id]} alt="" draggable={false} style={{ width: '100%', display: 'block' }} /> : <div style={{ width: '100%', aspectRatio: '8.5/11', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8792A0' }}>Loading…</div>}
      {(zones || []).map(function (z) { return <div key={z.id} style={{ position: 'absolute', left: pct(z.x), top: pct(z.y), width: pct(z.w), height: pct(z.h), background: '#10151B' }} />; })}
      {(pending || []).map(function (s) { return <div key={s._k} style={{ position: 'absolute', left: pct(s.x), top: pct(s.y), width: pct(s.w), height: pct(s.h), background: '#10151B', border: '1.5px dashed #E08C20', boxSizing: 'border-box' }} />; })}
    </div>
  );
}

// ---- in-document semantic search modal ----
function SearchModal(props) {
  var [q, setQ] = useState('');
  var [results, setResults] = useState(null);
  var [busy, setBusy] = useState(false);
  async function run() {
    if (!q.trim()) return; setBusy(true);
    try { var r = await api.post('/semantic-search/documents', { query: q.trim(), requestId: props.requestId, topN: 8 }); setResults(r.data.results || r.data.matches || []); }
    catch (e) { setResults([]); }
    setBusy(false);
  }
  return (
    <div style={sty.scrim} onClick={function (e) { if (e.target === e.currentTarget) props.onClose(); }}>
      <div style={sty.modal}>
        <div style={sty.mhead}>
          <div><h3 style={{ margin: 0, fontSize: '15px' }}>Search inside this request’s documents</h3><p style={{ margin: '2px 0 0', fontSize: '12px', color: '#8792A0' }}>Ask in plain language — finds the most relevant pages by meaning.</p></div>
          <button style={sty.x} onClick={props.onClose}>✕</button>
        </div>
        <div style={sty.searchrow}>
          <input autoFocus value={q} onChange={function (e) { setQ(e.target.value); }} onKeyDown={function (e) { if (e.key === 'Enter') run(); }} placeholder='e.g. "bank account or routing number"' style={sty.searchInput} />
          <button style={btnPrimary(busy)} disabled={busy} onClick={run}>{busy ? 'Searching…' : 'Search'}</button>
        </div>
        <div style={sty.results}>
          {results == null ? <div style={{ color: '#8792A0', fontSize: '13px', padding: '8px 0' }}>Enter a query to search across the attached documents.</div>
            : results.length === 0 ? <div style={{ color: '#8792A0', fontSize: '13px', padding: '8px 0' }}>No matches.</div>
              : results.map(function (r, i) { return <div key={i} style={sty.res}><div style={sty.rp}>{(r.title || r.file_name || ('Result ' + (i + 1)))}{r.score != null ? ' · ' + Math.round(r.score * 100) / 100 : ''}</div><div style={sty.rt}>{r.snippet || r.text || r.summary || ''}</div></div>; })}
        </div>
      </div>
    </div>
  );
}

function pct(v) { return (v * 100) + '%'; }
function seg(on) { return { background: on ? '#1F4E79' : 'transparent', color: on ? '#fff' : '#93A2B4', border: 'none', fontSize: '12.5px', fontWeight: 650, padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }; }
function badge(d) { return { display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '12px', fontWeight: 750, padding: '4px 11px', borderRadius: '999px', background: d.bg, color: d.fg }; }
function dot(d) { return { width: '8px', height: '8px', borderRadius: '50%', background: d.fg }; }
function btnPrimary(disabled) { return { background: disabled ? '#9CB4CC' : '#1F4E79', color: '#fff', border: 'none', fontSize: '12.5px', fontWeight: 700, borderRadius: '8px', padding: '8px 12px', cursor: disabled ? 'default' : 'pointer', width: '100%' }; }

var sty = {
  center: { padding: '48px', textAlign: 'center', color: '#8792A0' },
  root: { height: '100vh', display: 'flex', flexDirection: 'column', background: '#E7ECF2', fontFamily: 'ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif', overflow: 'hidden' },
  bar: { height: '54px', flexShrink: 0, background: '#141D28', color: '#E9EEF4', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', padding: '0 14px' },
  grp: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 },
  back: { display: 'flex', alignItems: 'center', gap: '7px', color: '#93A2B4', background: 'transparent', border: 'none', fontSize: '13px', fontWeight: 600, padding: '6px 8px', borderRadius: '8px', cursor: 'pointer' },
  reqid: { fontFamily: 'ui-monospace,Menlo,monospace', fontWeight: 700, fontSize: '14px', color: '#fff' },
  filepick: { background: '#1D2A38', border: '1px solid #2A3A4C', color: '#E9EEF4', padding: '6px 10px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, maxWidth: '260px' },
  seg: { display: 'flex', background: '#1D2A38', border: '1px solid #2A3A4C', borderRadius: '9px', padding: '3px' },
  icon: { display: 'flex', alignItems: 'center', gap: '7px', background: '#1D2A38', border: '1px solid #2A3A4C', color: '#E9EEF4', fontSize: '12.5px', fontWeight: 600, padding: '7px 11px', borderRadius: '8px', cursor: 'pointer' },
  pager: { display: 'flex', alignItems: 'center', gap: '4px' },
  pgbtn: { width: '30px', height: '30px', background: '#1D2A38', border: '1px solid #2A3A4C', color: '#E9EEF4', borderRadius: '7px', fontSize: '15px', cursor: 'pointer' },
  pg: { fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '12.5px', color: '#93A2B4', minWidth: '58px', textAlign: 'center' },
  strip: { flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 16px', background: '#fff', borderBottom: '1px solid #D9E0E8' },
  err: { background: '#F8E7E8', color: '#B02A37', padding: '9px 16px', fontSize: '13px' },
  tplbar: { background: '#E7EFF7', borderBottom: '1px solid #BFD3E8', padding: '9px 16px', fontSize: '13px', color: '#1F4E79', display: 'flex', alignItems: 'center', gap: '12px' },
  tplApply: { flexShrink: 0, padding: '6px 12px', borderRadius: '7px', border: 'none', background: '#1F4E79', color: '#fff', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' },
  tplNo: { flexShrink: 0, padding: '6px 12px', borderRadius: '7px', border: '1px solid #BFD3E8', background: '#fff', color: '#1F4E79', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' },
  stage: { flex: 1, display: 'flex', minHeight: 0 },
  canvas: { flex: 1, overflow: 'auto', padding: '24px', display: 'flex', justifyContent: 'center' },
  doc: { position: 'relative', width: '720px', maxWidth: '100%', alignSelf: 'flex-start', boxShadow: '0 2px 10px rgba(20,30,45,.14)', cursor: 'crosshair', userSelect: 'none', background: '#fff' },
  docLoad: { width: '100%', aspectRatio: '8.5/11', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8792A0' },
  znum: { marginLeft: '2px', width: '15px', height: '15px', minWidth: '15px', borderRadius: '50%', background: 'white', color: '#111', fontSize: '9px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
  returnBtn: { background: '#1F4E79', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  colHead: { textAlign: 'center', fontSize: '10.5px', letterSpacing: '.09em', textTransform: 'uppercase', fontWeight: 700, color: '#8792A0', marginBottom: '8px' },
  rail: { flexShrink: 0, width: '380px', background: '#fff', borderLeft: '1px solid #D9E0E8', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  acc: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 },
  box: { borderBottom: '1px solid #D9E0E8', display: 'flex', flexDirection: 'column', minHeight: 0 },
  boxOpen: { flex: '1 1 auto' },
  head: { display: 'flex', alignItems: 'center', gap: '10px', padding: '13px 16px', background: '#fff', border: 'none', width: '100%', textAlign: 'left', color: '#14181D', cursor: 'pointer' },
  caret: { color: '#8792A0', transition: 'transform .18s', fontSize: '12px' },
  htitle: { fontSize: '13.5px', fontWeight: 750, display: 'flex', alignItems: 'center', gap: '8px' },
  hsub: { fontSize: '11.5px', color: '#8792A0', display: 'block', marginTop: '1px' },
  count: { fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '11px', fontWeight: 700, background: '#FBF0E1', color: '#D9821A', padding: '1px 7px', borderRadius: '999px' },
  body: { display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
  aisub: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderTop: '1px solid #D9E0E8', borderBottom: '1px solid #D9E0E8', background: '#F3F6F9' },
  selall: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#48535F', fontWeight: 600 },
  ailist: { overflow: 'auto', padding: '6px 12px 10px', flex: 1 },
  item: { display: 'flex', gap: '10px', padding: '10px', border: '1px solid #D9E0E8', borderRadius: '9px', marginTop: '8px', background: '#fff', alignItems: 'flex-start', cursor: 'pointer' },
  itemOn: { borderColor: '#D9821A', background: '#FBF0E1' },
  itemTxt: { display: 'block', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '13px', fontWeight: 650, color: '#14181D' },
  itemWhy: { display: 'block', fontSize: '11.5px', color: '#48535F', marginTop: '3px' },
  itemRule: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#8792A0', marginTop: '3px' },
  cat: { fontSize: '9.5px', letterSpacing: '.05em', textTransform: 'uppercase', fontWeight: 700, background: '#EAEFF4', color: '#48535F', padding: '1px 6px', borderRadius: '5px' },
  scan: { padding: '26px 18px', textAlign: 'center', color: '#48535F', fontSize: '13px' },
  spin: { width: '26px', height: '26px', border: '3px solid #EAEFF4', borderTopColor: '#D9821A', borderRadius: '50%', margin: '0 auto 12px', animation: 'spin .7s linear infinite' },
  link: { background: 'none', border: 'none', color: '#1F4E79', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  pad: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto' },
  lbl: { fontSize: '10.5px', letterSpacing: '.09em', textTransform: 'uppercase', color: '#8792A0', fontWeight: 700 },
  select: { width: '100%', fontSize: '12.5px', fontWeight: 600, color: '#14181D', background: '#fff', border: '1px solid #D9E0E8', borderRadius: '8px', padding: '8px', boxSizing: 'border-box' },
  zrow: { display: 'flex', alignItems: 'center', gap: '8px' },
  remove: { border: 'none', background: 'transparent', color: '#B02A37', cursor: 'pointer', fontSize: '12px', fontWeight: 600 },
  revTag: { fontSize: '10.5px', letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 750, background: '#141D28', color: '#fff', padding: '3px 9px', borderRadius: '6px' },
  znumList: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '19px', height: '19px', minWidth: '19px', borderRadius: '50%', color: '#fff', fontSize: '10.5px', fontWeight: 700, marginTop: '1px' },
  pgchip: { fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '10.5px', fontWeight: 700, color: '#1F4E79', background: '#EAEFF4', border: '1px solid #D9E0E8', padding: '3px 7px', borderRadius: '6px', whiteSpace: 'nowrap', alignSelf: 'center', cursor: 'pointer' },
  warnBox: { background: '#F8E7E8', border: '1px solid #E3B6BA', color: '#B02A37', borderRadius: '9px', padding: '11px 12px', fontSize: '12.5px', lineHeight: 1.5, margin: '8px 0' },
  textarea: { width: '100%', boxSizing: 'border-box', fontSize: '12.5px', fontFamily: 'inherit', color: '#14181D', background: '#fff', border: '1px solid #D9E0E8', borderRadius: '8px', padding: '9px', resize: 'vertical' },
  returnToAuthor: { width: '100%', background: '#fff', color: '#B02A37', border: '1px solid #E3B6BA', borderRadius: '8px', padding: '9px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' },
  finban: { fontSize: '12.5px', lineHeight: 1.5, padding: '11px 12px', borderRadius: '9px' },
  divider: { height: '1px', background: '#D9E0E8' },
  railGhost: { width: '100%', background: '#fff', color: '#1F4E79', border: '1px solid #D9E0E8', borderRadius: '8px', padding: '9px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' },
  legalBtn: { width: '100%', background: '#6D3BB5', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' },
  releasedBox: { background: '#E4F3EC', border: '1px solid #A7D8C0', color: '#177A54', borderRadius: '9px', padding: '12px', fontSize: '13px', lineHeight: 1.5, marginBottom: '12px' },
  scrim: { position: 'fixed', inset: 0, background: 'rgba(10,16,24,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40, padding: '20px' },
  modal: { background: '#fff', border: '1px solid #D9E0E8', borderRadius: '14px', boxShadow: '0 10px 30px rgba(20,30,45,.2)', width: '560px', maxWidth: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  mhead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px', borderBottom: '1px solid #D9E0E8' },
  x: { background: '#F3F6F9', border: '1px solid #D9E0E8', width: '30px', height: '30px', borderRadius: '8px', color: '#48535F', fontSize: '15px', cursor: 'pointer' },
  searchrow: { display: 'flex', gap: '8px', padding: '14px 18px', borderBottom: '1px solid #D9E0E8' },
  searchInput: { flex: 1, fontSize: '13.5px', padding: '9px 12px', border: '1px solid #D9E0E8', borderRadius: '9px', background: '#F3F6F9' },
  results: { overflow: 'auto', padding: '8px 18px 16px' },
  res: { padding: '11px 0', borderBottom: '1px solid #D9E0E8' },
  rp: { fontSize: '11px', color: '#1F4E79', fontWeight: 700, fontFamily: 'ui-monospace,Menlo,monospace' },
  rt: { fontSize: '13px', color: '#14181D', marginTop: '3px' }
};
