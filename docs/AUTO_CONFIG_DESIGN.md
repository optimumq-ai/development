# Auto-Configuration & Trust Model - GOVERNING SPEC

Status: governing design (2026-06-24). This document is authoritative for how Optimum Q configures itself
to a city's laws and ordinances. Every auto-configurable area (fees/estimates, deadlines, redaction/
exemptions, appeals) MUST conform to the trust model, UI architecture, and data model defined here.
Related docs it governs: CITY_FEE_SURVEY.md (fee instruction-set gaps), JURISDICTION_RULES.md (multi-state
structure), FEE_ESTIMATE_KNOWLEDGE.md, WORKFLOW_DECISIONS.md, TAXONOMY_DESIGN.md.

Business objectives this serves (Kevin):
  (1) Ship a code version complete enough that few/no per-city code changes are needed - i.e. the system can
      EXPRESS virtually any city's rules.
  (2) Eliminate the need for an "Optimum Q consultant" to hand-configure each customer; shift setup to AI
      drafting + the CITY's own review and sign-off. Minimal Optimum Q staff overhead.

================================================================================
## 1. CORE PRINCIPLE: expressiveness precedes automation
AI can only auto-configure into a slot that can HOLD the rule. An extractor that correctly reads "Ohio: no
labor charges, ever" is useless if the fee engine cannot REPRESENT non-billable labor. Therefore the build
order is always:
  (a) make the configuration substrate rich enough to express the rule (the "instruction set"), THEN
  (b) point AI at populating it.
Building the agent first just produces rules it cannot write down. The instruction-set catalog (Section 6) is
both the completeness guarantee for objective (1) and the contract the AI targets.

Two kinds of "rule", different homes:
  - PARAMETERS: a per-page rate, a deposit threshold, a 10-day window, billable yes/no. Stored as config
    values. Easy.
  - STRUCTURE / BEHAVIOR: "pause the clock during an AG ruling", "this state inserts an internal-appeal stage
    with its own 30-day window", "labor becomes billable only past 50 pages". These change how an engine
    BEHAVES and cannot be a single number. This is the hard, valuable engineering (Sections 5, 6).

================================================================================
## 2. THE TRUST MODEL (assistive AI -> review -> attest -> live)
One sentence: AI DRAFTS, the city REVIEWS and corrects, the city ATTESTS per area, and only THEN can that
area go live. Three reinforcing layers: assistive framing (docs + UI), per-area review, blocking attestation.

2.1 Assistive framing (everywhere)
  - Documentation AND on-screen text state plainly that AI auto-configuration is ASSISTIVE ONLY, intended to
    accelerate setup, and that review for accuracy and completeness is critically important and is the city's
    responsibility. No screen should imply the AI output is authoritative or legally vetted.

2.2 Per-field PROVENANCE + CONFIDENCE (feeds review)
  - Every auto-populated field carries: source citation (statute/ordinance section or uploaded doc + locator),
    a confidence score (0..1), and the extracted value. Example: "$0.10/pg <- Tex. Gov't Code 552.0001,
    conf 0.92" vs "labor rate: not found in sources, defaulted to 0 - VERIFY, conf 0.0".
  - The review surface SORTS/【flags】low-confidence and not-found items to the top so a human's attention goes
    where it matters. This is what makes review fast and credible. (feePolicyExtract already emits per-field
    citations + confidence - it is the prototype; generalize it, Section 5.)

