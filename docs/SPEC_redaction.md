# Consolidated Spec — Domain 8: Redaction
**Current design only.** Verified against code + DB on 2026-07-08.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]`

## 1. Core model — layout vs law `[BUILT]`
The Replit-era design principle is implemented: **Layout Profiles** (`layout_profiles` — WHERE zones appear on a document type) are separate from the **Exemption Reference Library** (`redaction_rules` + `redaction_categories` — the LEGAL basis). A zone links to a rule; the rule carries the exemption citation. Managed on RedactionRulesPage.

## 2. Manual workspace `[BUILT]`
Per-document jobs (`redaction_jobs`) with drag-and-drop zones (`redaction_zones`), each zone attachable to a rule + note. Manual placement is the default working mode (Replit lesson). RedactionWorkspacePage.

## 3. AI zone discovery — suggest-only `[BUILT]`
AI reads the document's extracted text, flags exempt/sensitive spans, maps each to a rule from the library, then locates the words in the already-extracted **word-box data** and returns SUGGESTED boxes — coordinates are correct **by construction** (placed on real text, no coordinate guessing — the fix for the Replit-era unreliability). Suggestions are ephemeral; the user accepts/dismisses in the workspace.

## 4. Review pipeline `[BUILT]`
Job review stages: `pending_review → in_review → released`. **Apply = burn** (server-side): produces the released PDF + a **documentation sheet**, marks the job released, and writes the record into `fulfilled_records` (→ Domain 2 publication model). `review_auto_redaction` task type exists for mass-import output review `[task unrouted — Tasks spec]`. RedactionReviewPage.

## 5. Templates & batch application `[BUILT]`
Redaction **templates** (built from a sample document; `build_redaction_template` task from import ingest): create/edit/sample preview; **match** and **match-batch** (does a doc fit the template?); **apply** and **apply-batch** with candidate listing — the mechanism behind mass redaction of format-static groupings.

**Seeded from actual samples — S1 substrate `[BUILT 2026-09-16 — item 7 slice S1; verify_templates_from_samples 43/43]`**
(`DESIGN_templates_from_samples.md`; Kevin's D1–D7 all taken.) `POST /redaction-templates` is open to redaction workers, who
**propose** (`status='proposed'`, `source='sample'`, `proposed_by`, `proposed_from_request_id`); a supervisor+ saves directly
or approves (`POST /:id/approve`) / returns with a note (`POST /:id/return` → `status='returned'`, never matches). The task
screen's "Generate reusable template" now carries `record_type_id` (finding A) and proposes. Three kinds: `pages`, `fields`,
and **`content`** (no zones; `rule_ids`; activates directly for anyone allowed; never returned by match/match-batch; apply-batch
refuses it). **Classes:** `record_types.layout_class` (static · floating · adhoc · NULL unknown) — the census PROPOSES from the
grouping (`uniform`→static, `few_layouts`→floating), a human confirms by naming it in the save or on the taxonomy PATCH; never
set silently (D7). `layout_profiles.content_class` (simple · complex) — simple when every cited rule is detector-backed
(`redactionAudit.detectorForRule`) OR the layout is static; recomputed when zones change. **Matching rule (§7, D5):** when the
record type has a census grouping the template stores the grouping's `census_signature` and takes its **pile vocabulary**
(tokens common to the grouping's example members, `vocabulary_source='pile'`); `safetyScore` first requires the target's census
fingerprint (`docFingerprint.extractFeatures`, OCR second, computed at match time) to `isMatch` the signature — a veto returns
score 0 with `gate='fingerprint_veto'`, so match, match-batch, apply-batch and the mass-job worker all HOLD without change. A
template with no signature matches on vocabulary alone and is labelled **provisional** (list + inventory row). Retroactive:
`templateSeeding.backfillSignatures()` at boot adopts the census for existing templates whose type has a grouping. Measured in
the harness fixture: one-sample vocabulary 85 vs pile 100 on the same form; Standard-notice vocabulary 93 against the Extended
notice, vetoed to 0 by the fingerprint. NOT YET (S2–S4): the done card, floating HOLD mode, the estimate write-back at close.

## 6. Mass jobs `[BUILT]`
Durable, resumable, **chunked** background queue (`mass_redaction_jobs`): worker ticks every 60s; runs only inside a configured **work window** (start/end time); respects a **daily budget** cap; per-item error isolation with a merged error log. Feeds the review pipeline (§4). **Library destination `[2026-08-14]`:** each job carries `record_type_id`/`department_id` — where its request-less outputs shelve in the public library (defaulted from the template's linked type + owner department, human-editable at compose; request-attached files keep the request's own shelf). Binding detail: `SPEC_public_library.md` §2a.

**Role gate `[BUILT 2026-08-14, extended same day to the whole domain]`:** every redaction-work MUTATION across the processing surface takes the SHARED gate `middleware/auth.requireRedactionWork` — a redaction permission role (`REDACTION_WORKER`; the orphan `REDACTION_AUTHORITY` also accepted) or a supervising function role (`DIRECTOR`/`SUPERVISOR`; `SYSTEM_ADMIN` always passes). Covered: mass-jobs mutations + 911 triggers; workspace job/zone create-edit-delete, AI discover/suggest, apply, submit/begin-review/return, released-record publish (§2–4); template single-apply + stage (§5); rules-library create/edit/delete/discover + approve (§1); structured apply (§8); all AV mutations (§7); repository ingest runs. Deliberately UNCHANGED: templates' pre-existing stricter in-handler `isElevated` bar (create/edit/delete/dismiss/apply-batch — supervisor+ function roles incl. `DEPT_MANAGER`), rules-approve's own `isElevated` check, compute-only endpoints (template match/match-batch, structured preview), and ALL reads (`requireAuth`). Repository CONFIG (create/edit/delete/ai-configure/paper-index import) is `SYSTEM_ADMIN`/`DIRECTOR` — the redactionConfig EDIT precedent (see `SPEC_sources_imports_connectors.md`). Previously everything here was `requireAuth` only — any logged-in staffer could burn redactions across an archive.

**Audit trail `[BUILT 2026-08-14]`:** request-less processing work now has one — `processing_history` (insert-only; mirrors `request_history`'s actor columns, which couldn't serve because its `request_id` is NOT NULL). Written on: job created / paused / resumed / canceled / run-now (route, named actor); every worker chunk (`chunk_processed` — actor is the forcing user on run-now, else `Scheduled Batch`; counts + forced/completed flags); 911 connector generate / pull / run-pipeline, including the unattended daily batch. `details` is JSON of **shape facts only** (counts, ids, names) — never covered text (§6a's no-PII-in-logs rule). Read back via `GET /api/mass-jobs/:id/history`. Failed audit writes log loudly but never abort the work they describe. No UI surface yet (UI rule: design session first).

## 6a. Content audit — the per-item reliability check `[BUILT 2026-08-14 — Kevin's idea; verify_redaction_audit 14/14]`
Every zone-based apply (`redactionApply`) now runs a deterministic **content audit** before burning: the words under each zone are known from the text layer, and each zone's cited rule maps by title keyword to a datum detector (SSN, phone, email, card, date of birth — `services/redactionAudit`). Three checks, all **advisory** (flags never block a release): a box that **covers no text** (drift), a box whose covered text **doesn't contain a complete value of the kind its rule names** (partial/wrong coverage — Kevin's "part of a word / partial phone number"), and the **leak scan** — a value of a kind this job redacts still visible OUTSIDE every box (the under-redaction direction). Flags carry only shape facts (zone number, page, expected kind, character count) — **never the covered text**, which is the PII being redacted. They persist on `redaction_jobs.audit_flags`, surface per-file in the batch-results screen ("Content check: …"), and roll into the mass job's issue log. Rules with no detector (attorney-client, deliberative…) get the coverage check only. The structured/fields path is exempt (whole-column withholding has no zones). **Parked/future** (recorded 2026-08-14): the image-crop + AI-vision variant of this audit for scanned pages — same design, activates for documents with no text layer; carries a PII-retention question (crops are concentrated PII) and real vision-call volume, so it ships with the scanned-archive work, not before.

## 6b. Parked designs — anchor-relative zones (semi-fixed templates) `[DESIGNED 2026-08-14 — build needs a mockup session with Kevin first]`
Kevin's semi-fixed-template case: a variable-length insert section shifts everything below it, so absolute zones burn the wrong spot. Agreed design: **anchor-relative zones** — a template zone may be positioned relative to an anchor phrase ("N points below 'Section 3 — Applicant History'") found deterministically in the target's text layer (word coordinates already stored); the benchmark document supplies the offsets. Constraints that make it reliable: single variable section per template to start; **anchor not found on the expected page, or a computed zone running off the page → the document is HELD for human review** (the existing below-threshold pattern) — every failure mode degrades to a human look, never a wrongly-placed burn. This also absorbs print-driver drift (uniform shift/scale corrected from anchors) with no OpenCV: pixel-level registration is needed only for scans, which live with the OCR future work. NOT built: the template-editor authoring UI ("this box moves with this text") is a visual design Kevin decides from mockups per the UI rule. Also future: multi-section flows, cross-page zone flow.

## 7. AV / video redaction `[BUILT]`
Server-side A/V **burn** from zone JSON produced in the AV workbench (`av_redaction_tasks`, AvWorkbenchPage) — server-side by design (Replit lesson; no browser-side shortcut).

## 8. Structured-data redaction `[BUILT]`
FIELDS mode for structured records exported as CSV: officer marks exempt **columns** → values are **dropped** → a clean "born redacted" PDF + a **Fields Withheld index** is rendered. Key property: an exempt value is **never written** to the output. StructuredRedactionFieldsPage.

## 9. Known gaps
- **auto_publish automation** — the record-type flag exists (Domains 2/3), but the mass-job pipeline does NOT auto-publish on release; publishing remains the explicit staff toggle. `[flag present, automation NOT BUILT — resolves the Domain 2 open item]`
- Dedicated redaction **task screen** `[NOT BUILT]` — the redaction task routes but opens request detail; the workspace exists but is not the per-task processing UI (Tasks spec §6).
- **Legal Redaction** role/path for `sensitive` record types `[NOT BUILT]` — Tasks spec §7; sensitive flag existence unverified.
- One `redaction_profile_id` per record type — variant-level profiles blocked on the taxonomy decision (Domain 3).
