# Design — Delegated AV Fulfillment (the "offload to the evidence system" toggle)

**Status:** DRAFT. Proposed by Kevin 2026-07-14. Vendor-capability research **in flight** — §6 (buildability)
is **NOT filled in yet** and no code ships until it is.
Companions: `SPEC_record_search_task_screen.md` §4b (the BWC research that led here) ·
`SPEC_redaction_automation.md` · `SPEC_tasks_roles_mrr_fees.md` · `ARCHITECTURE.md`.

---

## 1. The idea, in Kevin's words

> *"Perhaps a toggle switch turned on if we're able to integrate well with that system. For video search and
> redaction, the interface changes — the search task is simply routed to that system, where search and redaction
> are performed, and when complete they feed what we identify as minimal necessary data back along with links.
> When a request for police video is located, redacted and the integration populates our system as needed, **no
> user would be required to do any processing with the search or redaction UI**."*

This is the logical end of what the BWC research concluded: **build the ledger, not the viewer.** The video never
leaves the evidence system; the clipper lives in Axon and always will; Axon has no request-intake product. So the
clean division of labor is:

| | Owns |
|---|---|
| **The DEMS** (Axon / Motorola / Genetec) | Finding the footage. Clipping it. Redacting it. Possibly reviewing it. |
| **OptimumQ** | **The request. The clock. The correspondence. The fee ledger. The legal decisions. The record of what the city did and why.** |

**This is not a fallback for a missing feature. It is the correct architecture** — and it is a *live* pattern:
the research found Colorado Springs PD running an external redaction vendor as a literal pipeline stage today.

---

## 2. Two positions `[Kevin, 2026-07-14]`

The toggle has two settings, not one. Kevin's framing:

### Position A — **FULL OFFLOAD** (`delegated_full`)
The external system performs **search → clip → redact → review/approve.** When it marks the work complete, the
integration populates OptimumQ. **No OptimumQ user touches a search or redaction UI, and no OptimumQ user
approves the redaction** — the external review is trusted and assumed compliant.

Requires the integration to return:
- the redacted derivative (file or durable link)
- **the exemption / Vaughn information** — *what* was redacted and the **legal basis** for each
- anything bearing on the **clock** (when work started/finished; anything that tolls)
- outcome facts (found / not found / could not resolve the description)

> **⚠ Position A is buildable ONLY if a DEMS actually emits exemption/legal-basis metadata AND a completion
> signal. That is the open research question. See §6. If no vendor does, Position A collapses into Position B
> and this section is deleted rather than shipped half-true.**

### Position B — **PARTIAL OFFLOAD** (`delegated_redaction`)
Only the **mechanical act** — viewing, clipping, redacting — happens externally. The finished file comes back by
**upload or link**. Redaction *reasons* are carried across (**copy-paste is acceptable** if the external tool
generates them and no export exists). **Approval of the redaction stays in OptimumQ.**

### Position OFF — **IN-HOUSE** (`in_house`)
Today's path. The searcher works the record-search screen; the redactor works the redaction workstation.

**Granularity: per SOURCE SYSTEM, not per city.** A city may delegate police video to Axon and still work its
documents in-house. This binds to the connector / `record_type_repositories`, which already carries a format.
(Kevin: *"It needs to be configurable by city"* — per-source satisfies that and is strictly more precise.)

---

## 3. THE INVARIANT THAT CANNOT BEND: the clock does not delegate

**A statutory deadline is the city's. It is never the vendor's.** If Axon takes six weeks, the city is late — and
*"we sent it to the evidence system"* is not a defense in any jurisdiction.

Therefore, in **every** delegated position:

1. **The task still exists in OptimumQ and the clock still runs.** Delegation changes *who does the work*, never
   *who owes the duty*. The request does not "leave the building."
2. **The record-search task screen becomes a STATUS surface, not a work surface** — what we sent, when we sent
   it, what came back, and **the running deadline in plain sight.**
3. **Silence is an alarm, not a state.** An outbound handoff with no completion signal must escalate. A delegated
   request that quietly stalls is **worse than no integration**, because the city believes it is being handled.
4. **The toggle must DEGRADE.** On timeout, error, or a "cannot resolve" response, the request **falls back to an
   in-house human task** with the effort trail intact. There is no terminal "stuck in the integration" state.

> This is the same failure class as the Illinois fee-forfeiture and burden-denial traps: **a right or a duty lost
> by inaction, silently, with nothing visibly wrong.** The design's whole job is to make delegation *visible*.

---

## 4. THE SECOND INVARIANT: the DEMS reports FACTS. OptimumQ makes the LEGAL DECISIONS.

Kevin's proposed return payload included *"no record found, vague description, etc."* — **those two are not the
same kind of thing, and the distinction is load-bearing.**

| The DEMS may assert | The DEMS must NOT decide |
|---|---|
| *"I searched these lanes and found no matching asset."* (a **fact**) | Whether that becomes a **"no responsive records"** closure — which requires evidence of a diligent search and, per the research, a **CAD call number**, because **up to 40% of dispatches that should have video have none.** |
| *"The description did not resolve to an incident."* (a **fact**) | Whether that is a **vague** request, whether the city must **ask for clarification**, whether that **tolls the clock**, and what **notice** is owed. |
| *"The scope would be unduly burdensome."* (an **observation**) | Whether the request is **Overly Broad** in the legal sense — because in **Illinois the conference duty is the CITY'S**, the clock does **not** stop for it, and **silence forfeits the burden defense entirely.** |

