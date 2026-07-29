import React from 'react';
import { C } from '../../lib/theme';

// THE PROCESSING-UI COMPONENT LIBRARY — SPEC_processing_ui.md §7 (BW1).
//
// Shared pieces ship as a COMPONENT LIBRARY, never a shared screen (spec §1). These are the
// primitives the ten approved mockups (docs/mockups/PROCESSING_UI_draft1..10_*.html) draw with,
// extracted so a second screen can obey the grammar without copying it — the divergent-private-copy
// defect lib/theme.js documents.
//
// THE GRAMMAR TOKENS (G) below are the mockups' :root superset over lib/theme.js, carried verbatim
// from the drafts Kevin marked up and approved (2026-07-28/29). They are ADDITIVE — C stays the
// staff-screen base palette; G holds only the compliance-grammar colors the mockups added. If the
// palette question in lib/theme.js's header is ever settled differently, this is the one place to
// change.
//
// COMPLIANCE NOTE (spec §1 rules a + c — these are legal constraints, not styling):
//  - ClockChip: an `operational_target` may NEVER render with the statutory treatment, and the
//    words beside it must never claim law. Copy should come from computeStatus.overdueMeaning.
//  - DecidedByBadge: the system is never shown as having decided a judgment call.

export var G = {
  navy: '#143D5C', line: '#C3CFDA',
  amberInk: '#9A6700', amberLine: '#D4A72C', amberBg: '#FFF8E5',
  ghost: '#8A97A3', statute: '#2F6B4F', statuteBg: '#EAF4EF'
};

// ---------------------------------------------------------------------------------------------
// ClockChip — the four irreconcilable clock grammars (spec rule a).
//   kind: 'response' | 'agency_action' | 'requestor_window' | 'operational_target' | 'none'
//   k:    the small uppercase kicker ("Statutory deadline", "City service target", …)
//   citation: statute cite — statutory kinds only
//   exposure: optional warning text (deemed-disclosure etc.) — renders loud, never a countdown
export function ClockChip(props) {
  var kind = props.kind || 'none';
  var statutory = kind === 'response' || kind === 'agency_action';
  var base = { display: 'inline-flex', alignItems: 'baseline', gap: 7, fontSize: 12.5,
    borderRadius: 6, padding: '4px 10px', background: C.surface, color: C.ink };
  var style;
  if (statutory) {
    style = Object.assign(base, { borderLeft: '4px solid ' + G.navy, borderTop: '1px solid ' + G.line,
      borderRight: '1px solid ' + G.line, borderBottom: '1px solid ' + G.line, color: G.navy, fontWeight: 700 });
  } else if (kind === 'operational_target') {
    style = Object.assign(base, { border: '1px dashed ' + G.ghost, color: C.muted });
  } else if (kind === 'requestor_window') {
    style = Object.assign(base, { border: '1px solid ' + G.line, color: C.muted });
  } else { // none — the honest "no deadline" state; never invent a date
    style = Object.assign(base, { border: '1px dashed ' + G.ghost, color: G.ghost, fontStyle: 'italic' });
  }
  return (
    <span style={style}>
      {props.k ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em',
        textTransform: 'uppercase', color: statutory ? G.navy : C.faint }}>{props.k}</span> : null}
      <span>{props.children}</span>
      {statutory && props.citation ? <span style={{ fontSize: 10.5, color: G.navy, background: C.surface2,
        border: '1px solid ' + G.line, borderRadius: 3, padding: '0 6px', fontWeight: 600 }}>{props.citation}</span> : null}
      {props.exposure ? <span style={{ fontSize: 11, fontWeight: 700, color: C.crit }}>⚠ {props.exposure}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// DecidedByBadge — who decided (spec rule c). by: 'person' | 'statute' | 'system' | 'recorded'
var BY = {
  person:  { bg: '#FFF8E5', fg: '#9A6700', bd: '#D4A72C', dash: false },
  statute: { bg: '#EAF4EF', fg: '#2F6B4F', bd: '#2F6B4F', dash: false },
  system:  { bg: '#F2F6F9', fg: '#143D5C', bd: '#C3CFDA', dash: false },
  recorded:{ bg: '#FFFFFF', fg: '#8A97A3', bd: '#8A97A3', dash: true }
};
export function DecidedByBadge(props) {
  var t = BY[props.by] || BY.recorded;
  return (
    <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, letterSpacing: '.06em',
      textTransform: 'uppercase', borderRadius: 3, padding: '2px 7px', background: t.bg, color: t.fg,
      border: '1px ' + (t.dash ? 'dashed ' : 'solid ') + t.bd, verticalAlign: '1px' }}>
      {props.children}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// SubmittedDescription — the global record-item layout (spec §2.1–2, Kevin 7/28): the requestor's
// VERBATIM text first, bold and larger, under the small title; defect buttons boxed to its LEFT.
// `actions`: the stacked defect-button node (omit → no box, e.g. legal review); `title` overridable
// for the MRR child case ("Item Description as Submitted").
export function SubmittedDescription(props) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: props.margin || '0 0 12px' }}>
      {props.actions ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '7px 8px', flex: 'none',
          border: '1px solid ' + G.line, borderRadius: 6, background: C.surface2 }}>
          {props.actions}
        </div>
      ) : null}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
          color: C.faint, marginBottom: 3 }}>{props.title || 'Request Description as Submitted'}</div>
        <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, lineHeight: 1.45, color: C.ink,
          maxWidth: '72ch' }}>{props.children}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// ParentStrip — the parent-level header strip. `number` mono-bold; children are kv spans.
