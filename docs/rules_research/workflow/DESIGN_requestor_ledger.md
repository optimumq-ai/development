# Requestor-level ledger — design (2026-07-26)

## Why this exists

The settled architecture makes the **parent a per-request financial processor** ([[workflow-design-status]]):
line-item ledger → per-request allowances/caps → total/invoice/payment/balance. That is the right home for
everything scoped to ONE request — but the working set contains a family of statutes whose state **crosses
requests**: "this requestor has unpaid fees from *previous* requests", "36 hours of free staff time per
requestor per *12 months*", "at least 7 requests in the last *7 days*", "10 physical deliveries per *month*".
A per-request parent cannot hold any of that. This doc designs the one mechanism that serves them all: a
**requestor-level ledger** sitting beside (not above) the parent processors.

## Driving rules (all in `../pruned/pruned_discovery.json`)

**A. Unpaid-prior-balance gates** — a running A/R balance per requestor:
| State | Rule | Effect when balance outstanding |
|---|---|---|
| TX | TX-0035 (§552.263(c)) | may require deposit/bond for unpaid amounts **> $100** before processing new requests |
| OK | OK-S03 (§24A.5(4), SB 535) | may require **advance payment** of new estimate (also when estimate > $75) |
| GA | GA-0025 | may require **prepayment** of the prior unpaid costs |
| MA | MA-0041/0042 | may **deny** the new request, with written notice of reasons |
| MI | MI-0056/0057 | may demand **increased deposit (≤100%)**; MUST STOP once requestor proves full payment |
| UT | UT-0037 | may require payment of past fees (+ future estimate) before processing |
| MO | MO-S02 (§610.026) | same/similar request within 6 months of nonpayment-withdrawal → may charge **old fee + new fee** |
| WI | WI-0043 | prisoner with prior unpaid records debt → prepayment |
| UT | UT-0036 | prior nonpayment (non-media) → lose the free first quarter-hour |

**B. Free-allowance accumulators** — consumable time budget per requestor per period:
- TX-0031 (§552.275): if the city elects the cap, allowance must be **≥ 36 hrs / 12-month period** and
  **≥ 15 hrs / month**; once exceeded, ALL personnel time + overhead becomes chargeable, via a written
  estimate the requestor must answer **within 10 days** or the request is withdrawn. **Exempt classes**
  (never metered): news media, elected officials, publicly-funded legal-aid 501(c)(3)s, higher-ed
  journalists/scholars.

**C. Request-frequency counters → classification flags:**
- IL-0022 (recurrent requester = request counts over rolling 12mo/30d/7d windows to the *same body*) →
  IL-0020 (21-bd response window) + IL-0021 (5-bd notice) + IL-0019 (advance full payment).
- PA-0029 (repeated requests for the *same record*), UT-0022 (unreasonable duplicates), NJ-A18/A19/M19/M24/T17
  (duplicate-pending & identical-unchanged denials) — need per-requestor **request history**, not just counts.
- NY-0026: identical record produced within past 6 months + electronic copy on file → **reuse free** (a
  beneficial trigger from the same history index).

**D. Delivery-volume caps** — OH-0024/0026: ≤10 records/month by physical delivery (unless non-commercial
certification) and a configurable electronic-transmission cap. Per-requestor per-month delivery counters.

**E. Requestor status flags (time-boxed):** OH-S01/S02 vexatious-litigator gate (external court list; ID
demand allowed on reasonable belief); UT vexatious designation (duty suspended ≤ 1 year, director order);
MI increased-deposit flag (cleared by proof of payment — an explicit **clearing event**).

## Design

### Entities

**RequestorProfile** — identity anchor. Created lazily on first *identifiable* contact (portal account,
verified email, staff-confirmed walk-in identity). Fields: verified channels (portal id, emails), display
name, **class attestations** (media / elected official / legal-aid / scholar — with attestation artifact,
since TX-0031 exemptions and OH commercial certification hang off them), status flags (below).

**RequestorLedger** — four sub-stores keyed to the profile:
1. **Balance** — A/R roll-up across this requestor's parents: `invoiced`, `paid`, `written_off`,
   `outstanding` (+ per-request breakdown & age). Fed by parent-processor events (invoice issued, payment
   received, waiver granted, close-nonpayment). Never computed ad-hoc from parents at read time — evented,
   auditable.