**An evidence system does not know what state it is in.** `clarification_clock_effect`, `clarification_duty`,
`vague_is_denial_ground` are per-jurisdiction and were built precisely because these answers differ by state.

**→ Kevin already reached this conclusion independently:** *"things like vague or overly broad response are
handled in our system."* This section is that instinct, written down and given teeth. **The integration FEEDS the
clarification engine; it never REPLACES it.**

---

## 5. THE THIRD INVARIANT: minimal necessary data cuts BOTH ways

Kevin applied "minimal necessary data" to the **return** trip. It binds at least as hard on the **outbound** trip.

**Send to the DEMS:**
- the four-lane lookup the search actually needs — **person in the incident · case/incident number ·
  date+time+location · officer** (this is the disjunctive form **RCW 42.56.240(14)(d)** effectively legislates)
- our request number (as a correlation key)
- the response deadline (so the DEMS can prioritize)

**Do NOT send:**
- **the requestor's identity.** The DEMS does not need it, most states forbid treating a request differently
  based on who is asking, and pushing a citizen's name into a police evidence system is a privacy harm we would
  be creating for no functional gain. `[HARD RULE]`
- the requestor's correspondence, fee posture, or any commentary about them.

---

## 6. Buildability — `[BLOCKED ON RESEARCH, 2026-07-14]`

Position A stands or falls on two vendor facts, **neither of which is currently established**:

| Question | Why it is fatal | Status |
|---|---|---|
| **Does any DEMS emit exemption / legal-basis (Vaughn) metadata for a redaction?** | Without it, Position A returns a redacted file the city **cannot defend**. A withholding with no citable basis is an indefensible denial. | **UNVERIFIED.** Axon's exemption log is **claimed in marketing, absent from the Redaction Studio product guide** the first research pass could read. *Claimed ≠ disproven — this is a gap, not a finding.* |
| **Can an external system be NOTIFIED when the DEMS finishes?** (webhook / callback / pollable status) | Delegated mode is **impossible without a completion signal.** If the only way to learn Axon is done is *a human noticing*, then "no user does any processing" is unachievable and the mode is a status board, not an integration. | **UNVERIFIED.** Axon's partner API exists and is default-on, but `developers.axon.com` is login-gated — **zero endpoints have been read.** |

**Honest statement of ignorance, for the record:** we do not currently know whether Axon's API can create a share
link, read a redaction, or fire a callback. Anyone who says otherwise is guessing. **No code ships against an
API we have not read.**

*(Research commissioned 2026-07-14: exemption-metadata capability across Axon / Veritone / CaseGuard / VIDIZMO /
Motorola / Genetec; API + completion-signal capability per DEMS; and whether any competing open-records platform
has ever integrated with a DEMS.)*

---

## 7. Sketch of the data model `[PROVISIONAL — pending §6]`

Builds on `ExternalEvidenceReference` (`SPEC_record_search_task_screen.md` §4b), which was already designed to
point at a video we will never hold.

- **`av_fulfillment_mode`** — per source system: `in_house | delegated_redaction | delegated_full`. Default
  **`in_house`** (safe-manual, per AUTO_CONFIG §2.3 — an un-attested integration takes no automated action).
- **`delegated_handoffs`** `[NEW]` — `id · request_id · task_id · system · sent_at · payload_sent (the four-lane
  lookup, NEVER the requestor) · status (sent|working|complete|failed|timed_out) · completed_at ·
  outcome (found|not_found|unresolvable) · returned_ref_id · escalated_at`.
- **Exemption ingest** `[SHAPE UNKNOWN — §6]` — if a DEMS emits reasons, they land as first-class exemption rows
  against the derivative, not free text. **If it emits only free text, they land as free text and the request is
  flagged as NOT having a citable trail** — the system must never *imply* a legal basis it does not have.

---

## 8. Open, and honestly so

1. **§6 — both vendor questions.** Everything else is downstream.
2. **Kevin's own caveat, recorded verbatim:** *"I don't know what the best design or process assumptions are
   reasonable… If you can polish up this approach and build accordingly, I'm ok with it **until I get
   prospect/customer feedback for improvement**."* This design is explicitly a **first draft to be revised
   against real customers**, not a settled contract. Build it so it is cheap to change.
3. **Trusting an external review** (Position A) means the city publishes a redaction **no OptimumQ user ever
   looked at**, bypassing the mandatory-reviewer gate that `redactionDisposition.js` applies to `law_enforcement`
   → `legal` disposition today. Kevin accepts this **when the external process is streamlined and marked
   complete**. It must be **per-city configurable**, and the **default must remain the gate** — a city opts *out*
   of human review deliberately, never by accident.
4. **Fees.** WA meters **redaction time (chargeable)** separately from **search time (not chargeable)**. If the
   DEMS does both, we need **actuals back** to bill correctly. And the research's Pattern C has the **vendor
   billing the requestor directly** — money that never crosses our ledger. Unmodeled.
