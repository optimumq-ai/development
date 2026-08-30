# Static Audit Triage — OptimumQ

Read-only triage of `links.json`, `deadcode.json`, `coverage.json`. Every claim below was verified by
opening the cited file(s) directly; where a fork agent produced the finding it was spot-checked before
being folded in here. Method note: several "no frontend caller" / "no test" flags are heuristic false
negatives — the frontend uses a local wrapper function instead of `api.*` directly, builds the URL with a
ternary instead of a simple two-literal concatenation, or a test builds the path with concatenation the
literal-match check doesn't recognize. Those are called out explicitly rather than silently reclassified.

## 0. Link integrity spot-check (links.json)

`unresolved: []`. Spot-checked 10 targets spread across the 209 found (App.js, AppLayout.js,
AdministrationPage.js, DashboardPage.js, LoginPage.js, MyTasksPage.js, RedactionWorkspacePage.js,
SetupPage.js, and two backend `door`/`editor` string literals in `services/jurisdictionProfile.js` and
`services/setupHub.js`) against `frontend/src/App.js`'s `<Route>` table — all 10 resolve, including one via
a redirect hop (`/taxonomy` → `/setup/taxonomy`, App.js:184) and one via the admin `?tab=` map (`/admin?tab=setup`
resolves because `setup` is a real tab key, AdministrationPage.js:17). No corrections needed.

## 1. Summary counts by class

| Class | Count |
|---|---|
| REAL BUG | 5 |
| UNFINISHED | 39 |
| DEAD | 26 |
| EXTERNAL/OK (incl. 2 confirmed heuristic false-positives) | 32 |
| Has a frontend caller, has test coverage — no classification needed (per task scope) | 14 |
| **Total items triaged** | **116** |

(102 from the four small lists + the 87-route list, plus the 14-item "tested, just list" bucket = 116,
matching `orphanFrontendFiles`(3) + `frontendCallsWithNoRoute`(3) + `configKeysReadNeverWritten`(8) +
`configKeysWrittenNeverRead`(1) + `backendRoutesNoFrontendNoTest`(87) + the 14 tested-but-caller-missed routes.)

`servicesNothingRequires` is empty — nothing to triage there.

---

## 2. REAL BUG

