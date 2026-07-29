import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { G, ClockChip } from '../components/primitives';

// PHASE 7 / BW6 — THE MRR OVERVIEW (mockup screen 2).
//
// SCOPE IS MY MRRs, AND THAT IS A DECISION, NOT A LIMITATION (Kevin, round 2; Draft 5 §3 q1, RESOLVED).
// With several eligible associates in the Open Records Office each holds only their own, so a working
// screen showing everybody's would be showing a manager work they cannot act on and are not accountable
// for. The all-office view with a manager column exists for OVERSIGHT AUTHORITY — ORO Supervisor /
// Director — and is deliberately NOT a tab here. Building it as a toggle would put an oversight surface
// one click from every associate, which is the opposite of what scoping it meant.
//
// WHAT A MANAGER IS ACTUALLY SCANNING FOR, in the column order it is scanned:
//   which request · whose · how many items · the CLOCK (statutory, master-only) · estimate readiness ·
//   and the flags that mean somebody is waiting on a decision (an outstanding clarification, an item
//   designated for denial).
//
// The clock renders through ClockChip from the server's `kind` (spec rule a) — a city service target can
// never wear the statutory treatment here any more than anywhere else, and a jurisdiction with no
// statutory deadline says so rather than showing a fabricated date.

var kv = { fontSize: 12.5, color: C.muted };

function Tag(props) {
  var tints = {
    vague: { bg: G.amberBg, fg: G.amberInk, bd: G.amberLine },
    denial: { bg: '#F7E9E5', fg: '#8C3A2B', bd: '#C08A7E' }
  };
  var t = tints[props.kind];
  return (
    <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: '.05em',
      textTransform: 'uppercase', borderRadius: 3, padding: '2px 7px', background: t.bg, color: t.fg,
      border: '1px solid ' + t.bd, whiteSpace: 'nowrap', marginRight: 5 }}>{props.children}</span>
  );
}

export default function MrrOverviewPage() {
  var nav = useNavigate();
  var [d, setD] = useState(null);
  var [err, setErr] = useState(null);

  useEffect(function () {
    api.get('/mrr/overview')
      .then(function (r) { setD(r.data); })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || e.message); });
  }, []);

  if (err) return <div style={{ padding: 20, color: '#8C3A2B' }}>{err}</div>;
  if (!d) return <div style={{ padding: 20, color: C.muted }}>Loading…</div>;

  var th = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted,
    textAlign: 'left', padding: '7px 10px', borderBottom: '2px solid ' + G.line, fontWeight: 700 };
  var td = { padding: '9px 10px', borderBottom: '1px solid ' + C.surface2, verticalAlign: 'top' };

  return (
    <div style={{ padding: '14px 16px', maxWidth: 1080 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: G.navy, marginBottom: 10 }}>
        MRR overview — my multi-record requests in process
      </div>

      {d.rows.length === 0 ? (
        <div style={{ background: C.surface, border: '1px solid ' + G.line, borderRadius: 6,
          padding: '20px 18px', color: C.muted, fontSize: 13 }}>
          You are not holding any multi-record requests. {d.scopeNote}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: C.surface,
          border: '1px solid ' + G.line, borderRadius: 6 }}>
          <thead>
            <tr>
              <th style={th}>Master record</th><th style={th}>Requestor</th><th style={th}>Items</th>
              <th style={th}>Clock</th><th style={th}>Estimate data</th><th style={th}>Flags</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map(function (r) {
              return (
                <tr key={r.requestId} style={{ cursor: 'pointer' }} onClick={function () { nav('/mrr/' + r.taskId); }}>
                  <td style={td}>
                    <div style={{ fontFamily: C.mono, fontWeight: 700, color: G.navy }}>{r.requestNumber}</div>
                    <div style={kv}>{r.descriptionShort}</div>
                  </td>
                  <td style={td}>{r.requestorName}</td>
                  <td style={td}>
                    {r.itemCount}
                    <div style={kv}>{r.openItems} live</div>
                  </td>
                  <td style={td}>
                    {r.clock && r.clock.dueDate ? (
                      <ClockChip kind={r.clock.kind}
                        k={r.clock.kind === 'response' || r.clock.kind === 'agency_action' ? 'Statutory' : (r.clock.label || null)}
                        citation={r.clock.citation}
                        exposure={r.clock.isOverdue ? (r.clock.overdueMeaning || null) : null}>
                        {String(r.clock.dueDate).slice(0, 10)}
                      </ClockChip>
                    ) : (
                      // NEVER a fabricated date, and never a blank — a blank reads as a bug.
                      <ClockChip kind="none">no statutory deadline</ClockChip>
                    )}
                  </td>
                  <td style={td}>
                    <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, borderRadius: 4,
                      padding: '3px 10px', background: C.surface,
                      border: '1px solid ' + (r.readiness.ready ? G.statute : G.line),
                      color: r.readiness.ready ? G.statute : C.ink }}>
                      {r.readiness.n} / {r.readiness.m}{r.readiness.ready ? ' ✓ ready' : ''}
                    </span>
                  </td>
                  <td style={td}>
                    {r.flags.vague ? <Tag kind="vague">Vague ×{r.flags.vague}</Tag> : null}
                    {r.flags.denialDesignated ? <Tag kind="denial">Denial → legal ×{r.flags.denialDesignated}</Tag> : null}
                    {!r.flags.vague && !r.flags.denialDesignated ? <span style={kv}>—</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={Object.assign({}, kv, { marginTop: 10 })}>{d.scopeNote}</div>
      <div style={{ fontSize: 12.5, marginTop: 12 }}>
        <Link to="/my-tasks" style={{ color: G.navy }}>← My Tasks</Link>
      </div>
    </div>
  );
}
