# Spec — Record-Search Task Screen (single-record)

**Status:** DRAFT for build. Drafted 2026-07-09 from a design session with Kevin. **Kevin's mark-up of the clickable mockup folded in 2026-07-14** — §2 (carried-forward, decision #2), §4b (video, decision #3 — *partially open, research pending*), §5b-2 (Vague vs Overly Broad `[NEW]`), §8 (terminology), §9 (design language). Companion to `SPEC_record_search_fulfillment.md` (Domain 7 §3, the `[NOT BUILT]` task screen) and `MASTER_task_types_permission_groups.md` (task type `record_search`, screen `[NOT BUILT]`).

> **BUILD ORDER — read §2.2 first.** The carried-forward panel is gated on **portal-side R9**
> (`DESIGN_split_canvas_intake.md`), which is designed but **not built**. The AV view (§4b) is gated on
> **research that has not returned**. Everything else is buildable now.
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

## 2. Carried-forward intake context `[RESOLVED 2026-07-14 — Kevin's mark-up, decision #2]`

The screen opens with what the requestor was already shown, so the searcher doesn't re-surface rejected records
and can document that the requestor saw them.

### 2.1 The rule Kevin set

> *"At any point where the existing files in the search result window clear, save those with the record. All
> cleared files for a request should accumulate **invisible to the requestor** and carry with the request. All
> selected files will accumulate on the right column and carry with the request."*

Two accumulating sets, not one:

| Set | Requestor sees it? | Where it accumulates | Meaning to the searcher |
|---|---|---|---|
| **Selected** | Yes — the right-hand column | `request_selected_records` `[BUILT]` | The requestor wants these. |
| **Not selected** | **No — never shown back to them** | `request_intake_results` `[NEW]` | Shown and passed over. **Do not re-surface.** |

**The accumulation boundary is the refine loop, not the search.** A description is not one-shot: the requestor
may search → select → re-describe → search again → select more, and only **Proceed** closes the description out.
So the not-selected set is written **on each results-clear** (every re-search *and* the final Proceed), and the
selected set accumulates in the column across all of them. Dedup by `record_id` on both sides; a record the
requestor passed over in search 1 and then *selected* in search 3 is **selected** — selection wins, and the row
moves rather than existing in both sets.

### 2.2 Dependency — this is gated on the portal, not on this screen `[IMPORTANT]`

The refine loop is **`DESIGN_split_canvas_intake.md` §"Search-completeness intent + refine-and-search-again"
(BACKLOG R9) — DESIGNED 2026-07-13, NOT BUILT.** R9 already establishes "clear on Proceed, not on each search"
and the accumulating Selected column. It does **not** yet persist the not-selected set, and it does not have the
bar in §2.3. Both are additions to R9, made by this mark-up.

**Therefore: the carried-forward panel on this screen cannot show real data until R9 ships on the portal side.**
The not-selected records do not exist anywhere to read. Build order is **R9 (portal persistence) → this screen**.
Shipping this screen first means its top panel renders empty for every request until R9 lands.

### 2.3 The bar `[NEW — Kevin's mark-up]`

Near the top of the search UI, a bar reading **"Self Service Portal Search Results"** with two buttons:

- **`Selected Records (n)`** — n = count of records the requestor picked.
- **`Records Not Selected (n)`** — n = count shown and passed over.

Clicking either opens a view of the associated record list. The counts are the point: the searcher sees at a
glance that the portal already showed this requestor 14 candidates and they took 2 — which is a very different
task from a request where the portal showed nothing.

Pair the bar with `request_search_intents.queries_tried` (R9 §3) — *what the portal already searched* — so the
searcher does not repeat a query the portal already ran and the requestor already rejected.

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

### 4b. Audio / Video `[NEW UI over existing connectors]` — **partially open, see §10.3**
"Search" here means **locate the asset**, never search events *inside* the media.
- Query by metadata — case #, date-time window, location, camera/unit (Axon connector exists, labeled body-worn/in-car).
- Each result is an **asset card**, not a moment.

#### The hard case Kevin posed (2026-07-14) — this is the design driver

> *"Footage of a confrontation between an officer and two men in front of the 7-Eleven at 100 Main St, around 8pm,
> within a two-day window."* Multiple officers may have been involved; the exact day is unknown. **Assume the
> request is not overly broad.**

Three things this scenario establishes, none of which the current design handled:

1. **The intake AI already gathered the scoping detail** (date, time, location, description) — and **that
   description must be displayed on the redaction screen**, not just this one. `[NEW requirement]` Today it stops
   at intake.
2. **There is no in-app video viewer.** The searcher must locate the event using the *evidence system's* own
   software (Axon Evidence.com et al.). The search here is metadata-only, and the *real* work — watching two days
   of footage from several officers to find an 8pm confrontation — happens **outside OptimumQ.**
