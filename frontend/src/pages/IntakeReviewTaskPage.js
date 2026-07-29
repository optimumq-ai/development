import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import {
  G, ClockChip, DecidedByBadge, SubmittedDescription, ParentStrip, TriggerBadge,
  EditInfoFrame, PortalResultsBar
} from '../components/primitives';

// THE INTAKE REVIEW TASK SCREEN — DRAFT_processing_ui_intake_review.md (1c + 0b),
// docs/mockups/PROCESSING_UI_draft1_intake_review.html screen 2, SPEC_processing_ui.md §3 screen 1.
//
// PARENT-SCOPED (decision 2). Parent strip, clock strip, eligibility, ledger and the inline waiver panel
// are parent-level and always visible; the single record item — description, classification, routing,
// prelim search, Vague/Overly-Broad marking — is an expandable block. Non-MRR only, so there is exactly
// one record item (decision 3).
//
// THE FIVE RULES ARE CONTRACT HERE, not styling (SPEC §1):
//   (a) every date is drawn by ClockChip from the server's `kind`. A city service target can never wear
//       the statutory grammar, the words come from `overdueMeaning`, and a request with no clock says so
//       rather than showing a date nobody set.
//   (b) a panel is hidden ONLY by an explicit `false` capability. `null` = unknown = render — 19 of the 21
//       seeded cities are null, and this screen must not strip panels from them. Every gate below is
//       written `=== false`, never `!capability`.
//   (c) advisory ≠ automatic. An eligibility ADVISORY renders ghost/dashed "recorded — nothing to decide";
//       a REVIEW renders amber with a confirm control and a named person's badge. The system is never
//       shown as having decided a judgment call.
//   (e) an anonymous requestor's ledger panel says history DOES NOT APPLY — never "hidden", which would
//       imply a balance exists behind a curtain.
//
// The gate is NOT computed here. `/tasks/:id/intake-context` returns the same `proceedGate()` the resolve
// route refuses on, so the words under a blocked Proceed and the words in the 422 are one sentence.

var box = { background: C.surface, border: '1px solid ' + G.line, borderRadius: 6, padding: '11px 13px', marginBottom: 11 };
var panelHead = { fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: C.muted, marginBottom: 7 };
var kv = { fontSize: 12.5, color: C.muted };
function btn(kind) {
  var base = { font: 'inherit', fontSize: 13, borderRadius: 5, padding: '6px 14px', cursor: 'pointer', fontWeight: 600 };
  if (kind === 'sec') return Object.assign({}, base, { background: C.surface, color: C.blue, border: '1px solid ' + C.blue });
  if (kind === 'quiet') return Object.assign({}, base, { background: C.surface2, color: C.ink, border: '1px solid ' + G.line, fontWeight: 500 });
  return Object.assign({}, base, { background: C.blue, color: '#fff', border: 'none' });
}

// The clock strip's kicker per kind. `none` gets no kicker — there is nothing to title.
var CLOCK_KICKER = {
  response: 'Statutory deadline', agency_action: 'Statutory deadline',
  operational_target: 'City service target', requestor_window: "Requestor's window"
};