| Item | file:line | Failure | Suggested fix |
|---|---|---|---|
| `ack_email` config toggle | UI: `frontend/src/pages/SystemNotificationsPage.js:60` writes it via allow-listed `PUT /api/config` (`backend/src/routes/config.js:27`); consumer gap: `backend/src/services/requestCreate.js:511-520` | The "Requestor acknowledgement email: Enabled/Disabled" toggle is real and savable, but the code that sends the acknowledgement email never reads `cfg('ack_email')` — it only checks `opts.sendConfirmation !== false && cols.requestor_email`. Setting it to Disabled has zero effect; every request with a requestor email still gets the email. | Gate the `require('./email').sendSubmissionConfirmation(...)` call in `requestCreate.js:511` on `await cfg('ack_email') !== 'off'` in addition to the existing conditions. |
| `app_url` config key | Read-only consumer: `backend/src/routes/onboarding.js:122`; no writer anywhere (not in `config.js:27` allow-list, no seed, no env var) | `POST /api/onboarding/:phase/request-review` builds a reviewer's deep-link email as `appUrl + '/setup?phase=...&review=1'` where `appUrl` is always `''` — the emailed link is a bare relative path, meaningless outside the browser session it was never sent from. Compounding: `/setup` now hard-redirects to `/admin?tab=setup` (`App.js:199`) and neither `SetupHubPage.js` nor `SetupGuidePage.js` reads a `?phase=`/`?review=` query param, so even a fully-qualified link would land nowhere useful. | Add `app_url` to a config screen (or seed it from an env var at boot) and update the deep-link target to a route that actually consumes `phase`/`review`. |
| `email_last_test_ok` config key | Read: `backend/src/services/setupHub.js:361`; the only writer candidate: `backend/src/routes/integrations.js:109-114` (`POST /api/integrations/test/email`), wired to a real "Test" button (`frontend/src/pages/EmailConfigPage.js:149`) | The Setup Hub's "Email" row reads `email_last_test_ok` to show "ready · test message sent" vs. "in_progress · no test message sent". The test-send handler sends the email and returns `{ok, message}` to the browser but never writes `email_last_test_ok` back to `system_config`. The row can never reach "ready" through the test flow no matter how many successful tests are run. | After a successful send in `integrations.js:114`, `UPDATE system_config` (or upsert) `email_last_test_ok = 'true'`. |
| `POST /api/auth/mfa/verify` (frontend call with no matching route) | Caller: `frontend/src/store/authStore.js:21`; UI: `frontend/src/pages/LoginPage.js` (`step === 'mfa'`, 6-digit code entry, "Verify" button at line 97) | Two-layer break: (1) `POST /api/auth/login` (`backend/src/routes/auth.js:7-17`) never checks `mfa_mode` or returns `requiresMfa`/`preAuthToken` — it always returns a full `accessToken` — so the MFA step in `LoginPage.js` can never even be reached. (2) Even if it were reached, `authStore.verifyMfa()` posts to `/auth/mfa/verify`, a route that does not exist anywhere in `backend/src/routes/auth.js` (only `/login`, `/me`, `/password/change`, `/logout`, `/config` exist). `mfa_mode` is a real, admin-settable dropdown (`frontend/src/pages/AuthenticationSetupPage.js:46`, values off/optional/required) that currently has **zero effect on login** — MFA cannot be enforced regardless of the setting. | Implement the MFA branch in `auth.js`'s login handler (check `mfa_mode`, issue a `preAuthToken`, require a second factor) and add the `POST /auth/mfa/verify` route, or remove the dead MFA UI/setting until it's built. |
| `POST /api/fee-estimates/request/:requestId/final-payment/record` | `backend/src/routes/feeEstimates.js:526-542`, vs. the live door `backend/src/routes/feeEstimates.js:614-660` | This is a second, no-longer-called "final payment" endpoint that updates `request_fee_estimates.final_paid_amount` and writes history directly — but unlike the endpoint the cashiering UI actually calls (`POST /request/:requestId/payment/record`, called from `FeeEstimatePanel.js` and covered by the real ledger insert at `feeEstimates.js:635-636` plus `paymentStatus.recordEvent`), this legacy door never inserts into the `fee_payments` ledger table and never calls `paymentStatus.recordEvent`. It IS still exercised by `backend/tests/verify_reissue.js:132-133` (confirming it's blocked by the same revised-estimate guard), so it's live, reachable, and would silently desync `final_paid_amount` from `SUM(fee_payments.amount)` if ever invoked (a stale client, a script, direct API use). | Either delete the route (cashiering already goes through `/payment/record`) or make it call the same ledger-insert + `paymentStatus.recordEvent` path before removing the duplication risk. |

---

## 3. UNFINISHED

Grouped by file. "Evidence" cites the doc/comment establishing intent, plus the missing UI/caller.

### From `backendRoutesNoFrontendNoTest` (route built, no UI/caller yet)

| Route | Evidence of intent |
|---|---|
| `POST /api/requests/:id/reopen` | `backend/src/routes/requests.js:308-323` comment "PHASE 7 / BW5 — REOPEN (Draft 8 rev 2 §3.3, decided 7/29)" — fully built, Director-gated; `RequestWorkspacePage.js`'s closed-request view has no Reopen button. |
| `GET /api/requests/:id/clarification/preview` | `docs/HANDOFF.md:284` + `docs/SPEC_record_search_task_screen.md:299` document a read-only preview for review/edit; `RecordSearchTaskPage.js:140` instead POSTs `/clarification` directly, never fetching the preview. |
| `GET /api/tasks/:id/suggest` | `docs/TASK_AND_NOTIFICATION_MODEL.md:38` marks `suggestAssignee` "[code: exists]"; only consumed internally by `backend/src/services/taskRouting.js:411` for auto-routing — no supervisor-facing UI browses suggestions. |
| `POST /api/tasks/:id/assign` | Manual-assign counterpart to `/suggest` above; no caller anywhere in `frontend/src`. |
| `GET /api/tasks/:id/close-approval` | `frontend/src/components/ui/PowerQueue.js:7`: "the close-approval queue ... [is a] future customer and DO NOT build in v1." |
| `POST /api/tasks/:id/close-approval/:decision` | Same `PowerQueue.js:7` citation as above. |
| `GET /api/dispositions/:requestId/pipeline` | `dispositions.js:2,58` comments describe a "Frame B four-condition panel" never built; `DispositionsPage.js` renders only Frame C. |
| `POST /api/dispositions/:requestId/withdrawal-communication` | Tested (`backend/tests/verify_clock_disposition_gates.js:94-97`); rights-decided per `docs/SPEC_request_lifecycle_workflow.md:48`; no button in `DispositionsPage.js`. |
| `POST /api/dispositions/:requestId/hold` | Tested (`verify_clock_disposition_gates.js:98-100`), rights-decided; `DispositionsPage.js`'s hold panel (lines 218-224) is read-only. |
| `DELETE /api/dispositions/:requestId/hold` | Tested (`verify_clock_disposition_gates.js:102-103`); same rights citation; no UI caller. |
| `POST /api/dispositions/:requestId/installment-request` | Tested (`verify_clock_disposition_gates.js:105-106`); `dispositions.js:184` comment describes intended behavior; no frontend caller. |
| `GET /api/clocks/overdue` | `docs/DEADLINE_TOLLING_DESIGN.md:62,67`: "for the tickler/dashboard to consume later" / "Tickler (future): read `tolling.overdue()`." |
| `POST /api/clocks/request/:requestId/clock` | A distinct, more granular sibling of the route the UI does call (`POST /request/:requestId/start`, `RequestWorkspacePage.js:88`, which starts *all* applicable clocks) — this one starts one named clock `type`. Tested (`verify_clock_disposition_gates.js:73`) and rights-gated per `docs/SPEC_request_lifecycle_workflow.md:48` ("clocks.js start / start-one"), but no UI ever calls the single-clock form. |
| `POST /api/clocks/:clockId/extend` | Comment `clocks.js:42-44`: "A STATUTORY extension ... Caps come from the jurisdiction's rules"; rights-gated + tested in a dedicated 36-assertion suite (`backend/tests/verify_extend.js`, `verify_clock_disposition_gates.js:79-87`); no "extend" control anywhere in `frontend/src`. |
| `PATCH /api/taxonomy/categories/:id` | `docs/SPEC_taxonomy_classification.md:6-7` promises full CRUD; tested (`verify_request_gates.js:64-65`); `TaxonomyPage.js` only GETs categories for a dropdown, no edit UI. |
| `DELETE /api/taxonomy/categories/:id` | Same spec citation; tested `verify_request_gates.js:66`. |
| `POST /api/taxonomy/record-types/:id/departments` | Tested (`verify_taxonomy_variants.js:88`, `verify_request_gates.js:70`); spec describes many-to-many department links, but `RecordTypeEditor.js:83` only PATCHes a single-value `/routing` endpoint. |
| `DELETE /api/taxonomy/record-types/:id/departments/:linkId` | Tested `verify_request_gates.js:71`; same UI gap. |
| `POST /api/taxonomy/record-types/:id/repositories` | Tested `verify_request_gates.js:75`; `RecordTypeEditor.js:84` instead PATCHes `/sources` with `repository_ids`. |
| `DELETE /api/taxonomy/record-types/:id/repositories/:linkId` | Tested `verify_request_gates.js:76`; same gap. |
| `GET /api/mass-jobs/:id/history` | `docs/SPEC_redaction.md:25` verbatim: "Read back via `GET /api/mass-jobs/:id/history`... No UI surface yet (UI rule: design session first)." Exercised only by `verify_processing_audit.js:114`. |
| `GET /api/config-freshness/sources` | `docs/CONFIG_FRESHNESS_DESIGN.md:142`: "Dormant (not removed, just unused by UI): the `/sources`, `/sources/:id/check` endpoints..." — explicit 2026-06-24 decision. |
| `POST /api/config-freshness/sources` | Same dormant-by-design note. |
| `DELETE /api/config-freshness/sources/:id` | Same note (covered by the "/sources... endpoints" phrase). |
| `POST /api/config-freshness/sources/:id/check` | Explicitly named dormant, `CONFIG_FRESHNESS_DESIGN.md:142`. |
| `POST /api/config-freshness/promote` | Documented manual trigger (`configFreshness.js:194-196`, `CONFIG_FRESHNESS_DESIGN.md:157-158`); no "promote now" button in `RuleUpdatesPage.js` — the hourly/startup scheduler (`effectiveConfig.js:89-91`) covers the normal path. |
| `GET /api/jurisdiction-profile/status` | `docs/JURISDICTION_PROFILE_DESIGN.md:24`, `docs/DRAFT_processing_ui_golive_checklist.md:52` document it as the section-status source; built pages read `/policy-settings` + `/go-live` instead — never wired. |
| `POST /api/jurisdiction-profile/sync` | `JURISDICTION_PROFILE_DESIGN.md:29` documents an intended "Re-sync from live config" button never built (no "Re-sync" string anywhere in `frontend/src`). The underlying `JP.sync()` function IS used heavily as an internal hook elsewhere — only the manual HTTP trigger is unreachable. |
| `GET /api/jurisdiction-profile/ledger` | `services/jurisdictionProfile.js:51`'s `ledger` section's `editor` link is just `/config`, a generic redirect (`App.js:199`) — no dedicated ledger screen was built, though `services/requestorLedger.js` has full read/write logic used at runtime elsewhere. |
| `PUT /api/jurisdiction-profile/ledger` | Same as GET — no other write path exists anywhere for this config; no UI door beyond the generic `/config` redirect stub. |
| `GET /api/redaction-config` | `docs/HANDOFF.md:1526-1527` lists "an editor/attest surface like the clarification policy" as Remaining; `docs/SPEC_redaction_automation.md:106` confirms backend built/verified, UI not built. |
| `POST /api/redaction-config` | Same evidence. |
| `POST /api/redaction-config/reset` | Same evidence. |

### From `configKeysReadNeverWritten` (config surfaced nowhere to set it)

| Key | Evidence of intent |
|---|---|
| `mass_redaction_window_start` | Read with fallback (`'18:00'`) in `backend/src/routes/massJobs.js:25`, `services/massJobs.js:84`; displayed read-only on `frontend/src/pages/MassRedactionPage.js:156`. No admin UI writes it in the live app — seeded only in the test fixture (`seed_fixture.sql:33`), which CLAUDE.md itself warns is not live-shaped. |
| `mass_redaction_nightly_budget` | Same pattern (default `'500'`; fixture seeds `'2000'`); read at `massJobs.js:24,46,52,114,137`, displayed at `MassRedactionPage.js:156`, no live writer. |
| `erp_base_url` | `services/setupHub.js:377`'s own status message literally says "no screen yet" (three times, for the `settlement` hub row); `docs/WORKING_setup_inventory.md:81` confirms: "ERP / settlement integration ... **No provider-config screen**; mode chosen at 2.1." |
| `erp_webhook_secret` | Same citation as `erp_base_url`. |
| `portal_search_ai_routing` | Read via raw SQL, fail-open default ON (`backend/src/services/recordSearch.js:140`); documented as a toggle in `docs/SPEC_record_search_fulfillment.md:9` ("toggle `portal_search_ai_routing`, default ON"). No admin UI or route exists to set it — currently an ops-only lever settable only by a direct `system_config` write. |
| `portal_search_judge` | Read via raw SQL, fail-open default ON (`recordSearch.js:256`); documented in `docs/SESSION_STATE_2026-06-26.md:13`. Same "no setter surface" gap. |

---

## 4. DEAD

| Item | Why safe-to-delete |
|---|---|
| `frontend/src/pages/SetupPage.js` | Explicitly retired: `docs/HANDOFF.md:8752` — "`SetupPage` is no longer mounted (file kept; `/onboarding` API untouched — the fee-test signal still reads it)." Superseded by `SetupHubPage.js`. Not imported by `App.js` or any reachable page. |
| `frontend/src/components/FeeSandboxPanel.js` | Only imported by the now-unmounted `SetupPage.js` (`SetupPage.js:4,124`) — an orphaned island together with it. |
| `frontend/src/components/ui/TaskPoolSection.js` | Zero references anywhere in the repo (confirmed by a full-repo grep, not just `frontend/src`). Its pool-fetch and `/redaction/:id` routing logic were duplicated inline into `frontend/src/pages/MyTasksPage.js` (created in the same commit, `069d08c`) at `MyTasksPage.js:50-52,193`; nothing imports the component anymore. Last touched in commit `c7c6920` with no further edits since. |
| `POST /api/estimate-profiles/:recordTypeId/actuals` | `estimateProfiles.js:20-23`; no HTTP caller (`EstimateProfilePanel.js` only does GET/assess/PUT). The underlying `recordActuals()` function is legitimately called in-process from `feeEstimates.js:581` — the *feature* isn't dead, only this HTTP door. |
| `DELETE /api/estimate-profiles/:recordTypeId` | `estimateProfiles.js:26-29`; no caller, no doc mentions a reset control. |
| `GET /api/workflow-model/node/:id` | `workflowModel.js:9-13`; `WorkflowMapPage.js` fetches the whole model once and indexes client-side. Comment at `workflowModel.js:15-18` notes the single-node-lookup Simulator screen "was DELETED 2026-08-01." |
| `DELETE /api/decision-reasons/:id` | `decisionReasons.js:28-31`; no admin UI manages the reasons library — `FeeWaiverDecisionPanel.js` only lists/adds. |
| `GET /api/tasks/:id/release-review` | `tasks.js:943-954`; superseded by `GET /:id/release-package` (`tasks.js:961`), which both `ReleaseReviewTaskPage.js:27` and `ReleaseReviewPowerModePage.js:33` actually call. |
| `GET /api/dispositions/:requestId/hold` | `dispositions.js:156`; redundant — `services/disposition.js:670` already embeds the same `releaseHold.holdState()` result as `rec.hold` in the main `GET /:requestId` response that `DispositionsPage.js` reads. |
| `POST /api/mrr/item/:childId/activity/:activity/start` | `mrr.js:242-246`. Confirmed no caller anywhere: `MrrActivityTaskPage.js` (the assignee's activity-task view) only calls `GET /activity-task/:taskId` and `POST .../complete`, never `.../start`; `HUB.startActivity` has no in-process caller either; no doc mentions a "start" control. (Adjacent activity verbs — assign, not-required, external-link/revoke — are all genuinely wired from `MrrChildPage.js` via a local `post()` helper the heuristic missed; `start` alone has nothing.) |
| `GET /api/parent-finance/:id/quoted-shares` | `parentFinance.js:64`; superseded by `GET /:id/view` ("THE SCREEN'S ONE READ" comment, `parentFinance.js:46-47`); `ParentFinancialPage.js:72` only calls `/view`. |
| `GET /api/parent-finance/:id/netting` | `parentFinance.js:72`; same. |
| `GET /api/parent-finance/:id/adjustments` | `parentFinance.js:87`; same. |
| `GET /api/parent-finance/:id/settlement` | `parentFinance.js:96`; same. |
| `GET /api/notifications/unread-count` | `notifications.js:14`; redundant — `GET /` (line 10) already returns `unread`, and `NotificationBell.js:16` reads it from there. |
| `POST /api/public/refine-search` | Its UI — the old chat-first native-search panel on `PublicPortalPage.js` — was explicitly "deleted 2026-07-10" per `docs/SPEC_public_portal_intake.md:26`. |
| `POST /api/public/native-search` | Same retired panel; `docs/BACKLOG.md:43` documents it was built for that panel. |
| `GET /api/public/sources` | Same retired panel; `docs/BACKLOG.md:47` documents it fed that panel's "connected systems" menu. |
| `POST /api/redaction-templates/:id/apply` | `redactionTemplates.js:203`; the real "Apply Redaction" button calls `/redaction-jobs/jobs/:id/apply` instead (`RedactionWorkspacePage.js:182`, `RedactionTaskPage.js:243`); `docs/BACKLOG.md:81` confirms the template flow uses `/stage` + jobs-apply. |
| `POST /api/fee-profiles/extract` | `feeProfiles.js:48`; no caller anywhere. The real extraction flow calls `feePolicyExtract.extract()` directly from `feeLaw.js:531-534` / `configExtractors.js:123`, bypassing this route. |
| `POST /api/fee-profiles/preview` | `feeProfiles.js:69`; no caller. `FeeSandboxPanel.js:62` calls `/api/fee-sandbox/preview` instead, wrapping the same `engine.compute`. |
| `POST /api/clarification-policy` | `clarificationPolicy.js:29`, "slice 1" comment; the real editor lives on `RequestRulesPage.js`, posting to `/request-rules/clarification/enabled` and `/confirm` instead — superseded. (Its sibling `GET` on the same router IS live-used, read-only, by `RecordSearchTaskPage.js:117` — not part of the flagged list.) |
| `GET /api/jurisdiction-profile/eligibility` | Superseded by `POST /api/request-rules/eligibility/posture` (used by `RequestRulesPage.js`'s eligibility tab); no caller found. |
| `GET /api/jurisdiction-profile/approval-modules` | Superseded — `approvalModules` config is read via `feeLaw.js`'s own service calls (`feeLaw.js:189-203`, `waiverState`), not this route; no caller found. |
| `PUT /api/jurisdiction-profile/approval-modules` | Superseded — the Fee Law screen's "who decides" control writes through `feeLaw.js:224` (`decideWaiver`) directly; the commercial-rate module has no write UI at all (fixed default, `services/intakeReview.js:390`); no caller found for this route. |
| `GET /api/fee-estimates/request/:requestId/payment-timeline` | `feeEstimates.js:728`; no caller — `FinancialProfilePanel.js:212-215` consumes `paymentTimeline` embedded in the `/financial-profile` response (`feeEstimates.js:837`) instead. `docs/REQUEST_FINANCIAL_PROFILE_DESIGN.md:400` documents the original intent to expose it here but it looks superseded, not actively planned. |

---

## 5. EXTERNAL/OK

Includes 2 items confirmed to be **heuristic false-positives, not real problems** — flagged explicitly.

| Item | Actual caller / status |
|---|---|
| `GET /api/requests/public/config` | `frontend/src/pages/PublicPortalPage.js:20`, `PublicPortalWizardPage.js:335`, `PaperFormPage.js:42` — bare `axios.get`, not the `api.*` wrapper the heuristic scans. |
| `GET /api/tasks/:id/close-gate` | `RecordSearchTaskPage.js:246-250` calls it via a template-built variable — heuristic only matches a literal string as `api.*`'s first argument. |
| `POST /api/mrr/item/:childId/activity/:activity/assign` | `MrrChildPage.js:128,133` via a local `post()` wrapper (`MrrChildPage.js:112`) around `api.post`, invisible to the heuristic's `api\.(get|post|...)\(` regex. |
| `POST /api/mrr/item/:childId/activity/:activity/external-link/revoke` | `MrrChildPage.js:145`, same `post()` wrapper. |
| `POST /api/mrr/item/:childId/activity/:activity/not-required` | `MrrChildPage.js:255`, same wrapper. |
| `POST /api/mrr/item/:childId/designate-denial` | `MrrChildPage.js:422`, same wrapper. |
| `POST /api/mrr/item/:childId/withdraw-designation` | `MrrChildPage.js:382`, same wrapper. |
| `POST /api/mrr/item/:childId/mark-defect` | `MrrChildPage.js:445`, same wrapper. |
| `POST /api/mrr/item/:childId/hold` | `MrrChildPage.js:346` and `ParentFinancialPage.js:114` (`'/mrr/item/' + h.id + (h.held ? '/lift-hold' : '/hold')` — a ternary the heuristic's concat-pattern regex doesn't handle). |
| `POST /api/mrr/item/:childId/lift-hold` | `MrrChildPage.js:338` and `ParentFinancialPage.js:114` (same ternary call). |
| `POST /api/mrr/item/:childId/release` | `MrrChildPage.js:333`; the separate `GET .../release` (a different route, `mrr.js:411`) is called from `ParentFinancialPage.js:101` via a simple concat the heuristic did catch. |
| `POST /api/public/chat` | `PublicPortalWizardPage.js:365`, `axios.post`. |
| `POST /api/public/submit` | `PublicPortalWizardPage.js:434`, `axios.post` — also the CLAUDE.md-cited seed-data path. |
| `POST /api/public/request-verification` | `PublicPortalWizardPage.js:346`, `axios.post`. |
| `GET /api/public/verify-status/:token` | `PublicPortalWizardPage.js:321`, `axios.get`. |
| `GET /api/public/verify/:token` | Not a JS caller — `publicChat.js:521` builds this URL into the citizen's verification email; the link is opened from an inbox, not the SPA. |
| `POST /api/public/request-status` | `frontend/src/components/StatusCheckModal.js:85`, `axios.post`. |
| `POST /api/public/verify/lookup` | `frontend/src/components/VerifyRecordModal.js:85`, `axios.post`. |
| `POST /api/public/verify/code` | `VerifyRecordModal.js:99`, `axios.post`. |
| `GET /api/public/verify-view` | `VerifyRecordModal.js:107` — built as a plain URL and used as an `<a>`/iframe `src`, not a fetch call. |
| `GET /api/public/library/search` | `frontend/src/pages/PublicLibraryPage.js:36`, `axios.get`. |
| `GET /api/public/file/:id` | `PublicLibraryPage.js:104` and `PublicLibraryMapPage.js:14` — plain `<a href>` download link. |
| `GET /api/contribute/:token` | `frontend/src/pages/ContributePage.js:32`, `axios.get`. |
| `POST /api/contribute/:token/note` | `ContributePage.js:53`, `axios.post`. |
| `POST /api/contribute/:token/files` | `ContributePage.js:44`, `axios.post`. |
| `POST /api/contribute/:token/complete` | `ContributePage.js:62`, `axios.post`. |
| `POST /api/fee-estimates/request/:requestId/estimate/accept` | `frontend/src/components/ui/FeeEstimatePanel.js:276` via a local `respond()` helper (`FeeEstimatePanel.js:172-175`) whose dynamic path segment contains a literal slash, breaking the heuristic's segment-count match. |
| `POST /api/fee-estimates/request/:requestId/estimate/decline` | `FeeEstimatePanel.js:277`, same `respond()` helper. |
| `POST /api/fee-estimates/request/:requestId/deposit/record` | `FeeEstimatePanel.js:269`, same helper; also tested `verify_deposit_clock.js:147`. |
| `POST /api/settlement/payment-applied` | `demo-connectors/tyler-munis/server.js:179` — ERP payment-applied webhook, shared-secret auth per `settlement.js:38-44` comment. |
| **`frontendCallsWithNoRoute`: `JurisdictionConfigPage.js:605`** (heuristic false-positive, not a bug) | `api.post('/jurisdiction-profile/' + (un ? 'unattest' : 'attest'), ...)` — the regex mis-parsed the ternary and reported "no route," but this resolves fine to two real, tested routes: `POST /api/jurisdiction-profile/attest` (`jurisdictionProfile.js:48`) and `.../unattest` (line 53), exercised in `backend/tests/verify_bw9_golive.js` and `verify_bw9b_editors.js`. |
| **`frontendCallsWithNoRoute`: `ParentFinancialPage.js:114`** (heuristic false-positive, not a bug) | Same ternary pattern as above — resolves to `POST /api/mrr/item/:childId/hold` or `.../lift-hold` depending on `h.held`; both routes are real and also called from `MrrChildPage.js` (see the mrr.js rows above). |

---

## 6. Backend routes with a frontend caller AND test coverage (no classification needed)

These 14 are in `backendRoutesNoFrontendCaller` (101) but NOT in `backendRoutesNoFrontendNoTest` (87) —
the caller-detection heuristic missed the frontend call (usually a dynamic/concatenated path), but the
route is exercised by the test suite, confirming it's real and working:

```
GET  /api/jurisdiction-profile/enforcement
GET  /api/public/browse
GET  /api/public/browse/records
GET  /api/staff/:id
GET  /api/stages
PATCH /api/redaction-templates/:id
POST /api/decision-reasons
POST /api/jurisdiction-profile/attest
POST /api/jurisdiction-profile/unattest
POST /api/requests/public
POST /api/tasks
POST /api/taxonomy/categories
PUT  /api/dispositions/knobs/:knob
PUT  /api/fee-profiles/:id
```

---

## 7. Coverage summary (coverage.json)

**Backend:** 401 routes total, 247 with zero harness reference (61%). Route **files with EVERY route
untested** (uncovered count == total route count for the file — confirmed by cross-referencing
`coverage.json`'s per-file uncovered counts against a fresh route count per mounted file):

```
parentFinance.js   9/9   workflow.js        6/6   tickler.js          3/3
redactionConfig.js 3/3   settlement.js      3/3   workflowModel.js    2/2
semanticSearch.js  2/2   reports.js         2/2   clarificationPolicy.js 2/2
classify.js        1/1   help.js            1/1   feeSandbox.js       1/1
```
Two of these (`reports.js`, `semanticSearch.js`) are confirmed live, frontend-called, production features
(`AIReportingPage.js`, `TaxonomyPage.js`, `RedactionTaskPage.js`, `DocSearchPanel.js`) with simply no test
harness — a coverage gap, not dead code. The rest overlap heavily with the UNFINISHED/DEAD findings above
(`parentFinance.js` is 4/4 DEAD-flagged routes plus a 5th, `/view`, that IS the real live endpoint but
untested; `redactionConfig.js` and `clarificationPolicy.js`'s POST routes are the UNFINISHED/DEAD items
above).

Largest partially-uncovered files by absolute gap: `requests.js` (23/26), `mrr.js` (18/21), `feeEstimates.js`
(17/19), `tasks.js` (15/24), `configFreshness.js` (14/16), `redactionJobs.js` (11/12), `jurisdictionProfile.js`
(10/20).

**Frontend:** 62 routes total, 32 with no harness reference (52%) — including real, actively-used screens
with no Playwright/API-level coverage at all: `/login`, `/portal`, `/portal/request`, `/portal/form`,
`/portal/library(+/map)`, `/requests/new`, `/org`, `/my-tasks`, `/record-search/:taskId`,
`/intake-review/:taskId`, `/reports`, `/discovery`, `/redact-fields/:fileId`, and the entire `/setup/*`
screen family (email, authentication, notifications, video-redaction, time-capture, time-budgets,
agent-rules, ai-configuration, record-sources, workflow-rules, process-map, update-configuration,
redaction-rules, taxonomy, user-types) — i.e. almost the whole Setup Hub's dedicated-screen slate has zero
route-level harness coverage even though the backend routes behind several of them (`setupHub.js`,
`agentRules.js`, `feeLaw.js`) are separately tested.

---

**Summary counts:** REAL BUG 5 · UNFINISHED 39 · DEAD 26 · EXTERNAL/OK 32 (2 of which are confirmed heuristic
false-positives, not caller gaps) · tested-with-caller-missed (listed, not classified) 14. Total triaged: 116.
