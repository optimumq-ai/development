import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { C } from '../lib/theme';
import { G, ClockChip, DecidedByBadge, ConfirmPopup, GateRow } from '../components/primitives';

// PHASE 7 / BW7 — THE PARENT FINANCIAL VIEW.
// (docs/DRAFT_processing_ui_parent_financial.md · mockup PROCESSING_UI_draft7_parent_financial.html ·
//  SPEC_processing_ui.md §3 screen 7)
//
// The parent is the request's financial processor and this is its ledger made visible. Kevin's decided
// settlement method (§0, 2026-07-28 r2) is what the middle of this page renders, and the five things below
// are legal or ledger discipline rather than layout:
//
//  1. THE STATEMENT IS THE EVENT STREAM. Never a recomputation. A figure a demand rests on has to be
//     reconstructable from what was recorded at the time, so this page displays `statement.rows` and computes
//     nothing from them. Every line carries its ACTOR, and the REQUESTOR is an EXTERNAL actor — purple badge,
//     because their approval of an estimate is neither the city's decision nor the system's. Verify ≠ Approve.
//  2. FROZEN SHARES, RUNNING BALANCE, VARIANCES THAT GATE NOTHING. The allocation table shows each item's
//     share as it was frozen at acceptance, the funds balance as it stood for that row, and states the
//     own-share-only rule ON THE ROW — because the counter is exactly where a member of staff will be tempted
//     to net a sibling's balance against this one, and §5.9 forbids it.
//  3. NO AUTOMATIC REFUND. The refund control is VISIBLE to the Request Manager and ENABLED only for Finance.
//     Hiding it would leave the RM unable to tell a citizen who to ask; enabling it would give away an
//     authority the RM does not hold. Both states come from the server.
//  4. THE SEND IS A PERSON'S ACT. The reconciliation panel shows the auto-draft and its delta and offers no
//     send of its own — that is the reissue machinery, reached from the estimate surface.
//  5. PAYMENT IS TAKEN AT THE CASH DRAWER. This page LINKS. A second place to take money is a second
//     cash-handling procedure, and cities do not have those.
//
// EVERY NUMBER COMES FROM `/parent-finance/:id/view`. A screen that recomputes a money figure is a second
// implementation of the rule, and the two will disagree the first time one of them is edited.

var btn = { font: 'inherit', fontSize: 13, background: G.navy, color: '#fff', border: 'none',
  borderRadius: 5, padding: '6px 14px', fontWeight: 600, cursor: 'pointer' };
var btnQuiet = Object.assign({}, btn, { background: C.surface2, color: C.ink, border: '1px solid ' + G.line, fontWeight: 500 });
var btnOff = Object.assign({}, btnQuiet, { opacity: 0.5, cursor: 'not-allowed' });
var kv = { fontSize: 12.5, color: C.muted };
var panelHead = { fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
  color: C.muted, marginBottom: 7 };
var panel = { background: C.surface, border: '1px solid ' + G.line, borderRadius: 6, padding: '11px 13px', marginBottom: 12 };
var th = { textAlign: 'left', fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
  color: C.faint, padding: '4px 8px', borderBottom: '1px solid ' + G.line, whiteSpace: 'nowrap' };
var td = { fontSize: 12.5, padding: '6px 8px', borderBottom: '1px solid ' + C.hair, verticalAlign: 'top' };
var mono = { fontFamily: C.mono, fontWeight: 700 };

function money(n) { return (n == null ? '—' : '$' + Number(n).toFixed(2)); }

// The statement's actor column. `external` is the purple family — the requestor's own act.
function ActorBadge(props) {
  var by = props.by || 'recorded';
  var label = by === 'external' ? 'Requestor (external)' : by === 'person' ? 'Person'
    : by === 'system' ? 'System · computed' : by === 'statute' ? 'Statute' : 'Recorded';
  return <DecidedByBadge by={by}>{label}</DecidedByBadge>;
}

