import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';

// INVENTORY INFORMATION — one source's census (inventory build slice 2, 2026-09-15; drawings in
// docs/mockups/inventory_census, Kevin's calls of 2026-09-14/15: ONE Inventory door per source card, the census is
// started and refreshed HERE, "Everything else" is just a file list, every template is named for what it is, OCR is
// the census's second pass). Data: GET /repositories/:id/inventory · POST /repositories/:id/census ·
// GET /repositories/:id/inventory/file/:fp (View sample). Association and the three doors on a grouping are slice 3;
// their buttons are drawn but say so.

var C = { ink: 'var(--oq-fg-12232e)', mute: 'var(--oq-fg-5c6f7c)', faint: 'var(--oq-fg-8296a4)', line: 'var(--oq-ln-d2dce3)', edge: 'var(--oq-ln-becad3)', pri: 'var(--oq-bg-1e6091)', priFg: 'var(--oq-fg-1e6091)' };
var card = { background: 'var(--oq-bg-ffffff)', border: '1px solid ' + C.line, borderRadius: '10px' };
var sect = { fontSize: '11.5px', fontWeight: '700', color: C.mute, textTransform: 'uppercase', letterSpacing: '0.05em' };
var hint = { fontSize: '11.5px', color: C.faint, lineHeight: '1.4' };
function pill(kind, text) {
  var K = { ok: ['var(--oq-bg-e1f2e9)', 'var(--oq-fg-1b8a5a)'], warn: ['var(--oq-bg-f6ebd6)', 'var(--oq-fg-9a6512)'], grey: ['var(--oq-bg-f0f2f5)', 'var(--oq-fg-5b6b7a)'], blue: ['var(--oq-bg-ebf3fb)', 'var(--oq-fg-1f4e79)'], red: ['var(--oq-bg-fee2e2)', 'var(--oq-fg-991b1b)'] }[kind] || ['var(--oq-bg-f0f2f5)', 'var(--oq-fg-5b6b7a)'];
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '700', borderRadius: '999px', padding: '3px 9px', whiteSpace: 'nowrap', background: K[0], color: K[1] }}>{text}</span>;
}
function btn(kind, extra) {
  var base = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', height: '30px', padding: '0 12px', borderRadius: '7px', fontSize: '12.5px', fontWeight: '600', fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid ' + C.edge, background: 'var(--oq-bg-ffffff)', color: C.ink };
  var k = kind === 'pri' ? { background: C.pri, color: 'var(--oq-fg-ffffff)', border: '1px solid var(--oq-ln-1e6091)' }
    : kind === 'soft' ? { background: 'var(--oq-bg-ebf3fb)', color: 'var(--oq-fg-1f4e79)', border: '1px solid var(--oq-ln-c9d6e2)' }
    : kind === 'dis' ? { background: 'var(--oq-bg-f2f6f9)', color: 'var(--oq-fg-a9b7c2)', border: '1px solid ' + C.line, cursor: 'default' } : {};
  return Object.assign(base, k, extra || {});
}
function when(x) { return x ? String(x).slice(0, 16) : ''; }
function secs(ms) { if (ms == null) return ''; var s = Math.round(ms / 1000); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; }
function errText(e, fb) { return (e && e.response && e.response.data && e.response.data.error) || fb; }
var GRID = '2fr 0.7fr 1fr 1.8fr 1.7fr 1.2fr 1fr';
var REDACTION = {
  template_ready: { kind: 'ok', label: 'Redaction template ready' },
  waiting: { kind: 'warn', label: 'Waiting for a redaction template' },
  no_redaction: { kind: 'ok', label: 'No redaction needed' },
  redact_by_hand: { kind: 'grey', label: 'Redact by hand' },
  none: { kind: 'grey', label: 'No redaction template' },
  proposed: { kind: 'warn', label: 'Redaction template proposed' },          // item 7: a worker's proposal awaits a supervisor
  holds: { kind: 'warn', label: 'Redaction template (holds for review)' },   // floating layout: pre-places, never burns (S4)
  assisted: { kind: 'ok', label: 'Redact by hand · assisted' }                // content profile: AI pre-scoped, never mass-applies
};
var LAYOUT_CLASS = { static: ['ok', 'Static'], floating: ['warn', 'Floating'], adhoc: ['grey', 'Free text'] };
var ESTIMATE = function (e) {
  if (!e || e.state === 'none') return ['warn', 'Estimate: none yet'];
  var t = e.state === 'seeded' ? 'Estimate: seeded (expert)' : 'Estimate: learned from ' + e.n + ' request' + (e.n === 1 ? '' : 's');
  return ['ok', t + (e.inherited ? ' · parent' : '')];
};
var LAYOUT = { uniform: ['ok', 'Uniform'], few_layouts: ['grey', 'Few layouts'] };

