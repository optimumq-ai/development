# Build Priority Summary — every [NOT BUILT] across all 12 domain specs
Compiled 2026-07-08 from the verified domain specs. Ranked for a time-constrained path to a sellable core. Sizes are directional.

## Tier 1 — Close the core single-record demo loop
1. **Record-search task screen** (D7) — engine fully exists; demo-minimal screen = request context + layered search + select + mark found/complete. *Medium.*
2. **Redaction task → workspace wiring** (D8/D4) — workspace exists; minimally, a redaction task click should open the job/workspace, not generic request detail. *Small.*
3. **Populate estimate profiles** for the top ~10 record types (D6) — DATA task, no code; lights up the already-built automated-estimate path. *Small, high leverage.*
4. ~~**Fee-waiver approval task routing** (D4)~~ **[BUILT 2026-07-09, verified 2026-07-11]** — intake `fee_waiver_requested` → `onIntake` spawns a team-agnostic `fee_waiver` task scoped to `FEE_AUTHORITY`; visible in an approver's pool (not a non-approver's); resolved by `POST /:id/fee-waiver-decision` (grant/deny → task done + history). Interim role `FEE_AUTHORITY` pending the Finance rename (item 9). *(This doc predates the 07-09 build.)*
5. **Explicit found/not-found resolution states** (D7) — small now; hard prerequisite for MRR roll-up later. *Small.*

## Tier 2 — High-value, pre-sales-polish
6. **Fee-choice intake (default-forward)** + rich quick-reply widget, chat AND form (D1 §5). *Medium.*
7. **Notification model + nullable task-request link** (D4/D9) — kills the SYS-IMPORT pseudo-request wart at the root. *Medium.*
8. **My Tasks restructure** — per-role boxes, no-empty-boxes rule, pool section, Queued/In-Process labels (D4 §5). *Medium.* **Must also settle `BACKLOG` R10 — returned-for-rework surfacing** ("URGENT CORRECTIONS REQUIRED" on the same task row + the reviewer's notes): redaction reviewer mode is built and can return work with a reason, but the author's task shows no sign it came back. The general "your work came back" treatment (redaction returns, fee objections, clarification rework) belongs to this restructure. Interacts with item 7 (notification model) — pull vs. push.
9. **Role catalog reconciliation** to one task-routing set + FEE_WAIVER_APPROVER→Finance rename (D4 §8). *Small-medium.*
10. **Legal Review task wiring; Legal Redaction path** for sensitive types (D4 §7; verify sensitive flag). *Small-medium.*

## Tier 3 — Ambitious subsystems (post first customer signal)
11. **Parent/child always-wrap + MRR processing flow** (D4 §11) — measured: 5 creation sites + 118-row migration + ~17 queries/6-8 views reviewed; then the full RM flow (Multi-Record Estimate/Search tasks, non-system contributor email link, Verify step, roll-up, early-release w/ Finance approval, HIGH PRIORITY report). *Large.*
12. **MRR item-by-item intake** in the portal agent (D1 §6). *Medium.*
13. **Workload health scoring** (exponential lateness formula, time budget input) + composite scores + management dashboard + AI reporting hooks (D4 §4, D11). *Medium-large.*
14. **Taxonomy variant level + auto-discovery groupings** (D3 — Kevin's open design). *Large.*
15. **Sources screen presentation redesign** (D9 — decision pending). *Medium.*
16. Remaining: commercial approval `[deferred — customer demand]`; fee-waiver-denial response window `[legal research first]`; help-agent retrieval upgrade (corpus now exists); production email connector; auto-publish automation (currently deliberate manual); per-task screen team variants.

## Data tasks (no code)
State jurisdiction profiles beyond TX+2; estimate profiles (item 3); redaction rule library per jurisdiction (AI-propose exists).

## Hardening (pre-production, from D12)
Password KDF (replace SHA-256/static salt) · TLS · MFA · secrets + volume encryption · backups · logging hygiene · vector payload encryption + index minimization · third-party pen test · (consider) gatekeeper agent.
