# Spec — Record-Search Task Screen (single-record)

**Status:** DRAFT for build. Drafted 2026-07-09 from a design session with Kevin. Companion to `SPEC_record_search_fulfillment.md` (Domain 7 §3, the `[NOT BUILT]` task screen) and `MASTER_task_types_permission_groups.md` (task type `record_search`, screen `[NOT BUILT]`).
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[NEW]` (introduced by this spec).

**Scope.** The dedicated screen a Fulfillment Staff (Record Search) member sees when they click a `record_search` task in **My Tasks**. Single-record only — the MRR Multi-Record Search task (`mrr_search`) is a separate, hand-assigned flow (`MASTER` A2) and out of scope here. Mirrors the proven `EstimateTaskPage.js` pattern: load task via `GET /tasks/:taskId`, header + request context, one focused work surface, action drives completion.

Route: `record-search/:taskId` → new `RecordSearchTaskPage.js` (parallels `estimate/:taskId`). `MyTasksPage` currently sends every task to the generic `/requests/:id` workspace (line ~162); it must route by task type (`estimate`→estimate screen, `record_search`→this screen, `redaction`→redaction screen, else→workspace).

---

## 1. Gating — when does a search task exist at all?

The screen is the endpoint of a branch decided at intake. Not every request reaches it.

| Intake outcome | Search task? | Notes |
|---|---|---|
| Requestor **selected** record(s) from results | **No** | Request proceeds carrying the selected records. |
| Selected record(s) came from the **public library** (already-released / public-ready) | **No search AND no redaction** | Straight toward delivery — already redacted & released. |
| Results **shown but none selected** | **Yes** | Intake results travel with the request as "already shown — reasonable to exclude" (§3). |
| **No results**, or a PATH (b) format (email/audio/photos/DB/paper) that skips intake search | **Yes** | Opens on the format-appropriate view (§4–5). |

> **Gating status — VERIFIED unbuilt (2026-07-09).** Neither §1 gating rule exists today. `workflowEngine.onIntake` → `buildSignals` → `evaluate(workflow_rules)` routes purely on classifier signals; **there is no "records selected" signal**, and `request_selected_records` is **never referenced in any service** (written at submit, read by nothing in the workflow path). The 4 seeded rules only ever route to `intake` or `record_search`: `wfr-sensitive` (pri 5, flags→hold), `wfr-confident` (pri 20, conf≥70 + owner team → `record_search`), `wfr-uncertain` (pri 30 → intake), `wfr-fallback` (pri 100 → intake). So a confident match **always** goes to `record_search` regardless of what the requestor selected.
>
> **Build recipe (mostly data, minimal code):**
> 1. Add two signals to `buildSignals` from `request_selected_records` (data already persists): `selected_count` (row count) and `selected_all_public_ready` (all rows where `source_system = 'Fulfilled Request Index'` OR `public_availability = 'available'` — the markers `recordSearch.searchPublicReady` / `publicChat` stamp on library picks).
> 2. Add two `workflow_rules` rows (data, no engine change), slotted below `wfr-sensitive` but above `wfr-confident`:
>    - `wfr-selected-public` (~pri 10): `selected_count ≥ 1` AND `selected_all_public_ready` → stage `delivery` (skip search AND redaction — already released).
>    - `wfr-selected-private` (~pri 15): `selected_count ≥ 1` → skip search → `redaction_review` / `fee_review`.
> 3. Both caveats already handled: `wfr-sensitive` stays highest (a sensitivity flag holds even if a record was selected); routing a public-ready pick to `delivery` still passes the existing release gate (`feeRelease`, `[BUILT]`), so unpaid balances are still enforced and skipping redaction is correct.
> The engine's condition operators (`is_true`, `gte`, `contains_any`, …) already support these rules.

---

## 2. Carried-forward intake context

The screen opens with what the requestor was already shown, so the searcher doesn't re-surface rejected records and can document that the requestor saw them.

- **Selected records** `[BUILT]` — persisted at submit to **`request_selected_records`** (`record_id, title, source_system, public_availability`) with a `RECORDS_SELECTED` history row (`publicChat.js` /submit).
- **Shown-but-unselected candidates** `[NOT BUILT]` — **not persisted anywhere today.** Search results at intake are ephemeral in the chat. To render the "already shown to requestor, not selected → exclude" section, submit must persist the full candidate set. Proposed: `request_intake_results` `[NEW]` (or add a `selected` flag to `request_selected_records` and capture all), written where results are produced in `publicChat.js`.

---

## 3. Format toggle — one screen, four views

The AI/taxonomy already stores physical format, so the screen defaults to it and lets the searcher correct it.

- **Source of truth:** `record_types.formats` (JSON: `video|pdf|structured_data|email|physical|mixed`) + per-repository `record_type_repositories.format`. The classifier assigns **one** record type per request, so each request has a clean primary `formats` array.
- **Default:** union across the request's record type(s); pick the dominant one. **Toggle stays visible** so the searcher can flip if the AI got the format wrong.

| Toggle view | Maps from `formats` |
|---|---|
| **Digital** | `pdf`, `structured_data`, `email` |
| **Audio / Video** | `video` |
| **Paper** | `physical` |
| **Other** | `mixed` / unrecognized (hard-drive copy, phone/device contents, screenshots) |

---

## 4. Per-format behavior

### 4a. Digital `[reuse existing]`
Live keyword + semantic search across connected systems → review results → attach/select files. Backed by the `recordSearch` engine (`[BUILT]`, §1 of the fulfillment spec) and the existing `RecordsPanel` / `DocSearchPanel`. Results filtered/prioritized to digital sources.

### 4b. Audio / Video `[NEW UI over existing connectors]`
"Search" here means **locate the asset**, never search events *inside* the media.
- Query by metadata — case #, date-time window, location, camera/unit (Axon connector exists, labeled body-worn/in-car).
- Each result is an **asset card**, not a moment.
- On attach, the searcher may add a **time-range / event scope note** (e.g. "10:14–10:22, traffic stop"). This scope note **travels downstream** to the AV redaction workbench (`AvWorkbenchPage`, `av-redact/:requestId/:fileId`) — the searcher hands off "here's the clip and roughly where the relevant part is"; the redactor does the in-video work. No in-video content search anywhere in the pipeline.

### 4c. Paper `[NEW]`
- Archive-index search (`paper_index_items`, paperindex connector) returns a **storage location**, not a file.
- The searcher physically retrieves the records, then uses a **Scan** button to pull pages from a locally- or network-attached scanner directly into the request. *(Scanner integration is new; abstract behind a "scan source" so a demo/stub can stand in.)*

### 4d. Other (device/media copies) `[NEW]`
Minimal surface: a **description** field + **upload or link a large file** in storage (hard-drive image, phone extraction, screenshots). No search — the searcher is documenting/attaching a manually-produced artifact.

---

## 5. Actions & resolution rail

All actions accumulate into `request_history` as an **effort trail** — the evidence that supports a "no responsive records" closure.

### 5a. Confer with supervisor `[NEW]`
Sends the supervisor a snapshot/link of this task (request context + what's been searched) plus a note. Interim (full notification model is Tier 2 #7, `[NOT BUILT]`): write a `CONSULT_REQUESTED` history row and surface on the supervisor's view. Read-only for them unless they act.

### 5b. Contact requestor for clarification `[NEW]`
Templated outreach requesting detail. **Branches on `delivery_method`** (captured at intake as `email` | `mail`):
- `email` → clarification template → send via `email.js` / `emailTemplate.js` → log `CLARIFICATION_REQUESTED`.
- `mail` → generate a **printable letter** (no digital send) → mark "to be mailed" → log.

**Outreach mechanics BUILT 2026-07-09 (backend) — `[BUILT]`.** `services/clarificationNotice.js` `[NEW]` is the deterministic, plain-language builder (mirrors `feeNotice.js`): `buildNotice(reqRow, ctx)` → `{subject, text}` (greets requestor, cites the request number, restates the on-file description, asks for specifics, adds a response-window sentence when `clarification_grace_days` is set, signs off with the agency letterhead); `renderLetterHtml()` → a print-friendly postal letter (letterhead, date, recipient + mailing-address block, `Re:` line, body, signature — no digital send). `clarificationAction.send()` now performs the outreach: **email** channel wraps the body via `emailTemplate` and sends through `email.js` (returns `{sent, provider}`); **mail** channel renders the letter and marks it `to_be_mailed`. A read-only `GET /api/requests/:id/clarification/preview` returns the draft (subject/text/channel/address hints) for the UI to review + edit; `POST …/clarification` accepts staff overrides (`channel`, `to`, `mailingAddress`, `subject`, `text`). Outreach is independent of the clock/effort-trail (a delivery failure still logs); the channel + delivery outcome are recorded in the `CLARIFICATION_REQUESTED` note.

**Address gap — `[RESOLVED 2026-07-10]`:** the split-canvas intake now captures a structured mailing address when postal delivery is chosen (`mailing_*` columns — slices 1/5), and clarification reads it (slice 1b). `clarificationAction.resolveMailingAddress(reqRow, opts)` resolves the postal address by precedence **inline override → stored `mailing_*` → none**: `doOutreach` uses the stored address for postal requests (no re-prompt) and only rejects with `400 ADDRESS_REQUIRED` when neither an inline nor a stored address exists (legacy/email requests); `preview` reports `addressRequired` only when mailing **and** none is on file, and returns the on-file `mailingAddress` so the UI can show it. `findRequest` selects the `mailing_*` columns; the letter renders them as a clean multi-line block (`street1 / street2 / City, ST ZIP`). Email remains the default channel.

**Vague-request checkbox** — a "vague request" checkbox on this action records `reason: vague` on the event (immediate value: effort trail). Whether it **tolls the statutory clock** is a **jurisdiction setting**, **defaulting to no-toll** until research confirms a given state/city allows tolling for vagueness. Capture now, flip tolling per-jurisdiction later with no code change.

**Tolling engine — already built, just not triggered.** Verified against code 2026-07-09:
- Full config-driven engine exists: `services/tolling.js`, `routes/clocks.js` (mounted `backend/server.js:47` at `/api/clocks`), `deadlineCalc.js`; design in `DEADLINE_TOLLING_DESIGN.md`. Pause/resume with derived, recomputed due dates + writeback to `requests.deadline_date`.
- **`clarification_pending` is already a declared toll reason** on the default `respond` clock (`tolling.js:16` `tollReasons: ['clarification_pending','payment_pending','extension']`), but **nothing ever fires it** — the only invoked toll today is `ag_ruling_pending` (`requests.js:229`). This "Contact requestor" button is the natural first caller: `POST /api/clocks/:clockId/toll` with `reason:'clarification_pending'` (endpoint accepts any reason), and `resume` on the requestor's reply.
- Rules are meant to be per-jurisdiction: `system_config` key `deadline_rules` (JSON), overridable via `jurisdictionProfile.js` — *"default set now; fed by the Jurisdiction Profile later. No hardcoded TX."* Vagueness tolling therefore becomes a per-jurisdiction rule, no code change.
- Related planned model node: `clarification-timeout` (`workflowModel.js`) — vague request sent back, requestor silent past `clarification_response_threshold` → close `withdrawn (no clarification)`. Not built; the auto-close threshold is a sibling of the toll rule.

**Trigger BUILT 2026-07-09 (backend) — `[BUILT]`.** The clarification action is now wired to the tolling engine (clarification-policy slice 2; see `CLARIFICATION_POLICY_SURVEY.md` §8.2). `services/clarificationAction.js` exposes `send()` / `resolve()`, surfaced as `POST /api/requests/:id/clarification` and `.../clarification/resolve` (`requireAuth`) — the endpoints the "Contact requestor" button and the requestor's reply will call. Behavior is selected by `clarification_clock_effect`: `toll_pause_resume` / `operational_hold` pause on send + resume on reply; `toll_and_restart` / `start_gate` pause on send + **restart** on reply (new `tolling.restart()` primitive gives a clean full window); `no_fixed_clock` / `runs_no_stop` never pause. Fires the `clarification_pending` toll reason. **Gated on `clarificationPolicy.automationActive`** (policy enabled AND jurisdiction section attested) — otherwise the action is a pure effort-trail entry with no clock change. The `CLARIFICATION_REQUESTED` / `CLARIFICATION_RECEIVED` history event (incl. the vague flag) is always written. The outreach mechanics (email template / printable postal letter branch on `delivery_method`) are now BUILT (see the "Outreach mechanics" block above).

**Auto-close BUILT 2026-07-09 (backend) — `[BUILT]`.** The `clarification-timeout` model node (`workflowModel.js`, now `status:'built'`) is implemented by `services/clarificationTimeout.js` `[NEW]` — a sweep (sibling of `feeNonpayment.sweep`) run inside the daily `tickler.runSweep` and its manual `POST /api/tickler/run`. A request is **auto-closed as "withdrawn (no clarification)"** only when its latest `CLARIFICATION_REQUESTED` is unanswered (no later `CLARIFICATION_RECEIVED`) and older than the **threshold = `clarification_grace_days` + `abandonment_grace_days`** (the requestor window plus the optional internal safety buffer). Gated on `clarificationPolicy.automationActive` (enabled AND jurisdiction attested), a **configured positive grace** (null/statute-silent never auto-closes), AND `abandonment_closure ∈ {allowed, via_denial}` (`not_allowed`/`unspecified` never). Closure goes through the central `taskRouting.applyStageTransition(rid,'closed',…)` (writes history `CLOSED_NO_CLARIFICATION` with `stage_from/stage_to`, clears the tickler flag) plus `closure_reason='no_clarification'`. When `closure_notice_required` is set, the closure note **flags that a written notice is owed** — auto-sending that notice is a separate follow-up. **Still `[NOT BUILT]`:** the auto-sent closure notice. (Intake mailing-address capture + clarification read-through is now `[BUILT]` — slices 1/5/1b.)

**Jurisdiction research to gather (per city) so it loads straight into the model** *(Kevin — same process as the estimate engine; ~12 cities)*:
1. Does a vague/insufficient request pause the clock at all? (yes / no / silent)
2. What triggers the pause — sending a clarification request? only a statutorily-defined insufficiency? notify-within-N-days requirement?
3. When does it resume — on requestor reply / partial reply / fresh clock on reply?
4. Auto-close threshold — days of silence before deemed withdrawn (feeds `clarification_response_threshold` + `clarification-timeout`).
5. Basis while tolled — business vs. calendar days; does the clarification window have its own clock?
6. Statutory citation — for the legal-basis / Vaughn-style trail.

These map 1:1 onto `deadline_rules.clocks.respond.tollReasons` + a small per-jurisdiction `clarification` policy block.

**Research GATHERED (2026-07-09) → see `docs/CLARIFICATION_POLICY_SURVEY.md`.** 16 jurisdictions surveyed
across two independent AI passes; the 6 checklist dimensions above are answered there with citations. Key
outcomes that feed this section: (a) the per-jurisdiction `clarification` policy block is specified as a
7-field substrate (`clarification_policy`), the crux field being `clarification_clock_effect` — a 6-value enum
(`no_fixed_clock · runs_no_stop · toll_pause_resume · toll_and_restart · start_gate · operational_hold`) that
selects the tolling-engine behavior when this "Contact requestor" button fires; (b) dimension 4 (auto-close
threshold) is split into two fields — `clarification_grace_days` (the requestor's respond-or-close window;
statutory almost nowhere, WA/FL practice = 30) and an optional `abandonment_grace_days` safety buffer — which
feed `clarification_response_threshold` / the `clarification-timeout` node above; (c) **no jurisdiction
requires** contacting the requestor, so the button stays discretionary and the whole policy defaults to
OFF/safe-manual until the city attests it (AUTO_CONFIG gate). All per-jurisdiction VALUES need counsel
verification before reliance. Michigan's clock model is a flagged cross-doc conflict (survey §5.1).

### 5c. Log phone call `[NEW]`
Free-form entry — who / when / summary / outcome → `request_history` as `CALL_LOGGED`. Pure effort trail.

### 5d. Resolution `[NOT BUILT — folds in Tier 1 #5]`
- **Found** → attach the responsive record(s) → mark task complete → hand off to redaction/delivery per stage.
- **No responsive records** → close with reason; the screen surfaces the accumulated **effort trail** (systems searched, calls logged, clarifications sent) as the closure evidence.
- Explicit per-record found/not-found states are the prerequisite for the later MRR Partially-Granted roll-up (fulfillment spec §4).

---

## 6. Layout (three zones)

1. **Context** — header (task type + status badge, mirrors EstimateTaskPage) · request line (number, requestor, record type, description) · **carried-forward intake results** (selected = included; unselected = "shown, not picked → exclude").
2. **Search surface** — the always-visible **format toggle** → the matching view (§4).
3. **Actions & resolution rail** — Confer · Contact (templated) · Log call · → **Found / No responsive records**.

---

## 7. Data-model & routing changes

| Change | Where | Status |
|---|---|---|
| Route `record-search/:taskId` + `RecordSearchTaskPage.js` | `App.js`, new page | `[NEW]` |
| `MyTasksPage` routes by task type | `MyTasksPage.js` | `[NEW]` |
| Persist shown-but-unselected intake candidates | `publicChat.js` /submit + `request_intake_results` (or flag on `request_selected_records`) | `[NEW]` |
| AV scope-note carried to redaction | search attach → `av_redaction_tasks` / handoff | `[NEW]` |
| Scanner "scan source" abstraction (paper) | new connector/stub | `[NEW]` |
| Postal address capture (clarification + delivery) | portal intake + `requests.mailing_*` columns | `[BUILT]` — slices 1/5 (capture) + 1b (clarification reads it) |
| Vague-request toll setting | jurisdiction config + `clock_tolls` | `[NEW]`, defaults no-toll |

---

## 8. Open decisions / to confirm

1. **Build order** — record-search screen first (larger, Tier 1 #1), then the redaction task screen (Tier 1 #2)? Or together?
2. **Intake-results persistence** — build the unselected-candidate persistence (§2) *with* the screen, or ship the screen on selected-records-only and fast-follow?
3. **Video scoping** — searcher adds a time-range/event note handed to redaction (proposed §4b), or stays purely at "find the file" and leaves all scoping to the redactor?
4. **Selected → skip-search gating** — **RESOLVED 2026-07-09 (verified unbuilt).** Selection has zero effect on routing today; `request_selected_records` is written at submit but read by no service. Build recipe (two `buildSignals` fields + two `workflow_rules` rows, no engine change) documented in §1. Public-library picks → skip search+redaction via `wfr-selected-public`; private picks → skip search via `wfr-selected-private`; release gate at delivery still enforces balances.
5. **Tolling on vagueness** — Kevin researching which jurisdictions permit it; setting defaults off until then.
</content>
</invoke>
