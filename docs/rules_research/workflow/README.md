# Master workflow design (Phase 5) — working notes

Turns the aligned rule set (`../pruned/pruned_discovery.json`, 1101 rules → `../alignment/
master_concept_dictionary.json`, 118 concepts) into ONE configurable workflow: shared logic written once,
per-state differences expressed as **parameters** (a value the city/state config fills) or **state-gated
branches** (a path active only for that state). This is the unified-engine-with-state-profiles design
([[engine-architecture-deferred]] — now the chosen direction).

## Artifacts
- **`request_flow_master_v2.drawio`** — the diagram. **4 linked pages**: Master · Clarification ·
  Estimate-Fee · Denial. Open in draw.io/diagrams.net; the blue ▸ boxes on Master drill into the sub-pages.
- `request_flow_master_v2.svg` — flat preview of the Master page.
- `build_workflow_diagram.js` — regenerates BOTH files from an inline node/edge model (edit + `node` it).
- `PROJECT_STATUS.html` — the plain-language status/orientation doc (given to Kevin in the exchange folder).

## Core architecture (settled with Kevin)
- **Uniform intake:** every channel (portal · online form · clerk-keyed paper) normalizes to the same
  up-to-10-item structure; the engine downstream never cares how the request arrived.
- **Parent vs child:** a request (PARENT) holds up to 10 items (CHILDREN). **Process Status lives on the
  child** (In Review → Intake+Prelim-Search → Estimate → Search → Redaction → Shipped/Denied/Closed).
  The **parent is a financial processor + accounting only** (line-item ledger → per-request allowances/caps
  → total/invoice/payments/balance) — NO workflow status. Parent has two flags: **Active/Closed**
  (request-queue visibility) and **Financial Status: OK / Hold-Awaiting-Payment / Closed-Nonpayment**.
- **The only parent→child coupling is visibility:** Hold suppresses the child from “My Tasks” (request
  stays queued, flagged); Closed-Nonpayment flips Active/Closed and de-queues. Financial status never
  rewrites Process Status.
- **Clock = a MATRIX of named timers**, not one deadline. Numeric-deadline states:
  `extended_due = received + statutory_days + implied_extension` (implied_extension=0 until a trigger:
  clarification sent · “additional time” letter · no-record contact-us +3d). Soft-standard states (e.g. OH
  “promptly/reasonable”, no number): NO legal due date → city sets an internal OPERATIONAL target that
  drives My Tasks/aging but is explicitly NOT a legal deadline (S-002 pattern).
- **Legal-redaction** and **legal-denial** are spawnable escalations from Intake/Search/Redaction.
- **“Config, not law” edges** (flagged ⚠ on the diagrams): clarification response-window, estimate response
  & close-on-nonpayment windows — statute is mostly silent, so they’re city-config with defaults.
- **Compliant automation only** ([[compliant-automation-principle]]).

## Pressure tests
- **Ohio** (all-soft, staff-denies): passed. Two refinements FOLDED IN (v2.1): eligibility gate generalized
  to residency·citizenship·incarcerated; soft-clock made first-class. Ohio MINORS still open (below).
- **Texas** (hard sub-clocks, AG-rules-to-withhold): found real gaps — RESOLVED in v2.2 (below).

## RESOLVED in v2.2 (2026-07-26)
Driven by Kevin's desktop research (`../desktop_research/`), which surfaced the 2025 session laws our
discovery missed (TX HB 4219 · OK SB 535 · OH HB 265 → `../supplements/amendments_2025.json`, 9 verified
rules; TX-0016..0021 AG-referral rules RESTORED to the working set — now 1116 rules).
1. **AG-referral band added to the Denial page** (state-gated: TX). No staff denial: previous-determination
   check → prepare AG request stating SPECIFIC exceptions (HB 4219) → HARD 10-bd submit / 15-bd comments
   clocks → requestor notices → [external AG ruling ≈45bd, informational] → apply. Post-HB 4219 the 10-bd
   checkpoint has **five exits** (produce · certify date · no-records · previous-determination · AG request) —
   no request silently closes.
2. **Deemed-disclosure branch added** — TX inverts deemed-denial: missed AG clocks → info PRESUMED PUBLIC
   (§ 552.302); cross-referenced from the deemed-denial note.
3. **Clarification page fixed**: statutory response window = MO (90d) **+ TX (61d)**; TX
   consequences-warning content requirement; TX 10-bd AG clock re-measured from clarification. OK SB 535
   folded: statutory clarify procedure (3-element specificity) + deny-only-after-engagement.
4. Estimate page: OK statutory advance-payment gate (>$75 or unpaid prior fees) noted; cross-request
   (requestor-level ledger) triggers flagged: TX 552.263(c)/552.275 · OK unpaid-fees.

## OPEN — pick up here next session
**Data question (still open):** TX-0031 free allowance is **per-requestor / 12 months** (cross-request) — the
per-request parent ledger can’t hold it; needs a requestor-level running total. (OK’s unpaid-prior-fees
advance-payment trigger, OK-S03, needs the same requestor-level balance — one mechanism serves both.)

**Alignment debt:** the 15 new working-set rules (9 supplements + 6 restored) are NOT yet mapped into the
118-concept master dictionary — rerun/extend the alignment before Phase 6 templates.

**Ohio minors (not yet folded):** oral/phone as a named intake channel; delivery volume-caps parameter
(OH-0024/0026); no-forwarding-duty state gate on the referral path.

**Not yet detailed:** Records Search · Redaction (+ Legal Redaction) · Disposition/Status sub-flows.
**Not started:** state-gated overlay (color every node shared/param/branch — the bridge to Phase 6);
per-state config templates (Phase 6); the build (Phase 7).
