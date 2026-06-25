# Config Freshness / Rule-Update Loop

Periodically check whether the laws/ordinances/rules behind Optimum Q's configuration have changed, stage any
proposed updates in a holding status, and email a reminder to the designated person REGARDLESS of whether anything
was found. Nothing is ever applied automatically - updates take effect only after human review + approval.

Maps onto AUTO_CONFIG_DESIGN.md Section 5 (source registry + freshness/re-validate), Section 2.3 (the
attestation gate = the warning/disclaimer/agree step before apply), and Section 6 (per-domain extractors).

## Slices
- SLICE A (BUILT 2026-06-24): registry + staging + scheduler + reminder. Decision-independent foundation.
- SLICE B (BUILT 2026-06-24): pluggable source FETCH (registered URL / uploaded file / pasted text -> one "source document")
  + version-diff (detect drift vs last_version_hash) + per-domain extractors that turn a source doc into a
  proposed config diff and stage it. This is where "AI located updated content" becomes real/authoritative.
- SLICE C (BUILT 2026-06-24): the generic review UI - review doc -> import -> editable proposed config -> disclaimer -> agree ->
  apply. This is the attestation gate, reused by every domain.
- SLICE D: roll remaining domains (deadlines, exemption-model, taxonomy) onto the framework.

## Slice A (built)
Tables:
- config_sources(id, jurisdiction_id, domain, label, url, active, last_checked_at, last_change_at,
  last_version_hash, notes, created_at) - per-jurisdiction registry of WHERE each domain's governing text lives.
  Seeded 4 TX sources (redaction, fee, deadline, exemption) pointing at the TPIA / OAG cost rules.
- config_proposals(id, jurisdiction_id, domain, status[pending|applied|dismissed], summary, proposed_json,
  source_ref, created_by, created_at, reviewed_by, reviewed_at) - GENERIC staging for domains without a native
  pending store. Redaction uses its OWN native staging (redaction_rules.approval_status='pending_review').
- config_freshness_runs(id, trigger, jurisdiction_id, summary_json, emailed, created_at) - run log.

Domains: redaction, fee, deadline, exemption, taxonomy.

Service src/services/configFreshness.js: runScan({trigger}) touches last_checked_at on active sources, tallies
pendingSummary() per domain (redaction=pending_review rows; others=config_proposals pending), logs the run, and
sends the reminder email. maybeRun() respects cadence (system_config 'freshness_scan_days', default 30).
startScheduler() = 90s startup + daily setInterval calling maybeRun (mirrors tickler). Wired in server.js.

email.sendFreshnessReminder(data, to): reminder fires regardless; lists pending-per-domain or says nothing
pending; states nothing is auto-applied. Recipient = system_config 'freshness_reminder_to' (set to
admin@optimumq.ai) || 'contact_email' || admin@optimumq.ai. NOTE: Resend still in TEST MODE -> only delivers to
admin@optimumq.ai until the optimumq.ai domain is verified.

Routes /api/config-freshness: GET /status, POST /run (elevated), GET/POST /sources + DELETE /sources/:id
(elevated), GET /proposals?status=, POST /proposals/:id/dismiss (elevated).

VERIFIED live: empty run -> total 0, emailed true (reminder sent with nothing pending); staged fee proposal ->
total 1, fee:1, emailed true, proposal listed; dismiss works. Test residue cleaned.

