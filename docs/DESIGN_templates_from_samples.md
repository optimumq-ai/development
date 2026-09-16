# Estimate + redaction templates seeded from actual record samples

**Status:** Kevin took all seven recommendations (D1–D7) on 2026-09-16; **S1 BUILT** the same day (`verify_templates_from_samples` 43/43, plus the Estimate chip on the taxonomy list and inventory row pulled forward from S3). S2–S4 open. Originally: DESIGN for Kevin's decisions — 2026-09-16. Markup item 7 ("save a template at done when none exists for the
record type/variant; static vs floating vs ad-hoc layouts; simple vs complex redaction content"). Nothing built.
**Authority:** this document > the item-6 canvas annotation `templates` > the two live screens. Binding specs once built:
`SPEC_redaction.md` §5 (templates), `SPEC_fees_estimates_payments.md` §2 (estimate profiles),
`SPEC_sources_imports_connectors.md` §6 (inventory rows).

## 0. Summary

A record type's two "templates" — WHERE to redact (a layout profile) and HOW MUCH it costs (an estimate profile) — are
today created by a separate, elevated act on a screen most staff never open. Item 7 moves both to the moment the evidence
exists: **the first time a document of a type/variant is actually redacted or a request for it actually closes.** Done
becomes a teaching moment: the completed work is offered as the seed, the human confirms in one act, and the inventory
row reports both postures. Two classifications are added so the offer is honest about what a template *can* do: a
**layout class** (static · floating · ad-hoc) and a **content class** (simple · complex). Together they select the
automation the type gets (§3) and the estimate driver that will move (§5).

Two measured findings (§7) change the mechanics: a redaction template seeded from ONE sample fails its own pile most
of the time under the current vocabulary matcher, and short forms cannot be told apart by vocabulary at all. So a
sample-seeded template must take its vocabulary from the census pile and be gated by the census fingerprint.

## 1. Current state (verified 2026-09-16, file:line in the session record)

- **Redaction templates** = `layout_profiles` (`kind='pages'` zones `[{page_no,x,y,w,h,rule_id,label}]`, or
  `kind='fields'` field map). Created only by `POST /redaction-templates` (supervisor+); from three doors: the redaction
  workspace in template mode (`?for_type=` carries the record type), the structured-fields page, and the redaction task
  screen's "⧉ Generate reusable template" — **which posts no `record_type_id`**, so its templates are invisible to the
  census posture (§1 finding A). No save step at task completion; completion = apply/burn + release stage.
- **Matching** = vocabulary only: the template's fingerprint is the alpha-token set of its ONE source file's text
  (numbers dropped, ≤600 tokens); the score is the share of those tokens present in the target's text; ≥ the template's
  `safety_threshold` (80) applies, below it HOLDS for a human. Not consulted: the census fingerprint (`docFingerprint`
  11 features incl. the `titleLines` veto) — the two systems never meet.
- **Census posture** per grouping (`sourceCensus.redactionPosture`) derives from the grouping's record type only:
  any non-deleted `layout_profiles` row for that type → *Redaction template ready*; else release posture → *No redaction
  template needed*; else `redact_by_hand` → *Redact by hand*; else `mass_redaction_candidate` → *Waiting for a redaction
  template*. Door "Start a redaction template" stages an example PDF and opens the workspace in template mode.
- **Estimate profiles** = `record_type_estimate_profiles`: six drivers (`searchHours reviewHours programmingHours
  bwPages colorPages oversizedPages`), Welford running mean + `sample_size`; `assess()` automates only at confidence
  `seeded|high` (n ≥ 3, CV ≤ 0.5) and total ≤ $200; a variant with no row reads its parent. **Write-back happens only at
  the staff manual `/reconcile`** — the measured-labor auto-draft deliberately never folds in (§4a). Reconcile happens
  only when there is a fee variance to notify, so most closed requests teach the profile nothing.
- **Variants** are `record_types` rows with `parent_record_type_id`; a template links to whichever id it was made for.
  `record_types.redaction_profile_id` is an unused placeholder.
