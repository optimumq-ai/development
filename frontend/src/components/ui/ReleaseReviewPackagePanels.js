import React from 'react';
import { C } from '../../lib/theme';
import { G, ClockChip, DecidedByBadge, SubmittedDescription, ParentStrip } from '../primitives';

// PHASE 7 / BW8 — the reviewable substance, on the surface (Draft 9 §2 / Frame B). One component,
// two doors: the single-task screen and power mode render THIS, so the slow path and the fast path
// cannot show a reviewer different evidence. Everything here comes assembled from
// GET /tasks/:id/release-package — the screen adds layout and nothing else.

function panel(title, body, key) {
  return (
    <div key={key} style={{ background: C.surface, border: '1px solid ' + G.line, borderRadius: 8, padding: '11px 14px', marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: G.navy, marginBottom: 7 }}>{title}</div>
      {body}
    </div>
  );
}

function fmtSize(n) {
  if (n == null) return '';
  if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n > 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

export default function ReleaseReviewPackagePanels(props) {
  var pkg = props.pkg;
  if (!pkg) return null;
  var strip = pkg.strip || {};
  var clock = strip.clock;
  var pipe = strip.pipeline || {};
  var files = (pkg.releasedSet && pkg.releasedSet.files) || [];
  var wl = (pkg.withholdingLog && pkg.withholdingLog.entries) || [];
  var withCite = wl.filter(function (e) { return e.citation; }).length;
  var ledger = pkg.flags && pkg.flags.ledger;
  var advisories = (ledger && ledger.advisories) || [];

  return (
    <div>
      <ParentStrip number={strip.requestNumber || '—'}>
        <span style={{ fontSize: 12.5, color: C.muted }}><b style={{ color: C.ink }}>{strip.requestorName || 'Anonymous requestor'}</b>{strip.deliveryMethod ? ' · delivery: ' + strip.deliveryMethod : ''}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          {clock ? (
            <ClockChip kind={clock.kind} k={clock.label} citation={clock.citation}
              exposure={clock.isOverdue ? clock.overdueMeaning : null}>
              {clock.dueDate || 'no date'}
            </ClockChip>
          ) : <ClockChip kind="none" k="No clock">none on this request</ClockChip>}
          <span style={{ fontSize: 12, color: C.muted }}>
            pipeline: {pipe.eligible ? 'all conditions hold' : (pipe.readyPendingReview ? 'ready — pending this review' : 'conditions open')} · balance ${Number(pipe.balanceDue || 0).toFixed(2)}
          </span>
        </span>
      </ParentStrip>

      <SubmittedDescription>{strip.description || '—'}</SubmittedDescription>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>
          {panel('Released set — ' + (pkg.releasedSet ? pkg.releasedSet.count : 0) + ' record(s)' +
                 (pkg.withholdingLog && pkg.withholdingLog.count ? ' (redacted)' : ''), (
            files.length ? files.map(function (f) {
              return <div key={f.id} style={{ fontSize: 12.5, color: C.muted, padding: '2px 0' }}>
                📄 <span style={{ color: C.ink }}>{f.name}</span>{f.size ? ' · ' + fmtSize(f.size) : ''}</div>;
            }) : <div style={{ fontSize: 12.5, color: C.crit }}>No responsive records are attached — an empty release should not be approved without asking why.</div>
          ), 'set')}

          {panel('Withholding log — what needs your eyes', (
            <div>
              {wl.length ? wl.map(function (e, i) {
                return (
                  <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline', padding: '4px 0', borderBottom: i < wl.length - 1 ? '1px solid ' + C.surface2 : 'none' }}>
                    <span style={{ fontFamily: C.mono, fontSize: 11.5, fontWeight: 700, color: G.navy, flex: 'none' }}>p. {e.pageNo}</span>
                    <span style={{ fontSize: 12.5, color: C.ink }}>
                      {e.ruleTitle || e.note || 'Redaction'}
                      {e.note && e.ruleTitle ? <span style={{ color: C.muted }}> — {e.note}</span> : null}
                      {e.citation
                        ? <span style={{ fontSize: 10.5, color: G.navy, background: C.surface2, border: '1px solid ' + G.line, borderRadius: 3, padding: '0 6px', fontWeight: 600, marginLeft: 6 }}>{e.citation}</span>
                        : <span style={{ fontSize: 11, color: G.amberInk, marginLeft: 6 }}>no citation on the rule — the authority is not on record</span>}
                      {e.createdBy ? <span style={{ fontSize: 11, color: C.faint }}> · {e.createdBy}</span> : null}
                    </span>
                  </div>
                );
              }) : <div style={{ fontSize: 12.5, color: C.muted }}>No redactions on this set — nothing is being withheld.</div>}
              {wl.length ? (
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
                  {wl.length} withholding(s) · {withCite === wl.length ? 'every one carries its authority' : withCite + ' carry citations'} · the full inventory rides the notice.
                </div>
              ) : null}
            </div>
          ), 'wl')}

          {panel('The notice, as the requestor receives it', (
            pkg.notice ? (
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 6 }}>{pkg.notice.subject}</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12.5, color: C.ink, lineHeight: 1.5, background: C.surface2, border: '1px solid ' + G.line, borderRadius: 6, padding: '9px 12px' }}>{pkg.notice.text}</pre>
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
                  {pkg.notice.willSendTo
                    ? 'Sends to ' + pkg.notice.willSendTo + ' as part of the release event — one communication, one act.'
                    : (pkg.notice.sendNote || 'No address on file — an emailed notice does not apply.')}
                  {' '}{pkg.notice.deliveredAtNote}
                </div>
              </div>
            ) : <div style={{ fontSize: 12.5, color: C.crit }}>The notice could not be assembled — do not approve what you cannot read.</div>
          ), 'notice')}
        </div>

        <div style={{ flex: '0 1 250px', minWidth: 220 }}>
          {panel('Flags on this item', (
            <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 2 }}>
              {pkg.flags && pkg.flags.hold ? <div><DecidedByBadge by="person">Hold</DecidedByBadge> <span style={{ color: C.crit }}>{pkg.flags.hold}</span></div> : null}
              {advisories.length ? advisories.map(function (a, i) {
                return <div key={i}><DecidedByBadge by="recorded">Ledger · advisory</DecidedByBadge> {a.summary || a.counter}</div>;
              }) : <div><DecidedByBadge by="system">Ledger</DecidedByBadge> {ledger && ledger.reason ? ledger.reason : 'nothing recorded against this requestor.'}</div>}
              {!(pkg.flags && pkg.flags.hold) && !advisories.length ? <div style={{ marginTop: 2 }}>Nothing amber — nothing pending anywhere on this item.</div> : null}
            </div>
          ), 'flags')}

          {panel('This act is yours', (
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
              Approving fires the release event — <b style={{ color: C.ink }}>Closed – Delivered</b>, <code>delivered_at</code>, the notice — recorded as you, this item, this moment.
              Audit-identical to opening the task the slow way. No bulk-approve exists; the unit of action is one item, always.
            </div>
          ), 'yours')}
        </div>
      </div>
    </div>
  );
}