## Honesty note / key design point
"AI located UPDATED content" is only authoritative if sources are REGISTERED (URL/file) and a prior snapshot is
stored to diff against (last_version_hash). Without that, an AI scan only re-proposes from model memory (a nudge,
not authoritative, and can't say what changed). Slice B builds the registered-source fetch + diff. The existing
ruleDiscovery.js (redaction) is model-knowledge, on-demand, redaction-only - Slice B/D generalizes it behind the
pluggable source-fetch interface.

## Dependency
This loop will fold into the Jurisdiction Profile data model (the versioned/sectioned/attestation artifact) once
that exists - the profile sections will carry the source freshness dates + attestation; today config lives
per-area and proposals/apply target those per-area stores.

## Slice B (built 2026-06-24)
src/services/configExtractors.js: per-domain adapter framework.
- fetchSource(source, rawText): pasted/uploaded text wins; else best-effort URL fetch (12s timeout, 200k cap,
  HTML->text). hashText = sha256 for drift detection.
- ADAPTERS by domain, each {label, applyTarget, current(jid), extract(jid,text)->{proposed,summary}, apply(jid,cfg,actor)|null}:
  - fee: extract via feePolicyExtract; current/apply = the in-effect fee profile (pickConfig selection:
    jurisdiction + context 'FR', prefer status active then version desc); apply deepMerges the approved config.
  - deadline: generic AI extract; current/apply = system_config 'deadline_rules'.
  - exemption: generic AI extract; current/apply = jurisdiction_profiles.exemption_model (validated enum).
  - redaction, taxonomy: generic AI extract (proposal+summary) but apply=null (REVIEW-ONLY -> direct staff to
    the native area editor; redaction rules + taxonomy are multi-row libraries with their own approval).
- genericExtract(domainLabel, jurName, currentCfg, sourceText): AI returns {config, summary}; "No change
  indicated" when source implies no change.
Tables: config_source_snapshots(id, source_id, jurisdiction_id, domain, hash, text, fetched_at); config_proposals
gained snapshot_id, current_json, applied_json, attested_by, attested_at.
Endpoints (added to /api/config-freshness): POST /sources/:id/check {rawText?} and POST /extract {domain,rawText}
(fetch->snapshot->diff->extract->stage a pending proposal; update source last_checked/last_version_hash/last_change_at);
GET /proposals/:id (proposal + proposed + current + snapshot text + applyTarget/reviewOnly); POST /proposals/:id/apply
{editedConfig?, attested} (requires attested=true; applies via adapter; marks applied + attested_by/at + applied_json).
VERIFIED live (fee): pasted 2026 fee schedule -> proposal bw $0.15/color $0.50/labor $20 vs current bw $0.10;
review detail returned proposed-vs-current + 227-char snapshot; attested apply wrote bw 0.10->0.15 to the live
profile; restored + cleaned. NOTE: scheduled scan still does the cheap reminder only; AI extraction is on-demand
(cost/latency + live-fetch reliability) - a 'freshness_auto_extract' flag can later let the scheduled scan auto-check URL sources.

## Slice C (built 2026-06-24)
frontend/src/pages/RuleUpdatesPage.js at /rule-updates (nav 'Rule Updates', isElev). One screen:
- Status card: recipient + cadence + last-check date + "Send reminder now" (POST /run).
- Pending review list: each proposal (domain badge, summary, source, date) with Review / Dismiss.
- Registered sources grouped by domain (last-checked, source link, pending count) + per-source "Check now"
  (POST /sources/:id/check; tells the user to paste if the URL can't be read).
- "Paste a document to check": domain picker + textarea -> POST /extract -> stages a proposal.
- ReviewModal (2 steps): (1) summary + collapsible source document + EDITABLE proposed config (JSON textarea)
  side-by-side with read-only current config; (2) disclaimer/warning (names the live applyTarget, states OQ
  proposes config but is not legal advice) + a required "I have reviewed and authorize" checkbox -> "Agree &
  apply" (POST /proposals/:id/apply {editedConfig, attested:true}). Review-only domains (redaction/taxonomy)
  show the note and no apply. Invalid JSON is caught before confirm/apply.
VERIFIED: status/proposals/detail endpoint sequence the page drives returns the right shapes; generic extractor
works for deadline (proposed calendar_days/10 -> business_days/15 from a pasted amendment, with citing summary);
fee apply verified in Slice B. This is the attestation gate (review -> edit -> disclaimer -> agree -> apply),
reused by every JSON-config domain. SLICE D (BUILT 2026-06-24: richer redaction/taxonomy apply via their native
editors; optional scheduled auto-extract; file-upload source ingestion; fold into Jurisdiction Profile model).

## Slice D (built 2026-06-24)
Completes the loop across all domains + makes the periodic scan optionally autonomous.
- Redaction & taxonomy now APPLY by staging pending-review DRAFTS into their native libraries (not review-only):
  configExtractors adds doc-aware extractRedactionRules / extractTaxonomy; redaction apply inserts redaction_rules
  (approval_status='pending_review', is_active=0) + legal_sources + rule_legal_sources (mirrors ruleDiscovery);
  taxonomy apply inserts record_types (status='draft', source='ai'). Each still goes through that library's own
  approval before taking effect. applyMode = 'live' (fee/deadline/exemption) | 'stage_drafts' (redaction/taxonomy).
- stageFromSource(jid, source, rawText, actor, opts): consolidated fetch->snapshot->drift-diff->extract->stage
  pipeline, shared by the on-demand check/extract endpoints AND the optional scheduled auto-extract.
- Scheduled AUTO-EXTRACT (opt-in): system_config 'freshness_auto_extract' ('1' to enable; default off). When on,
  runScan also fetches each active URL source and stages changes (onlyIfChanged). Reminder still sends regardless.
- POST /settings (elevated): set cadenceDays / recipient / autoExtract. POST /upload (multer + pdftotext): upload
  a PDF or text file as a source document -> stageFromSource. /status now returns autoExtract.
- UI (RuleUpdatesPage): Settings card (cadence, recipient, auto-check toggle -> /settings); file upload in the
  "paste a document" card (PDF/text); review modal is applyMode-aware (stage_drafts shows "added as pending-review
  drafts in <library>, not applied live" + "Add as drafts" button; live shows the apply wording + "Agree & apply").
VERIFIED live: redaction apply staged pending-review drafts (then cleaned); /settings round-trip; file upload
(text -> fee proposal bw $0.20/color $0.75). NOTE: this whole feature was first built in a turn that the client
interrupted (connection/limit) before committing; the work was recovered intact from the working tree, verified,
and committed (backend = commit 69ffabe; frontend + upload = this commit).
The config-freshness loop is now complete end to end. Remaining future work: fold the source registry +
attestation into the Jurisdiction Profile data model (the next foundational item).

## Repositioned: no autonomous law-tracking (2026-06-24)
Decision: Optimum Q must never imply it monitors, tracks, or detects changes in the law - that would
quietly assume responsibility for being right about the law and invite reliance on the software. The agency
(whose managers are informed of changes through their associations/newsletters well before effective dates)
brings the approved document; Optimum Q only stages, reviews, and (next) effective-dates it.
Removed/neutered:
- Backend: the scheduled run no longer fetches/checks/monitors any source or auto-extracts. runScan now ONLY
  sends the periodic courtesy reminder and logs it. Seeded source URLs (config_sources) cleared. Auto-extract
  left off and unreachable from the UI. Cadence default 30d -> 182d (~6 months; freshness_reminder_days).
- Email: reminder reworded to a six-monthly courtesy reminder - review changes you're aware of and update
  before each effective date; explicit that it's routine (not a notice that anything changed) and that staying
  current is the office's responsibility; upload/effective-date/review/approve/auto-deploy framing.
- Frontend: 'Rule Updates' -> 'Update Configuration'. Removed registered-sources card, URLs, 'Check now',
  auto-check toggle, 'last checked'. Page is now upload-approved-copy -> review -> approve.
Dormant (not removed, just unused by UI): the /sources, /sources/:id/check endpoints and the configExtractors
URL-fetch path. NEXT: effective-dated configuration (schedule an approved change for a future date; a nightly
check promotes it on its effective date; prior versions retained as superseded history for defensibility).

## Effective-dated configuration (BUILT 2026-06-24)
The agency brings an approved change and decides WHEN it takes effect; Optimum Q deploys it on that date.
- Tables: scheduled_config_changes (approved changes awaiting a future effective date: jurisdiction, domain,
  effective_date, config_json to apply, summary, source_ref, proposal_id, status scheduled|applied|cancelled);
  config_history (each live config's effective window per domain: config_json, effective_from, effective_to,
  source initial|applied|scheduled_promotion) for "what configuration was in effect on date X?" defensibility.
- Service effectiveConfig.js: schedule() (future date; live config untouched), promoteDue() (applies any
  scheduled change whose effective_date <= today; idempotent; ordered by date), cancel() (before it lands;
  returns the linked proposal to the review queue), applyConfig() (shared apply: adapter.apply + history
  snapshot + profile re-index), recordHistory/seedBaselineHistory, startPromotionScheduler (startup + hourly).
- Approve endpoint branches: future effective date on a live area (fee/deadline/exemption) -> schedule
  (proposal -> 'scheduled'); else apply now (records history). Endpoints: GET /scheduled, POST
  /scheduled/:id/cancel, POST /promote. server.js starts the hourly promotion.
- UI (Update Configuration): the approve step offers Apply now / Schedule for a future date (date picker,
  live areas only); a "Scheduled changes" list shows pending changes (area, summary, Effective <date>) with
  Cancel. Scheduling only applies to live areas; redaction/taxonomy stay add-as-drafts-now.
- Effective-date scheduling is NOT offered for stage_drafts areas (redaction/taxonomy) - those create drafts
  that need separate approval anyway.
VERIFIED: schedule (live config untouched) -> appears in list -> promoteDue applies on/after effective date
(history window captured) -> cancel returns proposal to queue; future-dated waits; all reversible. Baseline
config_history seeded for jur-tx (one open window per live area). Promotion runs hourly + at startup.
NEXT (optional): a read-only history viewer ("what was in effect on <date>"); a per-section "1 change
scheduled for <date>" indicator on the Jurisdiction Profile dashboard.