- No code concept of static/floating/ad-hoc or simple/complex exists. Nearest: the parked anchor-relative zones
  ("semi-fixed", `SPEC_redaction` §6b) and the per-file disposition tiers Simple/Standard/Elevated/Legal.

## 2. The two classifications

### 2a. Layout class — where things are on the page (a property of the VARIANT)

| class | meaning | evidence the system already has | template that fits |
|---|---|---|---|
| **static** | same form, every field in the same place | census grouping `layout='uniform'`; fingerprint agrees on all 11 features | absolute zones (built) |
| **floating** | same form family, a variable-length section shifts what follows | grouping `layout='few_layouts'`, or `titleLines` agree while positional features differ | anchor-relative zones (§6b, parked) |
| **ad-hoc** | free text — letters, emails, memos, minutes, narratives | document ungrouped/singleton, or the type's groupings show no consensus | none by position; a **content profile** (§3) |

Stored as `record_types.layout_class` (`static | floating | adhoc | NULL=unknown`). **Derived by the census, confirmed
by the human at done** (§4 card, one pre-filled radio), editable on the taxonomy variant screen. Never inferred from a
single document alone: with no census evidence the offer says "unknown — you tell us".

### 2b. Content class — what gets redacted (a property of the TEMPLATE / the type's redaction work)

