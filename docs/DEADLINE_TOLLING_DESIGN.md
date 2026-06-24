# Statutory Deadline & Clock-Tolling Engine - DESIGN

Status: design for build (2026-06-24). Governed by AUTO_CONFIG_DESIGN.md (Section 8). This is the "biggest
missing primitive": today deadlines are a naive calendar-day offset (requests.deadline_date) and the tickler
watches only INTERNAL clocks. Statutory clocks need calendar-basis awareness, stacked clocks, and TOLLING
(pause/resume), e.g. "pause the response count while we await an AG ruling / clarification / payment".

## Goals
- Model one or more CLOCKS per request, each with its own rule (acknowledge / respond / produce / appeal / AG).
- Calendar basis per clock: business_days (skip weekends + a per-jurisdiction HOLIDAY SET) or calendar_days.
- TOLLING: events that PAUSE and RESUME a clock (clarification_pending, payment_pending, ag_ruling_pending,
  extension). Time spent tolled does not count; the due date pushes out by the tolled duration.
- Derived, auditable due dates (never store-and-mutate a bare date - recompute from start + duration + tolls).
- Config-driven rules (default set now; fed by the Jurisdiction Profile later). No hardcoded TX.
- Back-compat: keep requests.deadline_date in sync as a cached projection of the PRIMARY clock so the existing
  dashboard overdue count + email keep working unchanged.

## Data model
request_clocks: id, request_id, clock_type (respond|acknowledge|produce|appeal|ag_ruling|custom), label,
  basis (business_days|calendar_days), duration (int days), started_at (TEXT ts), status
  (running|tolled|satisfied|expired), satisfied_at, is_primary (int 0/1), created_at, updated_at.
clock_tolls (the ledger): id, clock_id, reason, tolled_from (ts), tolled_until (ts NULL = currently open),
  note, created_at.  An OPEN toll (tolled_until NULL) means the clock is paused now.

Rules config (system_config key 'deadline_rules', JSON; later supplied/overridden by Jurisdiction Profile):
  { version, weekend:[0,6], holidays:["YYYY-MM-DD", ...],
    clocks: {
      respond:   { label, basis:"calendar_days", durationByClassification:{simple:5,standard:10,complex:20,
                   redaction_required:30}, default:10, startOn:"intake", primary:true,
                   tollReasons:["clarification_pending","payment_pending","extension"] },
      ag_ruling: { label, basis:"business_days", duration:10, startOn:"demand", primary:false,
                   tollReasons:["extension"] }
    } }
  Default 'respond' basis is calendar_days with the EXISTING classification durations -> identical to today's
  deadline_date (no demo shift). A jurisdiction may switch it to business_days. 'ag_ruling' (business_days/10,
  TX) demonstrates business-day + toll machinery and is started ON DEMAND (by the future AG workflow segment).

## Calculation (pure, in deadlineCalc.js - no DB)
- isBusinessDay(d, holidaysSet, weekend); addBusinessDays(start, n, holidays); addCalendarDays(start, n);
  businessDaysBetween(a, b, holidays); calendarDaysBetween(a, b); + addBasisDays / basisDaysBetween dispatchers.
- All at DATE granularity (YYYY-MM-DD), UTC. start day = day 0; addBasisDays(start, N) = the date N basis-days
  later (matches existing new Date()+N for calendar).

## Status (derived) - tolling.computeStatus(clock, tolls, rules)
  elapsed   = basisDaysBetween(started_at, now)
  tolled    = sum over toll intervals of basisDaysBetween(from, until||now)   // open interval counts to now
  consumed  = max(0, elapsed - tolled)
  remaining = duration - consumed
  currentlyTolled = any toll with tolled_until NULL
  dueDate   = addBasisDays( addBasisDays(started_at, duration), tolled )       // base due, pushed out by tolls
  isOverdue = status not satisfied AND not currentlyTolled AND remaining < 0
  => due date is always recomputable + explainable from (start, duration, basis, holidays, toll ledger).

## Operations (tolling.js service)
- startClocksForRequest(requestId) - idempotent; creates clocks whose rule.startOn=='intake' (respond), using
  the request's classification for duration; writes the primary clock's dueDate back to requests.deadline_date.
- startClock(requestId, type, opts) - create a specific clock (e.g. ag_ruling on demand).
- toll(clockId, reason, note) - open a toll interval; set clock.status='tolled'. (no-op if already open.)
- resume(clockId) - close the open interval; set status='running'; recompute + writeback deadline_date.
- satisfy(clockId) - status='satisfied', satisfied_at=now (e.g. response sent, ruling received).
- statusForRequest(requestId) - all clocks with derived status; recompute primary -> deadline_date.
- overdue() - clocks where isOverdue (for the tickler/dashboard to consume later).

## Integration
- Hook startClocksForRequest into workflowEngine.onIntake (single common post-creation hook; idempotent).
- Writeback: primary clock dueDate -> requests.deadline_date (keeps dashboard/email correct, now toll-aware).
- Tickler (future): read tolling.overdue() instead of the naive deadline_date < now; statutory-overdue flag.
- AG/appeal workflow segments (future): call startClock('ag_ruling') + toll(respond,'ag_ruling_pending') on
  entry, satisfy/resume on exit. THIS is where "clock pauses for the AG hearing" lives.
- Attestation gate (future): auto-actions (auto-toll, auto-flag) gated per AUTO_CONFIG_DESIGN.md; v1 actions are
  explicit/manual + the intake auto-start (safe).

## Backfill / existing data
- Existing requests have no clocks. startClocksForRequest is idempotent; provide a backfill endpoint to create
  clocks for active requests (started_at = their created_at) so their derived due date matches today's value.

## v1 scope (this build)
deadlineCalc.js (+tests); request_clocks + clock_tolls + default rules config; tolling.js (start/toll/resume/
satisfy/status/overdue + deadline_date writeback); routes/clocks.js; onIntake hook + backfill endpoint; tests
(business-day math w/ holidays, toll pause/resume math, overdue, writeback). UI surface (clocks on request
detail + toll/resume controls) follows as a second commit.