export default function ParentFinancialPage() {
  var params = useParams();
  var id = params.requestId || params.id;
  var [v, setV] = useState(null);
  var [err, setErr] = useState(null);
  var [ledger, setLedger] = useState(null);
  var [msg, setMsg] = useState(null);
  var [busy, setBusy] = useState(false);
  var [refundOpen, setRefundOpen] = useState(false);
  var [refundForm, setRefundForm] = useState({ amount: '', method: 'check_request', reference: '' });
  var [settleOpen, setSettleOpen] = useState(false);
  var [holdOpen, setHoldOpen] = useState(null); // { id, held, canHold, blockedReason, citation }
  var [holdNote, setHoldNote] = useState('');

  function load() {
    api.get('/parent-finance/' + id + '/view')
      .then(function (r) {
        setV(r.data);
        // RULE (e). The cross-request chip reads the SAME endpoint the MRR master card reads, so the two
        // screens cannot disagree about whether a requestor has a history.
        if (!r.data.parent.anonymous) {
          api.get('/jurisdiction-profile/ledger/request/' + r.data.parent.id)
            .then(function (x) { setLedger(x.data); }).catch(function () { setLedger(null); });
        }
      })
      .catch(function (e) { setErr((e.response && e.response.data && e.response.data.error) || e.message); });
  }
  useEffect(load, [id]);

  function act(path, body, done) {
    setBusy(true); setMsg(null);
    api.post('/parent-finance/' + id + '/' + path, body || {})
      .then(function (r) { setBusy(false); setMsg(null); if (done) done(r.data); load(); })
      .catch(function (e) {
        setBusy(false);
        setMsg((e.response && e.response.data && e.response.data.error) || e.message);
      });
  }

  // THE ITEM HOLD — THE SECOND DOOR, NOT A SECOND CONTROL (Draft 7 open question 3: keep both).
  // It calls the EXACT endpoints the MRR hub calls, which are the exact `releaseHold` functions with their
  // installment-entitlement prevention guard. Nothing about the hold is reimplemented here — a guarded legal
  // control with two implementations is a control with two behaviours, and one of them will be the wrong one.
  function openHold(rowId) {
    api.get('/mrr/item/' + rowId + '/release')
      .then(function (r) {
        var h = r.data.hold || {};
        setHoldOpen({ id: rowId, held: !!h.held, canHold: h.canHold !== false,
          blockedReason: h.blockedReason || null, citation: h.citation || null,
          neverAPaymentHold: h.neverAPaymentHold || '' });
        setHoldNote('');
      })
      .catch(function (e) { setMsg((e.response && e.response.data && e.response.data.error) || e.message); });
  }
  function submitHold() {
    var h = holdOpen; if (!h) return;
    setBusy(true); setMsg(null);
    api.post('/mrr/item/' + h.id + (h.held ? '/lift-hold' : '/hold'), { note: holdNote })
      .then(function () { setBusy(false); setHoldOpen(null); load(); })
      .catch(function (e) { setBusy(false); setMsg((e.response && e.response.data && e.response.data.error) || e.message); });
  }

  if (err) return <div style={{ padding: 20, color: '#8C3A2B' }}>{err}</div>;
  if (!v) return <div style={{ padding: 20, color: C.muted }}>Loading…</div>;

  var p = v.parent, net = v.netting, rule = v.releaseRule, alloc = v.allocation;
  var rec = v.reconciliation, set = v.settlement, watch = v.watchdog, cap = v.collectionCap;

  return (
    <div style={{ padding: '14px 16px', maxWidth: 1120 }}>

      {/* ── IL FEE FORFEITURE — WARNING ONLY (open question 5, drafted position) ─────────────────── */}
      {v.forfeiture && v.forfeiture.warning ? (
        <div style={{ background: G.amberBg, border: '1px solid ' + G.amberLine, borderLeft: '4px solid ' + G.amberLine,
          borderRadius: 6, padding: '9px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: G.amberInk }}>
            ⚠ This request may no longer be chargeable
          </div>
          <div style={{ fontSize: 12.5, color: C.ink, marginTop: 3, maxWidth: '86ch' }}>{v.forfeiture.reason}</div>
          <div style={Object.assign({}, kv, { marginTop: 3 })}>
            {v.forfeiture.citation} · {v.forfeiture.posture}
          </div>
        </div>
      ) : null}

      {/* ── THE PARENT CARD ─────────────────────────────────────────────────────────────────────── */}
      <div style={{ background: C.surface2, border: '1px solid ' + G.line, borderRadius: 6,
        padding: '10px 13px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={Object.assign({}, mono, { color: G.navy, fontSize: 14 })}>{p.requestNumber}</span>
          <span style={{ fontWeight: 700, color: G.navy, fontSize: 14 }}>Financial view</span>
          <span style={kv}>
            {p.anonymous ? 'Anonymous requestor' : (<b style={{ color: C.ink }}>{p.requestorName}</b>)}
            {p.isMrr ? ' · ' + p.itemCount + ' items' : ' · single record'}
          </span>
          <span style={Object.assign({}, kv, { marginLeft: 'auto' })}>{net.statusLabel || ''}</span>
        </div>

        {/* THE ONE NUMBER PEOPLE COME HERE FOR, and the two that qualify it. */}
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 9 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.faint }}>Balance due</div>
            <div style={Object.assign({}, mono, { fontSize: 22, color: net.balanceDue > 0 ? G.navy : G.statute })}>{money(net.balanceDue)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.faint }}>Billed / paid / credits</div>
            <div style={Object.assign({}, mono, { fontSize: 14, color: C.ink })}>
              {money(net.base)} · {money(net.paidGross)} · {money(net.credits)}
            </div>
          </div>
          {net.refundOutstanding > 0 ? (
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.faint }}>Refund owed back</div>
              <div style={Object.assign({}, mono, { fontSize: 18, color: '#8C3A2B' })}>{money(net.refundOutstanding)}</div>
            </div>
          ) : null}
        </div>
        <div style={Object.assign({}, kv, { marginTop: 4, maxWidth: '92ch' })}>{net.order}</div>

        {/* THE RELEASE RULE, BY NAME. A rule staff have to be able to name is a rule the screen names. */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 9 }}>
          <DecidedByBadge by="statute">Release rule · {rule.label}</DecidedByBadge>
          {(v.clocks || []).length ? v.clocks.map(function (c, i) {
            // A REQUESTOR WINDOW, in requestor-window grammar. It is not a statutory deadline on the city and
            // must never borrow that treatment (spec rule a).
            return (
              <ClockChip key={i} kind="requestor_window" k={c.label || 'Requestor window'}>
                {c.dueDate ? 'Unclaimed until ' + c.dueDate : (c.label || '—')}
              </ClockChip>
            );
          }) : <ClockChip kind="none" k="Requestor window">No collection window running</ClockChip>}
          {/* RULE (e): anonymous shows NO chip — it "does not apply", which is not the same as hidden. */}
          {p.anonymous
            ? <DecidedByBadge by="recorded">Cross-request ledger · anonymous — does not apply</DecidedByBadge>
            : ledger == null
              ? <span style={kv}>Ledger · loading…</span>
              : ledger.anonymous
                ? <DecidedByBadge by="recorded">Cross-request ledger · anonymous — does not apply</DecidedByBadge>
                : <DecidedByBadge by="system">Cross-request ledger · prior balance {ledger.balance && ledger.balance.outstanding != null ? money(ledger.balance.outstanding) : 'none'}</DecidedByBadge>}
        </div>
        <div style={Object.assign({}, kv, { marginTop: 4, maxWidth: '92ch' })}>{rule.note}</div>
        <div style={Object.assign({}, kv, { marginTop: 2, maxWidth: '92ch', color: C.faint })}>{rule.derivedNote}</div>
        {p.anonymous ? <div style={Object.assign({}, kv, { marginTop: 3, maxWidth: '92ch' })}>{v.anonymousNote}</div> : null}
      </div>

      {/* ── THE 20% WATCHDOG — THE ONLY MID-FLIGHT RUNNING NUMBER, AND IT CAPS COLLECTION ────────── */}
      {watch.revisedStatementOutstanding ? (
        <div style={{ background: G.amberBg, border: '1px solid ' + G.amberLine, borderRadius: 6,
          padding: '9px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: G.amberInk }}>
            Updated itemized statement outstanding — collection is capped at {money(watch.lastNotifiedTotal)}
          </div>
          <div style={{ fontSize: 12.5, color: C.ink, marginTop: 3, maxWidth: '90ch' }}>{watch.reason}</div>
          <div style={Object.assign({}, kv, { marginTop: 3 })}>
            {watch.citation} · billable now <b style={{ color: C.ink }}>{money(cap.billable)}</b>
            {cap.forfeited > 0 ? <span> · forfeited unless the statement goes out <b style={{ color: '#8C3A2B' }}>{money(cap.forfeited)}</b></span> : null}
          </div>
        </div>
      ) : null}

      {/* ── PER-ITEM ALLOCATION AND RELEASE — THE CENTREPIECE ───────────────────────────────────── */}
      <div style={panel}>
        <div style={panelHead}>Allocation and release — frozen quoted shares against the funds pool</div>
        {!alloc.hasQuote ? (
          <div style={kv}>No estimate has been priced on this request yet, so there is nothing to allocate.</div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 7 }}>
              <DecidedByBadge by={alloc.frozen ? 'external' : 'recorded'}>
                {alloc.frozen ? 'Shares frozen at acceptance · ' + String(alloc.frozenAt || '').slice(0, 10) : 'Not yet frozen'}
              </DecidedByBadge>
              <span style={kv}>Funds available <b style={Object.assign({}, mono, { color: C.ink })}>{money(alloc.funds.available)}</b>
                {' '}= paid {money(alloc.funds.paid)} − refunds {money(alloc.funds.refunds)} + credits {money(alloc.funds.credits)}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 780 }}>
                <thead>
                  <tr>
                    <th style={th}>Item</th>
                    <th style={th}>Priced subtotal</th>
                    <th style={th}>Quoted share (frozen)</th>
                    <th style={th}>Funds before → after</th>
                    <th style={th}>Release</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {alloc.rows.map(function (r) {
                    return (
                      <tr key={r.id}>
                        <td style={td}>
                          <div style={{ fontWeight: 700, color: G.navy }}>{r.label}</div>
                          {r.componentLabel ? <div style={Object.assign({}, kv, { fontSize: 12 })}>{r.componentLabel}</div> : null}
                          {r.hasUnpricedActuals ? (
                            <div style={{ fontSize: 11.5, color: G.amberInk, marginTop: 2 }}>
                              ⚠ priced at actual — this share is provisional, not free
                            </div>
                          ) : null}
                        </td>
                        <td style={Object.assign({}, td, mono)}>{money(r.componentGross)}</td>
                        <td style={Object.assign({}, td, mono)}>{money(r.quotedShare)}</td>
                        <td style={td}>
                          {r.consumesFunds ? (
                            <span style={mono}>{money(r.fundsBefore)} → {money(r.fundsAfter)}</span>
                          ) : (
                            <span style={kv}>
                              <span style={mono}>{money(r.fundsBefore)}</span> — unchanged
                            </span>
                          )}
                          <div style={Object.assign({}, kv, { fontSize: 11.5, marginTop: 2 })}>
                            {r.consumesFunds ? ('Shipped (' + r.shipEvidence + ') — its share drew the pool down.')
                              : (r.neverShippedRule || 'Not shipped yet — draws nothing.')}
                          </div>
                        </td>
                        <td style={td}>
                          {r.covered === null ? <span style={kv}>—</span>
                            : r.covered
                              ? <DecidedByBadge by="system">Covered</DecidedByBadge>
                              : <DecidedByBadge by="system">Short {money(r.balanceOnThisItem)}</DecidedByBadge>}
                          <div style={Object.assign({}, kv, { fontSize: 11.5, marginTop: 3, maxWidth: '46ch' })}>{r.ownShareRule}</div>
                          {r.coverageBasis ? <div style={Object.assign({}, kv, { fontSize: 11, marginTop: 2, color: C.faint })}>basis: {r.coverageBasis}</div> : null}
                        </td>
                        <td style={td}>
                          {/* THE ITEM HOLD — reusing releaseHold VERBATIM, guarded there. Two doors decided
                              (here and the MRR hub), one evaluator: when it refuses, its refusal is shown as
                              written. A paraphrased legal refusal is a different refusal. */}
                          <button type="button" onClick={function () { openHold(r.id); }} style={btnQuiet}>Hold…</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={Object.assign({}, kv, { marginTop: 7, maxWidth: '96ch' })}>{alloc.explain}</div>
            <div style={Object.assign({}, kv, { marginTop: 4, maxWidth: '96ch' })}>{alloc.frozenNote}</div>
            <div style={Object.assign({}, kv, { marginTop: 4, maxWidth: '96ch' })}>{alloc.varianceRule}</div>
            <div style={Object.assign({}, kv, { marginTop: 4, maxWidth: '96ch' })}>{alloc.gatesWorkNote}</div>
          </div>
        )}
      </div>

      {/* ── THE LAST RECORD SETTLES THE REQUEST ─────────────────────────────────────────────────── */}
      {set.isMrr ? (
        <div style={panel}>
          <div style={panelHead}>Settlement — the last record settles the request</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
            {set.settled
              ? <DecidedByBadge by="person">Settled {String(set.settled.at || '').slice(0, 10)} · {set.settled.outcome}</DecidedByBadge>
              : set.ready
                ? <DecidedByBadge by="recorded">Ready to settle</DecidedByBadge>
                : <DecidedByBadge by="recorded">Not yet — {set.terminalCount} of {set.itemCount} items terminal</DecidedByBadge>}
            {set.neverShippedCount > 0 ? (
              <span style={kv}>{set.neverShippedCount} item(s) ended without shipping — their shares never consumed funds.</span>
            ) : null}
          </div>
          <div style={Object.assign({}, kv, { marginTop: 6, maxWidth: '96ch' })}>{set.reason}</div>
          <div style={{ marginTop: 8 }}>
            <GateRow ok={set.terminalCount === set.itemCount || (set.lastRecord != null)}>
              Every sibling terminal — {set.terminalCount} of {set.itemCount}
            </GateRow>
            <GateRow ok={!!(set.lastRecordActuals && set.lastRecordActuals.in)}>
              The last record’s own actuals in
              {set.lastRecordActuals && set.lastRecordActuals.remainingBillableTasks > 0
                ? ' — ' + set.lastRecordActuals.remainingBillableTasks + ' billable task(s) still in flight'
                : (set.lastRecordActuals && !set.lastRecordActuals.hasMeasured
                  ? ' — no measured labor (capture off or skipped); the quoted quantities stand'
                  : '')}
            </GateRow>
          </div>
          <div style={Object.assign({}, kv, { marginTop: 7, maxWidth: '96ch' })}>{set.branches}</div>
          <div style={Object.assign({}, kv, { marginTop: 4, maxWidth: '96ch', color: C.faint })}>{set.footnote}</div>
          <div style={{ marginTop: 9, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" disabled={!v.canSettle || busy} onClick={function () { setSettleOpen(true); }}
              style={v.canSettle && !busy ? btn : btnOff}>Settle the request…</button>
            {!v.canAct ? <span style={kv}>Settling is ORO Finance’s act.</span> : null}
          </div>
        </div>
      ) : null}

      {/* ── RECONCILIATION — THE DRAFT IS VISIBLE; THE SEND IS A PERSON'S ACT ───────────────────── */}
      <div style={panel}>
        <div style={panelHead}>Reconciliation — measured against estimated</div>
        {!rec.has ? (
          <div style={kv}>Nothing has been reconciled on this request yet.</div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
              {rec.autoDraft
                ? <DecidedByBadge by="system">Auto-draft · not sent</DecidedByBadge>
                : <DecidedByBadge by="person">{rec.notifiedAt ? 'Sent ' + String(rec.notifiedAt).slice(0, 10) : 'Recorded by a person'}</DecidedByBadge>}
              <span style={kv}>
                Estimate <b style={Object.assign({}, mono, { color: C.ink })}>{money(rec.baselineTotal)}</b>
                {' → revised '}<b style={Object.assign({}, mono, { color: C.ink })}>{money(rec.total)}</b>
                {rec.variancePct != null ? <span> ({rec.variancePct >= 0 ? '+' : ''}{rec.variancePct}%)</span> : null}
              </span>
              {rec.reNotifyRequired ? <DecidedByBadge by="statute">Revised notice required</DecidedByBadge> : null}
            </div>
            <div style={Object.assign({}, kv, { marginTop: 6 })}>
              Measured labor {rec.measuredHours.searchHours}h search · {rec.measuredHours.reviewHours}h review
              {rec.estimatedHours ? (
                <span> against estimated {rec.estimatedHours.searchHours}h · {rec.estimatedHours.reviewHours}h</span>
              ) : null}
              {!rec.hasMeasured ? ' — no measured labor captured; the quoted quantities stand.' : ''}
            </div>
            {rec.autoDraftNote ? <div style={Object.assign({}, kv, { marginTop: 4, maxWidth: '96ch' })}>{rec.autoDraftNote}</div> : null}
            <div style={Object.assign({}, kv, { marginTop: 4, maxWidth: '96ch' })}>{rec.sendNote}</div>
            <div style={{ marginTop: 8 }}>
              <Link to={'/requests/' + p.id + '/estimate'} style={Object.assign({}, btnQuiet, { textDecoration: 'none' })}>
                Estimate versions &amp; revised notice…
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* ── THE STATEMENT — EVENTED, NEVER RECOMPUTED ───────────────────────────────────────────── */}
      <div style={panel}>
        <div style={panelHead}>Statement</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>What</th>
                <th style={th}>Amount</th>
                <th style={th}>Who</th>
                <th style={th}>Status it produced</th>
              </tr>
            </thead>
            <tbody>
              {v.statement.rows.length === 0 ? (
                <tr><td style={td} colSpan={5}><span style={kv}>No money events recorded on this request yet.</span></td></tr>
              ) : v.statement.rows.map(function (e) {
                return (
                  <tr key={e.id}>
                    <td style={Object.assign({}, td, kv, { whiteSpace: 'nowrap' })}>{String(e.at || '').slice(0, 16)}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 700, color: C.ink }}>{e.type}</div>
                      {e.reason ? <div style={Object.assign({}, kv, { maxWidth: '62ch' })}>{e.reason}</div> : null}
                      {e.reference ? <div style={Object.assign({}, kv, { fontSize: 11, color: C.faint })}>ref {e.reference}</div> : null}
                      {e.actorNote ? <div style={Object.assign({}, kv, { fontSize: 11.5, marginTop: 2 })}>{e.actorNote}</div> : null}
                    </td>
                    <td style={Object.assign({}, td, mono, { whiteSpace: 'nowrap' })}>{e.amount != null ? money(e.amount) : '—'}</td>
                    <td style={td}>
                      <ActorBadge by={e.decidedBy} />
                      <div style={Object.assign({}, kv, { fontSize: 11.5, marginTop: 3 })}>
                        {e.actor || '—'}{e.approver ? ' · approved by ' + e.approver : ''}
                      </div>
                    </td>
                    <td style={Object.assign({}, td, kv)}>{e.statusLabel || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={Object.assign({}, kv, { marginTop: 7, maxWidth: '96ch' })}>{v.statement.discipline}</div>
      </div>

      {/* ── CREDITS AND THE REFUND RAIL ─────────────────────────────────────────────────────────── */}
      <div style={panel}>
        <div style={panelHead}>Credits and refunds</div>
        {v.adjustments.length === 0 ? (
          <div style={kv}>No credits or refunds on this request.</div>
        ) : v.adjustments.map(function (a) {
          return (
            <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap',
              padding: '5px 0', borderBottom: '1px solid ' + C.hair }}>
              <span style={Object.assign({}, mono, { color: a.type === 'refund' ? '#8C3A2B' : G.statute, minWidth: 88 })}>
                {a.type === 'refund' ? '−' : '+'}{money(a.amount)}
              </span>
              <DecidedByBadge by="person">{a.type}</DecidedByBadge>
              <span style={Object.assign({}, kv, { flex: '1 1 320px', minWidth: 240 })}>{a.reason}</span>
              <span style={Object.assign({}, kv, { fontSize: 11.5 })}>
                {a.actor || '—'}{a.method ? ' · ' + a.method : ''}{a.reference ? ' · ' + a.reference : ''}
              </span>
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 9 }}>
          <span style={kv}>Refund owed back <b style={Object.assign({}, mono, { color: C.ink })}>{money(net.refundOutstanding)}</b></span>
          {/* VISIBLE TO THE RM, ENABLED ONLY FOR FINANCE — both states decided server-side. */}
          <button type="button" disabled={!v.refundEnabled || busy} onClick={function () { setRefundOpen(true); }}
            style={v.refundEnabled && !busy ? btn : btnOff}>Issue refund…</button>
          <span style={Object.assign({}, kv, { flex: '1 1 340px', minWidth: 260 })}>
            {v.canAct
              ? (net.refundOutstanding > 0 ? net.refundRule : 'No refund is due — credits reduce the open balance first.')
              : v.actNote}
          </span>
        </div>
      </div>

      {/* ── THE RAIL ────────────────────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* PAYMENT IS TAKEN AT THE CASH DRAWER. A link, never a second till. */}
        <Link to={v.cashDrawer.path} style={Object.assign({}, btn, { textDecoration: 'none' })}>Take payment → Cash Drawer</Link>
        <Link to={'/requests/' + p.id} style={Object.assign({}, btnQuiet, { textDecoration: 'none' })}>Request record</Link>
        <Link to={'/requests/' + p.id + '/estimate'} style={Object.assign({}, btnQuiet, { textDecoration: 'none' })}>Estimate versions</Link>
        <Link to={'/requests/' + p.id + '/history'} style={Object.assign({}, btnQuiet, { textDecoration: 'none' })}>Event log</Link>
      </div>
      <div style={Object.assign({}, kv, { marginTop: 6, maxWidth: '96ch' })}>{v.cashDrawer.note}</div>
      {msg ? <div style={{ fontSize: 12.5, color: '#8C3A2B', marginTop: 8, maxWidth: '96ch' }}>{msg}</div> : null}

      {/* ── REFUND — WHAT WILL BE WRITTEN, BEFORE IT IS WRITTEN ─────────────────────────────────── */}
      <ConfirmPopup open={refundOpen} title="Record a refund" onClose={function () { setRefundOpen(false); }}
        actions={
          <React.Fragment>
            <button type="button" disabled={busy} style={busy ? btnOff : btn}
              onClick={function () {
                act('refund', { amount: Number(refundForm.amount), method: refundForm.method, reference: refundForm.reference },
                  function () { setRefundOpen(false); });
              }}>Record the refund</button>
            <button type="button" style={btnQuiet} onClick={function () { setRefundOpen(false); }}>Cancel</button>
          </React.Fragment>
        }>
        <div style={{ fontSize: 12.5, color: C.ink, maxWidth: '80ch' }}>
          <b>{money(net.refundOutstanding)}</b> is owed back on this request. This records that a refund was authorized —
          <b> it does not move any money</b>. The funds move in the city’s finance system, and the reference below is how
          the two records find each other.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 9 }}>
          <input value={refundForm.amount} placeholder="Amount" onChange={function (e) { setRefundForm(Object.assign({}, refundForm, { amount: e.target.value })); }}
            style={{ font: 'inherit', fontSize: 13, padding: '5px 8px', width: 110, border: '1px solid ' + G.line, borderRadius: 5 }} />
          <select value={refundForm.method} onChange={function (e) { setRefundForm(Object.assign({}, refundForm, { method: e.target.value })); }}
            style={{ font: 'inherit', fontSize: 13, padding: '5px 8px', border: '1px solid ' + G.line, borderRadius: 5 }}>
            <option value="check_request">Check request</option>
            <option value="card_reversal">Card reversal</option>
            <option value="credit_to_account">Credit to account</option>
          </select>
          <input value={refundForm.reference} placeholder="Finance reference number"
            onChange={function (e) { setRefundForm(Object.assign({}, refundForm, { reference: e.target.value })); }}
            style={{ font: 'inherit', fontSize: 13, padding: '5px 8px', width: 240, border: '1px solid ' + G.line, borderRadius: 5 }} />
        </div>
        <div style={Object.assign({}, kv, { marginTop: 7 })}>
          Both fields are required. A refund with no method and no reference cannot be proved to have happened.
        </div>
      </ConfirmPopup>

      {/* ── SETTLE — STATES BOTH BRANCHES BEFORE IT RUNS ────────────────────────────────────────── */}
      <ConfirmPopup open={settleOpen} title="Settle the request" onClose={function () { setSettleOpen(false); }}
        actions={
          <React.Fragment>
            <button type="button" disabled={busy} style={busy ? btnOff : btn}
              onClick={function () { act('settle', {}, function () { setSettleOpen(false); }); }}>Run the settlement</button>
            <button type="button" style={btnQuiet} onClick={function () { setSettleOpen(false); }}>Cancel</button>
          </React.Fragment>
        }>
        <div style={{ fontSize: 12.5, color: C.ink, maxWidth: '82ch' }}>
          This runs the aggregate actuals through the fee engine <b>once</b> and produces the adjusted final invoice or a
          refund — exactly as a single-record request does. A request settles once; it cannot be re-run.
        </div>
        <div style={{ marginTop: 8 }}>
          <GateRow ok>If it leaves a balance, the last record is <b>held</b> until that payment.</GateRow>
          <GateRow ok>If it nets to a refund or to zero, the last record <b>releases immediately</b>.</GateRow>
          <GateRow ok={!watch.revisedStatementOutstanding}>
            {watch.revisedStatementOutstanding
              ? 'Unnotified overage will NOT be billed: collection is capped at ' + money(watch.lastNotifiedTotal) + ' (' + watch.citation + ').'
              : 'Nothing caps the final invoice — the requestor has been told the current number.'}
          </GateRow>
        </div>
      </ConfirmPopup>

      {/* ── ITEM HOLD — releaseHold's REFUSAL, VERBATIM ─────────────────────────────────────────── */}
      <ConfirmPopup open={!!holdOpen} title={holdOpen && holdOpen.held ? 'Lift the release hold' : 'Hold this record'}
        onClose={function () { setHoldOpen(null); }}
        actions={
          <React.Fragment>
            <button type="button" disabled={busy || (holdOpen && !holdOpen.held && !holdOpen.canHold)}
              style={(busy || (holdOpen && !holdOpen.held && !holdOpen.canHold)) ? btnOff : btn}
              onClick={submitHold}>{holdOpen && holdOpen.held ? 'Lift the hold' : 'Place the hold'}</button>
            <button type="button" style={btnQuiet} onClick={function () { setHoldOpen(null); }}>Cancel</button>
          </React.Fragment>
        }>
        {holdOpen ? (
          <div>
            {!holdOpen.held && !holdOpen.canHold ? (
              <div style={{ background: G.amberBg, border: '1px solid ' + G.amberLine, borderRadius: 6, padding: '8px 10px' }}>
                {/* VERBATIM. A paraphrased legal refusal is a different refusal. */}
                <div style={{ fontSize: 12.5, color: C.ink, maxWidth: '80ch' }}>{holdOpen.blockedReason}</div>
                <div style={Object.assign({}, kv, { marginTop: 4 })}>{holdOpen.citation}</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 12.5, color: C.ink, maxWidth: '82ch' }}>
                  A hold always needs a note, and the note is the record. {holdOpen.neverAPaymentHold}
                </div>
                <textarea value={holdNote} onChange={function (e) { setHoldNote(e.target.value); }} rows={3}
                  placeholder="Why is this record being held?"
                  style={{ font: 'inherit', fontSize: 13, padding: '6px 8px', width: '100%', marginTop: 8,
                    border: '1px solid ' + G.line, borderRadius: 5 }} />
              </div>
            )}
          </div>
        ) : null}
      </ConfirmPopup>
    </div>
  );
}