3. **The scope/description box STAYS.** Kevin: *"the additional description box that you added is a good idea and
   should be included, and if what is uploaded is a clip from a larger video file, it serves the purpose of
   describing what was clipped."* `[RESOLVED — decision #3, partial]`

#### `[OPEN — research commissioned 2026-07-14]` How does the located video actually ARRIVE?

Kevin flagged, with unusual candor, that his own model may not survive contact with reality:

> *"What I described above about creating a clip might be totally disconnected from reality — if the search person
> is not the redactor for police video, perhaps he only views video, so your note idea is very important, but the
> concept of adding a clip to the record becomes a problem. Adding a link to the full video might be the only thing
> that can be accomplished. I don't know — lack of knowledge is a problem on my part."*

**Unresolved, and NOT to be guessed at:**
- **Is the searcher the redactor?** If they are different people, "the searcher clips the video" is incoherent —
  the searcher may only have *view* rights in the evidence system. **This single question determines the whole
  handoff design.**
- **Clip or full asset?** If a clip: how does it enter — an **upload button**? A pull from a **network share** where
  the evidence system drops exports? If no clip: a **link** into the evidence system may be all that is possible.
- **If the Axon connector gets built**, can it select an *exported clip*, or does that still require a manual upload?
- **Does redaction even happen here?** If agencies typically redact **inside** Axon and export a finished file,
  OptimumQ may only ever need to receive a **finished redacted file + a link** — which would collapse most of this
  design.
- **The click cost.** If one person does both jobs, they upload the original *and* the redacted video (or link both) —
  Kevin: *"quite a few clicks… I'm not sure how to optimize the design."*

**Kevin's own framing of the way out:** *"I am not ruling out building a viewer that allows creation of clips in the
system, and finishing development of the video redaction feature so the process can be streamlined, but for now
let's just try to do what makes the most sense as is."* He also expects to *"revise this area significantly after
discussions with prospects."*

**→ Research commissioned 2026-07-14:** what city open-records deployments actually do for BWC/dashcam
search + redaction (role split, clip-vs-link, evidence-system integration patterns, what GovQA / NextRequest /
JustFOIA / FOIAXpress actually support). **Do not build the AV view until it returns.** The rest of the screen
(§4a digital, §4c paper, §4d other, §5 rail) is **not blocked** by this.

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

---

### 5b-2. Request-defect marking: **Vague** vs **Overly Broad** `[NEW — Kevin's mark-up 2026-07-14]`

> Kevin: *"I think there should be a way to mark the description as Vague or Overly Broad, and force the process
> associated with clarification specific to that state/city to begin. In any case I think it's important for those
> selection options to be visible."*

**These are two different legal defects and MUST NOT be one checkbox.** The system today has exactly one flag —
`vague` (bool, `routes/requests.js:333` → `clarificationAction.send()`). That is insufficient, and in at least
one seeded jurisdiction it is actively dangerous.

#### Why they are different (evidence: `CLARIFICATION_POLICY_SURVEY.md` §Illinois)

| | **Vague** (unclear what is being asked) | **Overly Broad** (clear, but unduly burdensome) |
|---|---|---|
| Illinois duty | **None.** 5 ILCS 140 § 3.3 — the Act does **not** compel a body to interpret or advise a requester on meaning. | **Mandatory.** Before invoking the unduly-burdensome exemption on a categorical request, the body **shall** extend an opportunity to **confer** to reduce the request to manageable proportions. |
| Clock | Runs. (IL `clock_effect: runs_no_stop`.) | **Runs — the conference does NOT toll it.** |
| Failure mode | Ordinary lateness. | **FORFEITURE.** *"A body that fails to respond on time may not treat the request as unduly burdensome at all."* Sitting silently waiting for clarification **destroys the burden defense.** |
| Denial ground | `vague_is_denial_ground` (bool, seeded) | **No slot exists.** See gap below. |

This is the same class of trap as the **Illinois fee-forfeiture guardrail** (`SPEC_fees_estimates_payments`,
shipped 2026-07-14): a statutory right the agency loses by inaction, silently, with no error anywhere.

#### The substrate already models the duty — it has no caller

`clarificationPolicy.js:25` — `DUTIES = ['none', 'required_before_denial', 'required_before_burden_denial']`.
The third value **is** the Illinois conference duty, and it is **seeded for Illinois**
(`seed_clarification_policies.js`, `duty:` field). Like `clarification_pending` before it, the slot is filled
and **nothing ever reads it**. This rail is its first caller.

#### Behavior

Two visible, mutually-exclusive markers on the resolution rail (not buried in a modal):

