# State Public-Records Configuration Discovery — Research Prompt **V2**

> **Draft for red-line, 2026-07-20.** Built on the Arizona V1 prompt (which was strong) + the three
> conversation turns that followed. Destined for `optimumq-ai/state-law-search-data`. `{{STATE}}` is a
> placeholder so one prompt drives all 50 states.

---

## What changed from V1 — read this first, then the prompt below

V1 was excellent at **anti-fabrication** (source hierarchy, current-law verification, quotation
confirmation). All of that is **kept verbatim in spirit** — do not weaken it. V2 changes only two things,
because V1 had exactly two failures (confirmed against the Arizona working copy):

1. **Scope (dilution).** V1's 27-area list read as a *collection mandate* — "go find rules for each" — which
   padded the output and pulled in legal background. **V2 replaces it with a single inclusion TEST**, demotes
   the enumeration to a *coverage checklist*, and names an explicit **Remove list** and **three keeper-slivers**.
   (The Arizona run's own "V2 inclusion principle" and "Items to Remove" already converged on this — V2 just
   makes it the gate instead of an afterthought.)

2. **Shape (organization).** V1's output was a flat list of mixed-grain labels with relationships and clocks
   buried in prose, so it could not be grouped or parametrized. **V2 adds five structured columns** —
   `Concept Key`, `Config Home`, `Clock Effect`, `Clock Spec`, `Related Rule IDs` — and one **grain rule**
   (one atomic rule at one level per row). These are *columns*, not schemas/JSON — the V1 "no software design
   in output" guardrail stays intact.

Everything else — municipal scope, source restrictions, authority treatment, the QC checklist — carries over.

---

## Objective

Research **{{STATE}}** and identify explicit **operational rules governing how a single municipal
public-records request is processed**, so the results can later be reviewed and condensed into a
cross-state, parameterized configuration library.

Exploratory discovery and documentation only. Do **not**: judge compliance, give legal advice, resolve
ambiguity, decide whether a specific record is disclosable, predict litigation, design the software, or
build a national taxonomy. Preserve uncertainty; accuracy over rule count.

State the **research date** at the top of your response, and the most recent legislative session reviewed.

---

## THE INCLUSION TEST (this is the scope gate — apply it to every candidate rule)

> **Include a rule only if the platform would _do something differently_ while handling an individual
> request because of it** — set or gate a value, start/stop/adjust a clock, require a notice or document,
> permit or block an action, route or classify the request, or move it between states (including ending it).
>
> **If nothing in the software changes during request handling, EXCLUDE it** — and record it in the
> **Excluded** list (below) with a one-line reason.

This test does the work the old 27-area menu tried to do, without padding and without dropping the useful
sliver hiding in an otherwise-irrelevant section.

### Presumptively OUT (the Remove list — exclude unless a specific rule passes the test above)
Government organization · officer/public-body definitions · archive governance · historical preservation ·
routine records-retention & destruction schedules · annual destruction reports · State Library / records-authority
administration · general recordkeeping obligations · attorney-fee provisions · civil damages · criminal penalties ·
legislative findings, history, or proposals · general transparency-policy statements.

### The THREE keeper-slivers (these live inside "out" sections but PASS the test — keep them)
1. **Custodian designation / who-must-respond / wrong-department routing** — lives under *definitions of
   officer*, but it drives **routing**. Keep.
2. **A preservation hold triggered by the request itself** (or by an appeal/litigation on that request) —
   lives under *retention/preservation*, but it is a **state the request enters**. Keep. (Routine retention
   schedules: still out.)
3. **Deemed / constructive denial trigger** — lives under *enforcement* next to damages/fees you are cutting,
   but the *trigger* ("silence for N days = denial") is a **clock with a terminal event**. Keep the trigger;
   drop the remedy amount.
   - Also keep any **definition the software branches on** — e.g. *commercial purpose* (drives the fee
     basis), *custodian* (drives routing). A blanket "cut definitions" would wrongly drop these two.

### Coverage checklist (NOT a collection order — a map of where to look)
Use these only to check you *looked*, and to report areas with **no explicit rule** as material negative
findings. Do not manufacture a row per item.

Requester eligibility · government/municipal coverage · intake & submission · scope & clarification ·
classification · deadlines & time calculation · search & record identification · custody & routing ·
communications/notices · production & inspection · electronic records & format · fees · payment/deposits ·
redaction & segregability · denials · administrative/AG review · appeals · enforcement *(trigger only)* ·
request tracking *(only if legally required)* · special record types *(only those that alter processing)*.

---

## Primary output — one table, these columns

