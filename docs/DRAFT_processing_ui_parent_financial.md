# DRAFT — Processing UI, session 1 (screen 7): the Parent Financial View

**Status:** DESIGN DRAFT for Kevin's markup, 2026-07-28. Not a spec, not for build. Sibling of
drafts 1c–6; becomes part of `SPEC_processing_ui.md` when the shape settles.
**Mockup:** `docs/mockups/PROCESSING_UI_draft7_parent_financial.html` (tracked; viewing copy in
`/home/optimumq/exchange`) — one screen, continuing R-2421 post-estimate. Single city; WA/OH/IL
differences are annotations.

The BUILD item from the phase-screen inventory ("Parent financial view — CashDrawerPage covers
payment-taking"), plus the **refund/credit path Draft 2 flagged** (a later denial shrinking a paid
deliverable). The parent is the request's financial processor; this is its ledger made visible.

---

## 0. THE MRR SETTLEMENT METHOD — decided with Kevin, 2026-07-28 (round 2)

Kevin caught the real problem with per-item allocation on an MRR: the aggregate pricing vehicles
mean a per-item "actual" cost does not exist until every child has actuals — so a release gate that
consults actuals is provisional, order-dependent, and an accounting method no city runs. The
decided method ("simple, not perfect, adequate"):

1. **Quoted shares are frozen at estimate acceptance** (§5.10.2 prorata, computed once). Actuals
   never touch the release gate; variances accumulate silently for the end.
2. **Release check = running funds balance.** paid − Σ quoted shares of records already shipped;
   a ready record ships when the balance covers its quoted share (this IS the cumulative-FIFO rule
   the code flags as required). A denied / never-shipped record's share never consumes funds.
3. **The last record settles the request.** Trigger: the last record becomes *ready* (all siblings
   terminal, its own actuals in). Aggregate actuals run through the same engine once → the adjusted
   final invoice or refund, **exactly as for a non-MRR** — the last record is held until that
   payment, or **releases immediately when the adjustment nets to refund or zero**.
4. **The only mid-flight running number is parent-level:** the 20% overage watchdog (§552.2615)
   feeding the existing updated-statement/reissue machinery — which also **caps what the final
   invoice may collect** (unnotified overage is forfeited; the screen refuses to bill it).
5. **Allocation basis stays dollar-prorata** (page-weighted / vehicle-aware allocation considered
   and declined: half the vehicles are surcharges or step functions, and with the gate frozen,
   allocation precision no longer affects release). Per-category ratios remain a possible later
   refinement, out of v1.
6. **Credit classes:** credits valued purely in quoted numbers (e.g. withheld pages at the quoted
   allocation) post when their cause occurs; anything derived from measured actuals waits for the
   terminal settlement.
7. **Documented §5.9 footnote:** a purist reading would hold the last record only for its own
   adjusted share; final-delivery-against-final-payment is the standard regime deposits were
   designed around, the invoice issues the moment the record is ready, and the 20% rule bounds the
   exposure. Adopted with the reasoning recorded.

## 1. The shape

- **Parent card:** balance due, release rule by name (`pay_in_full` TX / `per_installment` WA —
  the WA unclaimed-installment edge modeled and labeled, re-check flagged), the 60-day unclaimed
  requestor-window chip, cross-request ledger chip.
- **Statement:** evented, never recomputed (class-A ledger discipline — a figure a demand rests on
  must be reconstructable). Every line carries its actor: requestor approval (purple external-actor
  badge — Verify ≠ Approve), person acts (credit approval, revised-notice send), system
  computations with basis.
- **Per-item allocation & release table** — the centerpiece, now running Kevin's method (§0):
  quoted shares (frozen, ×ratio, gross visible, requestor-explainable sentence), the running funds
  balance shown per row ($200 → $136 → $58), variances explicitly not touching the gate, the
  own-share-only rule stated where staff will be tempted to override it, and the funds check
  gating **release, never work**. A "last record settles the request" panel shows both settlement
  branches (balance-due hold / refund-releases-immediately) and the 20% collection cap.