**`Mark Vague`** → the existing path. `clarificationAction.send({ vague: true })`. Clock behavior selected by
`clarification_clock_effect` per jurisdiction (already built, gated on `automationActive`).

**`Mark Overly Broad`** `[NEW]` → a **distinct** path:
1. Records `reason: overly_broad` (new value; **not** `vague`).
2. Reads `clarification_duty` for the jurisdiction:
   - `required_before_burden_denial` (**IL**) → the action is **not optional**. The screen opens a **conference
     offer**, not a generic clarification letter — its purpose is *to reduce the request to manageable
     proportions*, which is different language and a different outcome from *"please clarify what you mean."*
     The screen must **display the running response deadline** with an explicit forfeiture warning: *"The clock
     does not stop for this conference. If the response deadline passes, this request can no longer be denied as
     unduly burdensome."*
   - `none` / `required_before_denial` → conferring is discretionary; behave like the vague path.
3. **Never tolls on the strength of overbreadth alone.** Tolling remains driven by
   `clarification_clock_effect`; for IL that is `runs_no_stop`, and the UI must not imply otherwise.

#### Gaps this opens (deliberately flagged, NOT silently assumed)

- **`overbroad_is_denial_ground`** — the substrate has `vague_is_denial_ground` but **no overbreadth sibling**.
  Overbreadth *is* a denial ground in far more states than vagueness is (it is the unduly-burdensome exemption).
  **Needs a field and a survey pass.** Same rule as `second_notice_required`: **an unresearched denial ground is
  the same legal exposure as an unresearched clock rule — it ships default-OFF and unseeded.**
- **The conference duty has a deadline of its own in IL** (the ordinary 5 business days + one 5-day extension).
  Whether the *conference offer* has its own sub-deadline is unresearched.
- The survey (§Illinois, line 248) explicitly calls this *"the bridge to the overly-burdensome topic — the
  conference machinery is shared."* The overly-burdensome topic has **not** been surveyed. This marker is the
  reason to do it.

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

1. **Context** — header (task type + status badge, mirrors EstimateTaskPage) · request line (number, requestor,
   record type, description) · the **"Self Service Portal Search Results"** bar (§2.3): `Selected Records (n)` ·
   `Records Not Selected (n)`, each opening its list · the intake AI's **gathered scoping detail** (date, time,
   location — §4b) which also travels to redaction.
2. **Search surface** — the always-visible **format toggle** → the matching view (§4).
3. **Actions & resolution rail** — Confer · Contact (templated) · Log call · **`Mark Vague`** · **`Mark Overly
   Broad`** (§5b-2 — *visible*, per Kevin, not buried in a modal) · → **Found / No responsive records**.

---

## 7. Data-model & routing changes

