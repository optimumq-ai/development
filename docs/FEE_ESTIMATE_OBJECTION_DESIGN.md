# Fee Estimate Objection Handling + Fee Authorizer Role — Design Spec

**Status:** design, not built. Sits alongside the payment-timing layer (slices 4a/4b planned). No code until approved. Elaborates the "fee dispute / appeal" dimension recorded in FEE_ESTIMATE_VARIABLE_MAP.md §B.1.

## 0. Guiding principle

The system is a **thin substrate**, not an adjudicator or a router. For objections it does four things only: **capture** the objection with evidence, let a human **assign/reassign** ownership, **freeze automation** where the jurisdiction requires it, and preserve an **audit trail**. All judgment — negotiate, waive, reduce, agree a new date, uphold, deny — stays with people. Objections are infrequent, authority-based, and ad hoc, so we deliberately avoid Smart Routing and role-gated pools here (both were considered and set aside).

## 1. Objection is an OVERLAY, not a status

- A separate field set on the request; it **never overwrites** the request's real process stage/status. The request keeps moving through its normal lifecycle representation; "Objection" rides on top.
- While an objection is open it does exactly one mechanical thing: **freeze the automated clock / tickler / due-window** — but only if that state/city's rule requires tolling. This is a per-jurisdiction config flag on the Jurisdiction Profile; where the rule doesn't toll, there is no clock effect.

## 2. Creation — the "catch" step (any user)

Whoever receives the objection can flag it, without needing to know who will manage it. Objections arrive however the agency takes contact — a generic openrecords@ inbox, a phone call, a walk-in, or a reply to the estimate email. States generally name the venue that *resolves* a dispute (MI → body head then court; NC → State CIO mediation; PA → OOR; SD → administrative review or court) but do **not** dictate how the requester first lodges it, so intake is agency-side and can come to anyone.

- Trigger: an **"Objection" button** on the request record.
- Mandatory intake dialog **before save** (provenance is not optional):
  - **Source type** (dropdown): letter / email / phone call / in-person.
  - **Evidence** (required, at least one): upload a scan/photo of a letter, a screenshot or forwarded copy of an email, OR a typed recap of a phone/in-person conversation.
  - **Short reason.**
- On save: objection created (status `open`); clock frozen iff the jurisdiction requires; **request stage untouched**. The evidence ties to the preserved estimate-basis record — the audit trail if the fee is ever formally challenged.

## 3. Assignment & reassignment (the "amoeba")

- At creation the catcher either **assigns to any system user**, or clicks **"escalate to my supervisor"** (which simply resolves to their supervisor as the assignee — no special mechanic).
- The objection appears as a line item in the assignee's **"Fee Estimate Objections"** box on My Tasks.
- The assignee may **reassign to any other user** at any time; it moves to that person's box. A supervisor is just another assignee — they can act as resolver or reassign. Free-form reassignment is intentional: the process shape emerges from tribal knowledge (e.g., "Suzanne always handles objections"), it is not encoded.
- Optional: an agency may set a **standing default assignee** to skip the decision. (Open decision #4.)
- Assignment is **manual and person-based** — not Smart Routing, not a role pool. (Rationale: low volume, authority-based, ad hoc.)

## 4. Visibility (watchers)

- **Open Records — standing read-only visibility** of all open objections, for central oversight (configurable, recommended on). Appears on the Open Records view but is informational; nothing to clear.
- **Owning-team supervisor standing visibility** — OPEN DECISION #2. Recommendation: off — supervisors enter via escalation/assignment, consistent with the amoeba model.
- Watchers never clear anything; entries auto-drop from all views when the objection resolves.

## 5. Resolution — one exit, outcomes split by financial effect

The current owner records an outcome. Whether it clears immediately depends on whether money moves:

- **Non-financial → clears directly on the owner's action:** agree a new due date; uphold the fee as-is; requester withdrew the objection.
- **Financial → TENTATIVE, pending approval:** a fee reduction, a partial or full waiver, or writing off a difference at reconciliation. The owner enters a **tentative** adjustment (amount + description + optional supporting doc). **Both the adjustment and the objection-removal sit pending** until a **Fee Authorizer** approves. On approval → adjustment applied, objection clears, clock un-freezes. On rejection → returns to open/owner.
- Outcomes that produce a **revised estimate or new due date** re-enter the normal accept/pay flow built in the payment-timing slices.

This is the segregation-of-duties control: the person negotiating/entering a revenue reduction is **not** the person who approves it.

## 6. Fee Authorizer role (generalization of the existing waiver approver)

- Today a role approves **fee waivers**. Generalize that single authority to cover **all revenue-reducing actions**: waivers, negotiated discounts/reductions, and reconciliation write-offs.
- The existing waiver approval becomes **one case** of this role — a rename/broadening, not a new approver.
- Placeholder name: **"Fee Authorizer"** (final name is open decision #1; renameable in one place).

## 7. Relationship to the payment-timing layer (slice 4)

- Distinct, jurisdiction-agnostic capability. It does **not** change the deterministic bands, gates, due-windows, or delivery triggers (4a/4b).
- The **revised-estimate re-consent** (slice 4e) is one door into this same manual-resolution surface.
- The **estimate notice** (slice 4a) may carry an optional, per-jurisdiction "if you believe this estimate is incorrect, you may…" line — some states require posting the avenue. Informational text only; never the procedure.

## 8. Data model sketch (for build time)

- `objections` (overlay on request): `id, request_id, status (open|tentative|resolved), source_type, evidence_file_id | recap_text, reason, assignee_id, raised_by, raised_at, resolution_type, resolution_detail, resolution_amount, approval_status, approved_by, approved_at, resolved_by, resolved_at, clock_frozen`.
- **My Tasks "Fee Estimate Objections" box:** objections WHERE `assignee_id = me` AND status IN (open, tentative). Open Records standing view: status IN (open, tentative), read-only.
- **Fee Authorizer approvals:** a pending queue of financial resolutions awaiting approval.
- Reuses existing plumbing: `request_history` for audit; the tasks / My Tasks surfacing; evidence upload via the existing file handling.

## 9. Explicitly OUT of scope

- Encoding each state's **formal appeal venue/procedure** (CIO / OOR / court). That is the separate formal-appeal layer; an operational objection may *optionally* escalate into it later, possibly under a different (legal/appeals) role.
- Any attempt to **auto-determine** who should manage an objection.

## 10. Open decisions to lock before build

1. **Fee Authorizer** — final role name ("Fee Authorizer" placeholder in use).
2. **Owning-team supervisor standing visibility** — on or off? (recommend off).
3. **Open Records standing visibility** — default on? (recommend on).
4. **Standing default assignee** for objections — support now, or later?

<!-- END OBJECTION DESIGN 2026-07-01 -->
