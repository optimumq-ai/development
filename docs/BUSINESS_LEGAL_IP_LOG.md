# Optimum Q — Business / Legal / IP Living Log

**What this is.** A running capture of business, legal-posture, contract-language, and patent-candidate decisions and leads, so they aren't lost between sessions. **This is design reasoning and an organized intake for counsel — NOT legal or patent advice.** Every item marked `[FOR COUNSEL]` must be reviewed/drafted by the appropriate attorney (SaaS/product-liability, IP/patent) before it is relied on or put in front of a customer.

Owner: Kevin Hargrove. Started 2026-07-01.

---

## 1. Compliance posture — fees, redaction, calendar/clock, and any local-policy-driven config

**Decision (v1): "Never assess, and say so plainly."**
- The platform implements the agency's **local policy / ordinance as authoritative** (highest priority in configuration).
- The platform does **NOT** identify, reconcile, flag, notify about, or take any action on cases where local policy may fail to comply with state or federal law. It does not verify compliance and does not provide legal advice.
- The agency's own **designated reviewer approves the configuration on the record** (who/when logged) — this human-approval-of-record is the core liability posture: a responsible agency official exercised their own legal judgment and took ownership. Optimum Q is the tool; the agency is the decision-maker of record.
- Rationale: the risky postures are (a) detect a conflict and stay silent, and (b) detect and adjudicate (which risks assuming a duty to catch all conflicts and/or giving bad legal advice). "Never assess + explicit responsibility allocation + human approval of record" avoids both.

**`[FOR COUNSEL]` License / ToS language to draft:**
- Platform implements agency-directed policy; does **not** provide legal advice or verify compliance with state/federal/local law.
- Agency is **solely responsible** for legal compliance of its configured policies (fees, redaction rules, deadlines/tolling, everything).
- **Indemnification:** agency indemnifies Optimum Q against claims arising from the agency's own policy/compliance choices.
- **Limitation of liability** cap.
- Explicit **"not legal advice"** disclaimer.
- Consider **E&O insurance** (errors & omissions / tech professional liability).
- Surface a short version of the responsibility allocation at the configuration/approval point in the product (not just buried in ToS).

**Related earlier decision (statutory currency):** the platform's AI pre-populates rules (redaction, jurisdiction) to **best effort**; human review/add/delete/approval is required; and the platform does **not** represent that it keeps legal/statutory requirements current — **the customer/agency is responsible for maintaining legal currency.** (Also: remove the "Check for updates" button + any language implying the platform auto-maintains rule currency — logged separately as a post-wizard audit item.)

---

## 2. Future feature — "Compliance assist" (DEFERRED)

- Concept: surface the relevant statute/citation as **reference material** next to the config, so a reviewer can compare policy vs. state law themselves. Ties to the "make fees defensible" value (see the NOLA OIG vague-catch-all anti-pattern in the fee variable map).
- **Explicitly informational, not determinative.** Opt-in. Counsel-reviewed before release.
- **Deferred** until Kevin is content with reliability, usability, stability, and accuracy of the current-scope solution. Do NOT build in v1. Revisit as a deliberate v-next decision.

---

## 3. Go-to-market IP protection & NDA gating

- Goal: protect IP as much and as long as possible at launch; slow the spread of novel capabilities without scaring off prospects.
- **Website gating plan:** generic public home page → button to request access (enter email) → issued a password → password unlocks **NDA content → click-to-agree → proceed**. Demos gated behind a signed/clicked NDA.
- Emphasize **"patent pending"** (once a provisional is on file) + NDA to make prospects take confidentiality seriously.

**`[FOR COUNSEL]` / accuracy flags:**
- **"Utility patent" vs "provisional":** what Kevin plans to file first is almost certainly a **provisional patent application** — a placeholder that locks a priority date, is never examined, never "granted," and gives **12 months** to file the real non-provisional utility application. It is what legitimately supports saying **"patent pending."**
- **Safe to say:** "patent pending" once the provisional is filed.
- **Do NOT say (off a provisional):** "we received approval for our initial patent application" or anything implying a patent was granted/approved — there is no approval to receive on a provisional, and overstating patent status can create **false-marking** exposure. Have the patent attorney pin exact permissible wording.
- Click-through NDA enforceability + the email/password gating flow → have counsel confirm the NDA mechanism is enforceable as designed.

---

## 4. Patent-candidate features (to evaluate with a patent attorney)

Capture any feature that is a **genuine differentiator vs. other public-records/FOIA solutions** and *might* be novel/non-obvious enough to eventually support a real (non-provisional) utility patent. Goal: identify ~5 strong candidates to include in a provisional filing. Each needs a patent attorney's novelty/prior-art assessment — the notes below are engineering descriptions, not patentability opinions.

*(Running list — add as we identify them. Not yet assessed for novelty.)*

- **(candidate)** AI-pre-populated, human-approval-gated jurisdiction configuration with per-phase designated-reviewer sign-off and audit trail (the onboarding wizard's review/approval architecture).
- **(candidate)** Mandatory interactive fee/estimate **test-sandbox gate** — configuration cannot be approved until a reviewer runs scenarios against the live engine and confirms correct behavior, with the confirmation tied to the config version (auto-invalidated on change).
- **(candidate)** Jurisdiction-vs-agency layered fee/rules resolution with **per-line-item statutory override** and a per-(state × variable) statutory/policy layer model.
- **(candidate — needs build)** Dual fee-computation modes (computed labor+duplication engine vs. fixed/tiered published schedule) selectable per record type/department.
- **(placeholder)** Reserved for additional candidates as they emerge.

> Note: "differentiator" and "might be patentable" are the bar for listing here; only the patent attorney determines actual patentability. Keep prior-art awareness in mind — several of these may exist elsewhere.

---

## 5. Parking lot / to-revisit
- Post-wizard audit: remove "Check for updates" button + auto-currency-implying language (cross-ref fee/redaction docs).
- Confirm which of the above patent candidates are truly unique after a prior-art search.
