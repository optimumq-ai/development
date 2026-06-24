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

## NEXT slice — version-bound attestation gate (the keystone for "eliminate the OQ consultant")
Build on the columns already present:
- Per-section ATTEST action: record attested_by / attested_at / attested_version / attested_hash = current.
- Un-attested sections default to safe/manual handling (do not silently apply unreviewed config).
- A material change to a section (version bump via edit or freshness apply) makes attested_hash != content_hash
  -> readiness 'needs_reattestation' (drift), so a stale sign-off can never persist.
- UI: per-section "Review & attest" with the version/hash being signed; surface drift prominently.
Then: readiness hub actions (run auto-config from here, fold in the source registry), and later
address->jurisdiction resolution + precedence stack.