- **Reconciliation:** auto-draft when the last billable task finalizes (measured 2.1 h vs estimated
  3.0 h → revised total); the send is a person's act; the delta rides one revised communication.
- **Refund/credit path (new design):** recompute → evented credit cited to its cause ("item 2: 40
  pages withheld per legal determination") → credits net against a remaining balance automatically →
  a **refund exists only when credits exceed balance**, issued by ORO Finance, method recorded,
  never automatic. Credits fold into the next communication — the one-notice principle applied to
  money flowing back.
- **Rail:** Take payment → Cash Drawer (link, never duplicate) · revised-notice send · refund
  (visible to the RM, enabled only for Finance) · guarded item-hold · estimate versions · event log.

## 2. Bindings

| Surface | Binds to |
|---|---|
| Statement | `paymentStatus.recordEvent` event stream + estimate versions (`fee_estimates`, `kind='reconciliation'`) + Cash Drawer receipts |
| Allocation | `feeEngine.compute()` componentGross + §5.10.2 `componentCharged` prorata (in the priced snapshot) |
| Coverage | `feeRelease.releaseGate()` (built, `bd9befa`) + the flagged cumulative-FIFO upgrade (§5.10.3) |
| Release rule | per-jurisdiction `payment_release_rule` (`pay_in_full` default / `per_installment` WA) |
| Reconciliation | Slice E/H machinery: `laborActuals` readout (`GET /fee-estimates/request/:id`), auto-draft (`created_by='(auto-draft)'`, `notified_at NULL`), `feeReissue` human-gated send |
| Credits / refunds | NEW: credit events (cause-cited) posted on withholding/reconciliation recompute; refund action gated to ORO Finance (`FINANCE`), method recorded |
| Clock chip | `nonpayment_window` (requestor_window kind) via `computeStatus` |
| IL guardrail | fee-forfeiture warning surfaces as a banner when response is late — charges the screen must refuse to demand |

## 3. Compliance treatments

Rule (a): the only clock here is a requestor window, outline treatment. Rule (c): every money event
carries decided-by; the requestor's approval is an external actor's act (purple badge family from
Draft 4); refunds/credits are person-approved with the system doing only arithmetic. Rule (e):
anonymous requests show no cross-request chip — "does not apply". §5.9's sibling rule and §5.10.2's
prorata are rendered with their reasoning on the row, because the counter is where they will be
second-guessed.

## 4. Build implications (if the shape survives)

1. **Credit events**: a `credit` event type on the payment stream, cause-cited (withholding ref /
   reconciliation ref); netting logic (credits reduce balance; refund-due = max(0, credits −
   balance-after-payments)).
2. **Refund action**: FINANCE-gated route + method record; no execution integration in v1 (check
   request / card reversal recorded, performed in the city's finance system).
3. **Cumulative FIFO coverage** (already flagged in-code) becomes a hard prerequisite this screen
   depends on for MRR truthfulness.
4. **Withholding → recompute hook**: legal determination reducing a delivered set triggers the
   item's gross/charged recompute + credit event (connects Draft 3/4 outcomes to money).
5. **Screen route** from MRR hub / request header / Cash Drawer receipt line; RM read, Finance act.

## 5. Open questions for Kevin

1. **Where does the revised notice live** — drafted as sent from here (it's a money communication);
   or should send stay on the estimate screen (Draft 2) with this view read-only?
2. **Refund execution** — is record-only (method + reference number) enough for v1, with the actual
   movement in the city's finance system?
3. **Item-hold control** — drafted here *and* on the MRR hub (same guarded control, two doors).
   Keep both, or hub-only?
4. **Requestor-facing allocation** — should the per-item charged/explanation table also render in
   the requestor's portal view of the estimate, or staff-side only for now?
5. **IL forfeiture banner** — warning-only (drafted), or should it hard-disable Take-payment for
   forfeited charges?

## 6. Not re-opened

§5.9 coverage (built), §5.10.2 prorata (decided), the reconciliation machinery and its human-gated
send, Cash Drawer as the payment-taking surface, class-A ledger eventing, no parent disposition.
