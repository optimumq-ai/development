# Fee Payment & Settlement Layer — Design Spec (small-town + ERP)

**Status:** design, not built. Sits *under* the payment-timing engine (slices 1–4, live) and is **additive** — it does not change anything already built. Research-grounded 2026-07-02. Complements FEE_ESTIMATE_VARIABLE_MAP.md and FEE_ESTIMATE_OBJECTION_DESIGN.md.

## 0. Core principle

Our system computes **what** is owed, **when**, and what it **gates** (the paymentTiming plan + the 4d release gate + the 4e balance). It is **not** a payment processor, a cash register, or the system of record for money. This settlement layer decides only **how** money is collected and **who owns the receivable** — via one per-jurisdiction config switch.

## 1. Payment mode — per-jurisdiction config: `internal` | `erp`

- **`internal` (small-town):** our system is the system of record for the charge. We present a pay link / accept mail / accept walk-in via a cashiering-lite screen, record the payment locally (extends the existing `deposit/record` + `final-payment/record` endpoints), and **our tickler + notices own reminders**.
- **`erp` (big-city):** finance/the ERP is the system of record once a charge is handed off. We emit a charge event at the plan's gate moment, receive a "payment applied" signal back, and **suppress our payment reminders** (the ERP dunns).

## 2. Requestor experience — NEVER an account or login (both modes)

- No self-service login is ever required. Government payment platforms support **guest checkout with no login and pay-by-email links**, and a receipt can be emailed without an account.
- Requestor identity travels as **optional descriptive fields** (name, email, address) plus the **request number as the reference** — never as credentials the requestor must create.

## 3. The three due-date semantics (what a charge must carry)

Research-grounded (federal FOIA + state patterns). Every charge is exactly one of:

- **(A) Advance / deposit — due before work begins.** Due within the advance window (federal 20 working days; TX 10 business; MI ~45) or the request is closed/withdrawn/abandoned. Work is gated on payment.
- **(B) Balance before release — records processed but HELD until paid.** Due before release. (This is the 4d gate.)
- **(C) Net-terms / process-then-bill — records released / work done, then invoiced, due net-N days, interest after.** Federal default for fees ≤ $250 with a requester in good standing; a common local policy for small amounts. Release is NOT gated on payment.

Sources: U.S. DOJ FOIA Guide (advance-payment restriction; the restriction does not bar requiring payment before releasing already-processed records); 45 CFR 5.51 (process on presumed willingness to pay, 20-working-day advance window, interest from the 31st day); state deposit thresholds (AR >$25, OK >$75, MI >$50, VA >$200, GA >$500) — below the threshold, the default is process-and-collect.

## 4. Charge-event contract

**Outbound (to ERP; also the shape of the internal payment record):**
- `amount`
- `type`: `deposit` | `additional_deposit` | `balance`
- `chargeDate`
- `dueDate`: `immediate` | `window-end` | `net-N` — derived from `plan.firstPayment.dueWindow` (A) or `plan.secondPayment.dueTerms` (C)
- `gatingSemantic`: `work_gated` (A) | `release_gated` (B) | `net_terms` (C) — from the gate + delivery trigger
- `reference`: request number (for matching the payment back)
- `requestor`: name / email / address — **optional descriptive fields**, for the receipt and for ERP-side dedup; not an account
- `chargeCodeHint`: maps to the ERP misc-receipt charge code / revenue GL line

**Inbound ("payment applied"):** `amount` + `reference` → calls the existing 4e `deposit/record` or `final-payment/record` path → balance updates → `paidInFull` flips → the 4d release gate opens. Same plumbing whether a clerk keys a check or a webhook fires.

## 5. Reminder ownership (resolves the double-reminder risk)

**Rule: whoever is the system of record for the receivable owns the reminders/dunning.**
- `internal`: our tickler + notices own payment reminders.
- `erp`: once a charge is handed off, the ERP owns the invoice, due date, interest, and dunning. We **send only workflow/status notices** ("your records are ready") and **suppress payment-chasing notices**; we only listen for "paid." One config flag, one behavior.

## 6. Only SETTLED charges go to the ERP (adjustment / revision discipline)