| Change | Where | Status |
|---|---|---|
| Route `record-search/:taskId` + `RecordSearchTaskPage.js` | `App.js`, new page | `[NEW]` |
| `MyTasksPage` routes by task type | `MyTasksPage.js` | `[NEW]` |
| Persist shown-but-unselected intake candidates | `publicChat.js` — write on **every results-clear** (re-search *and* Proceed) → `request_intake_results` `[NEW table]` | `[NEW]` — **belongs to portal R9, not this screen** (§2.2) |
| "Self Service Portal Search Results" bar (Selected `n` / Not Selected `n`) | this screen, §2.3 | `[NEW]` |
| AV scope/description note carried to redaction | search attach → `av_redaction_tasks` / handoff | `[NEW]` — **kept** (Kevin, decision #3) |
| How the located video ARRIVES (upload clip / link asset / connector-pull) | §4b | `[OPEN — research pending]` |
| Scanner "scan source" abstraction (paper) | new connector/stub | `[NEW]` |
| Postal address capture (clarification + delivery) | portal intake + `requests.mailing_*` columns | `[BUILT]` — slices 1/5 (capture) + 1b (clarification reads it) |
| Vague-request toll setting | jurisdiction config + `clock_tolls` | `[NEW]`, defaults no-toll |
| **`reason: overly_broad`** as a value distinct from `vague` | `clarificationAction.send()` + `routes/requests.js:333` (today accepts only `vague`) | `[NEW]` — §5b-2 |
| **Read `clarification_duty`** to force the IL conference path | `clarificationPolicy.js:25` — value **seeded, never read** | `[NEW]` — this rail is its first caller |
| **`overbroad_is_denial_ground`** field | `clarificationPolicy.js` FIELDS | `[NEW, UNSEEDED]` — needs survey (§10.6) |
| "Responsive" → "Include in Response" (labels only) | ~14 files, UI strings; **not** the DB column or node ids | `[NEW]` — §8 |

---

## 8. Terminology — "Responsive" → "Include in Response" `[NEW — Kevin's mark-up 2026-07-14]`

> Kevin: *"Throughout the system I want to change any descriptions that use the term 'Responsive' to something
> like 'Include in Response.'"*

**Scope: user-facing text only.** The word appears in ~14 files. The rename covers **labels, buttons, column
headers, help text, and workflow-node display labels** a user actually reads.

**Explicitly NOT renamed** — these are internal identifiers with no user-visible benefit and a real migration cost:
- **`request_files.responsive`** — a database column (`schema.postgres.sql:20`). Renaming it is a migration
  touching every read/write site to buy nothing a user sees.
- **`workflowModel.js` node ids** (`responsiveness`, `any-responsive`, `enough-to-advance`, `no-records-exit`) —
  stable keys referenced by seeded rules. Their **`label:` and description strings are renamed; the `id:` is not.**

The legal term of art ("responsive records") survives in **statutory/notice copy** where it is quoting law —
e.g. a no-records notice. Renaming it there would misquote the statute. Judgment call per string, not a
blind find-and-replace.

---

## 9. Design language `[NEW — Kevin's mark-up 2026-07-14]`

The mockup was built on the **redaction** token set. Kevin's direction is the **portal** palette
(`PublicPortalV2Page.js:20`) — which is already a complete, dark-mode-aware token set, not a new invention:

| Token | Value | Kevin's words |
|---|---|---|
| `--bg` | `#D8E0E8` | *"the shade of gray in the background"* |
| `--surface-2` | `#F2F6F9` | *"the lighter shade of gray in boxes"* |
| `--surface` | `#FFFFFF` | *"entry fields or data display fields as white"* |
| `--blue` | `#1E6091` | *"a little stronger and more blue"* — **the default for ALL buttons** |

- **All buttons take `--blue` by default.** Color is provisional — *"we can settle on the right color as we
  refine this UI."*
- **Type scale up ~1px at every step** — *"in general, all text is small."*
- **The portal's own `Send verification now` button is un-styled** and must adopt the same default. `[BUG]`

**Scope decision (Kevin, 2026-07-14): the record-search MOCKUP only.** The shipped redaction workstation keeps
its darker token set for now, so the two staff screens **will visibly diverge until the color is settled**. That
is a known, accepted, temporary cost — the point is to judge the color on a real screen before promoting it
system-wide.

---

## 10. Open decisions / to confirm

1. **Build order** — **RESOLVED.** The redaction task screen **shipped 2026-07-11**. This screen is the last
   missing piece of the Tier 1 demo loop. But see §2.2: **portal-side R9 must precede this screen**, or the
   carried-forward panel renders empty.
2. **Intake-results persistence** — **RESOLVED 2026-07-14 (Kevin, decision #2).** Build it. Both sets accumulate
   across the refine loop; the not-selected set is invisible to the requestor and carries with the request. Spec
   in §2. Lands in **R9 on the portal**, not in this screen.
3. **Video scoping** — **PARTIALLY RESOLVED 2026-07-14 (Kevin, decision #3).** The scope/description box **stays
   — Kevin: "a good idea and should be included."** What remains open is *how the located video physically
   arrives* (upload a clip / link the full asset / connector-pull) and *whether the searcher and the redactor are
   even the same person*. Kevin explicitly flagged his own model may be *"totally disconnected from reality"* and
   asked for research into what other city open-records systems actually do for BWC/dashcam. **Research
   commissioned 2026-07-14 — see §4b.** Do not build the AV view until it lands.
4. **Selected → skip-search gating** — **RESOLVED 2026-07-09 (verified unbuilt).** Selection has zero effect on routing today; `request_selected_records` is written at submit but read by no service. Build recipe (two `buildSignals` fields + two `workflow_rules` rows, no engine change) documented in §1. Public-library picks → skip search+redaction via `wfr-selected-public`; private picks → skip search via `wfr-selected-private`; release gate at delivery still enforces balances.
5. **Tolling on vagueness** — **RESOLVED.** `CLARIFICATION_POLICY_SURVEY.md` (16 jurisdictions, 2026-07-09) answers
   it; `clarification_clock_effect` drives it per jurisdiction; defaults off until the city attests.
6. **`overbroad_is_denial_ground`** `[NEW, OPEN]` — the substrate has a vagueness denial-ground flag and **no
   overbreadth sibling** (§5b-2). Overbreadth is a denial ground in more states than vagueness is. **Needs a
   field + a survey pass.** Ships default-OFF and unseeded until researched.
7. **The overly-burdensome topic is unsurveyed** `[NEW, OPEN]` — the clarification survey names it as a shared
   machinery it did not cover (§Illinois, line 248). The Overly-Broad marker is the reason to survey it.
</content>
</invoke>
