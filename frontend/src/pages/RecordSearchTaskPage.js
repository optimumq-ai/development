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
  var [err, setErr] = useState('');
  var [view, setView] = useState('selected'); // which side of the bar is open

  useEffect(function () {
    var alive = true;
    api.get('/tasks/' + taskId)
      .then(function (r) {
        if (!alive) return;
        setTask(r.data.task);
        return api.get('/requests/' + r.data.task.request_id + '/search-intents');
      })
      .then(function (r) { if (alive && r) setIntake(r.data); })
      .catch(function () { if (alive) setErr('Could not load this task.'); });
    return function () { alive = false; };
  }, [taskId]);

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

  return (
    <div style={{ background: C.ground, minHeight: '100%', padding: 20, color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

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

        {/* The search surface (§4) and the actions / resolution rail (§5 — incl. Vague vs Overly Broad)
            are the next slices. Saying so on the page beats a screen that silently does half its job. */}
        <div style={{ marginTop: 16, background: C.surface, border: '1px dashed ' + C.hairStrong,
          borderRadius: 10, padding: 16, fontSize: 13, color: C.muted }}>
          <b style={{ color: C.ink }}>Next on this screen:</b> the search surface (digital · audio/video · paper · other)
          and the actions rail — Confer · Contact requestor · Log a call · <b>Mark Vague</b> / <b>Mark Overly Broad</b> ·
          Found / No responsive records. <span style={{ color: C.faint }}>Spec §4–§5.</span>
        </div>
      </div>
    </div>
  );
}