2. **Allowances** — named period accumulators: `unit` (hours · records · requests), `window` (rolling
   12-month / calendar month / rolling N-day), `floor/config value`, `consumed`, `exempt_classes`.
   TX personnel-time consumes only when *uncompensated* staff time is actually logged on a child task.
3. **Counters/History** — request log (timestamp, body, normalized scope hash, outcome) driving: IL
   recurrent computation (rolling windows), NJ/UT/PA duplicate detection, MO-S02 six-month
   similar-request match, NY-0026 reuse lookup.
4. **Flags** — `{flag, source, set_at, expires_at, clearing_event}`: `increased_deposit(MI)` cleared by
   proof-of-payment; `vexatious(OH/UT)` with expiry or external-list re-check; `recurrent(IL)` recomputed,
   never manually set.

### Trigger evaluation (where the ledger talks to the workflow)

The ledger is passive storage + **pure trigger functions** evaluated at three existing gates — it never
mutates a child's Process Status (same principle as parent→child coupling being visibility-only):

| Gate (existing diagram node) | Triggers evaluated |
|---|---|
| **Intake eligibility gate** (Master `g2`) | vexatious flag (OH/UT) · MA unpaid-balance deny · NJ/UT/PA duplicate advisory · IL recurrent → response-window override + 5-bd notice task |
| **Estimate / deposit decision** (Estimate page `ddep`/`fcom`) | TX >$100 unpaid → deposit demand · OK outstanding-fees/-$75 → advance payment · GA/UT/WI prepayment · MI increased-deposit % · MO-S02 fee carry-forward line item · TX-0031 over-allowance → all-time-chargeable estimate w/ 10-day response timer |
| **Delivery/ship gate** (Master `p6`) | OH monthly delivery caps (or certification on file) · decrement allowances/counters on actual delivery |

**Advisory vs automatic:** monetary triggers (deposit/advance/prepay demands, carry-forward lines) are
computed automatically but issue through the normal parent-processor communications. **Denial-shaped
triggers (MA deny, duplicate/repeat denials, vexatious) surface as flagged advisories a person confirms** —
similarity and "reasonable belief" are judgment calls; auto-denial would be
automation-beyond-the-compliant-subset ([[compliant-automation-principle]]).

### Identity & anonymity (the hard constraint)

Most states forbid conditioning access on identity (OH B(4), TX no-purpose/pseudonymous email, etc.), so:
- **Adverse triggers require an affirmative identity match** — same portal account, same verified email, or
  requestor-admitted identity. Never fuzzy-matched. An anonymous request simply evaluates no adverse
  triggers (that is what the statutes themselves accept — e.g. OH may demand ID *only* on reasonable
  vexatious belief, OH-S02).
- **Beneficial triggers** (NY-0026 free reuse) may use looser matching (same record scope suffices).
- Class attestations are voluntary claims with artifacts; TX exemption classes checked at estimate time.

### Config surface (per-state template fills)

Everything is state-gated + parameterized: enablement per mechanism · thresholds (TX $100, OK $75, MI ≤100%,
OH 10/month) · allowance sizes (TX floors: city may set HIGHER than 36h/15h, never lower) · windows (MO 6mo,
NY 6mo, IL 12mo/30d/7d) · exempt classes · MA/duplicate advisory-vs-manual routing. Concepts already carry
this: `payment.advance_payment` (14 states), `fee.personnel_time_free_allowance`,
`classification.recurrent_requester`, `delivery.*_volume_cap`, `eligibility.vexatious_requester_gate`.

### Explicitly out of scope
- Collections/lawsuits over unpaid balances (TX can't sue; external anyway).
- Cross-*city* requestor state — the ledger is per governmental body (IL counts are per body by statute).
- Auto-classifying anyone as vexatious — OH list is the court's; UT designation is the director's order;
  the system only *records and applies* an externally-established status until expiry.

## Open questions for Kevin
1. **Identity model:** are portal accounts mandatory enough to be the primary anchor, with verified-email
   matching for the email channel? (Recommended; walk-in/paper stays staff-confirmed.)
2. **MVP cut:** balances + deposit/advance triggers (class A) are needed for TX/OK/GA/MA/MI/UT day one;
   allowances (B) and frequency counters (C) can ship as config stubs with manual tracking. Agree?
3. Should the OH non-commercial certification live on the profile (sticky per requestor) or per request?
   Statute reads per-request; sticky-with-reconfirmation is friendlier. Default: per request.