| # | Column | What goes in it |
|---|--------|-----------------|
| 1 | **Rule ID** | `{{ST}}-0001`, sequential, no gaps. |
| 2 | **Authority Scope** | Generally Applicable · Municipal-Specific · Local-Government General · Agency-Specific Model · Record-Specific · Judicially Established. (Retention/Preservation only for the keeper-sliver hold.) |
| 3 | **Category** | Broad subject (Intake, Clarification, Deadlines, Search, Custody/Routing, Communications, Production, Inspection, Fees, Payment, Redaction, Denials, Review, Appeals, Enforcement, Special Records…). The *subject*, one. |
| 4 | **Concept Key** ⭐ | A short, stable slug naming the specific configurable concept, `family.thing` form — e.g. `intake.acknowledgment_window`, `fee.copy_rate_per_page`, `clarification.nonresponse_abandonment`. **If a shared concept dictionary is supplied with this prompt, MAP to an existing key when one fits; otherwise coin a new key AND list it in "Proposed Concept Keys" (SUGGEST).** This is the cross-state join key — two states' rows for the same concept must carry the *same* key. |
| 5 | **Legal Concept** | Prose name, preserving {{STATE}} terminology. (Human-readable companion to the slug.) |
| 6 | **Rule Type** | Requirement · Prohibition · Permission · Discretion · Definition · Classification · Deadline · Trigger · Exception · Presumption · Calculation · Remedy. Primary type; note a secondary in Notes. |
| 7 | **Config Home** ⭐ | `parameter` = a value/threshold/rate/window/enum the city fills in. `structural` = a step, branch, state, or path the engine must be able to *execute* (a required notice, an internal-appeal stage, {{STATE}}'s bespoke review paths). Routes the rule to the right home in the config system; keeps state-specific *forks* from being mislabeled as *values*. |
| 8 | **Atomic Rule** | Exactly one rule, one level. Actor · action/prohibition · trigger · key condition · resulting deadline/outcome. Stay close to source; add no conclusion the authority does not state. |
| 9 | **Trigger / Conditions** | The facts/events that activate it. "None stated" if unconditional. |
| 10 | **Clock Effect** ⭐ | One of: `none` · `sets-deadline` · `tolls` · `pauses` · `restarts` · `resets` · `terminal`. This is the **filterable timing dimension** — the field a later calendar/tolling pass queries. Most rows are `none`; that blank is itself signal. |
| 11 | **Clock Spec** ⭐ | If Clock Effect ≠ none: the value + unit + start event, short — e.g. `5 business-days from request receipt`, `30 calendar-days from clarification sent`. Human-readable; not JSON. |
| 12 | **Related Rule IDs** ⭐ | IDs of rules this one attaches to — the exception it modifies, the notice a deadline is attached to, the terminal event a clock leads to. **Moves relationship out of Notes and into a parseable cell.** An atomic split without this loses information the source sentence carried. |
| 13 | **Source Language** | Minimum quote to preserve meaning. Short. If wording is unverifiable: no quotation marks, cautious summary, flag in Notes. |
| 14 | **Source Authority** | Precise cite (`Ariz. Rev. Stat. § …`, session-law chapter/year, AG opinion no./date, rule citation, case + citation). |
| 15 | **Source Type** | Constitution · Statute · Session Law · Administrative Rule · AG Opinion · Appellate Decision · Official Guidance · Official Form · Agency Procedure. |
| 16 | **Effective Date / Status** | Current · Effective [date] · Amended effective [date] · Delayed · Enacted-awaiting-effect · Superseded · Repealed · Requires manual verification. Never blank. |
| 17 | **Direct Official Link** | Most direct official source. No search-engine URLs. No private substitutes. |
| 18 | **Notes** | Ambiguity, applicability limits, conflicts, secondary rule type, manual-verification needs, human-legal-review flags, later-pass issues. No legal advice, no config recommendations. |

⭐ = new in V2. Columns 10–11 may be collapsed into one delimited cell (`sets-deadline | 5 business-days | from request receipt`) if you prefer a narrower sheet — keep them parseable either way.

---

## Grain rule (fixes the mixed-level output)

**Every row is one atomic rule at one level.** Do not emit a whole-subject bullet ("Requester eligibility")
next to a single narrow rule ("portal acknowledgment exception"). If a provision bundles a requirement and a
permission (notice a fee estimate *and* accept advance payment), split them into separate rows and **link
them with Related Rule IDs** — never leave the linkage in prose. Do not fragment a balancing test or a
conjunctive exemption; keep those in one row and explain the conjunction in Notes.

---

## Everything below is carried over from V1 — apply unchanged

**Anti-fabrication (do not weaken):** Use only official {{STATE}} government/judicial sources this pass.
Verify current law — do not trust a handbook/FAQ/manual to hold the latest statute; check the codified
statute and recent enacted session laws; a bill is not law merely because it passed a chamber. Prefer the
most direct source; open PDFs to the relevant pages rather than trusting snippets. Confirm every quotation in
the opened source; if only a title/snippet was available, do not quote and flag manual verification.

**Authority treatment:** Preserve shall/must (mandatory) vs may (permitted) vs shall-not (prohibited) vs
should (advisory). Do not rewrite discretion as duty or guidance as law. Preserve undefined standards
("prompt", "reasonable", "unduly burdensome") as source terms — do **not** convert an undefined standard into
a fixed number.

**Source hierarchy** (higher governs lower; lower may explain but not override): Constitution → codified
statutes → enacted session laws not yet codified → administrative rules → published appellate decisions →
formal AG opinions → records-authority directives → official guidance/manuals/FAQs/forms → training material.
When a guide conflicts with a statute, the statute governs and you note the guide's inconsistency.

**Duplicate handling:** Do not create a second row because a handbook paraphrases a statute — cite the
statute, mention the handbook only if it adds a distinct operational practice. When a later authority
modifies an earlier one, mark the earlier limited/superseded rather than presenting both as controlling.

**Case-law boundary:** No exhaustive case review. Include a decision only when it's from an official source,
clearly establishes an operational rule not stated in statute/rule/AG-opinion, and can be stated without
predicting new facts. Give the narrow holding; don't automate a balancing test.

**Special records / exemptions:** Do not inventory every confidentiality statute. In a **separate** table
(`Special Record Types & Exemptions Identified`: Record Type | General Rule | Operational Process Created |
Source | Status | Link | Notes), include only those that create a distinct workflow, special notice, review,
redaction, qualification, fee treatment, or production method. Flag rules that require human legal review.

---

## Final deliverables

1. **Research date & current-law statement** — date, session reviewed, whether codified statutes were
   available, any gap between guidance and current law.
2. **Primary rule inventory** — the 18-column table. Group rows by Category for readability but keep
   sequential Rule IDs.
3. **Special record types & exemptions** — the separate, selective table.
4. **Proposed Concept Keys (SUGGEST)** ⭐ — every new `Concept Key` you coined that was **not** in the
   supplied dictionary, each with a one-line definition and the Rule IDs using it. *(This is what feeds the
   reconciliation pass and grows the shared dictionary. If no dictionary was supplied, ALL your keys are
   proposed — list them all.)*
5. **Structural branches identified** ⭐ — every rule marked `Config Home = structural` that represents a
   {{STATE}}-specific *path or stage* (not a routine step), one line each. These are the forks the engine must
   express, distinct from parameter values.
6. **Coverage matrix** — each checklist area: Researched-rules-found · Researched-none-found · Partial ·
   Source-inaccessible · Deferred. Do not claim exhaustiveness because every row has a status.
7. **Excluded (with reason)** ⭐ — material you found and deliberately left out under the inclusion test, one
   line + reason each. The audit trail for the scope decision.
8. **Material negative findings** — areas with no explicit rule (no fixed acknowledgment deadline, no
   clarification clock, no statewide municipal fee rate…), stated cautiously; absence of a found rule ≠ proof
   none exists.
9. **Gaps & later-pass questions** — inaccessible sources, verification issues, topics needing AG/case/
   municipal-association passes, balancing tests unsuitable for automatic configuration.

## Quality control (verify before returning)
Every primary row has a direct official source · every quotation confirmed in the opened source · statutes
current or status qualified · recent session laws considered · guidance not mislabeled as law · agency
procedures not presented as municipal requirements · possession/custody/control not conflated · "prompt"/
"reasonable" not converted to fixed numbers · ordinary vs special fee rules separated · exemptions don't
overwhelm processing rules · **every row has a Concept Key** · **every row has a Config Home** · **every
Clock Effect ≠ none has a Clock Spec** · **atomic-split rows carry Related Rule IDs** · the Excluded list is
populated (an empty one means the inclusion test wasn't applied).

## Prohibited output (unchanged from V1)
No software architecture, database schemas, code, YAML, JSON, config files, screen designs, workflow
recommendations, compliance determinations, legal advice, litigation predictions, a national taxonomy, or
claims of exhaustive coverage. *(The V2 columns are discovery fields, not software design — they record
facts found in the source.)*
