# Consolidated Spec — Domain 12: Auth, Security & Platform
**Current design only.** Verified against code + DB on 2026-07-08.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[HARDENING]`

## 1. Authentication & authorization `[BUILT / HARDENING items open]`
JWT access tokens (8h) carrying id/email/name/department + **function roles and permission roles**; `requireAuth` / `requireRole` middleware gates routes. Password hashing: **SHA-256 with a static salt** (the bcrypt-deadlock workaround) — `[HARDENING: upgrade to a proper KDF (bcrypt/argon2) + per-user salts pre-production]`. No MFA `[HARDENING — PRE_RELEASE_HARDENING Category 2]`.

## 2. Secrets `[BUILT / HARDENING]`
On-prem key handling: customer-provided keys stored in `system_config`, loaded into `process.env` at boot so all call sites work unchanged; saved keys override the `.env` baseline. **Stored plaintext** — `[HARDENING: encrypt-at-rest pre-production]`. Never echoed/SELECTed in ops (standing rule).

## 3. Departments & teams `[BUILT]`
`departments` with `kind` (department vs team), `is_open_records`, `is_catch_all`, `processed_by` (department → its processing team), **`auto_load_balancing`** (per-team toggle — the Tasks-spec §3 toggle EXISTS), `routing_specialization`, active/sort. DepartmentsPage + StaffManagementPage front org + user/role assignment.

## 4. Email `[BUILT]`
Resend integration, **live** — key + `resend_from` from system_config (optimumq.ai domain verified); `onboarding@resend.dev` is an unused fallback only. Branded templates (emailTemplate). Used by: verification, onboarding review requests, estimate/adjustment notices, dunning.

## 5. Platform `[BUILT]`
Ubuntu droplet; **PM2** (optimumq-api :3001 + three demo-connector stubs) running as dedicated **`optimumq` service user** (de-rooted 2026-07); nginx serves the built frontend; **PostgreSQL + pgvector in Docker**; geocode service for the map. Background workers on boot: massJobs, nena911 scheduler, importIngest scheduler, tickler, configFreshness, task reconciler.

## 6. Hardening backlog (from PRE_RELEASE_HARDENING.md, still accurate)
Category 1 (function-impacting): vector-DB payload encryption, index minimization. Category 2 (pre-production): auth/MFA, **TLS** (site is HTTP today), secrets/volume encryption, backups, logging hygiene, password KDF (§1). Deferred consideration: two-stage gatekeeper agent (screen for prompt injection before the records agent) — revisit pre-production or on a real abuse incident. Independent third-party pen test before government customers `[standing recommendation]`.