export default function SourceInventoryPage() {
  var { id } = useParams();
  var navigate = useNavigate();
  var [inv, setInv] = useState(null);
  var [err, setErr] = useState('');
  var [starting, setStarting] = useState(false);
  var [showFiles, setShowFiles] = useState(false);
  var [sample, setSample] = useState(null);   // { grouping, index, url, loading }
  var [staging, setStaging] = useState(null);
  var [assoc, setAssoc] = useState(null);     // Associate modal state
  var [noRed, setNoRed] = useState(null);     // No-redaction-needed modal state
  var [viewed, setViewed] = useState({});     // grouping id -> { fingerprint_id: true } samples opened this visit
  var [busy, setBusy] = useState(null);

  var load = useCallback(async function () {
    try { var r = await api.get('/repositories/' + id + '/inventory'); setInv(r.data); setErr(''); }
    catch (e) { setErr(errText(e, 'The inventory could not be loaded.')); }
  }, [id]);
  useEffect(function () { load(); }, [load]);
  // Item 7 S1: the approval door on the row (supervisor+). S2 restyles this after the mockup session.
  async function approveTemplate(t) {
    if (!window.confirm('Approve "' + t.name + '" as the redaction template? Documents of this variant that match it will be redacted automatically.')) return;
    setBusy(t.id); try { await api.post('/redaction-templates/' + t.id + '/approve'); await load(); } catch (e) { alert(errText(e, 'Could not approve.')); } setBusy(null);
  }
  async function returnTemplate(t) {
    var note = window.prompt('Return "' + t.name + '" to the proposer — what needs to change?'); if (note === null) return;
    setBusy(t.id); try { await api.post('/redaction-templates/' + t.id + '/return', { note: note }); await load(); } catch (e) { alert(errText(e, 'Could not return it.')); } setBusy(null);
  }
  // Poll while a census is queued or running.
  useEffect(function () {
    if (!inv || !inv.census || !inv.census.current) return;
    var t = setTimeout(load, 2000);
    return function () { clearTimeout(t); };
  }, [inv, load]);

  async function startCensus() {
    setStarting(true);
    try { await api.post('/repositories/' + id + '/census'); await load(); }
    catch (e) { setErr(errText(e, 'The census could not be started.')); }
    setStarting(false);
  }
  async function openSample(g, index) {
    var ex = g.examples[index]; if (!ex) return;
    if (sample && sample.url) URL.revokeObjectURL(sample.url);
    setSample({ grouping: g, index: index, url: null, loading: true });
    try {
      var r = await api.get('/repositories/' + id + '/inventory/file/' + ex.fingerprint_id + '/preview.png', { responseType: 'blob' });
      setSample({ grouping: g, index: index, url: URL.createObjectURL(r.data), loading: false });
      setViewed(function (v) { var n = Object.assign({}, v); n[g.id] = Object.assign({}, n[g.id] || {}); n[g.id][ex.fingerprint_id] = true; return n; });
    } catch (e) { setSample({ grouping: g, index: index, url: null, loading: false, error: errText(e, 'The document could not be opened.') }); }
  }
  async function openPdf() {
    var ex = sample && sample.grouping.examples[sample.index]; if (!ex) return;
    try { var r = await api.get('/repositories/' + id + '/inventory/file/' + ex.fingerprint_id, { responseType: 'blob' }); window.open(URL.createObjectURL(r.data), '_blank'); }
    catch (e) { alert(errText(e, 'The document could not be opened.')); }
  }
  function closeSample() { if (sample && sample.url) URL.revokeObjectURL(sample.url); setSample(null); }
  function viewedCount(g) { return Object.keys(viewed[g.id] || {}).length; }

  // ---- the three doors + association (slice 3) ----
  var G = function (g) { return '/repositories/' + id + '/groupings/' + g.id; };
  async function openAssociate(g) {
    closeSample();
    setAssoc({ g: g, catalog: null, suggestion: null, suggesting: false, mode: 'new_variant', parentId: '', name: '', existingId: '', err: '', busy: false });
    try { var r = await api.get(G(g) + '/catalog'); setAssoc(function (a) { return a ? Object.assign({}, a, { catalog: r.data }) : a; }); }
    catch (e) { setAssoc(function (a) { return a ? Object.assign({}, a, { err: errText(e, 'The catalog could not be loaded.') }) : a; }); }
  }
  async function askSuggestion() {
    setAssoc(function (a) { return Object.assign({}, a, { suggesting: true, err: '' }); });
    try {
      var r = await api.post(G(assoc.g) + '/suggest');
      var sg = r.data;
      setAssoc(function (a) {
        var next = Object.assign({}, a, { suggesting: false, suggestion: sg });
        if (sg.match && sg.match.record_type_id) { next.mode = 'existing'; next.existingId = sg.match.record_type_id; }
        if (sg.propose) { if (sg.propose.parent_record_type_id && !next.parentId) next.parentId = sg.propose.parent_record_type_id; if (sg.propose.name && !next.name) next.name = sg.propose.name; if (!sg.match) next.mode = 'new_variant'; }
        return next;
      });
    } catch (e) { setAssoc(function (a) { return Object.assign({}, a, { suggesting: false, err: errText(e, 'The suggestion failed.') }); }); }
  }
  async function approveAssociate() {
    var a = assoc; if (!a) return;
    if (a.mode === 'leave') { setAssoc(null); return; }
    setAssoc(Object.assign({}, a, { busy: true, err: '' }));
    try {
      var body = a.mode === 'existing' ? { mode: 'existing', record_type_id: a.existingId }
        : { mode: 'new_variant', parent_record_type_id: a.parentId, name: a.name, code: a.suggestion && a.suggestion.propose && a.suggestion.propose.name === a.name ? a.suggestion.propose.code : null,
            intent: a.suggestion && a.suggestion.propose ? a.suggestion.propose.intent : null, expected_content: a.suggestion && a.suggestion.propose ? a.suggestion.propose.expected_content : null,
            synonyms: a.suggestion && a.suggestion.propose ? a.suggestion.propose.synonyms : [], keywords: a.suggestion && a.suggestion.propose ? a.suggestion.propose.keywords : [],
            identifying_facets: a.suggestion && a.suggestion.propose ? a.suggestion.propose.identifying_facets : [], confidence: a.suggestion && a.suggestion.propose ? a.suggestion.propose.confidence : null };
      await api.post(G(a.g) + '/associate', body);
      setAssoc(null); await load();
    } catch (e) { setAssoc(function (x) { return Object.assign({}, x, { busy: false, err: errText(e, 'The association failed.') }); }); }
  }
  async function dissociate(g) {
    if (!window.confirm('Undo the association of "' + groupingName(g) + '"? Its ' + g.member_count + ' documents go back to "Not yet associated"; the record type itself stays.')) return;
    setBusy(g.id);
    try { await api.delete(G(g) + '/associate'); await load(); } catch (e) { alert(errText(e, 'Could not undo.')); }
    setBusy(null);
  }
  async function redactByHand(g, on) {
    if (on && !window.confirm('Redact by hand: each request\'s copies of "' + groupingName(g) + '" will be reviewed one by one. No redaction template, and Mass Redaction stops suggesting one. You can undo this here.')) return;
    setBusy(g.id); closeSample();
    try { if (on) await api.post(G(g) + '/redact-by-hand'); else await api.delete(G(g) + '/redact-by-hand'); await load(); } catch (e) { alert(errText(e, 'Could not record that.')); }
    setBusy(null);
  }
  async function openNoRedaction(g) {
    closeSample();
    setNoRed({ g: g, check: null, reason: '', busy: false, err: '' });
    try { var r = await api.get(G(g) + '/no-redaction/check'); setNoRed(function (n) { return n ? Object.assign({}, n, { check: r.data }) : n; }); }
    catch (e) { setNoRed(function (n) { return n ? Object.assign({}, n, { err: errText(e, 'The checks could not be loaded.') }) : n; }); }
  }
  async function confirmNoRedaction() {
    var n = noRed; if (!n) return;
    setNoRed(Object.assign({}, n, { busy: true, err: '' }));
    try { await api.post(G(n.g) + '/no-redaction', { reason: n.reason }); setNoRed(null); await load(); }
    catch (e) { setNoRed(function (x) { return Object.assign({}, x, { busy: false, err: errText(e, 'The decision was refused.') }); }); }
  }
  async function undoNoRedaction(g) {
    if (!window.confirm('Undo "No redaction needed" for "' + groupingName(g) + '"? The variant goes back to its previous release posture.')) return;
    setBusy(g.id);
    try { await api.delete(G(g) + '/no-redaction'); await load(); } catch (e) { alert(errText(e, 'Could not undo.')); }
    setBusy(null);
  }
  // "Start a redaction template" — the existing Mass Redaction path: stage a stamped example of the variant into the
  // redaction-template workspace (POST /redaction-templates/opportunities/:rt/stage-example).
  async function startTemplate(g) {
    if (!g.record_type) return;
    setStaging(g.id);
    try {
      var r = await api.post('/redaction-templates/opportunities/' + g.record_type.id + '/stage-example');
      navigate('/redact/' + r.data.fileId + '?for_type=' + encodeURIComponent(g.record_type.id));
    } catch (e) { setStaging(null); alert(errText(e, 'A document could not be staged for the template.')); }
  }

  var groupingName = function (g) { return g.record_type ? g.record_type.name : 'Unnamed grouping ' + g.ordinal; };
  if (err && !inv) return <div style={{ padding: '24px', color: 'var(--oq-fg-991b1b)', fontSize: '14px' }}>{err}</div>;
  if (!inv) return <div style={{ padding: '24px', color: C.faint, fontSize: '14px' }}>Loading inventory…</div>;
  var isData = inv.mode === 'data';
  async function associateKind(k, recordTypeId) {
    setBusy(k.id);
    try { if (recordTypeId) await api.post('/repositories/' + id + '/kinds/' + k.id + '/associate', { record_type_id: recordTypeId }); else await api.delete('/repositories/' + id + '/kinds/' + k.id + '/associate'); await load(); }
    catch (e) { alert(errText(e, 'Could not record that.')); }
    setBusy(null);
  }

  var src = inv.source, cz = inv.census, t = inv.totals, cur = cz.current, last = cz.last;
  var never = !last && !cur;
  var dr = cz.drift;
  var driftText = dr ? ((dr.new || dr.changed || dr.removed) ? [dr.new ? dr.new + ' new' : null, dr.changed ? dr.changed + ' changed' : null, dr.removed ? dr.removed + ' removed' : null].filter(Boolean).join(', ') + ' since' : 'No change since') : null;
  var pct = cur && cur.total_files ? Math.round((cur.done_files || 0) / cur.total_files * 100) : 0;
  var phaseText = cur ? (cur.status === 'queued' ? ('Queued' + (cz.queued_behind ? ' behind ' + cz.queued_behind.name : '') + ' — one census at a time protects the file server. Starts on its own; you can leave this page.')
    : cur.phase === 'text' ? 'Pass 1 of 2 — files with a text layer: ' + (cur.done_files || 0) + ' of ' + (cur.total_files || 0)
    : cur.phase === 'ocr' ? 'Pass 2 of 2 — scans read by OCR on this server · ' + (cur.done_files || 0) + ' of ' + (cur.total_files || 0) + ' files'
    : cur.phase === 'grouping' ? 'Grouping identical layouts…' : 'Starting…') : '';

  // Linked record types: buckets from the source links, variants from the groupings nested under their parent.
  var tree = {};
  (inv.linked_types || []).forEach(function (l) { if (!l.parent_name) tree[l.name] = tree[l.name] || { name: l.name, status: l.status, count: l.count_here, children: [], linked: true }; });
  (inv.groupings || []).forEach(function (g) {
    if (!g.record_type) return;
    var pn = g.record_type.parent ? g.record_type.parent.name : g.record_type.name;
    tree[pn] = tree[pn] || { name: pn, status: null, count: 0, children: [], linked: false };
    if (g.record_type.parent) tree[pn].children.push({ name: g.record_type.name, status: g.record_type.status, count: g.member_count });
    else tree[pn].count = g.member_count;
  });
  var treeList = Object.keys(tree).map(function (k) { return tree[k]; });

  return (
    <div style={{ padding: '20px 24px', maxWidth: '1180px' }}>
      <div style={Object.assign({}, card, { display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 14px', marginBottom: '14px' })}>
        <button onClick={function () { navigate('/setup/record-sources'); }} style={Object.assign(btn('soft'), { height: '26px', padding: '0 11px', fontSize: '11px', fontWeight: '700', borderRadius: '999px' })}>‹ Record Sources</button>
        <span style={{ fontSize: '12px', color: C.mute, flexGrow: 1 }}>Inventory information · what the census found on this source</span>
        <span style={hint}>Staff-only setup view. Nothing here is released.</span>
      </div>

      <div style={card}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid ' + C.line, display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: C.ink }}>{src.name}</div>
            <div style={{ fontSize: '12.5px', color: C.mute, marginTop: '3px' }}>{isData ? 'Data system · enumerated through its connector' : (src.path || src.connector_type)}{src.sub_folders ? ' · ' + src.sub_folders + ' sub-folder' + (src.sub_folders === 1 ? '' : 's') : ''}{src.description ? ' · ' + src.description : ''}</div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {src.status === 'active' ? pill('ok', 'Connected') : pill('grey', 'Inactive')}
              {last ? pill('grey', 'Census ' + when(last.finished_at) + (last.pass1_ms != null ? ' · took ' + secs((last.pass1_ms || 0) + (last.pass2_ms || 0)) : '')) : (cur ? pill('blue', cur.status === 'queued' ? 'Census queued' : 'Census running') : pill('warn', 'No census yet'))}
              {driftText && !cur ? <span style={{ fontSize: '12px', fontWeight: '600', color: driftText === 'No change since' ? C.mute : 'var(--oq-fg-9a6512)' }}>{driftText}</span> : null}
            </div>
          </div>
          <div style={{ textAlign: 'right', minWidth: '300px' }}>
            {cz.available ? (
              <button onClick={startCensus} disabled={!!cur || starting} style={Object.assign(btn(cur || starting ? 'dis' : 'pri'), { height: '36px', padding: '0 14px', fontSize: '13px' })}>{last ? 'Refresh census' : 'Perform census'}</button>
            ) : <span style={hint}>{cz.reason}</span>}
            {cz.available ? <div style={Object.assign({}, hint, { marginTop: '6px' })}>{cur ? phaseText : (last ? (isData ? <span>Re-reads the schema and counts; rows are never copied here.<br />This is the only place a census is started or refreshed.</span> : <span>Re-reads only new or changed files. Fingerprints are kept.<br />This is the only place a census is started or refreshed.</span>) : (isData ? 'A census enumerates the record kinds, their fields and counts. No rows are copied.' : 'A census reads every file once. Nothing is sent anywhere.'))}</div> : null}
            {cur ? <div style={{ height: '8px', width: '300px', marginTop: '8px', marginLeft: 'auto', background: 'var(--oq-bg-e8eef4)', borderRadius: '999px', overflow: 'hidden' }}><div style={{ height: '100%', width: pct + '%', background: C.pri }} /></div> : null}
            {err ? <div style={{ fontSize: '12px', color: 'var(--oq-fg-991b1b)', marginTop: '6px' }}>{err}</div> : null}
          </div>
        </div>

        {never ? (
          <div style={{ padding: '40px 20px 44px', textAlign: 'center' }}>
            <div style={{ fontSize: '15px', fontWeight: '700', color: C.ink }}>The system does not know what this source holds.</div>
            <div style={{ fontSize: '13px', color: C.mute, marginTop: '6px', lineHeight: '1.55', maxWidth: '640px', margin: '6px auto 0' }}>
              {isData ? 'A census of a data system asks the connector what record KINDS it holds — their fields, counts and date ranges where the system reports them. Nothing is copied; the kinds are the grouping. Until then nothing in this system can be associated to a record type or rendered for search.' : 'A census reads every file once — hashes it, extracts its text, and takes a layout fingerprint — then groups identical layouts and counts them. No AI is used and nothing is sent anywhere. Files with a text layer go first; scanned files are read by OCR (on this server) in a second pass and grouped like the rest. Until then nothing on this source can be associated to a record type or searched.'}
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '18px' }}>
              {(isData ? ['record kinds', 'rows', 'fields'] : ['files', 'fingerprinted', 'identical groupings']).map(function (l) { return <div key={l} style={{ width: '170px', textAlign: 'left', padding: '12px 14px', border: '1px solid ' + C.line, borderRadius: '9px' }}><div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--oq-fg-a9b7c2)' }}>—</div><div style={{ fontSize: '12px', color: C.mute, marginTop: '3px' }}>{l}</div></div>; })}
            </div>
            <div style={Object.assign({}, hint, { marginTop: '16px' })}>A first census takes a few seconds per hundred files, plus a few seconds per scanned page. Later refreshes re-read only new or changed files.</div>
          </div>
        ) : isData ? (
          <KindsView inv={inv} busy={busy} onAssociate={associateKind} navigate={navigate} />
        ) : (
          <div>
            <div style={{ display: 'flex', gap: '10px', padding: '16px 20px' }}>
              <Stat n={t.files} l="files, every type counted" />
              <Stat n={t.fingerprinted} l={'fingerprinted — ' + t.text_layer + ' with a text layer' + (t.ocr ? ', ' + t.ocr + ' scan' + (t.ocr === 1 ? '' : 's') + ' read by OCR in the second pass' : '')} color="var(--oq-fg-1b8a5a)" />
              <Stat n={t.unreadable} l={t.unreadable ? 'unreadable — scans where OCR found no words' : 'unreadable'} color={t.unreadable ? 'var(--oq-fg-9a6512)' : C.mute} sub={t.unreadable ? 'listed under Everything else' : null} />
              <Stat n={t.unsupported} l="unsupported — counted, not read" color={C.mute} sub={inv.unsupported_by_type.map(function (u) { return '.' + u.ext + ' ' + u.n; }).join(' · ') || null} />
              <Stat n={t.groupings} l={'identical grouping' + (t.groupings === 1 ? '' : 's') + ' · ' + t.ungrouped + ' ungrouped'} />
            </div>

            {inv.file_types.length ? (
              <div style={{ padding: '0 20px 16px' }}>
                <div style={Object.assign({}, sect, { marginBottom: '6px' })}>File types</div>
                <div style={{ display: 'flex', height: '14px', borderRadius: '6px', overflow: 'hidden' }}>
                  {inv.file_types.map(function (ft, i) { return <div key={ft.ext} title={ft.ext + ' ' + ft.n} style={{ width: (ft.n / t.files * 100) + '%', background: ['var(--oq-bg-1e6091)', 'var(--oq-bg-5b9bd5)', 'var(--oq-bg-9a6512)', 'var(--oq-bg-8296a4)', 'var(--oq-bg-becad3)'][Math.min(i, 4)] }} />; })}
                </div>
                <div style={{ marginTop: '6px' }}>{inv.file_types.map(function (ft, i) { return <span key={ft.ext} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: C.mute, marginRight: '14px' }}><i style={{ width: '10px', height: '10px', borderRadius: '3px', display: 'inline-block', background: ['var(--oq-bg-1e6091)', 'var(--oq-bg-5b9bd5)', 'var(--oq-bg-9a6512)', 'var(--oq-bg-8296a4)', 'var(--oq-bg-becad3)'][Math.min(i, 4)] }} />{ft.ext.toUpperCase()} {ft.n}</span>; })}</div>
              </div>
            ) : null}

            <div style={{ padding: '6px 20px 0' }}>
              <div style={{ fontSize: '15px', fontWeight: '700', color: C.ink }}>Identical groupings</div>
              <div style={hint}>Documents that share one layout: 8 of 10 layout features agree, 3 or more documents. Counts are exact — every file with text, native or OCR'd, was fingerprinted. One redaction template drawn on a grouping covers every document in it. A grouping without one has three doors: draw a redaction template · redact by hand · no redaction needed.</div>
            </div>
            <div style={{ padding: '8px 20px 4px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '10px', padding: '6px 12px', fontSize: '11px', fontWeight: '700', color: C.faint, textTransform: 'uppercase', letterSpacing: '0.04em' }}><div>Grouping</div><div style={{ textAlign: 'right' }}>Documents</div><div>Layout</div><div>Record type / variant</div><div>Redaction template</div><div>Estimate</div><div /></div>
              {inv.groupings.map(function (g) {
                var rt = g.record_type, red = REDACTION[g.redaction] || null, lay = LAYOUT[g.layout] || ['grey', g.layout || '—'];
                var lc = g.layout_class ? LAYOUT_CLASS[g.layout_class] : (g.layout_class_proposed ? ['grey', (LAYOUT_CLASS[g.layout_class_proposed] || ['', g.layout_class_proposed])[1] + '?'] : null);
                var det = g.redaction_detail, est = rt ? ESTIMATE(g.estimate) : null;
                return (
                  <div key={g.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: '10px', alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--oq-ln-eef2f5)', fontSize: '12.5px', background: rt ? 'transparent' : 'var(--oq-bg-fffbeb)' }}>
                    <div><b style={{ color: C.ink }}>{groupingName(g)}</b><div style={Object.assign({}, hint, { margin: '2px 0 0' })}>{g.folders.map(function (f) { return f.folder + ' (' + f.n + ')'; }).join(' · ')}</div></div>
                    <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{g.member_count}</b></div>
                    <div>{pill(lay[0], lay[1])}{lc ? <div style={{ marginTop: '4px' }} title={g.layout_class ? 'Layout class confirmed on the variant' : 'Layout class the census proposes — confirmed at the first redaction'}>{pill(lc[0], lc[1])}</div> : null}</div>
                    <div>
                      {rt ? <div>{rt.parent ? <span style={{ color: C.mute }}>{rt.parent.name} › </span> : null}<b style={{ color: C.ink }}>{rt.name}</b><div style={Object.assign({}, hint, { margin: '2px 0 0' })}>{rt.status === 'draft' ? 'draft variant — activate on the Taxonomy page' : rt.status}</div></div>
                        : <div><span style={{ color: 'var(--oq-fg-9a6512)', fontWeight: '600' }}>Not yet associated</span><div style={{ marginTop: '4px' }}><button onClick={function () { openAssociate(g); }} style={Object.assign(btn('soft'), { height: '26px', fontSize: '12px' })}>Associate ›</button></div></div>}
                      {rt ? <div style={{ marginTop: '3px' }}><span onClick={function () { dissociate(g); }} style={{ fontSize: '11.5px', color: C.faint, cursor: 'pointer' }}>{busy === g.id ? 'Working…' : 'Associate differently ›'}</span></div> : null}
                    </div>
                    <div>
                      {red ? pill(red.kind, red.label) : <span style={{ color: 'var(--oq-fg-a9b7c2)' }}>—</span>}
                      {det && det.template && det.template.provisional && g.redaction === 'template_ready' ? <div style={Object.assign({}, hint, { margin: '2px 0 0' })} title="This template was fingerprinted from one file before the census existed; it matches on vocabulary alone">provisional match</div> : null}
                      {g.redaction === 'proposed' && det && det.template ? (
                        <div style={Object.assign({}, hint, { margin: '2px 0 0', lineHeight: '1.7' })}>
                          {det.template.proposed_by ? 'by ' + det.template.proposed_by : 'proposed'}{det.template.proposed_from_request_id ? ' · from ' + det.template.proposed_from_request_id : ''}<br />
                          <span onClick={function () { approveTemplate(det.template); }} style={{ color: C.priFg, fontWeight: '600', cursor: 'pointer' }}>{busy === det.template.id ? 'Working…' : 'Approve ›'}</span>
                          {' · '}<span onClick={function () { returnTemplate(det.template); }} style={{ color: C.priFg, fontWeight: '600', cursor: 'pointer' }}>Return ›</span>
                        </div>
                      ) : null}
                      {g.redaction === 'waiting' || g.redaction === 'none' ? (
                        <div style={{ marginTop: '4px', fontSize: '12px', lineHeight: '1.7' }}>
                          <span onClick={function () { startTemplate(g); }} style={{ color: C.priFg, fontWeight: '600', cursor: 'pointer' }}>{staging === g.id ? 'Staging a document…' : 'Start a redaction template ›'}</span><br />
                          <span onClick={function () { redactByHand(g, true); }} style={{ color: C.priFg, fontWeight: '600', cursor: 'pointer' }}>Redact by hand ›</span><br />
                          <span onClick={function () { openNoRedaction(g); }} style={{ color: C.priFg, fontWeight: '600', cursor: 'pointer' }}>No redaction needed ›</span>
                        </div>
                      ) : null}
                      {g.redaction === 'redact_by_hand' ? <div style={Object.assign({}, hint, { margin: '2px 0 0' })}>{g.decisions && g.decisions.redact_by_hand && g.decisions.redact_by_hand.by ? g.decisions.redact_by_hand.by + ', ' + when(g.decisions.redact_by_hand.at) + ' · ' : ''}each request's copies reviewed one by one · <span onClick={function () { redactByHand(g, false); }} style={{ color: C.priFg, cursor: 'pointer' }}>Undo ›</span></div> : null}
                      {g.redaction === 'no_redaction' ? <div style={Object.assign({}, hint, { margin: '2px 0 0' })}>{g.decisions && g.decisions.no_redaction ? (g.decisions.no_redaction.by_name || 'staff') + ', ' + when(g.decisions.no_redaction.at) + ' · ' : ''}releases as-is after a clean read · <span onClick={function () { undoNoRedaction(g); }} style={{ color: C.priFg, cursor: 'pointer' }}>Undo ›</span></div> : null}
                    </div>
                    <div>{est ? pill(est[0], est[1]) : <span style={{ color: 'var(--oq-fg-a9b7c2)' }}>—</span>}</div>
                    <div style={{ textAlign: 'right' }}>{g.examples.length ? <button onClick={function () { openSample(g, 0); }} style={Object.assign(btn(), { height: '26px', fontSize: '12px' })}>View sample</button> : null}</div>
                  </div>
                );
              })}
              <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '10px', alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--oq-ln-eef2f5)', fontSize: '12.5px', color: C.mute }}>
                <div><b>Everything else</b><div style={Object.assign({}, hint, { margin: '2px 0 0' })}>no other document matched at 8 of 10 — just a file list{t.unreadable || t.unsupported ? ', with the unreadable and unsupported files' : ''}</div></div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{inv.ungrouped.count}</b></div>
                <div>{inv.ungrouped.count ? pill('grey', 'Varied') : null}</div>
                <div>{inv.ungrouped.count ? 'Searchable once indexed; not a redaction-template candidate' : 'Every document belongs to a grouping'}</div>
                <div>—</div>
                <div style={{ textAlign: 'right' }}>{inv.ungrouped.count ? <button onClick={function () { setShowFiles(!showFiles); }} style={Object.assign(btn(), { height: '26px', fontSize: '12px' })}>{showFiles ? 'Hide files ▴' : 'List files ▾'}</button> : null}</div>
              </div>
              {showFiles && inv.ungrouped.count ? (
                <div style={{ margin: '0 12px 6px', border: '1px solid var(--oq-ln-eef2f5)', borderRadius: '8px', background: 'var(--oq-bg-fbfcfd)', padding: '8px 12px', fontSize: '12px', color: 'var(--oq-fg-374151)', columnCount: 3, columnGap: '18px', lineHeight: '1.8', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                  {inv.ungrouped.files.map(function (f) { return <div key={f.fingerprint_id} style={{ breakInside: 'avoid' }}>/{f.filename}{f.kind !== 'doc' ? <span style={{ color: f.kind === 'unreadable' ? 'var(--oq-fg-9a6512)' : C.faint, fontFamily: 'Inter, system-ui, sans-serif', fontSize: '11px', marginLeft: '6px' }}>{f.kind}</span> : null}</div>; })}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '16px 20px', borderTop: '1px solid var(--oq-ln-eef2f5)' }}>
              <div>
                <div style={Object.assign({}, sect, { marginBottom: '8px' })}>Linked record types</div>
                {treeList.length ? treeList.map(function (n) {
                  return <div key={n.name} style={{ fontSize: '13px', lineHeight: '1.7', color: C.ink }}><b>{n.name}</b> <span style={hint}>{n.children.length ? 'bucket' : ''}{n.linked ? (n.children.length ? ' · linked to this source' : ' · linked to this source') : ''}{!n.children.length && n.count ? ' · ' + n.count + ' here' : ''}</span>
                    {n.children.map(function (c) { return <div key={c.name} style={{ paddingLeft: '14px' }}>› {c.name} — {c.count} here{c.status === 'draft' ? <span style={{ color: 'var(--oq-fg-9a6512)' }}> · draft</span> : null}</div>; })}
                  </div>;
                }) : <div style={{ fontSize: '13px', color: C.faint }}>No record type is linked to this source yet.</div>}
                <div style={Object.assign({}, hint, { marginTop: '6px' })}>Links are written when a grouping is associated — from where the documents live, never typed in.</div>
              </div>
              <div>
                <div style={Object.assign({}, sect, { marginBottom: '8px' })}>Census history</div>
                <div style={{ fontSize: '12.5px', lineHeight: '1.7', color: 'var(--oq-fg-374151)' }}>
                  {cz.history.map(function (h, i) {
                    return <div key={h.id}>{when(h.finished_at || h.started_at || h.requested_at)} — {h.status === 'failed' ? <span style={{ color: 'var(--oq-fg-991b1b)' }}>failed · {h.error}</span> : <span>{i === cz.history.length - 1 ? 'first census' : 'refresh'} · {h.total_files} files · {h.new_files} new, {h.changed_files} changed, {h.removed_files} removed · pass 1 {secs(h.pass1_ms)}{h.ocr_files ? ' · pass 2 (OCR, ' + h.ocr_files + ' scan' + (h.ocr_files === 1 ? '' : 's') + ') ' + secs(h.pass2_ms) : ''}</span>}</div>;
                  })}
                </div>
                <div style={{ marginTop: '10px', background: 'var(--oq-bg-f7f9fb)', border: '1px dashed ' + C.edge, borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: C.mute, lineHeight: '1.45' }}>The census reads <b>layout</b>, not meaning. It cannot tell which department a document belongs to; the person who associates a grouping is that check.</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {sample ? <SampleModal sample={sample} groupingName={groupingName} onClose={closeSample} onNav={function (d) { var n = sample.index + d; if (n >= 0 && n < sample.grouping.examples.length) openSample(sample.grouping, n); }} onTemplate={function () { startTemplate(sample.grouping); }} onOpenPdf={openPdf} onAssociate={function () { openAssociate(sample.grouping); }} onDissociate={function () { var g = sample.grouping; closeSample(); dissociate(g); }} onByHand={function () { redactByHand(sample.grouping, true); }} onNoRedaction={function () { openNoRedaction(sample.grouping); }} /> : null}
      {assoc ? <AssociateModal a={assoc} groupingName={groupingName} onChange={function (patch) { setAssoc(Object.assign({}, assoc, patch)); }} onSuggest={askSuggestion} onApprove={approveAssociate} onClose={function () { setAssoc(null); }} /> : null}
      {noRed ? <NoRedactionModal n={noRed} groupingName={groupingName} viewed={viewedCount(noRed.g)} onChange={function (patch) { setNoRed(Object.assign({}, noRed, patch)); }} onConfirm={confirmNoRedaction} onClose={function () { setNoRed(null); }} onViewSamples={function () { var g = noRed.g; setNoRed(null); openSample(g, 0); }} /> : null}
    </div>
  );
}

function Stat(props) {
  return (
    <div style={{ flex: 1, padding: '12px 14px', border: '1px solid var(--oq-ln-d2dce3)', borderRadius: '9px', background: 'var(--oq-bg-ffffff)' }}>
      <div style={{ fontSize: '24px', fontWeight: '800', lineHeight: '1.1', fontVariantNumeric: 'tabular-nums', color: props.color || 'var(--oq-fg-12232e)' }}>{props.n}</div>
      <div style={{ fontSize: '12px', color: 'var(--oq-fg-5c6f7c)', marginTop: '3px' }}>{props.l}</div>
      {props.sub ? <div style={{ fontSize: '11.5px', color: 'var(--oq-fg-8296a4)', marginTop: '2px' }}>{props.sub}</div> : null}
    </div>
  );
}

function SampleModal(props) {
  var s = props.sample, g = s.grouping, ex = g.examples[s.index], rt = g.record_type, red = REDACTION[g.redaction] || null;
  return (
    <div onClick={props.onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(18,35,46,0.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={function (e) { e.stopPropagation(); }} style={Object.assign({}, card, { width: '960px', maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' })}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid ' + C.line, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flexGrow: 1 }}><div style={{ fontSize: '15px', fontWeight: '700', color: C.ink }}>{props.groupingName(g)} — a sample document</div>
            <div style={hint}>{g.member_count} documents (counted) · {(LAYOUT[g.layout] || [0, g.layout])[1].toLowerCase()} layout{rt ? ' · ' + (rt.parent ? rt.parent.name + ' › ' : '') + rt.name : ''}</div></div>
          <button onClick={function () { props.onNav(-1); }} disabled={s.index === 0} style={btn(s.index === 0 ? 'dis' : '')}>‹ Previous</button>
          <button onClick={function () { props.onNav(1); }} disabled={s.index >= g.examples.length - 1} style={btn(s.index >= g.examples.length - 1 ? 'dis' : '')}>Next ›</button>
          <span style={{ fontSize: '12px', color: C.faint }}>{s.index + 1} of {g.examples.length} · {ex.filename}{ex.ocr ? ' · read by OCR' : ''}</span>
          <button onClick={props.onClose} style={Object.assign(btn(), { marginLeft: '6px' })}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px', padding: '20px', overflow: 'auto' }}>
          <div>
            <div style={{ border: '1px solid ' + C.edge, borderRadius: '4px', background: 'var(--oq-bg-f2f6f9)', height: '560px' }}>
              {s.loading ? <div style={{ padding: '20px', color: C.faint, fontSize: '13px' }}>Opening the document…</div>
                : s.url ? <img alt="first page of the sample document" src={s.url} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                : <div style={{ padding: '20px', color: 'var(--oq-fg-991b1b)', fontSize: '13px' }}>{s.error || 'No preview'}</div>}
            </div>
            <div style={Object.assign({}, hint, { marginTop: '8px' })}>First page as stored on the source. Nothing is redacted in this view. <span onClick={props.onOpenPdf} style={{ color: 'var(--oq-fg-1e6091)', fontWeight: '600', cursor: 'pointer' }}>Open the full PDF ›</span></div>
          </div>
          <div>
            <div style={sect}>Why these {g.member_count} are one grouping</div>
            <div style={{ fontSize: '13px', lineHeight: '1.6', margin: '6px 0 14px', color: C.ink }}>Every document agrees on at least 8 of 10 layout features: page count, the first and last lines, the position of the text blocks, and the same set of <b>field labels</b> on page 1.</div>
            {g.labels && g.labels.length ? <div><div style={sect}>Fields this layout owns</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '6px 0 14px' }}>{g.labels.map(function (l) { return <span key={l}>{pill('grey', l)}</span>; })}</div></div> : null}
            <div style={sect}>Where they live</div>
            <div style={{ fontSize: '13px', lineHeight: '1.6', margin: '6px 0 14px', color: C.ink }}>{g.folders.map(function (f) { return <div key={f.folder}>{f.folder} — {f.n} document{f.n === 1 ? '' : 's'}</div>; })}</div>
            <div style={sect}>Status</div>
            <div style={{ fontSize: '13px', lineHeight: '1.6', margin: '6px 0 14px', color: C.ink }}>
              {rt ? <span>Associated to <b>{rt.parent ? rt.parent.name + ' › ' : ''}{rt.name}</b>{rt.status === 'draft' ? ' (draft variant)' : ''}.</span> : <span style={{ color: 'var(--oq-fg-9a6512)', fontWeight: '600' }}>Not yet associated to a record type.</span>}
              {red ? <div style={{ marginTop: '4px' }}>{pill(red.kind, red.label)}{g.redaction === 'waiting' ? <span style={Object.assign({}, hint, { display: 'inline', marginLeft: '6px' })}>— a redaction template drawn on one of these covers all {g.member_count}</span> : null}</div> : null}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '18px' }}>
              {rt && (g.redaction === 'waiting' || g.redaction === 'none') ? <button onClick={props.onTemplate} style={Object.assign(btn('pri'), { height: '36px' })}>Start a redaction template from this grouping</button> : null}
              {rt && (g.redaction === 'waiting' || g.redaction === 'none') ? <div style={{ display: 'flex', gap: '8px' }}><button onClick={props.onByHand} style={Object.assign(btn(), { flex: 1, height: '36px' })}>Redact by hand</button><button onClick={props.onNoRedaction} style={Object.assign(btn(), { flex: 1, height: '36px' })}>No redaction needed</button></div> : null}
              {rt ? <div style={{ textAlign: 'center', fontSize: '12px' }}><span onClick={props.onDissociate} style={{ color: C.priFg, fontWeight: '600', cursor: 'pointer' }}>Associate differently</span></div>
                : <button onClick={props.onAssociate} style={Object.assign(btn('pri'), { height: '36px' })}>Associate with a record type</button>}
            </div>
            <div style={Object.assign({}, hint, { marginTop: '10px' })}>"Start a redaction template" opens the redaction-template workspace with one of these documents staged — the same path as Mass Redaction's "Waiting for a redaction template" card.</div>
          </div>
        </div>
      </div>
    </div>
  );
}


function Backdrop(props) {
  return <div onClick={props.onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(18,35,46,0.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div onClick={function (e) { e.stopPropagation(); }} style={Object.assign({}, card, { width: props.width || '780px', maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' })}>{props.children}</div>
  </div>;
}
var stepPill = function (kind, t) { return <span style={{ marginTop: '2px', flex: 'none' }}>{pill(kind, t)}</span>; };
var radio = function (on) { return { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px', border: '1px solid ' + (on ? 'var(--oq-ln-1e6091)' : C.line), borderRadius: '8px', background: on ? 'var(--oq-bg-f5f9fc)' : 'transparent', cursor: 'pointer' }; };
var rb = function (on) { return <span style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid ' + (on ? 'var(--oq-ln-1e6091)' : C.edge), marginTop: '2px', flex: 'none', background: on ? 'var(--oq-bg-1e6091)' : 'transparent', boxShadow: on ? 'inset 0 0 0 3px var(--oq-bg-ffffff)' : 'none' }} />; };
var inp = { display: 'block', width: '100%', boxSizing: 'border-box', height: '34px', border: '1px solid ' + C.edge, borderRadius: '7px', padding: '0 11px', fontSize: '13px', color: C.ink, background: 'var(--oq-bg-ffffff)', fontFamily: 'inherit' };
var note = { background: 'var(--oq-bg-f7f9fb)', border: '1px dashed ' + C.edge, borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: C.mute, lineHeight: '1.45' };

function AssociateModal(props) {
  var a = props.a, g = a.g, cat = a.catalog, sg = a.suggestion;
  var buckets = cat ? cat.buckets.filter(function (b) { return b.status === 'active'; }) : [];
  var all = cat ? cat.buckets.concat(cat.variants) : [];
  var byId = {}; all.forEach(function (r) { byId[r.id] = r; });
  var canApprove = !a.busy && (a.mode === 'leave' || (a.mode === 'existing' && a.existingId) || (a.mode === 'new_variant' && a.parentId && a.name.trim()));
  return (
    <Backdrop onClose={props.onClose}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid ' + C.line, display: 'flex', alignItems: 'center' }}>
        <div style={{ flexGrow: 1 }}><div style={{ fontSize: '15px', fontWeight: '700', color: C.ink }}>Associate "{props.groupingName(g)}" with a record type</div>
          <div style={hint}>{g.member_count} documents (counted) · {(LAYOUT[g.layout] || [0, g.layout])[1].toLowerCase()} layout · {g.folders.map(function (f) { return f.folder; }).join(', ')}</div></div>
        <button onClick={props.onClose} style={btn()}>✕</button>
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px', overflow: 'auto' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>{stepPill('grey', '1 · Recognition')}<div style={{ fontSize: '13px', lineHeight: '1.5', color: C.ink }}>No match to the stored signature of any approved variant. <span style={Object.assign({}, hint, { display: 'inline' })}>(If a known layout had turned up on this source it would have been counted under its variant, with nothing to approve.)</span></div></div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>{stepPill('blue', '2 · AI suggestion')}
          <div style={{ fontSize: '13px', lineHeight: '1.5', flex: 1 }}>
            {!sg ? <div><button onClick={props.onSuggest} disabled={a.suggesting} style={btn(a.suggesting ? 'dis' : 'soft')}>{a.suggesting ? 'Reading two excerpts…' : 'Ask the AI what these documents are'}</button><div style={Object.assign({}, hint, { marginTop: '4px' })}>One small call: two first-page excerpts and the field labels. It names; it never counts or writes.</div></div>
              : <div style={Object.assign({}, card, { padding: '10px 12px', background: 'var(--oq-bg-f5f9fc)' })}>
                  {sg.match ? <div>The AI reads these as an <b>existing type</b>: <b>{sg.match.parent_name ? sg.match.parent_name + ' › ' : ''}{sg.match.name}</b>{sg.match.confidence != null ? ' — confidence ' + Math.round(sg.match.confidence) + '%' : ''}<div style={Object.assign({}, hint, { marginTop: '4px' })}>{sg.match.reasoning}</div></div> : null}
                  {sg.propose && sg.propose.name ? <div style={{ marginTop: sg.match ? '8px' : 0 }}>{sg.match ? 'Otherwise, a' : 'It suggests a'} <b>variant of {sg.propose.parent_name || '?'}</b>: <b>"{sg.propose.name}"</b>{sg.propose.confidence != null ? ' — confidence ' + Math.round(sg.propose.confidence) + '%' : ''}<div style={Object.assign({}, hint, { marginTop: '4px' })}>{sg.propose.reasoning}</div></div> : null}
                </div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>{stepPill('grey', '3 · Your decision')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
            <div style={radio(a.mode === 'new_variant')} onClick={function () { props.onChange({ mode: 'new_variant' }); }}>{rb(a.mode === 'new_variant')}<div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: C.ink }}>A new variant under a bucket</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '8px' }}>
                <div><div style={{ fontSize: '12.5px', fontWeight: '600', marginBottom: '5px' }}>Parent bucket</div><select value={a.parentId} onChange={function (e) { props.onChange({ parentId: e.target.value, mode: 'new_variant' }); }} style={inp}><option value="">Choose a bucket…</option>{buckets.map(function (b) { return <option key={b.id} value={b.id}>{b.name}</option>; })}</select></div>
                <div><div style={{ fontSize: '12.5px', fontWeight: '600', marginBottom: '5px' }}>Variant name</div><input value={a.name} onChange={function (e) { props.onChange({ name: e.target.value, mode: 'new_variant' }); }} placeholder="e.g. Building Permit (pre-2018 form)" style={inp} /></div>
              </div>
              <div style={Object.assign({}, hint, { marginTop: '4px' })}>Created as a <b>draft</b>. Drafts do not classify requests until someone activates them on the Taxonomy page.</div>
            </div></div>
            <div style={radio(a.mode === 'existing')} onClick={function () { props.onChange({ mode: 'existing' }); }}>{rb(a.mode === 'existing')}<div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: C.ink }}>An existing record type or variant</div>
              <select value={a.existingId} onChange={function (e) { props.onChange({ existingId: e.target.value, mode: 'existing' }); }} style={Object.assign({}, inp, { marginTop: '8px' })}><option value="">Choose a type or variant…</option>{all.map(function (r) { return <option key={r.id} value={r.id}>{r.parent_record_type_id ? ((byId[r.parent_record_type_id] || {}).name || '') + ' › ' : ''}{r.name}{r.status === 'draft' ? ' (draft)' : ''}</option>; })}</select>
              <div style={Object.assign({}, hint, { marginTop: '4px' })}>Pick this when the AI is wrong about the bucket — for example a drive that also holds another department's forms.</div>
            </div></div>
            <div style={radio(a.mode === 'leave')} onClick={function () { props.onChange({ mode: 'leave' }); }}>{rb(a.mode === 'leave')}<div><div style={{ fontSize: '13px', fontWeight: '600', color: C.ink }}>Leave it unassociated for now</div><div style={hint}>It stays listed as "Not yet associated" and is searchable once indexed.</div></div></div>
          </div>
        </div>
        <div style={note}>On <b>Approve</b> the system will: {a.mode === 'existing' ? 'stamp the ' + g.member_count + ' documents with the chosen type · link the type to this source · store the layout signature so the next census recognises this form anywhere it appears' : 'create the draft variant · link it to this source (where the ' + g.member_count + ' documents live) · stamp the documents with it · store the layout signature so the next census recognises this form anywhere · list it under Mass Redaction as "Waiting for a redaction template"'}. Nothing is written before you approve.</div>
        {a.err ? <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-991b1b)' }}>{a.err}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><button onClick={props.onClose} style={Object.assign(btn(), { height: '36px' })}>Cancel</button><button onClick={props.onApprove} disabled={!canApprove} style={Object.assign(btn(canApprove ? 'pri' : 'dis'), { height: '36px' })}>{a.busy ? 'Approving…' : (a.mode === 'leave' ? 'Close' : 'Approve')}</button></div>
      </div>
    </Backdrop>
  );
}

function NoRedactionModal(props) {
  var n = props.n, g = n.g, ck = n.check, rt = g.record_type;
  var allowed = ck && ck.allowed, reasonOk = n.reason.trim().length >= 10;
  return (
    <Backdrop onClose={props.onClose}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid ' + C.line, display: 'flex', alignItems: 'center' }}>
        <div style={{ flexGrow: 1 }}><div style={{ fontSize: '15px', fontWeight: '700', color: C.ink }}>No redaction needed — {props.groupingName(g)}</div>
          <div style={hint}>{g.member_count} documents (counted){rt ? ' · ' + (rt.parent ? rt.parent.name + ' › ' : '') + rt.name : ''}</div></div>
        <button onClick={props.onClose} style={btn()}>✕</button>
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px', overflow: 'auto' }}>
        <div style={Object.assign({}, note, { background: 'var(--oq-bg-fffbeb)', borderColor: 'var(--oq-ln-e5c24a)', color: 'var(--oq-fg-374151)' })}>This is a <b>release decision</b> about every document of this layout, not a shortcut around a template. It is written to the variant{rt ? <span> <b>{rt.name}</b></span> : null}: public availability → <b>Releasable</b>, auto-release → <b>on</b>.</div>
        <div><div style={Object.assign({}, sect, { marginBottom: '6px' })}>What still happens</div><div style={{ fontSize: '13px', lineHeight: '1.55', color: C.ink }}>Every responsive document still gets the automatic <b>clean read</b> before release. Only a read that finds <b>nothing</b> to redact releases the original as-is; a document where the read finds something — a Social Security number, a phone number, a minor's name — goes to a redaction task anyway. The second-eyes release review is unchanged.</div></div>
        <div><div style={Object.assign({}, sect, { marginBottom: '6px' })}>Checks</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: C.ink }}>
            {!ck ? <div style={hint}>Checking…</div> : ck.checks.map(function (c) { return <div key={c.key} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>{stepPill(c.passes ? 'ok' : 'red', c.passes ? 'passes' : 'closed')}<div>{c.text}</div></div>; })}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>{stepPill(props.viewed ? 'ok' : 'warn', props.viewed ? 'looked' : 'look first')}<div>You have viewed <b>{props.viewed} of {g.member_count}</b> sample documents in this grouping. <span onClick={props.onViewSamples} style={{ color: C.priFg, fontWeight: '600', cursor: 'pointer' }}>View samples ›</span></div></div>
          </div>
        </div>
        <div><div style={{ fontSize: '12.5px', fontWeight: '600', marginBottom: '5px', color: C.ink }}>Why no redaction is needed <span style={{ color: 'var(--oq-fg-b02a37)' }}>*</span></div>
          <textarea value={n.reason} onChange={function (e) { props.onChange({ reason: e.target.value }); }} rows={3} placeholder="e.g. Inspection reports carry no personal information — inspector name and permit number only — and the same reports are already published on the permit portal." style={Object.assign({}, inp, { height: 'auto', padding: '9px 11px', lineHeight: '1.5', resize: 'vertical' })} />
          <div style={hint}>Required. Recorded with your name and the date in the taxonomy audit; shown on the grouping.</div></div>
        <div style={note}>On <b>Confirm</b>: the variant's release posture is written as above · the grouping shows <b>No redaction needed</b> · Mass Redaction stops listing it · the Technical Setup lane turns "changed since approval" for re-approval. Reversible from the grouping row at any time.</div>
        {n.err ? <div style={{ fontSize: '12.5px', color: 'var(--oq-fg-991b1b)' }}>{n.err}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><button onClick={props.onClose} style={Object.assign(btn(), { height: '36px' })}>Cancel</button><button onClick={props.onConfirm} disabled={!allowed || !reasonOk || n.busy} style={Object.assign(btn(allowed && reasonOk && !n.busy ? 'pri' : 'dis'), { height: '36px' })}>{n.busy ? 'Recording…' : 'Confirm — no redaction needed'}</button></div>
      </div>
    </Backdrop>
  );
}


// DATA SYSTEMS (slice 5): the same screen, kinds and fields instead of groupings and layouts. A data record is not read, it
// is RENDERED — one honest sentence per row from a recipe; the field redaction template decides what is withheld before
// anything is embedded. Embed tiers: 1 kind description always · 2 prose rows opt-in (priced, later) · 3 never (ids, dates, numbers).
var KGRID = '1.8fr 0.8fr 0.6fr 1.2fr 1.7fr 1.9fr 1.1fr';
var TIER = { 1: ['grey', 'Kind description only', 'tier 1 · no prose fields'], 2: ['grey', 'Kind description only', 'tier 2 eligible · prose fields — row embedding is a priced opt-in, later'], 3: ['grey', 'Never — ids, dates, numbers only', 'tier 3 · filters beat vectors here'] };
function KindsView(props) {
  var inv = props.inv, t = inv.totals;
  var [open, setOpen] = useState({});
  var [types, setTypes] = useState(null);
  useEffect(function () { api.get('/taxonomy/record-types').then(function (r) { setTypes((r.data.record_types || []).filter(function (x) { return x.status === 'active'; })); }).catch(function () { setTypes([]); }); }, []);
  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', padding: '16px 20px' }}>
        <Stat n={t.kinds} l="record kinds — the kinds are the grouping" />
        <Stat n={t.rows != null ? t.rows.toLocaleString() : '—'} l={t.rows != null ? 'rows across the kinds that report a count' : 'rows — this connector reports no counts'} />
        <Stat n={t.fields} l="fields" />
        <Stat n={t.field_templates + ' of ' + t.kinds} l="kinds have a field redaction template — the rest embed their description only" color={t.field_templates < t.kinds ? 'var(--oq-fg-9a6512)' : 'var(--oq-fg-1b8a5a)'} />
      </div>
      <div style={{ padding: '6px 20px 0' }}>
        <div style={{ fontSize: '15px', fontWeight: '700', color: C.ink }}>Record kinds</div>
        <div style={hint}>A data record is not read, it is rendered: one honest sentence per row from a recipe. The field redaction template (exempt columns marked once, covering every row) decides which values are withheld before anything is embedded.</div>
      </div>
      <div style={{ padding: '8px 20px 4px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: KGRID, gap: '10px', padding: '6px 12px', fontSize: '11px', fontWeight: '700', color: C.faint, textTransform: 'uppercase', letterSpacing: '0.04em' }}><div>Kind</div><div style={{ textAlign: 'right' }}>Rows</div><div style={{ textAlign: 'right' }}>Fields</div><div>Date range</div><div>Field redaction template</div><div>Embedding</div><div /></div>
        {inv.kinds.map(function (k) {
          var tier = TIER[k.embed_tier] || TIER[1];
          return (
            <div key={k.id}>
              <div style={{ display: 'grid', gridTemplateColumns: KGRID, gap: '10px', alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--oq-ln-eef2f5)', fontSize: '12.5px' }}>
                <div><b style={{ color: C.ink }}>{k.name}</b>
                  <div style={Object.assign({}, hint, { margin: '2px 0 0' })}>
                    {k.record_type ? <span>→ {k.record_type.name}{k.match_basis === 'by_name' ? ' · matched by name' : ''} · <span onClick={function () { props.onAssociate(k, null); }} style={{ color: C.priFg, cursor: 'pointer' }}>change ›</span></span>
                      : <span style={{ color: 'var(--oq-fg-9a6512)' }}>Not yet associated · <select value="" onChange={function (e) { if (e.target.value) props.onAssociate(k, e.target.value); }} style={{ fontSize: '11.5px', border: '1px solid ' + C.edge, borderRadius: '5px', padding: '1px 4px', background: 'var(--oq-bg-ffffff)' }}><option value="">choose a record type…</option>{(types || []).map(function (x) { return <option key={x.id} value={x.id}>{x.name}</option>; })}</select></span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{k.row_count != null ? <b>{k.row_count.toLocaleString()}</b> : <span title="This connector does not report counts" style={{ color: C.faint }}>not reported</span>}</div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{k.fields.length}</div>
                <div>{k.date_range ? (k.date_range.from + ' → ' + k.date_range.to) : <span style={{ color: C.faint }}>—</span>}</div>
                <div>{k.field_template ? <div>{pill('ok', 'Field redaction template ready')}<div style={Object.assign({}, hint, { margin: '2px 0 0' })}>{k.field_template.withheld.join(', ').replace(/_/g, ' ')} withheld</div></div>
                  : <div>{pill('warn', 'No field redaction template')}<div style={{ marginTop: '4px' }}><span onClick={function () { props.navigate('/mass-redaction'); }} style={{ fontSize: '12px', color: C.priFg, fontWeight: '600', cursor: 'pointer' }}>Create one ›</span></div></div>}</div>
                <div>{pill(tier[0], tier[1])}<div style={Object.assign({}, hint, { margin: '2px 0 0' })}>{tier[2]}{k.embed_tier === 2 && k.prose_fields.length ? ' — ' + k.prose_fields.join(', ').replace(/_/g, ' ') : ''}</div></div>
                <div style={{ textAlign: 'right' }}><button onClick={function () { setOpen(Object.assign({}, open, { [k.id]: !open[k.id] })); }} style={Object.assign(btn(), { height: '26px', fontSize: '12px' })}>{open[k.id] ? 'Hide record' : 'View a rendered record'}</button></div>
              </div>
              {open[k.id] ? (
                <div style={{ margin: '0 12px 8px', padding: '12px 14px', border: '1px solid var(--oq-ln-eef2f5)', borderRadius: '8px', background: 'var(--oq-bg-f7f9fb)' }}>
                  <div style={Object.assign({}, sect, { marginBottom: '6px' })}>A rendered record — {k.name}</div>
                  <div style={{ fontSize: '13.5px', lineHeight: '1.6', color: C.ink }}>{k.rendered.text.split('████').map(function (seg, i, arr) { return <span key={i}>{seg}{i < arr.length - 1 ? <span style={{ background: 'var(--oq-bg-12232e)', color: 'var(--oq-fg-12232e)', borderRadius: '3px', padding: '0 4px' }}>████████</span> : null}</span>; })}</div>
                  <div style={Object.assign({}, hint, { marginTop: '6px' })}>{k.field_template ? 'This sentence is what would be embedded. The blacked-out value is withheld by the field redaction template before the render leaves the system — the vector index never holds it.' : 'This sentence is what would be embedded once a field redaction template exists — today every non-id value shows, so only the kind description (tier 1) embeds.'}{k.description ? ' · Kind description: ' + k.description : ''}</div>
                  <div style={Object.assign({}, hint, { marginTop: '4px' })}>Fields: {k.fields.map(function (f) { return f.name.replace(/_/g, ' ') + ' (' + f.type + ')'; }).join(' · ')}</div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '16px 20px', borderTop: '1px solid var(--oq-ln-eef2f5)' }}>
        <div>
          <div style={Object.assign({}, sect, { marginBottom: '8px' })}>How a data census works</div>
          <div style={{ fontSize: '12.5px', lineHeight: '1.6', color: 'var(--oq-fg-374151)' }}>The connector reports its record kinds, fields and sample rows; counts and date ranges appear only where the system reports them — nothing is invented. A kind matching a record type by name is associated at census time (say so on the row); the rest you associate by hand. Row-level embedding of a kind is gated on its field redaction template existing (census → field template → then prose embedding, priced).</div>
        </div>
        <div>
          <div style={Object.assign({}, sect, { marginBottom: '8px' })}>Census history</div>
          <div style={{ fontSize: '12.5px', lineHeight: '1.7', color: 'var(--oq-fg-374151)' }}>
            {inv.census.history.map(function (h, i) { return <div key={h.id}>{when(h.finished_at || h.requested_at)} — {h.status === 'failed' ? <span style={{ color: 'var(--oq-fg-991b1b)' }}>failed · {h.error}</span> : <span>{i === inv.census.history.length - 1 ? 'first census' : 'refresh'} · {h.total_files} kinds · {h.new_files} new, {h.changed_files} changed, {h.removed_files} removed · {secs(h.pass1_ms)}</span>}</div>; })}
          </div>
        </div>
      </div>
    </div>
  );
}
