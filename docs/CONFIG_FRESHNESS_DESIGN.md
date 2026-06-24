# Config Freshness / Rule-Update Loop

Periodically check whether the laws/ordinances/rules behind Optimum Q's configuration have changed, stage any
proposed updates in a holding status, and email a reminder to the designated person REGARDLESS of whether anything
was found. Nothing is ever applied automatically - updates take effect only after human review + approval.

Maps onto AUTO_CONFIG_DESIGN.md Section 5 (source registry + freshness/re-validate), Section 2.3 (the
attestation gate = the warning/disclaimer/agree step before apply), and Section 6 (per-domain extractors).

## Slices
- SLICE A (BUILT 2026-06-24): registry + staging + scheduler + reminder. Decision-independent foundation.
- SLICE B (next): pluggable source FETCH (registered URL / uploaded file / pasted text -> one "source document")
  + version-diff (detect drift vs last_version_hash) + per-domain extractors that turn a source doc into a
  proposed config diff and stage it. This is where "AI located updated content" becomes real/authoritative.
- SLICE C: the generic review UI - review doc -> import -> editable proposed config -> disclaimer -> agree ->
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
