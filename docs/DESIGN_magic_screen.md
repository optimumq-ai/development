# DESIGN — the Magic Screen (demo/test mode)

**Provenance.** Kevin's `magicscreen.doc` (exchange folder, 2026-08-13) + the design discussion of
2026-08-14. Kevin asked for: a URL-only `/magic` screen with (1) Reset All to a benchmarked starting
point with RELATIVE dates preserved, (2) a way to modify demo data and re-benchmark, (3) a "magic
clock" that visibly advances time (~15–60s per day, hold-an-arrow; analog clock + calendar with the
advancing date highlighted), (4) fast role-switching among a curated demo cast. A fifth ask —
per-state switching (TX → OK …) — is **PARKED by Kevin 2026-08-14** pending his further thinking;
the groundwork facts are recorded below so nothing is re-discovered.

## The two architectural inversions (agreed 2026-08-14)
1. **The clock ages the data; it never moves system time.** "A day passes" = every date in the
   database shifts BACK one day, then the scheduled workers (clarification timeout, nonpayment,
   deadline checks) are poked to act on the newly-aged data immediately. Same observable outcomes
   through the real code paths, no synthetic-time refactor of the timestamp handling the statutory
   clocks depend on. Known trade-off, accepted: an absolute date printed on a screen shifts backward
   rather than "today" moving forward; every RELATIVE display (days left, days in process) behaves
   perfectly, and the magic screen's clock/calendar shows the synthetic date (real now + accumulated
   advance) to keep the audience oriented.
2. **The magic clock is also the authoring tool.** Kevin's ~10 benchmark scenarios are entered
   through the REAL portal and processed through the REAL screens, with clock advances between
   steps ("enter A · advance 5 days · estimate and pay A · enter B · …"), then Benchmark is pressed.
   This replaces the spreadsheet-import idea (whose interleaving problem dissolves) and keeps the
   seed-only-through-real-paths rule intact. "Modify demo data" = use the app, then re-benchmark.

## Benchmark / Reset (slice 1 — BUILT 2026-08-14, `verify_magic_reset`)
- **Benchmark** = full SQL snapshot of the demo database (every table, FK-topological order,
  self-referencing tables emitted parent-NULLS-first, secrets INCLUDED — the file lives in
  `backend/data/benchmarks/`, server-local, never git) + `meta.json` with `taken_at`.
- **Reset** = build-beside-swap: `<db>_magicbuild` is created from `schema.postgres.sql` from EMPTY
  (the pathway `reset_test_db.js` proves daily), the snapshot loads with the tasks bookkeeping
  triggers held off (restored `task_events` must not double), serial sequences re-synced past the
  restored max, then **every date shifts forward by (now − taken_at)** — so 9-days-in-process stays
  9 days in process forever — and only then do two renames swap it in (~ms; app pools reconnect on
  their next query). A failure anywhere before the swap leaves the running database untouched. The
  pre-reset database survives one generation as `<db>_prereset` — the undo of last resort.
- **The date-shifter** (`magicDemo.shiftDates`, exported for slice 2 = the clock with a negative
  delta): typed date/timestamp columns shift natively; TEXT columns named like dates
  (`*_at, *_date, *_day, *_deadline, at, day, date`) shift with their stored format preserved
  (space or ISO-T separator, 19-char datetimes, 10-char dates, tails kept verbatim), value-guarded
  by regex. **Known limits:** dates inside prose (history notes) and inside JSON blobs (config
  `confirmed_at`, estimate input snapshots) do not shift — relative displays all derive from shifted
  columns and stay correct; attestation dates drifting is cosmetically acceptable on a demo box.
- **Uploads on disk are not snapshotted** (v1): a reset orphans any files added since the benchmark
  — harmless junk in `uploads/`, recorded here so it is a decision, not a surprise.
- **Gates**: `system_config demo_mode = '1'` (absent ⇒ every `/api/magic/*` route **404s** — on a
  production install the surface does not exist) + `SYSTEM_ADMIN` + `confirm:true` on reset.
  **No API can set demo_mode** — the city-config POST allowlist does not carry it, deliberately:
  only someone with server access (a node/psql write to system_config) can flip it, so no
  compromised admin token can conjure the magic surface onto a production install.
  **Go-live/hardening note: flipping demo_mode OFF joins the go-live checklist.**

## Magic clock (slice 2 — engine BUILT 2026-08-14; UI ships with the screen shell)
`POST /api/magic/clock/advance {days|seconds}` (same gates as reset): `shiftDates(appPool, −N)`
against the LIVE demo db (no rebuild — the clock mutates the running world; Reset is the safety net
beneath it, and the clock REFUSES 409 NO_BENCHMARK when none exists — aging the world with no way
back is data loss, not a demo). After each tick the date-driven workers run IMMEDIATELY, each
isolated: `tickler.runSweep` (deadline flags + nonpayment dunning/closure + clarification
timeouts), `massJobs.tick` (nightly window), `effectiveConfig.promoteDue` (scheduled config),
`taskRouting.reconcileStageTasks` — so consequences land while the audience watches, not on the
next interval. Accumulated advance in system_config `magic_clock_offset`; `GET /magic/status`
serves `syntheticNow` (real now + offset) for the screen's clock face; Reset zeroes the key.
Advances bounded 1 min–90 days per call. UI (with the shell): hold-the-arrow advances, analog
clock + calendar per Kevin's visual; pace tuned so the workers keep up (60s/day acceptable —
Kevin narrates over it).

## Role switch (slice 3 — NOT BUILT, ships with the screen shell)
Curated cast on the screen (legal · ORO head · finance · estimator · searcher · redactor · ORO
Associate for MRR — Kevin expects to tune this with use): server mints a real session token for the
chosen user (the login mechanism, demo-gated), the client swaps it in and reloads. The screen shell
itself is design-gated (v2 UI rule): mockup for Kevin before build, including the clock/calendar.

## Parked: per-state switching (Kevin, 2026-08-14)
Facts so nothing is re-learned: the 32-state rules research is DONE (5 waves, pruned 1,116 rules,
master concept dictionary of 122 concepts/17 families; Kevin holds the xlsx); the importer
(`import_state_template.js`) lists 32 gathered templates; TX + OH are fully imported (17 domains,
15 sections each) and TX is active + fully attested (2026-08-01); other states are thin partials;
only TX has a fee profile. The agreed shape WHEN unparked: one demo db + per-state benchmark
snapshots + a replayable scenario script, with a per-state readiness ledger
(imported → reviewed → fee profile → scenarios replayed → benchmarked) and the state switcher
refusing, in words, to switch to a state that isn't demo-ready. 18 states were deliberately never
gathered (no prospect-sized cities — Kevin).

## Starting-point decision (Kevin, 2026-08-14)
Not an empty database: keep the furniture (taxonomy, staff, config, library, templates, sources),
purge the current requests through the guarded corpus purge, author the ~10 scenarios with the
clock, then Benchmark.
