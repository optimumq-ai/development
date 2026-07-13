# Consolidated Spec — Domain 10: Jurisdiction & Configuration
**Current design only.** Verified against code + DB on 2026-07-08.
Legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]`

## 1. Jurisdiction profiles `[BUILT]`
**One codebase, no state forks** — jurisdictional variance is config. `jurisdiction_profiles` (code, name, statute_name, statute_citation, **exemption_model**, status) + `jurisdiction_profile_sections` covering: **identity, fees, taxonomy, exemption, deadlines, redaction**. `exemption_model` drives the legal branch (pre_clearance → AG flow vs internal review — Domain 5). **Texas verified against statute** (§ 552.2615 / § 552.263). JurisdictionProfilePage fronts it.

> **Correction 2026-07-13 (audited against the live DB).** This section previously claimed *"three state profiles loaded"* — **false: `jurisdiction_profiles` has exactly ONE row (`jur-tx`)**, and all 7 of its sections have `attested_by = NULL`, so every automation gate is closed. The profile row is also **7 columns of identity only** — it holds **no clock, deadline, tolling, deposit or clarification rule**. Those live in **global `system_config` singletons** (`deadline_rules`, `clarification_policy`), NOT per jurisdiction: `clarificationPolicy.read(jid)` accepts a jurisdiction id and discards it (`clarificationPolicy.js:122`). The §26 "unverified" note below is therefore answered: **the deadlines section does NOT drive clock durations per jurisdiction — it is a content hash of a global blob.** Full inventory and the fix (a `jurisdiction_rules` table) in **`SPEC_parent_child_lifecycle.md` §10**.

## 2. Effective-dated configuration `[BUILT]`
An approved config change applies **now or on a scheduled future effective date**; a nightly promotion applies scheduled changes whose date has arrived. Every apply **snapshots into `config_history` with an effective window** — the system can answer *"what configuration was in effect on date X?"* for legal defensibility. `system_config` for live keys; ConfigurationPage fronts it.

## 3. Config freshness & proposals `[BUILT]`
On a cadence (and on demand): sends a periodic **courtesy reminder** (explicitly does NOT fetch/monitor external sources) and tallies what's **pending review per rule-domain** (redaction uses its own pending_review rows; other domains use a generic `config_proposals` staging table). RuleUpdatesPage fronts the pending queue.

## 4. AI rule discovery — propose-only `[BUILT]`
`ruleDiscovery` asks the model for **jurisdiction-appropriate open-records exemptions not already in the library** and inserts each as `source='ai'`, `pending_review`, **inactive draft**. **Never auto-approved** — a supervisor reviews/verifies/approves before any rule takes effect. Same propose/approve principle as schema discovery (Domain 3).

## 5. Onboarding wizard `[BUILT]`
Seven phases (Jurisdiction, City Departments, Fulfillment Teams, Record Ownership, Repositories & Discovery, Fees & Estimates, Redaction Readiness) with **live readiness signals from actual DB state** (not bare checkboxes). Gated phases: designated **reviewer + approval + email** flow (branded review-request email via Resend — live, verified end-to-end); onboarding cannot pass a gated phase until approved. Fees phase carries the **sandbox hard gate** (Domain 6 §8) and surfaces the current fee-config version. SetupPage/stepper with deep links.

## 6. Supporting pieces
- **decision_reasons** library (statutory reason texts, per category, usage-ranked) `[BUILT — Domain 6 §7 / Domain 4 spec §9]`.
- **agentRules** — staff-managed rule entries for portal-agent behavior `[BUILT — light CRUD]`.
- **configExtractors / feePolicyExtract** — AI-assisted extraction of config/fee policy from source documents into proposals `[BUILT — feeds §3 staging]`.

## 7. Known gaps
- **Clock durations ↔ jurisdiction linkage**: a `deadlines` profile section EXISTS, but tolling's duration defaults are in-code; whether the profile section actually drives clock durations is `[unverified — Domain 5 §6 open item stands]`.
- Only 3 state profiles loaded; the other 47 are data work, not code `[data task]`.
- Fee-waiver-denial response-window rules per jurisdiction `[NOT BUILT — legal research first; Domain 4 spec §9]`.
