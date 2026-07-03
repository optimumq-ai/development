# Request Financial Profile — Design Note

Status: DESIGN (not yet built). Author: pairing session 2026-07-02.
Related: FEE_PAYMENT_SETTLEMENT_DESIGN.md, FEE_ESTIMATE_OBJECTION_DESIGN.md,
FEE_ESTIMATE_VARIABLE_MAP.md, FEE_ESTIMATE_KNOWLEDGE.md, DEADLINE_TOLLING_DESIGN.md,
BACKLOG.md (R1/R2). Also the parked "two-track status model" discussion (this note
absorbs the *payment* half of it).

## 1. Intent

A single, per-request, fully explainable view of everything financial about a request:
how the fee was computed, the estimate, what is owed and when (deposit vs final), the
estimate-to-actual adjustment, the running balance, and a dated payment-status timeline.

The goal is understanding — internally and for the requestor. Public-records offices spend
real time on the phone explaining "why do I owe this / why was nothing due / why must I pay
in full before I get anything / why did the cost change." A profile that *shows its work*,
including the rules that did NOT apply, is meant to remove most of that back-and-forth. This
is also a strong demo artifact: transparency that visibly reduces requestor friction.

## 2. Core principle — one object, several renderers

There is **one** Financial Profile object per request (a derived projection, not a new stored
calculation). It is rendered for different audiences and channels, which differ ONLY in the
operational envelope and the framing — **never in the numbers**:

- **Staff screen** — the full profile plus the operational envelope (below).
- **Requestor / portal screen** — the computation core + plain-language framing + what-you-owe.
- **Estimate email** — sent when the initial estimate is created.
- **Estimate-to-actual adjustment email** — sent when reconciliation completes.
- **First-payment-received update email** — LOW PRIORITY.

Because the email a requestor receives *is* the profile, the screen and the email can never
disagree. Single source of truth, projected per context.

## 3. Leverage — what already exists

The deterministic fee engine (`backend/src/services/feeEngine.js`, `compute(profile, request)`)
already emits ~75% of the profile and is explicitly designed to be explainable:

- Itemized per-component line items (each record type / driver) with per-line reasons
  (e.g. "Not chargeable until pages exceed 50, currently 30").
- Request-level rule outcomes: `floorApplied`, `ceilingApplied`, `deMinimisWaived`,
  `freeAllowances`, `estimateNotifyTriggered`.
- Plain-language `depositBasis` (e.g. "50% of $120.00 (estimate exceeds $100)").
- Runs in ESTIMATE and FINAL modes, so estimate vs reconciled actual come from the same code.

Also reusable: the estimate/notice generators (`feeNotice` / `buildNotice`, band-specific
requestor language, balance-due notice), the payment ledger (`fee_payments`), ERP tracking
(`erp_charges`), and approved-objection credits already folded into `paymentState`.

So this feature is mostly (a) surfacing what `compute()` already returns, (b) one additive
engine change (Section 4), and (c) a payment-status timeline (Section 5). It is NOT a second
calculator.

## 4. The one engine change — the explanation trace

Today the engine emits *that* a rule fired (`floorApplied: true`) but not the configured value
or the reason when it did NOT fire. All the values (minFee, maxFee, deMinimis, deposit
threshold/percent, allowances, surcharge, labor billability) are already in scope at decision
time; they are simply not emitted for the not-applied case.

Add a structured **explanation trace**: for EVERY request-level rule, emit
`{ rule, configuredValue, applied, effect, plainLine }` whether or not it fired. Examples:

- "Minimum fee: $40 configured — total $120 exceeded it, no floor applied."
- "Maximum fee: $500 configured — not reached."
- "De minimis waive under $10 — not triggered."
- "Search labor: $0.00 — not chargeable in this jurisdiction." (see Section 8)
- "Deposit: 50% of $120 (estimate exceeds $100) — $60 due before work."

**Principle: the profile is GENERATED from the engine's own trace, never a hand-authored
template.** A template mirroring the rules would drift the moment the AI configures a new rule
(e.g. a commercial surcharge). A rendering of the trace shows any rule the engine evaluates,
automatically, with zero extra work. (Same "generate from the model, don't draw it by hand"
discipline chosen for the dashboard.)

## 5. Payment-status timeline (event log)

