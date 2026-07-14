import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';

// RECORD-SEARCH TASK SCREEN — SPEC_record_search_task_screen.md
//
// Slice 1: the CONTEXT zone. The searcher opens this and the first thing they must understand is what the
// PORTAL ALREADY DID on their behalf — which, until R9 shipped, the system could not tell them.
//
//   - the "Self Service Portal Search Results" bar (spec §2.3, Kevin's mark-up): Selected (n) / Not Selected (n)
//   - the per-description INTENT block (spec §2, DESIGN_split_canvas_intake §R9.4) — the instruction the
//     requestor actually gave, which a flat pile of selections could never express
//   - queries the portal already ran, so the searcher does not repeat one the requestor already rejected
//
// The search surface (§4) and the actions/resolution rail (§5) are the NEXT slices.

// Palette = the PORTAL token set (Kevin, 2026-07-14): gray ground, lighter gray boxes, white fields,
// #1E6091 as the one button colour. See SPEC §9.
var C = {
  ground: '#D8E0E8', surface: '#FFFFFF', surface2: '#F2F6F9', field: '#EBF3FB',
  ink: '#12232E', muted: '#5C6F7C', faint: '#8296A4',
  hair: '#D2DCE3', hairStrong: '#BECAD3',
  blue: '#1E6091', blueTint: '#E4EEF6', blueInk: '#0E3A5C',
  green: '#1B8A5A', greenTint: '#E1F2E9',
  amber: '#9A6512', amberTint: '#F6EBD6',
  crit: '#B02A37', critTint: '#F8E7E8',
  mono: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace'
};

// The four intents, and what each one MEANS to the person now doing the searching. This table is the whole
// point of R9 — see DESIGN_split_canvas_intake §R9.4.
var INTENT = {
  complete: {
    label: 'Requestor: this is everything',
    tone: 'neutral',
    hint: 'The selection answers the ask. Nothing further was requested for this description.'
  },
  search_more: {
    label: 'Requestor asked us to search for MORE',
    tone: 'amber',
    hint: 'Fulfilling from the selection alone CLOSES a request the requestor considers OPEN.'
  },
  no_match_search: {
    label: 'No match in the portal results — team search required',
    tone: 'amber',
    hint: 'The portal searched and found nothing they wanted. This is an instruction to search, NOT abandonment.'
  },
  not_searchable: {
    label: 'Not portal-searchable — team must pull',
    tone: 'blue',
    hint: 'Email / audio-video / photos / data exports / paper. The portal NEVER searched this one.'
  }
};

function toneStyle(tone) {
  if (tone === 'amber') return { bg: C.amberTint, fg: C.amber, bd: C.amber };
  if (tone === 'blue') return { bg: C.blueTint, fg: C.blueInk, bd: C.blue };
  return { bg: C.surface2, fg: C.muted, bd: C.hairStrong };
}

