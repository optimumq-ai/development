# Jurisdiction Profile — Design & Status

## What it is
One versioned, sectioned record of how a jurisdiction is configured. It is an INDEX layer over the
existing per-area config stores — it does NOT move or own the config. Config still lives in:
fee_profiles (fees), system_config 'deadline_rules' (deadlines), jurisdiction_profiles row
(identity + exemption_model), redaction_rules (redaction), record_types (taxonomy). The profile tracks,
per section: a content hash, a version that advances when the underlying config changes, provenance
(source / last-changed), and attestation fields (who signed off, when, which version + hash).

Why an index, not a migration: hub-and-spoke per AUTO_CONFIG_DESIGN.md — area editors stay the source of
truth; the profile is the readiness/governance layer above them. This avoids a risky data migration and
keeps every existing area working untouched.

## Built (slice 1 — 2026-06-24)
- Table jurisdiction_profile_sections (id, jurisdiction_id, section, label, content_hash, version, status,
  source, last_changed_at/by, attested_by/at/version/hash, notes, timestamps); UNIQUE (jurisdiction_id, section).
- Service backend/src/services/jurisdictionProfile.js: SECTIONS catalog (identity, fees, deadlines,
  exemption, redaction, taxonomy, each with a deep-link editor path); signature(jid,section) reads the live
  config for that area (reusing configExtractors .current for fee/deadline/exemption; row/rule digests for
  identity/redaction/taxonomy); stable() deterministic stringify + hashOf; sync(jid) idempotent indexer
  (bumps version on hash change, upserts); getProfile(jid) returns sections + derived readiness
  (not_configured | configured | attested | needs_reattestation) + summary.
- Route /api/jurisdiction-profile: GET /status (active jurisdiction), POST /sync (elevated), GET /:jid.
- Hook: applying a config-freshness proposal now calls jurisdictionProfile.sync -> the affected section's
  version advances (this is what will later re-arm attestation on change).
- UI: Jurisdiction Profile page (nav, isElev) — readiness dashboard: jurisdiction header + summary, per-section
  readiness badge / version / provenance / last-changed / attestation line + "Open editor" deep-link, and a
  "Re-sync from live config" button. Read-only for now.
VERIFIED: 6 TX sections index at v1; version bumps v1->v2 on an underlying fee change; sections table is fully
derived (safe to delete + re-sync to a clean baseline).

## Version-bound attestation gate (BUILT 2026-06-24) — the keystone for "eliminate the OQ consultant"
Build on the columns already present:
- Per-section ATTEST action: record attested_by / attested_at / attested_version / attested_hash = current.
- Un-attested sections default to safe/manual handling (do not silently apply unreviewed config).
- A material change to a section (version bump via edit or freshness apply) makes attested_hash != content_hash
  -> readiness 'needs_reattestation' (drift), so a stale sign-off can never persist.
- UI: per-section "Review & attest" with the version/hash being signed; surface drift prominently.
Then: readiness hub actions (run auto-config from here, fold in the source registry), and later
address->jurisdiction resolution + precedence stack.

### Attestation gate — built
- backend service: attest(jid,section,actor) records attested_by/at/version + attested_hash = current content_hash;
  unattest clears it; sectionState(jid,section) exposes per-section readiness for other modules.
- routes: POST /api/jurisdiction-profile/attest + /unattest (SYSTEM_ADMIN / DIRECTOR only).
- drift / re-arm: a section's version bumps whenever its underlying config changes (manual edit OR a
  config-freshness apply, via the apply->sync hook). Once version/hash move past the attested ones,
  readiness becomes 'needs_reattestation' — a stale sign-off can never silently cover changed config.
- UI: per-section "Review & attest" -> sign-off modal naming the section + exact version, disclaimer +
  confirm checkbox; attested rows show who/when/which version + "Remove sign-off"; drifted rows show the
  amber re-review detail + "Re-attest"; summary counts attested + needs-re-attestation.
- VERIFIED full cycle: attest (v1) -> underlying change (v2) -> needs_reattestation -> re-attest (v2) ->
  un-attest. Drift loop is closed by composition: apply-hook bumps the section version (verified) and a
  version bump on an attested section yields needs_reattestation (verified).

### Enforcement boundary (deliberate)
The system today is human-in-the-loop: AI only PROPOSES config; a person reviews and applies it. Nothing
applies un-reviewed config autonomously, so "un-attested defaults to safe/manual" is already honored by the
architecture. The attestation layer adds (a) a recorded, version-bound sign-off trail and (b) readiness
visibility. sectionState() is the hook any FUTURE autonomous feature must consult before acting on a section
that isn't attested. We intentionally did NOT hard-gate live request processing (fees/routing/redaction) on
attestation now: with nothing yet attested that would flip the whole demo to manual and break working flows.
That hard-gate becomes meaningful only once cities actually sign off in production.

## NEXT (after attestation)
Readiness hub actions (run auto-config from the profile; fold the config-freshness source registry in as
per-section sources), then address->jurisdiction resolution + the precedence stack (which profile applies).

### Enforcement hardwired behind a master dev_mode switch (2026-06-24)
backend/src/services/enforcement.js: system_config 'dev_mode' (default ON = bypass) is a master switch for
not-yet-finalized enforcement (reusable for other half-built features). checkSection(jid,section) is the
attestation gate; FAIL-OPEN (dev_mode on, error, missing section, or no jurisdiction -> ok=true), so it can
only ever add a block when confident (dev_mode OFF and the section genuinely unattested/drifted).
Wired into the cost-notice SEND (POST /api/feeEstimates/request/:id/notice/send): dev_mode OFF + fees section
unattested/drifted -> 409 {needsAttestation} with a plain-language reason; dev_mode ON -> proceeds unchanged.
Toggle: GET /api/jurisdiction-profile/enforcement (read), POST (SYSTEM_ADMIN) flips dev_mode. Hidden UI: the
Jurisdiction Profile page shows a "Developer settings" panel ONLY when the URL ends with #dev
(/jurisdiction-profile#dev). dev_mode is ON now. ROUTE NOTE: literal routes must precede /:jid (it shadowed
GET /enforcement initially; fixed). To extend enforcement to other actions, call enforcement.checkSection at
the action and honor !ok; new feature gates can reuse enforcement.devMode()/cfg() as a master bypass.