export default function IntakeReviewTaskPage() {
  var params = useParams();
  var taskId = params.taskId;

  var [ctx, setCtx] = useState(null);
  var [request, setRequest] = useState(null);
  var [history, setHistory] = useState([]);
  var [findings, setFindings] = useState(null);
  var [ledger, setLedger] = useState(null);
  var [branch, setBranch] = useState(null);
  var [intents, setIntents] = useState(null);
  var [recordTypes, setRecordTypes] = useState([]);
  var [departments, setDepartments] = useState([]);
  var [err, setErr] = useState('');
  var [flash, setFlash] = useState(null);
  var [busy, setBusy] = useState('');
  var [expanded, setExpanded] = useState(true);
  var [editing, setEditing] = useState(false);
  var [view, setView] = useState('selected');
  var [q, setQ] = useState('');
  var [results, setResults] = useState(null);
  var [searching, setSearching] = useState(false);
  var [denyReason, setDenyReason] = useState('');
  var [resolved, setResolved] = useState(false);

  function loadContext() {
    return api.get('/tasks/' + taskId + '/intake-context').then(function (r) {
      setCtx(r.data);
      var rid = r.data.task.request_id;
      api.get('/requests/' + rid).then(function (x) {
        setRequest(x.data.request || x.data);
        setHistory((x.data.history || []).slice().reverse());
      }).catch(function () {});
      api.get('/requests/' + rid + '/eligibility-findings').then(function (x) { setFindings(x.data); }).catch(function () {});
      api.get('/requests/' + rid + '/search-intents').then(function (x) { setIntents(x.data); }).catch(function () {});
      // The LEDGER is parent-level money against a requestor identity, so it is asked of the parent when
      // there is one. `{anonymous:true}` is a real answer, not an error (rule e).
      var moneyRow = (r.data.parent && r.data.parent.id) || rid;
      api.get('/jurisdiction-profile/ledger/request/' + moneyRow).then(function (x) { setLedger(x.data); }).catch(function () { setLedger(null); });
      return r.data;
    });
  }

  useEffect(function () {
    var alive = true;
    loadContext().catch(function () { if (alive) setErr('Could not load this intake review.'); });
    api.get('/jurisdiction-profile/branch-profile').then(function (r) { if (alive) setBranch(r.data); }).catch(function () {});
    api.get('/taxonomy/record-types?status=active').then(function (r) { if (alive) setRecordTypes(r.data.record_types || []); }).catch(function () {});
    api.get('/departments').then(function (r) { if (alive) setDepartments(r.data.departments || []); }).catch(function () {});
    return function () { alive = false; };
  }, [taskId]);

  function fail(e, fallback) {
    var d = e && e.response && e.response.data;
    setFlash({ tone: 'crit', text: (d && d.error) || fallback });
  }

  // --- acts -----------------------------------------------------------------------------------------

  // Confer / log a call: the effort trail, the same one the record-search screen writes. Not decoration —
  // it is the evidence a later no-records closure is refused without.
  function effort(action, note) {
    setBusy(action);
    return api.post('/requests/' + ctx.task.request_id + '/effort', { action: action, notes: note })
      .then(function () { setFlash({ tone: 'ok', text: note }); return loadContext(); })
      .catch(function (e) { fail(e, 'That did not go through.'); })
      .then(function () { setBusy(''); });
  }

  // Marking a defect is NOT a note: it sends the clarification through the jurisdiction's own machinery,
  // which decides what happens to the clock — and it is what puts the request on hold. There is no manual
  // hold button anywhere on this screen (spec §2.4): hold is a system state with a named cause.
  function markDefect(reason) {
    setBusy(reason);
    return api.post('/requests/' + ctx.task.request_id + '/clarification', { reason: reason })
      .then(function (r) {
        var d = r.data;
        setFlash({
          tone: d.conferenceRequired ? 'crit' : 'ok',
          text: d.conferenceRequired
            ? 'Conference offered. THE CLOCK DID NOT STOP — missing the deadline forfeits the burden defense.'
            : ('Clarification sent — the request is on hold pending the requestor’s response' +
               (d.clockStillRunning ? '; the clock keeps running (' + d.effect + ').' : '; the response clock was tolled.'))
        });
        return loadContext();
      })
      .catch(function (e) { fail(e, 'That did not go through.'); })
      .then(function () { setBusy(''); });
  }

  function confirmFinding(f) {
    setBusy(f.id);
    return api.post('/requests/' + ctx.task.request_id + '/eligibility-findings/' + f.id + '/confirm', {})
      .then(function () {
        setFlash({ tone: 'ok', text: f.label + ' confirmed — recorded as your decision.' });
        return loadContext().then(function () {
          return api.get('/requests/' + ctx.task.request_id + '/eligibility-findings')
            .then(function (x) { setFindings(x.data); });
        });
      })
      .catch(function (e) { fail(e, 'Could not record that confirmation.'); })
      .then(function () { setBusy(''); });
  }

  function decideWaiver(decision) {
    if (decision === 'deny' && !denyReason.trim()) {
      setFlash({ tone: 'crit', text: 'A denial reason is required — it travels to the requester in the estimate notice.' });
      return;
    }
    setBusy('waiver');
    return api.post('/requests/' + ctx.task.request_id + '/fee-waiver-decision',
      decision === 'grant' ? { decision: 'grant' } : { decision: 'deny', reasonText: denyReason.trim() })
      .then(function () {
        setFlash({ tone: 'ok', text: decision === 'grant' ? 'Waiver granted — recorded as your decision.'
          : 'Waiver denied — the reason folds into the estimate notice unless this city sends a separate letter.' });
        setDenyReason('');
        return loadContext();
      })
      .catch(function (e) { fail(e, 'Could not record the waiver decision.'); })
      .then(function () { setBusy(''); });
  }

  // BW4 — the commercial classification, recorded. One endpoint, shared with the estimate screen, because
  // this is ONE fact about the request rather than a per-screen opinion.
  function classify(value) {
    setBusy('classify');
    return api.post('/requests/' + ctx.task.request_id + '/commercial-classification', { classifyAs: value })
      .then(function (r) {
        setFlash({ tone: 'ok', text: r.data && r.data.overridesDeclaration
          ? 'Classified as ' + value + ' — this overrides the requester’s declaration and must be communicated; it folds into the estimate notice.'
          : 'Classified as ' + value + ' — recorded against your name.' });
        return loadContext();
      })
      .catch(function (e) { fail(e, 'Could not record that classification.'); })
      .then(function () { setBusy(''); });
  }

  function saveInfo(patch) {
    setBusy('info');
    return api.patch('/tasks/' + taskId + '/intake-routing', patch)
      .then(function (r) {
        setRequest(r.data.request);
        if (r.data.changed && r.data.changed.length) setFlash({ tone: 'ok', text: 'Corrected: ' + r.data.changed.join('; ') + '.' });
        return loadContext();
      })
      .catch(function (e) { fail(e, 'Could not save that correction.'); })
      .then(function () { setBusy(''); });
  }

  function runSearch() {
    var query = q.trim();
    if (!query || searching) return;
    setSearching(true); setResults(null);
    api.post('/files/search/records', { query: query })
      .then(function (r) { setResults(r.data.results || []); })
      .catch(function (e) { fail(e, 'Search failed.'); })
      .then(function () { setSearching(false); });
  }

  function proceed() {
    setBusy('proceed');
    return api.post('/tasks/' + taskId + '/resolve', { outcome: 'proceed' })
      .then(function (r) {
        setResolved(true);
        setFlash({ tone: 'ok', text: r.data.stageChanged
          ? 'Intake review complete — the item is on its way to Record Search.'
          : 'Intake review complete — the request had already moved on, so its stage was left as it was found.' });
      })
      .catch(function (e) { fail(e, 'Could not resolve this intake review.'); })
      .then(function () { setBusy(''); });
  }

  if (err) return <div style={{ padding: 32, color: C.crit }}>{err}</div>;
  if (!ctx) return <div style={{ padding: 32, color: C.muted }}>Loading…</div>;

  var task = ctx.task;
  var req = request || ctx.request || {};
  var parent = ctx.parent || null;
  var gate = ctx.gate || { blocked: false, reasons: [] };
  var caps = (branch && branch.profile && branch.profile.capabilities) || {};
  // RULE (b). `=== false` and nothing else. `null`/undefined = unknown = render.
  function hidden(cap) { return caps[cap] === false; }

  // The inline approval panels exist only in `intake_review` mode — in `routed_task` mode (the shipped
  // default) the decision belongs to a Fee-Waiver Approval task and showing it here would be a second
  // place to make one decision.
  var wv = ctx.waiver || {};
  var showWaiver = !hidden('fee_waiver') && wv.mode === 'intake_review' &&
    (wv.outcome === 'needs_decision' || wv.outcome === 'auto_granted');
  var cm = ctx.commercial || {};
  // BW4: `classified` is a state worth rendering too — the reviewer should see the decision that was
  // recorded (and by whom) rather than watching the panel vanish the moment they click.
  var showCommercial = !hidden('commercial_rate') && cm.mode === 'intake_review' && cm.enabled &&
    (cm.outcome === 'needs_decision' || cm.outcome === 'classified');

  var totals = (intents && intents.totals) || { selected: 0, notSelected: 0, shown: 0 };
  var groups = (intents && intents.groups) || [];
  var tried = groups.reduce(function (a, g) { return a.concat(g.queriesTried || []); }, []);

  var rtName = (recordTypes.filter(function (r) { return r.id === req.record_type_id; })[0] || {}).name;
  var teams = departments.filter(function (d) { return d.kind === 'team'; });
  var depts = departments.filter(function (d) { return d.kind !== 'team'; });
  var teamName = (departments.filter(function (d) { return d.id === req.department_id; })[0] || {}).name;
  var ownerName = (departments.filter(function (d) { return d.id === req.record_owner_department_id; })[0] || {}).name;

  var hereBecause = (ctx.triggers || []).map(function (t) { return t.label; }).join(' · ');

  return (
    <div style={{ maxWidth: 1060 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: G.navy }}>Intake Review</h1>
        <Link to="/my-tasks" style={{ fontSize: 12.5, color: C.blue }}>← My Tasks</Link>
      </div>

      {flash ? (
        <div style={{ fontSize: 13, borderRadius: 8, padding: '9px 12px', marginBottom: 10,
          background: flash.tone === 'crit' ? C.critTint : C.greenTint,
          color: flash.tone === 'crit' ? C.crit : C.green,
          border: '1px solid ' + (flash.tone === 'crit' ? C.crit : C.green) }}>{flash.text}</div>
      ) : null}

      {/* ── PARENT STRIP (decision 2) ── */}
      <ParentStrip number={task.request_number || (parent && parent.request_number) || '—'}>
        <span style={kv}>Single record request · received {String(req.created_at || '').slice(0, 10)}</span>
        <span style={kv}><b style={{ color: C.ink }}>{req.requestor_name || 'Anonymous'}</b>{req.requestor_email ? ' · ' + req.requestor_email : ''}{req.delivery_method ? ' · delivery: ' + req.delivery_method : ''}</span>
        <span style={Object.assign({}, kv, { marginLeft: 'auto' })}>Stage: <b style={{ color: C.ink }}>{req.stage || '—'}</b></span>
        <span style={{ flexBasis: '100%' }}>
          {/* THREE different facts, never collapsed: a named trigger, always-mode, or an unrecorded one. */}
          {hereBecause ? <TriggerBadge>{hereBecause}</TriggerBadge> : null}
          {ctx.alwaysMode ? <span style={kv}>Here because: <b style={{ color: C.ink }}>this city reviews every request at intake</b> (intake review is set to “always”).</span> : null}
          {ctx.triggerUnrecorded ? <span style={kv}>No trigger was recorded on this task.</span> : null}
        </span>
      </ParentStrip>

      {/* ── CLOCK STRIP (rule a) ── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '10px 0 12px' }}>
        {(ctx.clocks || []).length ? (ctx.clocks || []).map(function (c, i) {
          return (
            <ClockChip key={i} kind={c.kind || 'none'} k={CLOCK_KICKER[c.kind] || null}
              citation={c.citation || null} exposure={c.isOverdue ? (c.overdueMeaning || null) : null}>
              {c.label ? c.label + ' — ' : ''}{String(c.dueDate || '').slice(0, 10) || 'no date set'}
            </ClockChip>
          );
        }) : (
          // The honest Ohio state. Never invent a date, and say WHY there is none — a blank reads as a bug.
          <ClockChip kind="none">No deadline on this request — no statutory response clock and no city service target is set.</ClockChip>
        )}
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>

          {/* ── THE RECORD ITEM (expandable; TX expanded / OH collapsed in the mockup) ── */}
          <div style={{ border: '1px solid ' + G.line, borderRadius: 6, marginBottom: 11, background: C.surface, overflow: 'hidden' }}>
            <div onClick={function () { setExpanded(!expanded); }}
              style={{ cursor: 'pointer', background: C.surface2, padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: G.navy, fontSize: 12.5 }}>{expanded ? '▾ ' : '▸ '}Record item</span>
              {/* A TRUNCATION of the verbatim text — never a paraphrase, and no AI summary exists (§2.1). */}
              <span style={Object.assign({}, kv, { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
                {req.description || ''}
              </span>
              {rtName ? <span style={{ fontSize: 11, background: C.surface, border: '1px solid ' + G.line, borderRadius: 3, padding: '1px 7px', color: C.muted }}>{rtName}</span> : null}
              {teamName ? <span style={{ fontSize: 11, background: C.surface, border: '1px solid ' + G.line, borderRadius: 3, padding: '1px 7px', color: C.muted }}>→ {teamName}</span> : null}
            </div>
            {expanded ? (
              <div style={{ padding: '11px 13px', borderTop: '1px solid ' + G.line }}>
                <SubmittedDescription actions={
                  <>
                    <button type="button" disabled={!!busy || resolved} onClick={function () { markDefect('vague'); }} style={btn('quiet')}>Mark Vague</button>
                    <button type="button" disabled={!!busy || resolved} onClick={function () { markDefect('overly_broad'); }} style={btn('quiet')}>Mark Overly Broad</button>
                  </>
                }>{req.description || ''}</SubmittedDescription>

                <EditInfoFrame
                  editing={editing}
                  onToggle={function () { setEditing(!editing); }}
                  note="These three feed smart routing — the specialization match runs against the eligible staff of the team chosen here, so a correction changes who can be matched downstream. The classification travels with the item as context for whoever searches it."
                  summary={editing
                    ? 'AI-generated from the request text — correct anything that is wrong before Proceed.'
                    : ('Classified as: ' + (rtName || 'unclassified') +
                       ' · Record owner: ' + (ownerName || 'not set') +
                       ' · Will route to (on Proceed): ' + (teamName || 'no team determined'))}
                  fields={[
                    { label: 'Classified as', value: req.record_type_id || '',
                      options: [{ value: '', label: '— unclassified —' }].concat(recordTypes.map(function (r) { return { value: r.id, label: r.name }; })),
                      onChange: function (v) { saveInfo({ recordTypeId: v || null }); } },
                    { label: 'Record owner', value: req.record_owner_department_id || '',
                      options: [{ value: '', label: '— not set —' }].concat(depts.map(function (d) { return { value: d.id, label: d.name }; })),
                      onChange: function (v) { saveInfo({ ownerDepartmentId: v || null }); } },
                    { label: 'Will route to (on Proceed)', value: req.department_id || '',
                      options: [{ value: '', label: '— no team —' }].concat(teams.map(function (d) { return { value: d.id, label: d.name }; })),
                      onChange: function (v) { saveInfo({ teamId: v || null }); } }
                  ]} />

                <hr style={{ border: 'none', borderTop: '1px solid ' + C.surface2, margin: '9px 0' }} />
                <h3 style={panelHead}>Preliminary search</h3>
                {/* The same substrate as the record-search screen (R9). Intake's version answers ONE
                    question — can the library already answer this? The deep search stays in Record Search,
                    and so does attaching: a record attached here would skip the gates that screen enforces. */}
                <PortalResultsBar totals={totals} view={view} onView={setView} />
                {tried.length ? (
                  <div style={Object.assign({}, kv, { marginTop: 6 })}>Portal already tried: {tried.map(function (t) { return '“' + t + '”'; }).join(', ')}</div>
                ) : null}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input value={q} onChange={function (e) { setQ(e.target.value); }}
                    onKeyDown={function (e) { if (e.key === 'Enter') runSearch(); }}
                    placeholder="Search the released library…"
                    style={{ flex: 1, font: 'inherit', background: C.surface, border: '1px solid ' + G.line, borderRadius: 4, padding: '5px 9px' }} />
                  <button type="button" onClick={runSearch} disabled={searching} style={btn('sec')}>{searching ? 'Searching…' : 'Search'}</button>
                </div>
                {results ? (
                  <div style={Object.assign({}, kv, { marginTop: 6 })}>
                    {results.length
                      ? results.length + ' candidate(s) in the released library. If one answers the request, the searcher attaches it in the Record Search task — intake does not attach.'
                      : 'Nothing in the released library matches that query.'}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* ── REQUESTER ELIGIBILITY (rule c) ── */}
          {hidden('eligibility_gate') ? null : (
            <div style={box}>
              <h3 style={panelHead}>Requester eligibility</h3>
              {findings && (findings.reviews || []).map(function (f) {
                return (
                  <div key={f.id} style={{ borderLeft: '3px solid ' + (f.open ? G.amberLine : G.statute), paddingLeft: 10, marginBottom: 8, fontSize: 13 }}>
                    <b>{f.label}</b> — {f.why}{' '}
                    {f.open
                      ? <DecidedByBadge by="person">Needs your confirmation</DecidedByBadge>
                      : <DecidedByBadge by="person">Confirmed by {f.confirmedBy}</DecidedByBadge>}
                    {f.open ? (
                      <div style={{ marginTop: 5 }}>
                        <button type="button" disabled={busy === f.id || resolved} onClick={function () { confirmFinding(f); }} style={btn('quiet')}>
                          {busy === f.id ? 'Recording…' : 'Confirm — proceed'}
                        </button>
                      </div>
                    ) : null}
                    {f.sourceRuleIds.length ? <div style={Object.assign({}, kv, { marginTop: 3 })}>{f.sourceRuleIds.join(', ')}</div> : null}
                  </div>
                );
              })}
              {findings && (findings.advisories || []).map(function (f) {
                return (
                  <div key={f.id} style={{ borderLeft: '3px dashed ' + G.ghost, paddingLeft: 10, marginBottom: 8, fontSize: 13, color: C.muted }}>
                    <b style={{ color: C.ink }}>{f.label}</b> — {f.why}{' '}
                    <DecidedByBadge by="recorded">Recorded — nothing to decide</DecidedByBadge>
                  </div>
                );
              })}
              {findings && (findings.legacy || []).map(function (n) {
                return (
                  <div key={n.id} style={{ borderLeft: '3px dashed ' + G.ghost, paddingLeft: 10, marginBottom: 8, fontSize: 13, color: C.muted }}>
                    {n.notes} <DecidedByBadge by="recorded">Recorded — nothing to decide</DecidedByBadge>
                    <div style={Object.assign({}, kv, { marginTop: 3 })}>{n.why}</div>
                  </div>
                );
              })}
              {findings && !findings.reviews.length && !findings.advisories.length && !findings.legacy.length ? (
                <div style={kv}>No eligibility condition was raised on this request.</div>
              ) : null}
            </div>
          )}

          {/* ── REQUESTOR HISTORY — LEDGER (rules c + e) ── */}
          <div style={box}>
            <h3 style={panelHead}>Requestor history — ledger</h3>
            {ledger == null ? <div style={kv}>Loading…</div>
              : ledger.anonymous ? (
                // RULE (e). "Does not apply", never "hidden": no identity anchor means no balance EXISTS for
                // this request, and none is being withheld from the reviewer.
                <div style={{ fontSize: 13 }}>
                  <b>Anonymous request.</b> There is no identity anchor, so requestor history <b>does not apply</b> —
                  no balance exists for this request, and none is being withheld.
                  {ledger.reason ? <div style={Object.assign({}, kv, { marginTop: 3 })}>{ledger.reason}</div> : null}
                </div>
              ) : (
                <div style={{ fontSize: 13 }}>
                  <div style={Object.assign({}, kv, { marginBottom: 7 })}>Identity anchor on file · balance is computed, not asserted.</div>
                  <div style={{ borderLeft: '3px solid ' + G.navy, paddingLeft: 10 }}>
                    <b>Prior balance {ledger.balance && ledger.balance.outstanding != null ? '$' + Number(ledger.balance.outstanding).toFixed(2) : '—'}</b>
                    <div style={{ marginTop: 4 }}>
                      <DecidedByBadge by="system">System · statute-triggered</DecidedByBadge>{' '}
                      <span style={kv}>computed automatically; any demand issues with the estimate notice. Nothing for you to decide here.</span>
                    </div>
                  </div>
                  {(ledger.flags || []).length ? (
                    <div style={{ marginTop: 8 }}>
                      {ledger.flags.map(function (f) {
                        return (
                          <div key={f.id} style={{ borderLeft: '3px solid ' + G.amberLine, paddingLeft: 10, marginBottom: 6 }}>
                            <b>{f.flag}</b>{f.citation ? ' — ' + f.citation : ''}{' '}
                            {/* An externally-established status names its decider — never this system (rule c). */}
                            <DecidedByBadge by="recorded">{f.source ? 'Recorded — ' + String(f.source).replace(/_/g, ' ') : 'Recorded only'}</DecidedByBadge>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )}
          </div>

          {/* ── INLINE FEE WAIVER (mode: intake_review only) ── */}
          {showWaiver ? (
            <div style={Object.assign({}, box, { background: C.surface2 })}>
              <h3 style={panelHead}>Fee waiver — decide now (inline)</h3>
              {wv.outcome === 'auto_granted' ? (
                <div style={{ fontSize: 13 }}>
                  {wv.reason}{' '}
                  {/* A statutory-mandatory category fires whether or not the discretionary program is on,
                      and it is NOT this reviewer's decision. */}
                  <DecidedByBadge by="statute">Granted by statute</DecidedByBadge>
                  <div style={Object.assign({}, kv, { marginTop: 4 })}>Nothing for you to decide here.</div>
                </div>
              ) : (
                <>
                  <div style={Object.assign({}, kv, { marginBottom: 7 })}>
                    Requested at submission: <b style={{ color: C.ink }}>yes</b>. This city decides the discretionary waiver here, inline.
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button type="button" disabled={!!busy || resolved} onClick={function () { decideWaiver('grant'); }} style={btn()}>Grant waiver</button>
                    <button type="button" disabled={!!busy || resolved} onClick={function () { decideWaiver('deny'); }} style={btn('sec')}>Deny waiver</button>
                    <input value={denyReason} onChange={function (e) { setDenyReason(e.target.value); }}
                      placeholder="Denial reason (required to deny)"
                      style={{ flex: 1, minWidth: 220, font: 'inherit', fontSize: 13, background: C.surface, border: '1px solid ' + G.line, borderRadius: 4, padding: '5px 9px' }} />
                  </div>
                  <div style={Object.assign({}, kv, { marginTop: 7 })}>
                    A denial <b style={{ color: C.ink }}>folds into the estimate notice</b> — no separate letter unless this city configured one.
                    The estimate cannot be sent while this is undecided.
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <DecidedByBadge by="person">Your decision</DecidedByBadge>{' '}
                    <span style={kv}>recorded against your name.</span>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {/* ── COMMERCIAL RATE (mode: intake_review only) ── */}
          {showCommercial ? (
            <div style={Object.assign({}, box, { background: C.surface2 })}>
              <h3 style={panelHead}>Commercial-rate classification</h3>
              <div style={{ fontSize: 13 }}>
                The requester declared <b>{cm.declared}</b>. {cm.clockEffect ? cm.clockEffect + ' ' : ''}
                <DecidedByBadge by="person">A person decides</DecidedByBadge>
              </div>
              {/* BW4 — the classification now HAS a home (`requests.commercial_classification`), so this is a
                  real act rather than the confession BW3 printed here. It is also a proceed-gate cause, but
                  only in this exact configuration: module enabled AND mode `intake_review`. */}
              {cm.recorded ? (
                <div style={{ marginTop: 7, fontSize: 13 }}>
                  Classified as <b>{cm.classified}</b>{' '}
                  <DecidedByBadge by="person">{cm.decidedBy ? 'Recorded by ' + cm.decidedBy : 'A person decided'}</DecidedByBadge>
                  {cm.overridesDeclaration ? (
                    <div style={Object.assign({}, kv, { marginTop: 4, color: G.amberInk })}>
                      This OVERRIDES what the requester declared — it changes the invoice, and in a state with a
                      commercial clock it can change the deadline. It must be communicated; the estimate notice
                      is where that lands.
                    </div>
                  ) : null}
                  <div style={{ marginTop: 6 }}>
                    <button type="button" disabled={!!busy || resolved} style={btn('quiet')}
                      onClick={function () { classify(cm.classified === 'commercial' ? 'standard' : 'commercial'); }}>
                      Change to {cm.classified === 'commercial' ? 'standard' : 'commercial'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 7 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" disabled={!!busy || resolved} style={btn()}
                      onClick={function () { classify('commercial'); }}>Classify as commercial</button>
                    <button type="button" disabled={!!busy || resolved} style={btn('sec')}
                      onClick={function () { classify('standard'); }}>Classify as standard</button>
                  </div>
                  <div style={Object.assign({}, kv, { marginTop: 6 })}>
                    Recording this is your act, against your name. Proceed is blocked until it is recorded —
                    the classification changes the invoice, and where a state gives commercial requests their
                    own window it changes the deadline too, so it has to land before one is quoted.
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* ── RAIL ── */}
        <div style={{ flex: '0 0 250px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={Object.assign({}, box, { marginBottom: 0 })}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: C.muted, marginBottom: 6 }}>Actions</div>
            <button type="button" disabled={!!busy || resolved} style={Object.assign({}, btn('quiet'), { width: '100%', marginBottom: 6 })}
              onClick={function () { effort('CONSULT_REQUESTED', 'Conferred with a supervisor about this intake.'); }}>Confer with supervisor</button>
            <button type="button" disabled={!!busy || resolved} style={Object.assign({}, btn('quiet'), { width: '100%', marginBottom: 6 })}
              onClick={function () { effort('CALL_LOGGED', 'Phone call logged during intake review.'); }}>Log a phone call</button>
            <button type="button" disabled={!!busy || resolved} style={Object.assign({}, btn('quiet'), { width: '100%', marginBottom: 6 })}
              onClick={function () { markDefect('vague'); }}>Request clarification…</button>
            {/* Branch-gated, three-valued: hidden ONLY where the state's profile says `false` (rule b). */}
            {hidden('custodian_referral') ? null : (
              <>
                <button type="button" disabled style={Object.assign({}, btn('quiet'), { width: '100%', opacity: 0.6, cursor: 'not-allowed' })}>
                  Refer to proper custodian…
                </button>
                {/* Not built rather than not offered. Pretending the button works is how a stub screen
                    strands a request; saying so is how the reviewer knows to use another route. */}
                <div style={Object.assign({}, kv, { marginTop: 4 })}>Custodian referral is not built yet (BW5) — this control is a placeholder.</div>
              </>
            )}
          </div>

          <div style={Object.assign({}, box, { marginBottom: 0 })}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: C.muted, marginBottom: 6 }}>Resolve intake</div>
            <button type="button" disabled={!!busy || gate.blocked || resolved}
              onClick={proceed}
              style={Object.assign({}, btn(), { width: '100%', opacity: (gate.blocked || resolved) ? 0.55 : 1, cursor: (gate.blocked || resolved) ? 'not-allowed' : 'pointer' })}>
              {resolved ? 'Resolved' : busy === 'proceed' ? 'Proceeding…' : 'Proceed → Fulfillment'}
            </button>
            {/* THE GATE, IN WORDS, from the server. Not a frontend re-derivation — the same sentences the
                422 would return, so the screen and the guard can never disagree. */}
            {gate.blocked ? (
              <div style={{ marginTop: 6 }}>
                {gate.reasons.map(function (r, i) {
                  return <p key={i} style={{ fontSize: 12.5, color: G.amberInk, margin: '0 0 4px' }}>☐ {r.text}</p>;
                })}
              </div>
            ) : (
              <p style={Object.assign({}, kv, { marginTop: 5 })}>
                Proceed routes the item to Record Search{teamName ? ' on the ' + teamName : ''}.
              </p>
            )}
            <p style={Object.assign({}, kv, { marginTop: 4 })}>
              No manual hold: marking Vague or Overly Broad places the request on hold automatically, pending
              the requestor's response.
            </p>
          </div>

          {history.length ? (
            <div style={Object.assign({}, box, { marginBottom: 0 })}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: C.muted, marginBottom: 6 }}>Recent activity</div>
              {history.slice(0, 6).map(function (h) {
                return (
                  <div key={h.id} style={{ fontSize: 12, color: C.muted, paddingBottom: 5 }}>
                    <b style={{ color: C.ink }}>{h.action}</b> · {String(h.created_at || '').slice(0, 10)}
                    {h.notes ? <div>{h.notes}</div> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
