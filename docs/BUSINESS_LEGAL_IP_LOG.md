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

---

## 2026-07-05 — Security disclosure, pen-testing, liability, NDA & leak strategy (discussion capture)

**NOTE: the liability/contract items below are ATTORNEY questions. This is captured reasoning to make the eventual legal conversation efficient — not legal advice or settled positions.**

### Pen-testing: scope & division of responsibility
- Two distinct targets, belonging to different parties:
  - **The application / code** — security of the software itself (injection, auth, file parsing, data leakage, AI-touchpoint behavior). Travels with the software into every deployment; testing it once on our side is valuable for every customer because the flaw (or its absence) is in the code, not the network.
  - **The customer's environment** — their network, firewalls, servers, staff practices. Theirs, varies widely, we can't test or control it.
- On-premise framing (honest + protective): "the application has been assessed and hardened" (our responsibility) vs. "securing the deployment — firewalls, access control, monitoring — is yours, and you may assess it however you like" (their responsibility). This is standard for on-premise software and cleanly separates our exposure from their network.

### Legal exposure of security representations (ATTORNEY REQUIRED)
- A pen-test is a **point-in-time, specific-scope snapshot** — never "the software is secure, guaranteed."
- Do **NOT** hand prospects the raw pen-test report — it is both a roadmap for attackers and itself sensitive. Share instead an **attestation / summary letter** (an independent assessment was performed on [date] against [scope]; findings were remediated) — lawyer-drafted, conservative, scoped.
- **Contracts do the liability work**, not disclosure: limitation-of-liability clauses, warranty disclaimers, shared-responsibility terms. Disclosure supports good faith; the contract bounds exposure.
- Never produce any "it passed / it's secure" customer-facing document without counsel shaping the language.

### Disclosure strategy — tiered by audience
- **Full technical detail** (the roadmap): internal only, never shared.
- **Attestation / summary**: shared with prospects.
- **Fixed vulnerabilities**: disclosable in general terms *because* fixed (a patched hole isn't a live roadmap) — but still not with detailed reproduction steps.
- **Live / unfixed vulnerabilities**: never broadcast.
- **Correction to an intuitive-but-flawed hypothesis:** "disclose a known vuln → customer bought with full disclosure → it becomes their responsibility" does **NOT** cleanly transfer liability. Disclosing a known vulnerability and shipping it anyway can be **worse** ("they knew and sold it anyway"). The real defense is "it wasn't broken, because we fixed it," not "we told you it was broken." Known vulnerabilities are to be **remediated**, not disclosed-and-shipped. Once a real vulnerability is known, there is generally a duty to act on it; documenting "we knew and did nothing" is evidence, not a defense.

### Leak risk — why detailed findings stay internal
- Once a document leaves our hands, control is lost. NDAs are weak protection against a determined or careless leak (proving the leak, tracing the path, and recovering damages is very hard).
- **Government environments are especially leaky** — public-records laws can make documents shared with a government body themselves subject to disclosure. A detailed security document handed to a city could, in some circumstances, **become a public record**. Keep detailed vulnerability specifics out of anything handed to a government customer.
- **Incumbent-relationship risk (Kevin's scenario):** competitive displacement in govtech is personal and relationship-driven. A city employee friendly with the displaced incumbent could pass a vulnerability document to a third party who would exploit or publicize it, in a way that makes legal recourse against that third party very hard. This is a real, recognized risk — and it is precisely **why the industry norm is to NOT distribute detailed vulnerability information, even under NDA.** The scenario reinforces the conservative posture rather than creating a new problem.

### AI-assisted self-testing (find-and-fix) — value & boundary
- Using Claude + multiple strong code models to generate and run a broad security test suite **for our own remediation** is legitimate and valuable; multiple models cross-checking widen the net beyond any single model's blind spot. Use it to find-and-fix as much as possible so issues are **eliminated rather than disclosed**.
- **Boundary:** the output is **internal remediation material**, not a customer-facing "we pen-tested it" artifact. AI-built tests share a blind spot — they test the failure modes the models can imagine, which correlates with how the system was built. That gap is exactly what an **independent human assessor** fills. Self-testing raises the floor; it does not replace the independent pen-test or become a customer guarantee.
- The **independent third-party pen-test** remains a separate, real, pre-production item (credibility + likely procurement requirement for police/CJIS records).

### Related items
- **Source code vs. deployable package:** giving customers source has IP and support implications, and is separate from letting them pen-test the *running* system (which needs no source). Business decision.
- **SBOM (Software Bill of Materials):** increasingly expected in government procurement; worth generating and maintaining.
- **AI verification tools prospects could use** to independently check our claims: SAST (static analysis), DAST (dynamic scanners), dependency/SBOM scanners, emerging AI pen-test assistants — all **aids, not oracles** (false positives, misses). Invite independent verification *generally*; avoid endorsing specific named tools (implies endorsement). "Confidence through transparency" — the AI Data Flow screen reads real source precisely so claims are verifiable.

### HOLD FOR ATTORNEY (the load-bearing legal pieces)
- Contract limitation-of-liability / warranty disclaimers / shared-responsibility terms.
- What (if anything) to attest to customers about security, and the exact language of any attestation.
- Whether/how to represent assessment results at all.
- Duty-to-act obligations once a vulnerability is known.
- Implications of public-records law for any security document shared with a government customer.