2.3 Per-area version-bound HARD ATTESTATION GATE (gates go-live)
  - Each auto-configurable AREA has a readiness state: drafted -> reviewed -> attested -> live. It starts NOT
    attested.
  - GATE IS HARD (Kevin's decision 2026-06-24): an area's automation does NOT operate until attested. Default
    posture for an un-attested area is SAFE/MANUAL (the feature is available manually with a persistent
    "not yet attested" warning, but no automated action - e.g. the fee engine will not auto-price, the tickler
    will not auto-act on statutory clocks, auto-redaction will not run - until the city attests). The SYSTEM
    cannot be marked fully "live" until all required areas are attested.
    (Revisit-if-needed note: Kevin is open to softening to "operates with persistent warnings" if prospects
    react negatively. Implement HARD; keep the soft mode as a config flag so it is a switch, not a rewrite.)
  - Attestation is VERSION-BOUND: it records WHAT was attested (a snapshot/version hash of that area's config),
    WHO (name + role), and WHEN. 
  - RE-ARMS ON MATERIAL CHANGE: editing a field in an attested area flips that area back to "needs
    re-attestation" (and back to safe/manual until re-attested). Stale attestations never silently persist.
  - This doubles as the AUDIT TRAIL / liability shield: if a city later disputes a missed deadline or wrongful
    withholding, Optimum Q can show exactly what content the city reviewed and signed off on, and when.

2.4 WHO may attest
  - Restricted to an elevated, authorized role (records officer / city attorney / SYSTEM_ADMIN-class), NOT any
    staffer. The point is that a responsible human WITH AUTHORITY accepted the legal content. Role scaffolding
    already exists (requireRole).

2.5 The DISCLAIMER (legal artifact - ATTORNEY REVIEW REQUIRED)
  - On clicking attest for an area, a modal presents: AI configuration is assistive only; the city is solely
    responsible for accuracy and legal compliance; the city confirms it has reviewed, modified, and corrected
    the content as needed; responsibility for the configuration rests with the city. Click-to-agree records
    the attestation record (2.3).
  - The FINAL disclaimer / indemnification wording MUST be reviewed by an attorney before launch. Optimum Q
    (and this system) should not be the last word on indemnification language. Draft text lives in the spec as
    a placeholder marked ATTORNEY-REVIEW.

2.6 Provenance vs attestation - keep BOTH (they do different jobs)
  - Per-FIELD provenance + confidence = fine-grained, feeds and accelerates REVIEW.
  - Per-AREA attestation = coarse, version-bound, one sign-off covering that area's current version, GATES
    go-live. Field provenance informs the human; area attestation authorizes the launch.

================================================================================
## 3. UI ARCHITECTURE: hub-and-spoke (decided 2026-06-24)
Configuration STAYS DISTRIBUTED - each area is configured inside its own existing UI section (fees in the fee
section, exemptions in redaction, etc.). This matches what is already built and is correct: editing a fee rule
vs an exemption are different tasks, different controls, different expert reviewers (fee clerk vs city
attorney). Do NOT rebuild specialized editors inside a mega "rules" screen - that is duplication that drifts.

ADD one thin global hub that does NOT duplicate editors - it links into them:
  JURISDICTION SETUP / COMPLIANCE HUB (new, thin) owns only the inherently-global concerns:
    - Address / jurisdiction resolution (Section 4).
    - Source registry + admin uploads (Section 5).
    - The "Run auto-config" action (kicks off the domain extractors).
    - READINESS DASHBOARD: each area's state (drafted -> reviewed -> attested -> live) with version + who
      signed off + last re-validated. Each row DEEP-LINKS into that area's own editor for the actual review and
      correction. The area's existing review flow ends with the attest button; its status rolls UP to the hub.
  Result: one obvious "am I ready to go live, and what still needs review?" screen, without rebuilding any
  editor twice. The hub is mostly status + navigation + the few truly-global actions.

Each existing area editor (fee config, redaction rules, taxonomy, future deadline config) gains, uniformly:
  - a provenance/confidence layer on auto-populated fields,
  - a review surface that surfaces low-confidence / not-found items,
  - an attest step at the end,
  - status reporting up to the hub.

================================================================================
## 4. ADDRESS -> JURISDICTION RESOLUTION (a precedence stack, not a lookup)
A city sits under a STACK of law: federal + state + (sometimes) county + municipal. The profile must resolve
the stack and MERGE WITH PRECEDENCE - local overrides state ONLY where the state permits it.
  - HOME-RULE vs DILLON'S-RULE matters: in some states a city may set its own fees/procedures (home rule); in
    others it may only do what the state authorizes (Dillon's rule). The resolver must know which, because it
    determines whether a municipal ordinance can legally override a state default at all.
  - Extends the principle already adopted ("state is a configuration LAYER, not a product variant") DOWN to the
    municipal layer: federal layer -> state layer -> county layer -> municipal overrides, each a set of
    fields/segments, merged by precedence rules that themselves are part of the state profile.
  - Output of resolution = the jurisdiction "stack" the extractors then populate and the city attests.

================================================================================
## 5. SOURCE REGISTRY + RETRIEVAL + FRESHNESS (the real bottleneck)
Getting accurate, CURRENT source text - and knowing when a law has CHANGED - is harder than the extraction and
is the main accuracy risk.
  - SOURCE REGISTRY: a curated, per-jurisdiction list of where the governing text lives (state code sites;
    municipal code hosts e.g. Municode / American Legal Publishing; AG opinion repositories; the state open-
    records counsel schedules). Curating these once per state is high-leverage and is legitimate Optimum Q IP.
  - ADMIN UPLOAD: the city can upload supplemental documents (their ordinance PDF, fee schedule, retention
    policy). Uploads feed the SAME extraction -> review -> attest path as fetched sources; they carry the same
    provenance.
  - FRESHNESS / RE-VALIDATE: every populated area records the source version/date it was built from. A
    "re-validate" concept lets the system (or staff) re-pull sources and flag fields whose source text changed
    -> those fields/areas drop to "needs re-attestation". Laws change; the system must detect drift, not rot
    silently.
  - RETRIEVAL is a capability concern: reliable current retrieval may need web/document tooling; design the
    extractor interface so the SOURCE-FETCH step is pluggable (fetched URL, uploaded file, or pasted text - all
    produce the same "source document" the extractor reads).

================================================================================
## 6. THE AUTO-CONFIG AGENT(S): domain extractors
feePolicyExtract is the PROTOTYPE of the whole agent - it already does cited, confidence-scored, reviewable
extraction with a propose-then-apply flow. Generalize that pattern into a family of DOMAIN EXTRACTORS, one per
configurable area, all sharing: source-document in -> {proposed fields with citation + confidence, provenance,
notes on what was not found} out -> review queue -> attest.
  - FEE / ESTIMATE extractor (exists; extend to the richer schema - Section 6.1).
  - DEADLINE / CLOCK extractor (new) - acknowledge/respond/produce/appeal windows, calendar basis, tolling
    triggers (Section 7).
  - EXEMPTION / REDACTION extractor (new) - populates the Exemption Reference Library (Section 6.2).
  - APPEAL / REVIEW-MODEL extractor (new) - which exemption_model applies + its parameters (Section 6.3).
Each is source-driven (not paste-only), emits the area's schema, and routes to that area's review surface.
The "Run auto-config" hub action fans out to all extractors for the resolved jurisdiction stack.

================================================================================
## 6/7. THE INSTRUCTION-SET CATALOG (the completeness contract)
A written enumeration of EVERY axis the system can be configured along, per domain. It is the spec of the
"slots" the agent fills and the guarantee behind objective (1). Page one already exists (CITY_FEE_SURVEY.md
fee gaps). Maintain it as the master list; building an area = making it able to express every axis here.

6.1 FEES / ESTIMATES axes (consolidated from CITY_FEE_SURVEY.md gaps)
  - Per-driver { rate, BILLABLE yes/no + basis-cite, billableWhen {trigger: pages|minutes|hours|none,
    threshold, mode: all_or_nothing|free_then_bill} }.  [THE switch - unlocks CA/NY/OH no-labor, TX 50-pg gate,
    FL "extensive", NY ">2hr prep", CO/TN/MA first-hour-free.]
  - Labor OVERHEAD percentage (TX +20%).
  - Requester-PURPOSE schedule switch (commercial vs non-commercial; AZ/IL/federal) - selectable profile
    VARIANTS by request.purpose; extends the engine's existing `context` (FR/SS) selector.
  - TIERED / graduated rate bands (3+ volume bands).
  - Per-estimate ACTUAL-employee-rate override (FL/NY/TN "lowest-paid capable employee").
  - Already covered: flat per-page, actual-cost drivers, media, A/V per-recording+per-minute, free page
    allowance, flat free-labor-hours, deposit threshold+percent, min/max/de-minimis, certification, delivery,
    estimate clocks + >20% reconcile.
  - Statutory rate CAPS (CO ~$41/hr, MA ~$25/hr) = set rate <= cap (config value; note it is inflation-
    adjusted and needs periodic re-validation - Section 5).

6.2 REDACTION / EXEMPTION axes - the Exemption Reference Library must be ACTION-READY, not just a list.
  Each entry carries: category, citation, AUTO-REDACTABLE yes/no, REQUIRES-A-RULING yes/no, detection hints
  (patterns/keywords/record-type associations), jurisdiction scope. The redaction engine ACTS on these (auto-
  redact bucket vs legal-review bucket vs release-as-is) and the AI POPULATES them from statute. Bucketing
  mirrors the TX 3-bucket model already in JURISDICTION_RULES.md (auto-redact / AG-ruling / release).

6.3 APPEALS / REVIEW-MODEL + DEADLINE axes
  - exemption_model in {pre_clearance, self_appeal_court, self_court} EXPANDS into a small CATALOG of
    switchable, parameterized WORKFLOW SEGMENTS a profile turns on and configures:
      * AG / pre-clearance segment (TX): "request ruling" node + its clock + external-dependency + the
        clock-TOLL while pending. Exists only in pre-clearance states.
      * Internal-appeal segment (NY-style): appeal-to-officer node + its own window (e.g. 30d) + answer window.
      * Ombuds / mediation segment (some states).
    The workflow engine is already node-based; design these as a deliberate CATALOG of reusable segments, not
    ad-hoc nodes. A profile selects which segments exist and sets their parameters.

================================================================================
## 8. THE DEADLINE / CLOCK-TOLLING ENGINE (biggest MISSING primitive)
Today deadlines are simple knobs and the tickler watches INTERNAL clocks (estimate response, deposit, stall).
STATUTORY deadlines are a different animal and have NO real model yet. They need their own design+build:
  - CALENDAR BASIS: business days vs calendar days, plus a per-jurisdiction HOLIDAY SET. (Texas business-day
    math, observed holidays, etc.)
  - STACKED CLOCKS: acknowledge / respond / produce / appeal - each its own rule and window, possibly running
    in sequence or parallel.
  - TOLLING TRIGGERS: events that PAUSE and RESUME a count - clarification pending, payment/deposit pending,
    AG-ruling pending (Kevin's example), a permitted extension invoked. The "we must file for an AG hearing, so
    the clock pauses" case lives HERE and generalizes to extensions, appeals, ombuds.
  - The tickler's time-sweep machinery is the reusable SEED (same bones, richer rules). Build the statutory-
    deadline engine as an evolution of it, not a separate parallel system.
  - This engine deserves its OWN design doc before any more deadline logic is built.

================================================================================
## 9. DATA MODEL: the Jurisdiction Profile becomes the central versioned artifact
Today config is scattered and fee profiles are a separate thing. Auto-config wants ONE profile object with
SECTIONS (fees, clocks/deadlines, redaction/exemptions, appeals), where:
  - each FIELD carries value + source citation + confidence + approval state,
  - each AREA/section carries a version + attestation record (who/when/version) + readiness state,
  - the profile carries the resolved jurisdiction STACK (Section 4) and the source registry refs (Section 5),
  - VERSION HISTORY is first-class (laws change; re-validation and re-attestation consume it).
This is the artifact the hub dashboard reads, the editors write, the extractors populate, and the attestation
gates. Existing fee profiles fold into the "fees" section of this profile over time.

================================================================================
## 10. IMPACT ON WHAT IS ALREADY BUILT / IN SPEC (the change list)
Promoted from "nice follow-on" to FOUNDATIONAL prerequisites:
  - Fee-engine gaps 1-4 (CITY_FEE_SURVEY.md): the per-driver billable/trigger switch, overhead %, purpose-
    based schedule variants. These are the SLOTS the agent fills - not optional anymore.
Generalize, don't rebuild:
  - feePolicyExtract -> the template for source-driven domain extractors (Section 6).
  - The provenance + review + apply pattern from taxonomy discovery + fee extraction = the universal auto-
    config pattern; apply it uniformly to every area.
Re-home / centralize:
  - Scattered config + standalone fee profiles -> sections of one versioned Jurisdiction Profile (Section 9).
Expand in design:
  - Exemption Reference Library -> action-ready entries (Section 6.2).
  - exemption_model toggle -> catalog of switchable workflow segments (Section 6.3).
Reuse as seed:
  - Tickler clock machinery -> statutory deadline/tolling engine (Section 8).
New, thin:
  - Jurisdiction Setup / Compliance hub (Section 3).
Demo Mode (BACKLOG.md) interaction: a city's attested profile is part of "known demo state"; demo reset should
seed a fully-attested demo jurisdiction so the demo opens "live".

================================================================================
## 11. GO-LIVE GATE BEHAVIOR (decided: HARD)
  - Un-attested area = SAFE/MANUAL: usable by hand with a persistent "not attested - automation disabled"
    warning; NO automated action (no auto-pricing, no statutory-clock auto-action, no auto-redaction) until
    attested.
  - System cannot be flagged fully "live" until all REQUIRED areas are attested. (Which areas are "required"
    is itself a small config - e.g. fees + deadlines + redaction required; appeals required only if the
    jurisdiction has an appeal/pre-clearance model.)
  - Soft mode (operate-with-warnings) retained as a CONFIG FLAG for a future pivot, not a rewrite.

================================================================================
## 12. BUILD SEQUENCING (recommended)
The agent is NOT first. Slots first, then automation, then the gate that wraps them.
  1. Fee-engine instruction-set gaps 1-4 (the slots; CITY_FEE_SURVEY.md). Highest ROI, also needed regardless.
  2. Statutory DEADLINE / TOLLING engine design doc, then build (the missing primitive; its own doc).
  3. Jurisdiction Profile data model (versioned, sectioned, provenance + attestation fields) - Section 9.
  4. Generalized extractor framework (from feePolicyExtract) + the per-area review surfaces + provenance layer.
  5. Attestation gate + readiness dashboard + Jurisdiction Setup hub (the trust wrapper) - Sections 2,3,11.
  6. Address->jurisdiction resolution + source registry + freshness/re-validate - Sections 4,5.
  7. Remaining domain extractors (deadlines, exemptions, appeals) + exemption-library action-readiness +
     workflow-segment catalog - Sections 6.2,6.3.
Rationale: each step is usable on its own and each makes the next easier. The gate (5) is meaningful only once
there are populated areas (1-4) to gate.

================================================================================
## 13. OPEN QUESTIONS / FLAGS
  - ATTORNEY-REVIEW: final disclaimer + indemnification wording (Section 2.5). Draft only until counsel signs.
  - Retrieval tooling for live source fetch (Section 5) - capability dependency; design fetch step pluggable.
  - Holiday-set sourcing per jurisdiction (Section 8) - where do observed-holiday calendars come from.
  - Colorado labor-hour ROUNDING direction unresolved (FEE_ESTIMATE_KNOWLEDGE.md divergence) - verify before CO.
  - "Required areas" definition for the go-live gate (Section 11) - finalize the default set.
  - How aggressively to model the long tail pre-market (Kevin leans maximalist per objective 1) - the catalog
    (Section 6/7) is where that line gets drawn; revisit as it is filled in.