| class | meaning | test (deterministic, uses the §6a audit's rule→detector map) |
|---|---|---|
| **simple** | every redaction is a fixed field or a detectable datum (SSN, phone, DOB, account, email…) | every zone's cited rule maps to a datum detector, OR the layout is static (a fixed box needs no reading) |
| **complex** | at least one redaction is judgment-shaped (attorney-client, deliberative, investigatory narrative, medical narrative) | some zone's rule has no detector AND the layout is not static |

Stored as `layout_profiles.content_class`; recomputed whenever a template's zones change. Kevin's two words are kept;
the nuance is that a judgment-shaped redaction in a FIXED box on a static form is still automatable by position, so
"complex" only bites where the position is not fixed.

### 2c. What the pair decides

| | simple | complex |
|---|---|---|
| **static** | absolute-zone template · auto-apply + content audit (built today) | same template · audit is coverage-only (no detector) — built |
| **floating** | anchor-relative template · **propose + HOLD** until anchors are authored (§6b UI) | same, HOLD |
| **ad-hoc** | content profile · AI suggestion pre-scoped to the rule set + detector audit · human per document | human per document · disposition tier Elevated/Legal |

Nothing in the matrix mass-applies to a floating or ad-hoc type. That is the compliance line: partial-but-compliant
over fully-automated-but-wrong.

## 3. Template kinds — one new kind

`layout_profiles.kind` gains **`content`**: no zones; `field_map` unused; a `rule_ids` list (the rules the sample's
zones cited) + `content_class`. It is what an ad-hoc type gets at done. Consumers: the workspace's AI suggestion call
scopes its "flag these kinds" list to the profile's rules first (falls back to the whole library), the disposition
tiering reads `content_class`, and the census posture shows *Redact by hand · assisted* (a `content` profile never makes
*template ready*, because it cannot mass-apply). `redaction_profile_id` on `record_types` stays unused — the link is
`layout_profiles.record_type_id` as for every other kind.

## 4. Save at done — the redaction side

**Trigger:** the redaction task's completion modal (the existing time-log modal on RedactionTaskPage) when the
document's record type/variant has **no active or proposed** template of a usable kind. Also offered from the workspace
"Generate reusable template" button, which becomes the same card (finding A fixed: the card always carries the type).

**The card** (mockup session decides the visuals; content fixed here):
- header: *"Save what you just did as the redaction template for ‹variant name›?"* + the sample's facts: N zones on
  P pages, the rules cited (by title), from request ‹number› / file ‹name›;
- **layout class** radio, pre-filled from the census (§2a) with the evidence line ("census: 25 identical documents in
  Development Services Shared Drive") or *unknown*;
- **content class** shown, not asked (§2b), with the one-line reason ("all 4 rules are detector-backed");
- what will happen, in words, per the §2c matrix ("static + simple: future documents of this variant that match the
  template will be redacted automatically and audited; documents that do not match are held for a person");
- three doors: **Propose** (default) · **Not now** · **This variant is always redacted by hand** (= the existing
  `redact_by_hand` posture door, reversible, same audit row).

**What Propose writes:** a `layout_profiles` row `status='proposed'`, `source='sample'`, `record_type_id` = the variant,
`source_file_id` = this document, zones = the job's final zones (rule ids kept), `layout_fingerprint` = **pile
vocabulary** (§7 rule) when the document belongs to a census grouping, else the one-file vocabulary with the threshold
annotated *provisional*; `content_class`; plus `census_signature` (the grouping's consensus signature, new column) so
matching can gate on it. Audit: `processing_history` row *template proposed from sample* (shape facts only).

**Approval:** a supervisor+ (the existing template bar) approves from the **Inventory row** ("Redaction template
proposed from 2026-000048 · Review ›" opens the workspace in template mode with the zones loaded, Approve/Return) or from
Mass Redaction. Approve → `status='active'`; from then on the built §5 machinery runs unchanged. A supervisor doing the
redaction themself gets **Save** in place of Propose (direct to active).

**Floating:** Propose writes the same row with `layout_class='floating'` and `status='proposed'`; approval activates it in
**HOLD mode** — match-batch lists candidates and pre-places the zones as *suggestions* in the workspace, never burns —
until the anchor authoring UI (§6b) exists and anchors are set. The inventory row says *Redaction template (holds for
review)*.

**Ad-hoc:** Propose writes a `content` profile (§3). No approval bar needed (it burns nothing); it activates directly and
the row says *Redact by hand · assisted*.

**Zero zones at done:** no offer. A single clean document is not evidence that a type needs no redaction. After **3**
completions with zero zones the inventory row surfaces *"3 documents redacted with nothing to redact — consider No
redaction needed ›"* (the existing guarded release-posture door, unchanged).

## 5. Save at done — the estimate side

**Trigger:** request close (disposition close, deny-close, and the auto-release pipeline's close) — a server-side hook,
no modal: nobody is reliably present at close, and the confidence ladder is already the human gate.

**What is written**, through the existing `recordActuals` (Welford), tagged `source='sample'` on first write:
- `searchHours`, `reviewHours` from `laborActuals.rollup` when `hasActuals` is true (NULL/skipped timers contribute
  nothing and the request is not counted — never fabricated zeros; parent/child scoping per §4a's correction);
- `bwPages` = page count of the released files; `colorPages`/`oversizedPages` only when staff entered actuals (§2a) —
  otherwise 0 is NOT written (unknown, not zero);
- `programmingHours` never (no routed task produces it).
- Written to the record type the estimate was made for (a variant keeps its own row; parent fallback on read as today).
  A request with **no estimate** still teaches quantities (that is exactly the type that has no profile).

**What does not change:** `assess()`'s ladder (n ≥ 3, CV ≤ 0.5, ≤ $200, no profile → manual), the estimate task title,
the panel prefill ("based on 1 prior request" at n=1), the auto-draft's human-gated SEND. The only reversal is §4a's
rule that actuals fold in **only** at manual reconcile — replaced by "at close, when measured" (Kevin decision D2).

**Provenance on screen:** the estimate profile page and the inventory row's new column say *seeded (expert) · learned
from N requests · none yet*; a profile whose seed was never confirmed by a clerk keeps saying so (existing note).

**How the classes reach the estimate:** no new driver. Once a static+simple template is active, `reviewHours` for that
variant falls and the mean follows; an ad-hoc+complex variant's `reviewHours` stays per-page-read. The complexity-tier
pricing idea in `FEE_ESTIMATE_KNOWLEDGE.md` stays unbuilt (no legal sanction found).

## 6. Inventory row — the second status column

The grouping row (documents) gains **Estimate** beside **Redaction template**:

| Redaction template | Estimate |
|---|---|
| ready · proposed from 2026-000048 (Review ›) · holds for review (floating) · assisted (content) · waiting · by hand · not needed | seeded (expert) · learned from N requests · none yet |

Plus a small layout-class chip on the row (Static · Floating · Free text · —). Data kinds (data systems) keep *field
redaction template* only; estimates for data kinds are out of scope here.

## 7. Matching — two measured findings and the rule they force

Measured 2026-09-16 on the live census of Development Services Shared Drive (8 associated piles, 5 examples each,
`pdftotext -layout`, the production `tokenize`/score code):

| | same form, one-sample vocabulary | same form, pile vocabulary (intersection of 4) | different form, pile vocabulary |
|---|---|---|---|
| long forms (permits, applications; 51–61 terms) | **58–92** | 94–100 | ≤ 67 |
| short forms (BIR, CO, both Correction Notices; 15–16 terms) | 62–85 | 100 | **81–100** |

- **Finding B — false negatives.** A template built from one sample keeps that sample's filled-in words (names, streets,
  work descriptions), so a second document of the same form scores 58–92: below the 80 threshold much of the time.
  Every such document would be HELD. Pile vocabulary (tokens common to the pile's members) removes the data words and
  scores 94–100.
- **Finding C — short forms are indistinguishable by vocabulary.** Once the data words are gone, a 15-term short form is
  letterhead + a few labels, shared by every short form the city prints: Correction Notice (Standard)'s vocabulary scores
  **100** against Correction Notice (Extended) — the two planted layouts the census correctly split by `titleLines` and
  geometry. A vocabulary-gated template for one would burn the other's coordinates.

**Rule:** a template that carries a `census_signature` matches a target only if the target's census fingerprint
`isMatch`es that signature (11 features, `titleLines` veto) **and** the vocabulary score clears the threshold; a target
with no fingerprint yet is fingerprinted at match time (same extractor). Vocabulary alone stays only for legacy templates
with no signature, and their inventory row says *provisional match*. This applies retroactively to existing templates
whose source file sits in a censused source.

## 8. Slices (each its own session; full suite once per slice)

1. **S1 — substrate + safety (no UI):** `record_types.layout_class`; `layout_profiles.content_class`, `census_signature`,
   `status='proposed'`, `kind='content'`; the task screen's template save carries `record_type_id` (finding A); pile
   vocabulary + fingerprint gate in match/match-batch (§7); census posture reads proposed/holds/assisted; harness
   `verify_templates_from_samples` (matrix of §7 as fixtures: one-sample vs pile, short-form veto).
2. **S2 — the done card + approval door** (after a mockup session per the UI rule): completion-modal card, workspace
   card, Inventory row *Review ›*, chip, `processing_history` rows.
3. **S3 — estimate at close:** close hook → `recordActuals`; provenance strings; Estimate column on the row; profile
   page wording.
4. **S4 — floating HOLD mode** (match lists + pre-placed suggestions, never burns) — the bridge until §6b's authoring UI.

## 9. Kevin's decisions

- **D1 Approval shape.** Recommend: worker *proposes*, supervisor+ approves from the Inventory row; a supervisor doing the
  work saves directly. Alternative: any redaction worker saves directly (faster, but a first-day zone set would start
  burning the pile).
- **D2 Estimate learning at close.** Recommend: every closed request with measured actuals teaches the profile (ladder
  gates automation). Alternatives: first request only (seed, then reconcile-only as today); keep reconcile-only.
- **D3 Ownership level.** Recommend: redaction templates belong to the VARIANT; the estimate row belongs to the type the
  estimate was made for, parent fallback on read. Alternative: variant actuals also roll into the parent mean.
- **D4 Floating before anchors exist.** Recommend: propose + HOLD (candidates listed, zones pre-placed, never burned).
  Alternative: do not offer a template for floating variants until §6b ships.
- **D5 Fingerprint gate on matching.** Recommend: yes, and retroactively for existing templates in censused sources.
  Consequence: a template whose source was never censused matches on vocabulary alone and is labelled provisional.
- **D6 "Nothing to redact" evidence.** Recommend: never from one sample; surface the No-redaction door after 3 clean
  completions. Alternative: offer at the first clean completion.
- **D7 Layout class authority.** Recommend: census proposes, human confirms at done, editable on the variant. Alternative:
  census sets it silently (faster; wrong on the ungrouped 4%).