export function ParentStrip(props) {
  return (
    <div style={{ background: C.surface2, border: '1px solid ' + G.line, borderRadius: 6,
      padding: '8px 12px', display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap',
      marginBottom: 10 }}>
      <span style={{ fontFamily: C.mono, fontWeight: 700, color: G.navy }}>{props.number}</span>
      {props.children}
    </div>
  );
}

// TriggerBadge — "why it's here" (intake exceptions queue; spec §3 screen 1).
export function TriggerBadge(props) {
  return (
    <span style={{ fontSize: 12.5, color: C.muted }}>
      Here because: <b style={{ color: C.ink }}>{props.children}</b>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// GateRow — one line of an evidence-gate checklist (☑ satisfied / ☐ open, amber).
export function GateRow(props) {
  return (
    <div style={{ fontSize: 12.5, padding: '3px 0', color: C.ink, lineHeight: 1.5 }}>
      <span style={{ fontWeight: 700, color: props.ok ? G.statute : G.amberInk }}>{props.ok ? '☑ ' : '☐ '}</span>
      {props.children}
    </div>
  );
}

// ConfirmPopup — the one-act close/confirm dialog (spec §4: every close states what will be
// written and sent; nothing closes on a single click). In-tree fixed overlay, scrim-click closes —
// the WorkTimerCompleteModal pattern, extracted. `actions`: the commit-button node.
export function ConfirmPopup(props) {
  if (!props.open) return null;
  return (
    <div onMouseDown={function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(16,26,42,.45)', zIndex: 60,
        display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ width: 'min(640px, 100%)', background: C.surface, borderRadius: 8,
        border: '2px solid ' + G.navy, boxShadow: '0 10px 34px rgba(20,61,92,.35)', padding: '14px 16px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: G.navy, marginBottom: 8 }}>{props.title}</div>
        {props.children}
        {props.actions ? <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>{props.actions}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// EditInfoFrame — the AI's three routing facts, correctable in place (Draft 1 §0b.5). Display
// state shows `summary` + the edit button; editing state renders labeled selects from `fields`:
// [{ label, value, options: [..], onChange }]. Corrections feed smart routing — say so via `note`.
export function EditInfoFrame(props) {
  return (
    <div style={{ border: '1px solid ' + G.line, borderRadius: 6, padding: '8px 10px',
      marginBottom: 9, background: C.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1, fontSize: 12.5, color: C.muted }}>{props.summary}</span>
        <button type="button" onClick={props.onToggle}
          style={{ cursor: 'pointer', fontSize: 12, padding: '4px 10px', fontWeight: 600, borderRadius: 5,
            background: props.editing ? C.surface : C.surface2,
            color: props.editing ? C.blue : C.ink,
            border: '1px solid ' + (props.editing ? C.blue : G.line) }}>
          {props.editing ? 'Done editing' : 'Edit info below'}
        </button>
      </div>
      {props.editing ? (props.fields || []).map(function (f) {
        return (
          <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7 }}>
            <label style={{ flex: '0 0 180px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '.05em', color: C.muted }}>{f.label}</label>
            <select value={f.value} onChange={function (e) { f.onChange(e.target.value); }}
              style={{ font: 'inherit', fontSize: 13, padding: '5px 8px', maxWidth: 360,
                border: '1px solid ' + G.line, borderRadius: 5, background: C.surface, color: C.ink }}>
              {(f.options || []).map(function (o) {
                return <option key={o.value != null ? o.value : o} value={o.value != null ? o.value : o}>{o.label || o}</option>;
              })}
            </select>
          </div>
        );
      }) : null}
      {props.editing && props.note ? (
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 7 }}>{props.note}</div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// PortalResultsBar — "Self Service Portal Search Results" (extracted from RecordSearchTaskPage's
// inline Bar(), unchanged pixels, so intake review can reuse it — spec §3 screen 1 prelim search).
//   totals: {selected, notSelected, shown} · view: 'selected'|'not' · onView(k)
export function PortalResultsBar(props) {
  var totals = props.totals || { selected: 0, notSelected: 0, shown: 0 };
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
        var on = props.view === t.k;
        return (
          <button key={t.k} type="button" onClick={function () { props.onView(t.k); }}
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