The profile is where **payment status is computed and stored** — as an immutable, dated event
log. Each transition appends an event; the current payment status is simply the latest event.
This gives both the full journey (for the demo and for the requestor's understanding) and the
current state. Other UIs (request queue, dashboard) REFERENCE this rather than recomputing.

This is the **payment half of the parked two-track status model.** The *processing* half
(Record Search / Redaction / Processing Complete / Delivered, plus a non-linear Closed node)
stays a separate workflow concern and is out of scope for this note; the money half lands here.

Illustrative payment-status vocabulary (to be finalized with the two-track status note):

- No path: **No Deposit Required** -> (on completion) **Invoiced — Awaiting Payment** ->
  **Paid in Full — Released**.
- Deposit path: **Deposit Invoiced — Hold** -> **Deposit Paid — Proceed** ->
  (actuals computed) **Final Payment Invoiced — Hold** -> **Paid in Full — Released**.
- Variants for jurisdictions where **delivery is triggered by invoice vs. by payment**
  (net-terms / process-then-bill vs. pay-before-release) — see the three due-date semantics in
  FEE_PAYMENT_SETTLEMENT_DESIGN.md (advance, release-gated, net-terms).
- **Closed — Nonpayment** as a terminal payment state (manual, or — where a jurisdiction allows
  closing for nonpayment after notice/dunning — potentially automatic; automation is out of
  scope here and belongs with the status-model + tolling work).

Design choice (confirmed): an **event log**, not a single overwritten status field.

## 6. Estimate -> actual adjustment

The engine's ESTIMATE and FINAL modes produce the projected and reconciled totals. The profile
shows both with the delta computed **in proximity to the total** so the change is immediately
understandable, plus the notify rule that governs re-consent when the change exceeds the
configured threshold (`estimateNotifyThreshold`). A third "adjusted total due" figure is
populated at reconciliation.

## 7. Multi-item (parent/child) requests

The engine already computes per-component line items rolling up to request-level rules applied
ONCE on the aggregate — it was built for the parent/child model. So the profile gets multi-item
**transparency for free**: it shows each record type's cost, the subtotal, allowances, floor,
and the single request-level total. This directly serves "help the requestor understand a split
request."

**Settlement stays aggregate at the request level for v1.** Per-child partial payment and
per-child release **automation is PARKED**: nothing in the compiled fee/timing knowledge
mandates partial delivery (federal and profiled states allow rolling production but do not
require per-item settlement). When a real customer split needs it, add **manual** manager
controls (record a payment against a child; manually trigger a child's release) — not
automation.

The permits -> variant example (e.g. multi-family vs single-family, where one variant carries
extra pages or a redaction path and the other does not) is a **taxonomy / intake-granularity**
problem (does a child represent a record *type* or a record-type *variant*, and does the system
know the variant differs), NOT a fee problem. It belongs with the taxonomy "bucket" revisit, not
this note. Parked.

## 8. Internal cost vs. recoverable cost

**Charged = shown = recoverable = what the engine computes.** There is no hidden number and no
second source of truth.

The engine computes the *recoverable* amount (what may lawfully be charged), which IS the
charge. The agency's true internal cost (staff hours x wage) is not computed today and is not
part of the charge.

Jurisdiction note: **California** is the canonical "direct cost of duplication" state
(Cal. Gov't Code § 7922.530(a)) — recoverable excludes time spent searching, retrieving,
reviewing, or redacting (essentially copy-machine + operator cost only), so recoverable is less
than true internal cost. The engine handles this by configuring those labor drivers non-billable
for a CA profile; the trace then shows lines like "Search labor: $0.00 — not chargeable in this
jurisdiction," which is a **transparency win** (proactively citing the rule heads off a dispute).
Narrow CA exceptions: electronic records needing compilation/extraction/programming CAN be
charged labor; redaction (incl. body-cam video) cannot (Nat'l Lawyers Guild v. Hayward, 2020).
**Texas** is the opposite pole — reasonably includes materials, labor, and overhead
(Tex. Gov't Code § 552.261) — recoverable ~= actual cost, no gap. Purely jurisdiction-specific.

An optional **internal cost-accounting overlay** ("this cost us ~$X in labor, we recovered $Y")
is a staff-only management nicety, is not part of the shared computation, and is **explicitly
parked / not built.**

## 9. Email render targets and the payment-mode split

- **Internal (small-town) mode:** the estimate email and the adjustment email double as the
  **invoice** — full computation detail plus what is due and how to pay. One communication does
  everything. Matches the cashiering path.
- **ERP (big-city) mode:** the email carries the **computation-detail / transparency** ("here is
  exactly how your estimate, and later your actual, was calculated") and then hands off:
  "You will receive an invoice and payment instructions as a separate communication." Matches erp
  mode already suppressing our payment mechanics.
- **Do NOT design for injecting our profile content into the ERP's own outbound.** ERP invoice/
  notice capabilities vary per customer, and it muddies who owns the invoice-of-record. Keep the
  split: we send the computation-detail email (our transparency value); the ERP sends the invoice
  and payment instructions. If a specific ERP later supports relaying our content, that is a
  per-customer bonus, not a generic design assumption.
- Enrich the existing `feeNotice`/`buildNotice` sends to render the full profile rather than a
  summary — not net-new plumbing.

## 10. Staff view vs. requestor view — where the envelope differs

Shared (identical, from one computation): the full itemized computation, the rule trace, the
amounts owed and when, the estimate-to-actual adjustment, and the plain-language "why."
Financial *outcomes* that change the charge (e.g. an approved objection fee reduction) show to
the requestor as an **adjustment line in the computation**, not as internal process.

Staff-only operational envelope (layered on top, never changes the numbers):

- Workflow / routing metadata: team, assignee, task states, internal timestamps.
- Aging / health signals: tickler flags, lateness / health score.
- Objection-handling internals: that an objection was raised, reassignments, evidence, the Fee
  Authorizer approval chain. (Only the resulting money adjustment shows to the requestor.)
- Estimator working notes / projection assumptions vs. the clean projected quantities shown out.
- Optional internal cost-accounting overlay (Section 8), if ever built.

## 11. Data / architecture sketch

- **Assembly:** a derived projection assembled from — the engine trace (ESTIMATE + FINAL), the
  request's fee estimate / reconciliation records, the payment ledger (`fee_payments`), ERP
  tracking (`erp_charges`), approved objection credits, and the payment-status event log.
- **Endpoint:** `GET /request/:id/financial-profile` returns the assembled object; every renderer
  (staff screen, requestor screen, emails) consumes the same object.
- **Payment-status event log:** a new lightweight table (e.g. `request_payment_events`:
  id, request_id, status, detail, amount_context, created_at, actor) appended on each transition.
  Current status = latest event. Request queue / dashboard read the latest event.
- **Engine trace:** additive change to `compute()`'s return (Section 4). Pure/deterministic, so
  unit-testable in isolation like `paymentTiming`.

## 12. Proposed phasing (order TBD)

1. Engine explanation-trace extension (emit all request-level rules incl. not-applied) +
   `GET /request/:id/financial-profile` assembly + **staff screen**.
2. **Requestor / portal view** + enrich the **estimate** and **adjustment emails** to render the
   profile (mode-aware per Section 9).
3. **Payment-status event timeline** (converges with the two-track status work); wire request
   queue / dashboard to reference it.

Parked (not in this feature): per-child settlement automation and manual per-child controls;
internal cost-accounting overlay; first-payment-received email (low priority); the *processing*-
status track (separate two-track status effort); the permits->variant taxonomy-granularity issue.

## 13. Open questions to resolve before/at build

- Final payment-status vocabulary and the invoice-vs-payment delivery-trigger variants (shared
  with the two-track status note — decide whether that note is written jointly or after this).
- Final requestor-view field inclusion list (confirm nothing in the shared core is withheld).
- Whether the payment-status event log fully replaces or augments any existing single-status
  field on the request (avoid two sources of status truth).
- Confirm the assembly endpoint's caching / recompute behavior (the engine is cheap and pure, so
  recompute-on-read is likely fine).

## 14. Build log & refinements (added 2026-07-02)

Phase 1 built and live:
- 1a: engine explanation trace (`feeEngine.compute` -> `requestLevel.rulesTrace`), commit c91d37f.
- 1b: assembly endpoint `GET /request/:id/financial-profile`, commit 9918647.
- 1c: staff Financial Profile tab (FinancialProfilePanel), commit 2ee8047.
- Follow-on: **computation-method descriptor** (Standard / Commercial rates / Fee waiver
  approved, derived from the engine's `purpose`+`purposeApplied` and `fee_waiver_status`) and
  **fee-waiver reflection** (a granted waiver still computes and shows the cost, with a "Fees
  waived" banner and payable $0 — the profile honors the existing `fee_waiver_status` flag, no
  special-cased path), commit da9dc37.

Confirmed capabilities (already built, relevant to this feature):
- **Fee waiver** has a full decision flow (`POST /requests/:id/fee-waiver-decision`, grant/deny,
  `fee_waiver_status`); denial already sends a mandatory requestor notice.
- **Purpose overrides** deep-merge and CAN null out a rule (e.g. commercial removing a max), and
  the rule trace is computed AFTER the merge, so it reflects the effective per-purpose rule set.
  (Authoring note: to REMOVE a rule for a purpose, the override must set it to null explicitly.)
- **Per-state config** is real: fee_profiles are keyed by jurisdiction_id (+ context + version);
  AI auto-config populates each jurisdiction's profile; the engine reads whichever applies. No
  per-state code fork; the profile is generated from config.
- **Effective-dated config** exists (`effectiveConfig.js` + `scheduled_config_changes` + nightly
  promotion + `config_history` windows). A scheduled rule change (e.g. removing a max at midnight)
  promotes to live config automatically; because the profile is GENERATED from live config (not a
  stored template), the removed rule disappears from every profile/email instantly — nothing to
  edit.

### REFINEMENT (deferred) — historical estimate faithfulness under a rule change
The assembly recomputes an estimate from its stored inputs against the CURRENT config (to always
have a trace). If a rule changes after an estimate was quoted (the midnight scenario), recompute
would re-explain — and re-total — a historical estimate under the NEW rules, diverging from what
the requestor was formally told. Fix (Phase 2/3), using tools that already exist:
- Show the **as-quoted total** from the estimate's immutable `fee_context_json` snapshot (not the
  recomputed total) as the authoritative quoted figure. (Today the endpoint prefers the recomputed
  total; change it to prefer the stored total for the "quoted" number.)
- When recomputing for the explanation trace, recompute against the config **in effect at the
  estimate's date** via `config_history` (effective_from/effective_to windows), not today's config.
This keeps a historical estimate faithful while new estimates use the new rules. Not a Phase-1
blocker (config rarely changes mid-request); belongs with the emails (Phase 2), since an emailed
estimate is the formal quote that must not silently change.