function daysUntil(d) {
  if (!d) return null;
  var ms = new Date(d + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime();
  return Math.round(ms / 86400000);
}

export default function RecordSearchTaskPage() {
  var params = useParams();
  var taskId = params.taskId;

  var [task, setTask] = useState(null);
  var [intake, setIntake] = useState(null);
  var [policy, setPolicy] = useState(null);   // the jurisdiction's clarification rules — drives the rail
  var [trail, setTrail] = useState([]);
  var [err, setErr] = useState('');
  var [view, setView] = useState('selected'); // which side of the bar is open
  var [defect, setDefect] = useState(null);   // 'vague' | 'overly_broad' — which marker is open
  var [busy, setBusy] = useState('');
  var [flash, setFlash] = useState(null);

  var [q, setQ] = useState('');
  var [results, setResults] = useState(null);
  var [searching, setSearching] = useState(false);
  var [attached, setAttached] = useState([]);
  var [resolved, setResolved] = useState(null);

  function loadTrail(rid) {
    return api.get('/requests/' + rid).then(function (r) {
      setTrail((r.data.history || []).slice().reverse());
    }).catch(function () {});
  }
  function loadAttached(rid) {
    return api.get('/files/' + rid).then(function (r) { setAttached(r.data.files || []); }).catch(function () {});
  }

  useEffect(function () {
    var alive = true;
    api.get('/tasks/' + taskId)
      .then(function (r) {
        if (!alive) return;
        setTask(r.data.task);
        var rid = r.data.task.request_id;
        api.get('/requests/' + rid + '/search-intents')
          .then(function (x) { if (alive) setIntake(x.data); }).catch(function () {});
        api.get('/clarification-policy')
          .then(function (x) { if (alive) setPolicy(x.data.policy); }).catch(function () {});
        loadTrail(rid);
        loadAttached(rid);
      })
      .catch(function () { if (alive) setErr('Could not load this task.'); });
    return function () { alive = false; };
  }, [taskId]);

  // --- actions -------------------------------------------------------------------------------------
  function effort(action, notes) {
    setBusy(action);
    return api.post('/requests/' + task.request_id + '/effort', { action: action, notes: notes })
      .then(function () { setFlash({ tone: 'ok', text: notes }); return loadTrail(task.request_id); })
      .catch(function () { setFlash({ tone: 'crit', text: 'That did not go through.' }); })
      .then(function () { setBusy(''); });
  }

  // Marking a defect is NOT a note — it sends the clarification and lets the jurisdiction's own rules decide
  // what happens to the clock. The reason travels ('vague' | 'overly_broad') because the two are different
  // legal defects; see clarificationAction.
  function markDefect(reason) {
    setBusy(reason);
    return api.post('/requests/' + task.request_id + '/clarification', { reason: reason })
      .then(function (r) {
        var d = r.data;
        setFlash({
          tone: d.conferenceRequired ? 'crit' : 'ok',
          text: d.conferenceRequired
            ? 'Conference offered. THE CLOCK DID NOT STOP — missing the deadline forfeits the burden defense.'
            : ('Clarification sent' + (d.clockStillRunning ? ' — the clock keeps running (' + d.effect + ').'
                                                           : ' — the response clock was tolled.'))
        });
        setDefect(null);
        return loadTrail(task.request_id);
      })
      .catch(function (e) {
        var msg = (e.response && e.response.data && e.response.data.error) || 'That did not go through.';
        setFlash({ tone: 'crit', text: msg });
      })
      .then(function () { setBusy(''); });
  }

  // --- the search surface (§4a) ---------------------------------------------------------------------
  function runSearch() {
    var query = q.trim();
    if (!query || searching) return;
    setSearching(true); setResults(null);
    api.post('/files/search/records', { query: query })
      .then(function (r) { setResults(r.data.results || []); })
      .catch(function () { setFlash({ tone: 'crit', text: 'Search failed.' }); })
      .then(function () { setSearching(false); });
  }

  function attach(rec) {
    setBusy(rec.id);
    api.post('/files/attach/' + task.request_id, { record: rec, includeInResponse: true })
      .then(function (r) {
        setFlash({ tone: 'ok', text: 'Included in Response: ' + r.data.originalName });
        return Promise.all([loadAttached(task.request_id), loadTrail(task.request_id)]);
      })
      .catch(function (e) {
        var d = e.response && e.response.data;
        // A record with no retrievable file cannot be attached. Say WHY rather than failing silently —
        // the connectors that would pull it are stubs, and the searcher needs to know that, not guess.
        setFlash({ tone: 'crit', text: (d && d.error) || 'Could not attach that record.' });
      })
      .then(function () { setBusy(''); });
  }

  // --- resolution (§5d) -----------------------------------------------------------------------------
  function resolve(outcome) {
    setBusy(outcome);
    api.post('/tasks/' + taskId + '/resolve', { outcome: outcome })
      .then(function (r) {
        setResolved(r.data);
        setFlash({ tone: 'ok', text: outcome === 'found'
          ? ('Search complete — ' + r.data.included + ' record(s) handed to Exemption Review.')
          : ('Closed — no responsive records. Diligence evidenced by ' + r.data.effortEntries + ' logged action(s).') });
        return loadTrail(task.request_id);
      })
      .catch(function (e) {
        var d = e.response && e.response.data;
        setFlash({ tone: 'crit', text: (d && d.error) || 'Could not resolve the task.' });
      })
      .then(function () { setBusy(''); });
  }

  if (err) return <div style={{ padding: 32, color: C.crit }}>{err}</div>;
  if (!task) return <div style={{ padding: 32, color: C.muted }}>Loading…</div>;

  var totals = (intake && intake.totals) || { selected: 0, notSelected: 0, shown: 0 };
  var groups = (intake && intake.groups) || [];
  var ungrouped = (intake && intake.ungroupedSelected) || [];
  var dLeft = daysUntil(task.deadline_date);
  var overdue = dLeft !== null && dLeft < 0;

  // Every record shown-and-passed-over, flattened. The requestor never sees this and never will — it exists
  // so the searcher does not re-surface something the requestor already looked at and declined.
  var passedOver = groups.reduce(function (a, g) { return a.concat(g.notSelected || []); }, []);
  var selectedAll = groups.reduce(function (a, g) { return a.concat(g.selected || []); }, []).concat(ungrouped);

  function Bar() {
    var tabs = [
      { k: 'selected', label: 'Selected Records', n: totals.selected },
      { k: 'not', label: 'Records Not Selected', n: totals.notSelected }
    ];
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        background: C.surface2, border: '1px solid ' + C.hair, borderRadius: 9, padding: '9px 12px' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: C.muted }}>
          Self Service Portal Search Results
        </span>
        {tabs.map(function (t) {
          var on = view === t.k;
          return (
            <button key={t.k} type="button" onClick={function () { setView(t.k); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                border: '1px solid ' + C.blue, borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 600,
                background: on ? C.blue : C.blueTint, color: on ? '#fff' : C.blue }}>
              {t.label}
              <span style={{ display: 'inline-grid', placeItems: 'center', minWidth: 20, height: 20, padding: '0 6px',
                borderRadius: 999, fontFamily: C.mono, fontSize: 12, fontWeight: 700,
                background: on ? '#fff' : C.blue, color: on ? C.blue : '#fff' }}>{t.n}</span>
            </button>
          );
        })}
        {totals.shown > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 13, color: C.faint }}>
            The portal showed them <b style={{ color: C.ink }}>{totals.shown}</b>; they took <b style={{ color: C.ink }}>{totals.selected}</b>.
          </span>
        )}
      </div>
    );
  }

  function Rec(props) {
    var r = props.r, dim = props.dim;
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: C.surface,
        border: '1px solid ' + C.hair, borderRadius: 8, padding: '9px 11px', marginTop: 6, opacity: dim ? 0.72 : 1 }}>
        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px',
          background: dim ? C.surface2 : C.greenTint, color: dim ? C.faint : C.green }}>
          {dim ? 'Shown' : 'Selected'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink, textDecoration: dim ? 'line-through' : 'none' }}>
            {r.title || r.record_id}
          </div>
          <div style={{ fontSize: 12, color: C.faint }}>
            {[r.source_system, dim && r.shown_in_query ? 'shown for “' + r.shown_in_query + '”' : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        {dim && <span style={{ fontSize: 11, fontWeight: 700, color: C.faint }}>Excluded</span>}
      </div>
    );
  }

  // The conference duty is the JURISDICTION'S, not the word's. If this city does not impose it, marking a
  // request Overly Broad records the defect and owes no conference — and the screen must not pretend otherwise.
  var duty = policy && policy.clarification_duty;
  var effect = policy && policy.clarification_clock_effect;
  var conferenceOwed = duty === 'required_before_burden_denial';
  var includedCount = attached.filter(function (f) { return f.responsive; }).length;
  var clockStops = effect === 'toll_pause_resume' || effect === 'toll_and_restart'
                || effect === 'start_gate' || effect === 'operational_hold';

  function Act(props) {
    return (
      <button type="button" disabled={!!busy} onClick={props.onClick}
        style={{ display: 'block', width: '100%', textAlign: 'left', cursor: busy ? 'not-allowed' : 'pointer',
          background: props.on ? C.blueTint : C.surface, border: '1px solid ' + (props.on ? C.blue : C.hair),
          borderRadius: 9, padding: '10px 12px', marginBottom: 8, opacity: busy && busy !== props.k ? 0.55 : 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650, color: C.ink }}>{props.title}</div>
        <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{props.sub}</div>
      </button>
    );
  }

  return (
    <div style={{ background: C.ground, minHeight: '100%', padding: 20, color: C.ink }}>
      <div style={{ maxWidth: 1360, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 16, alignItems: 'start' }}>
       <div style={{ minWidth: 0 }}>

        <Link to="/my-tasks" style={{ fontSize: 13, color: C.blue, textDecoration: 'none', fontWeight: 600 }}>‹ My Tasks</Link>

        {/* ---------------- ZONE 1 — CONTEXT ---------------- */}
        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10, marginTop: 12 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + C.hair, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: C.mono, fontSize: 19, fontWeight: 700, color: C.blue }}>{task.request_number}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px', background: C.blueTint, color: C.blueInk }}>
              Record Search
            </span>
            {task.record_type_name && (
              <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px', background: C.amberTint, color: C.amber }}>
                {task.record_type_name}
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 13, color: overdue ? C.crit : C.muted, fontWeight: overdue ? 700 : 400 }}>
              {task.deadline_date
                ? <><b>Statutory due</b> {task.deadline_date}{dLeft !== null ? ' · ' + (overdue ? Math.abs(dLeft) + ' days OVERDUE' : dLeft + ' days') : ''}</>
                : 'No deadline on file'}
            </span>
          </div>

          <div style={{ padding: 18 }}>
            <p style={{ margin: '0 0 12px', fontSize: 14.5, lineHeight: 1.5, maxWidth: '72ch' }}>{task.request_description}</p>
            <div style={{ fontSize: 13, color: C.faint, marginBottom: 16 }}>
              <b style={{ color: C.muted }}>Requestor</b> {task.requestor_name}
              {task.requestor_email ? ' · ' + task.requestor_email : ''}
              {task.team_name ? <> &nbsp;·&nbsp; <b style={{ color: C.muted }}>Team</b> {task.team_name}</> : null}
              {task.delivery_method ? <> &nbsp;·&nbsp; <b style={{ color: C.muted }}>Delivery</b> {task.delivery_method}</> : null}
            </div>

            {/* --- the bar (spec §2.3) --- */}
            <Bar />

            {/* --- what the portal already did, per description (R9) --- */}
            {view === 'selected' ? (
              <div style={{ marginTop: 12 }}>
                {groups.length === 0 && ungrouped.length === 0 && (
                  <div style={{ fontSize: 13, color: C.faint, padding: '10px 0' }}>
                    The portal did not search for this request, or it predates the intake-provenance change.
                    Nothing was carried forward.
                  </div>
                )}
                {groups.map(function (g) {
                  var meta = INTENT[g.intent] || INTENT.no_match_search;
                  var t = toneStyle(meta.tone);
                  return (
                    <div key={g.id} style={{ border: '1px solid ' + C.hair, borderRadius: 9, padding: 12, marginTop: 10, background: C.surface2 }}>
                      <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 6 }}>“{g.description}”</div>
                      <div style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, borderRadius: 999,
                        padding: '3px 10px', background: t.bg, color: t.fg, border: '1px solid ' + t.bd }}>
                        {meta.label}
                      </div>
                      <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>{meta.hint}</div>

                      {g.queriesTried && g.queriesTried.length > 0 && (
                        <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>
                          <b style={{ color: C.muted }}>The portal already ran</b> — don’t repeat these:{' '}
                          {g.queriesTried.map(function (q, i) {
                            return (
                              <span key={i} style={{ display: 'inline-block', background: C.surface, border: '1px solid ' + C.hair,
                                borderRadius: 999, padding: '1px 8px', margin: '2px 4px 0 0', fontFamily: C.mono, fontSize: 11.5 }}>
                                {q}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {(g.selected || []).map(function (r) { return <Rec key={r.id} r={r} />; })}
                      {(g.selected || []).length === 0 && (
                        <div style={{ fontSize: 12.5, color: C.faint, marginTop: 8, fontStyle: 'italic' }}>
                          Nothing selected for this description.
                        </div>
                      )}
                    </div>
                  );
                })}

                {ungrouped.length > 0 && (
                  <div style={{ border: '1px dashed ' + C.hairStrong, borderRadius: 9, padding: 12, marginTop: 10 }}>
                    <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 4 }}>
                      <b>Selected before intake recorded what it meant.</b> These carry no description or intent.
                    </div>
                    {ungrouped.map(function (r) { return <Rec key={r.id} r={r} />; })}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, background: C.field,
                  border: '1px solid ' + C.hair, borderRadius: 8, padding: '10px 12px' }}>
                  <b>The requestor was shown these and passed them over.</b> They have never been shown this list and
                  never will be — it is here so you don’t re-surface a record they already declined.
                </div>
                {passedOver.length === 0
                  ? <div style={{ fontSize: 13, color: C.faint, padding: '10px 0' }}>Nothing was shown and passed over.</div>
                  : passedOver.map(function (r) { return <Rec key={r.id} r={r} dim />; })}
              </div>
            )}
          </div>
        </section>

        {/* ---------------- ZONE 2 — THE SEARCH SURFACE (§4a) ---------------- */}
        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10, marginTop: 16 }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + C.hair, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted }}>
              Find the records
            </span>
            {includedCount > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '2px 9px',
                background: C.greenTint, color: C.green }}>{includedCount} to include</span>
            )}
          </div>
          <div style={{ padding: 18 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={q} onChange={function (e) { setQ(e.target.value); }}
                onKeyDown={function (e) { if (e.key === 'Enter') runSearch(); }}
                placeholder="Search the connected record systems…"
                style={{ flex: 1, minWidth: 0, background: C.surface, border: '1px solid ' + C.hairStrong,
                  borderRadius: 8, padding: '9px 12px', fontSize: 14, color: C.ink }} />
              <button type="button" onClick={runSearch} disabled={searching || !q.trim()}
                style={{ cursor: searching ? 'wait' : 'pointer', background: C.blue, color: '#fff',
                  border: '1px solid ' + C.blue, borderRadius: 8, padding: '9px 18px', fontSize: 13.5, fontWeight: 650,
                  opacity: (searching || !q.trim()) ? 0.55 : 1 }}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>

            {results && results.length === 0 && (
              <div style={{ marginTop: 14, fontSize: 13, color: C.muted, background: C.surface2,
                border: '1px solid ' + C.hair, borderRadius: 8, padding: '12px 14px' }}>
                <b style={{ color: C.ink }}>No matches.</b> That is a real, common outcome — not a failure. Log the
                effort, then close with <b>No responsive records</b> when you are satisfied the search was diligent.
              </div>
            )}

            {results && results.map(function (r) {
              var lib = r.publicReady === true;
              return (
                <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 10,
                  background: C.surface2, border: '1px solid ' + C.hair, borderRadius: 9, padding: '11px 13px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 650 }}>{r.title}</div>
                    <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>
                      {[r.docType, r.department, r.dateCreated, r.sourceSystem, r.pageCount ? r.pageCount + ' pp' : null]
                        .filter(Boolean).join(' · ')}
                    </div>
                    {r.summary && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 5, lineHeight: 1.45 }}>{r.summary}</div>}
                    {lib && (
                      <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 700,
                        borderRadius: 999, padding: '2px 8px', background: C.greenTint, color: C.green }}>
                        Already released · Public Records Library
                      </span>
                    )}
                  </div>
                  <button type="button" disabled={!!busy} onClick={function () { attach(r); }}
                    style={{ flex: 'none', cursor: busy ? 'not-allowed' : 'pointer', background: C.blueTint,
                      color: C.blue, border: '1px solid ' + C.blue, borderRadius: 8, padding: '8px 12px',
                      fontSize: 13, fontWeight: 650, opacity: busy && busy !== r.id ? 0.55 : 1 }}>
                    {busy === r.id ? 'Adding…' : 'Include in Response'}
                  </button>
                </div>
              );
            })}

            {attached.length > 0 && (
              <div style={{ marginTop: 18, borderTop: '1px dashed ' + C.hair, paddingTop: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
                  color: C.muted, marginBottom: 8 }}>On this request ({attached.length})</div>
                {attached.slice(0, 12).map(function (f) {
                  return (
                    <div key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6,
                      background: C.surface, border: '1px solid ' + C.hair, borderRadius: 8, padding: '8px 11px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px',
                        background: f.responsive ? C.greenTint : C.surface2, color: f.responsive ? C.green : C.faint }}>
                        {f.responsive ? 'Include in Response' : 'Attached'}
                      </span>
                      <span style={{ fontSize: 13, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.original_name}
                      </span>
                    </div>
                  );
                })}
                {attached.length > 12 && (
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>…and {attached.length - 12} more.</div>
                )}
              </div>
            )}
          </div>
        </section>
       </div>

       {/* ---------------- ZONE 3 — ACTIONS & DEFECT RAIL ---------------- */}
       <div style={{ minWidth: 0 }}>

        {flash && (
          <div style={{ marginBottom: 12, fontSize: 12.5, lineHeight: 1.5, borderRadius: 9, padding: '10px 12px',
            background: flash.tone === 'crit' ? C.critTint : C.greenTint,
            color: flash.tone === 'crit' ? C.crit : C.green,
            border: '1px solid ' + (flash.tone === 'crit' ? C.crit : C.green), fontWeight: 600 }}>
            {flash.text}
          </div>
        )}

        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10, marginBottom: 16 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid ' + C.hair, fontSize: 12.5, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted }}>Actions</div>
          <div style={{ padding: 14, paddingBottom: 6 }}>
            <Act k="CONSULT_REQUESTED" title="Confer with supervisor" sub="Send this task and a note"
              onClick={function () { effort('CONSULT_REQUESTED', 'Conferred with a supervisor on this search.'); }} />
            <Act k="CALL_LOGGED" title="Log a phone call" sub="Who, when, what came of it"
              onClick={function () { effort('CALL_LOGGED', 'Phone call logged during record search.'); }} />
          </div>
        </section>

        {/* ===== IS THE REQUEST DEFECTIVE? (spec §5b-2) =====
            Two defects, VISIBLE, never one checkbox. What each one DOES is decided by the jurisdiction's
            own clarification rules — which is the entire reason they cannot be collapsed. */}
        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10, marginBottom: 16 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid ' + C.hair, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted }}>
              Is the request defective?
            </span>
            {policy && !policy.enabled && (
              <span title="The jurisdiction's clarification policy is off or un-attested, so marking a defect records the effort trail but changes no clock."
                style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px',
                  background: C.surface2, color: C.faint }}>policy off</span>
            )}
          </div>
          <div style={{ padding: 14, paddingBottom: 8 }}>

            <Act k="vague" title="Mark Vague" sub="Unclear WHAT is being asked" on={defect === 'vague'}
              onClick={function () { setDefect(defect === 'vague' ? null : 'vague'); }} />
            {defect === 'vague' && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.muted, background: C.surface2,
                border: '1px solid ' + C.hair, borderRadius: 8, padding: '10px 12px', margin: '-2px 0 10px' }}>
                Sends a clarification request. This jurisdiction’s clock rule is <code style={{ fontFamily: C.mono }}>{effect || '—'}</code>
                {clockStops ? ' — the response clock will PAUSE.' : ' — the response clock KEEPS RUNNING.'}
                <button type="button" disabled={!!busy} onClick={function () { markDefect('vague'); }}
                  style={{ marginTop: 9, width: '100%', cursor: 'pointer', background: C.blue, color: '#fff',
                    border: '1px solid ' + C.blue, borderRadius: 8, padding: '8px 10px', fontSize: 13, fontWeight: 650 }}>
                  {busy === 'vague' ? 'Sending…' : 'Send clarification request'}
                </button>
              </div>
            )}

            <Act k="overly_broad" title="Mark Overly Broad" sub="Clear, but unduly burdensome" on={defect === 'overly_broad'}
              onClick={function () { setDefect(defect === 'overly_broad' ? null : 'overly_broad'); }} />
            {defect === 'overly_broad' && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, borderRadius: 8, padding: '10px 12px', margin: '-2px 0 10px',
                background: conferenceOwed ? C.critTint : C.surface2,
                border: '1px solid ' + (conferenceOwed ? C.crit : C.hair), color: C.ink }}>
                {conferenceOwed ? (
                  <>
                    <b>This jurisdiction requires a conference.</b> Before this request can be denied as unduly
                    burdensome, the agency <b>shall</b> offer the requestor an opportunity to confer and reduce it to
                    manageable proportions.
                    <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid ' + C.crit }}>
                      <span style={{ display: 'block', fontWeight: 700, color: C.crit, marginBottom: 3 }}>
                        ⚠ The clock does not stop for the conference.
                      </span>
                      Failing to respond on time means the request <b>may not be treated as unduly burdensome at all</b>.
                      Waiting silently <b>forfeits the burden defense</b>.
                      {task.deadline_date && (
                        <span style={{ display: 'block', marginTop: 7, fontFamily: C.mono, fontSize: 12,
                          color: C.crit, fontWeight: 700 }}>
                          Response due {task.deadline_date}{dLeft !== null ? ' · ' + (overdue ? Math.abs(dLeft) + ' days OVERDUE' : dLeft + ' days left') : ''}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    Records the request as <b>overly broad</b> and sends a clarification. <b>This jurisdiction imposes no
                    conference duty</b> (<code style={{ fontFamily: C.mono }}>duty={duty || 'none'}</code>), so conferring
                    is discretionary here.
                  </>
                )}
                <button type="button" disabled={!!busy} onClick={function () { markDefect('overly_broad'); }}
                  style={{ marginTop: 9, width: '100%', cursor: 'pointer', color: '#fff',
                    background: conferenceOwed ? C.crit : C.blue,
                    border: '1px solid ' + (conferenceOwed ? C.crit : C.blue),
                    borderRadius: 8, padding: '8px 10px', fontSize: 13, fontWeight: 650 }}>
                  {busy === 'overly_broad' ? 'Sending…' : (conferenceOwed ? 'Offer the conference' : 'Send clarification request')}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ===== RESOLUTION (§5d) — two ways out, and they are NOT symmetrical ===== */}
        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10, marginBottom: 16 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid ' + C.hair, fontSize: 12.5, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted }}>Resolve</div>
          <div style={{ padding: 14 }}>
            {resolved ? (
              <div style={{ fontSize: 13, fontWeight: 650, color: resolved.outcome === 'found' ? C.green : C.crit }}>
                {resolved.outcome === 'found'
                  ? '✓ Search complete — handed to Exemption Review.'
                  : '✓ Closed — no responsive records.'}
              </div>
            ) : (
              <>
                <button type="button" disabled={!!busy || includedCount < 1} onClick={function () { resolve('found'); }}
                  title={includedCount < 1 ? 'Include at least one record in the response first.' : ''}
                  style={{ width: '100%', cursor: (busy || includedCount < 1) ? 'not-allowed' : 'pointer',
                    background: includedCount < 1 ? C.surface2 : C.green, color: includedCount < 1 ? C.faint : '#fff',
                    border: '1px solid ' + (includedCount < 1 ? C.hair : C.green), borderRadius: 9,
                    padding: '10px 12px', fontSize: 13.5, fontWeight: 650, marginBottom: 8 }}>
                  {busy === 'found' ? 'Completing…' : 'Found — ' + includedCount + ' to include →'}
                </button>
                <button type="button" disabled={!!busy} onClick={function () { resolve('no_records'); }}
                  style={{ width: '100%', cursor: busy ? 'not-allowed' : 'pointer', background: C.surface,
                    color: C.muted, border: '1px solid ' + C.hairStrong, borderRadius: 9,
                    padding: '10px 12px', fontSize: 13.5, fontWeight: 650 }}>
                  {busy === 'no_records' ? 'Closing…' : 'No responsive records'}
                </button>
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
                  {includedCount < 1
                    ? 'Include at least one record to finish. Closing with no records is a legal act — it must be evidenced by the effort trail below.'
                    : 'Closing with no records is a legal act — it must be evidenced by the effort trail below.'}
                </div>
              </>
            )}
          </div>
        </section>

        {/* The effort trail. Not decoration — it is the evidence that supports a "no responsive records"
            closure, and the place a city looks when someone asks what it actually DID. */}
        <section style={{ background: C.surface, border: '1px solid ' + C.hair, borderRadius: 10 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid ' + C.hair, display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted }}>
              Effort trail
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px',
              background: C.surface2, color: C.faint, fontFamily: C.mono }}>{trail.length}</span>
          </div>
          <div style={{ padding: 14, maxHeight: 380, overflowY: 'auto' }}>
            {trail.length === 0 && <div style={{ fontSize: 12.5, color: C.faint }}>Nothing logged yet.</div>}
            {trail.slice(0, 25).map(function (h) {
              var loud = /CLARIFICATION|OVERLY BROAD|forfeit/i.test((h.action || '') + ' ' + (h.notes || ''));
              return (
                <div key={h.id} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid ' + C.hair }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, fontFamily: C.mono,
                    color: loud ? C.crit : C.blue }}>{h.action}</div>
                  <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.45, marginTop: 2 }}>{h.notes}</div>
                  <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>{h.actor_name} · {h.created_at}</div>
                </div>
              );
            })}
          </div>
        </section>
       </div>
      </div>
    </div>
  );
}