- Never stream estimates or interim recomputations to the ERP.
- Emit discrete, settled charge events only: **deposit** (at acceptance), **additional deposit** (only once a revised estimate is accepted or an objection is resolved), **balance** (reconciled actual − paid, at completion/ready).
- **Mid-flight revision (including agency-caused):** stopping the clock to re-clarify fees is explicitly sanctioned (FOIA lets agencies stop processing time as needed to clarify fee/willingness-to-pay issues; states toll while awaiting the requester's response). There is **no** statutory agency-error grace period — it is discretionary, and it routes to the **objection / manual-resolution surface** (negotiate / grant grace / absorb / partial waiver). The messy middle stays entirely in our system; the ERP only ever sees sequential settled charges. The initial deposit invoice stands; an additional deposit is a NEW charge event, emitted only once settled.

## 7. ERP customer records — misc-receipt default, no customer master for the common case

- **Default: post as a MISCELLANEOUS RECEIPT** — charge-code → revenue GL, reference = request number, payer name/email optional (customer-number field left blank). Copy/records fees are the textbook misc-receipt example ("payments for other services that do not require a bill"). This creates **no customer master and no redundant customer records**, and it fits the (A) and (B) immediate-collection patterns.
- **General Billing (invoice + customer record) only for an aging receivable** — i.e., the (C) net-terms case where finance wants a bill that ages and can be dunned. It is finance's internal accounting artifact; the requestor still never logs in; the ERP dedupes from the name/email/address we pass. Steer records fees to the misc-receipt default so this rarely fires.
- **Collected-outside-then-posted:** the gateway or our screen collects, then posts a misc receipt via the ERP's misc-cash import file or a payments integration.

Sources: Tyler Munis Accounts Receivable / General Billing / Miscellaneous Cash Receipt documentation.

## 8. Small-town (`internal`) build sketch

- **Cashiering-lite payment screen** extending `deposit/record` + `final-payment/record`: mail-in (a "copy balance" quick button, or enter the check amount); cash (enter tendered, show change due); a **daily cash-drawer / batch record** so accounting can count the drawer and reconcile net transactions.
- **Online:** a gateway hosted-link + webhook connector (payment-applied → 4e path).
- **Reminders:** the existing tickler + notices.

## 9. Big-city (`erp`) build sketch

- **Outbound charge-event emitter** at the gate moments (deposit at acceptance; balance at ready/completion).
- **Inbound payment-applied** endpoint (webhook, or a staff "mark paid in ERP" action) → 4e path → gate opens.
- **Suppress payment reminders** while in `erp` mode.
- **Connector specifics per ERP** (Munis misc-receipt import / payments integration; API connectors) = per-customer work at integration time, not a generic v1 build.

## 10. Built vs. additive

**Already built + live:** the plan (`dueWindow`, `onExpiry`, `deliveryTrigger`), gate→stage on acceptance, plan-driven tickler windows, balance + `paidInFull` (4e), the release gate (4d), and the notices including the balance-due notice with configurable payment instructions.

**Additive to build (none of it changes what exists):**
- `payment_mode` config (`internal` | `erp`) per jurisdiction.
- `secondPayment.dueTerms` (net-N) field to express type-(C) net-terms billing.
- the charge-event contract (out) + the payment-applied hook (in) — the in-hook reuses 4e.
- the internal cashiering-lite screen + daily drawer report.
- ERP connectors (per-customer).
- reminder-suppression behavior in `erp` mode.

## 11. Sequencing recommendation

Build small-town (`internal`) first — it extends what exists and needs no partner. Treat the ERP connector as per-customer work once there's a real ERP target. Specify the charge-event contract now (this doc) so the objection layer and the frontend surfacing don't accidentally assume internal-only.

## Provenance / verification

Research-grounded 2026-07-02. **Federal (authoritative):** U.S. DOJ FOIA Guide; 45 CFR 5.51. **ERP:** Tyler Munis AR / General Billing / Miscellaneous Receipts documentation (vendor + municipality-published guides). **State patterns:** per FEE_ESTIMATE_VARIABLE_MAP.md §E (verified TX/VA/MI) and the unverified leads. **Payment-gateway landscape:** InvoiceCloud, Paymentus, CityBase, CivicPlus Pay, PaymentVision, Point & Pay, and similar (vendor sources). Specific ERP-connector behavior must be confirmed against the target agency's ERP and version at integration time.

<!-- END PAYMENT SETTLEMENT DESIGN 2026-07-02 -->
