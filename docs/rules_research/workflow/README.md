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
- **Texas** (hard sub-clocks, AG-rules-to-withhold): found real gaps — see OPEN below.

## OPEN — pick up here next session
**Structural (from Texas):**
1. **“Mandatory external ruling to withhold” branch on the Denial page.** TX (and other AG-ruling states)
   have NO staff-denial; to withhold, the body must petition the AG within a HARD 10-business-day clock, else
   the info is **deemed PUBLIC** (TX-0022). Model: flag potentially-exempt → prepare AG request → 10-bd
   submission timer → [external AG decision] → apply. Likely **over-pruned TX’s `Review` category** — the
   AG-referral *trigger + clock* are in-scope even though the AG’s deliberation is external. Revisit that cut.
2. **Deemed-disclosure inverts deemed-denial.** Elsewhere silence → deemed DENIED (16 states); TX → deemed
   PUBLIC. Its own branch on the clock/denial consequence.

**Correction:** the Clarification page says statutory response window = “MO (90d) only” — WRONG; it’s
**MO (90d) + TX (61d)** (TX-0014). Fix the node.

**Data question:** TX-0031 free allowance is **per-requestor / 12 months** (cross-request) — the per-request
parent ledger can’t hold it; needs a requestor-level running total.

**Ohio minors (not yet folded):** oral/phone as a named intake channel; delivery volume-caps parameter
(OH-0024/0026); no-forwarding-duty state gate on the referral path.

**Not yet detailed:** Records Search · Redaction (+ Legal Redaction) · Disposition/Status sub-flows.
**Not started:** state-gated overlay (color every node shared/param/branch — the bridge to Phase 6);
per-state config templates (Phase 6); the build (Phase 7).
