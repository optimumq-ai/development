# DRAFT — Processing UI, session 1: the Intake Reviewer end to end

**Status:** DESIGN DRAFT for Kevin's markup, 2026-07-28 (rev 1c — Kevin's rounds 1 and 2 folded in,
same day). Not a spec, not for build. Becomes (part of) `SPEC_processing_ui.md` only after Kevin
settles the shape.
**Mockup:** `exchange/PROCESSING_UI_draft1_intake_review.html` — Austin TX / Columbus OH toggle, blue
numbered annotations, legend at the bottom; the record-item blocks really expand/collapse. Uses the
portal palette Kevin chose for the record-search mockup (`lib/theme.js` tokens; adopting them for a new
screen is still Kevin's call — `SPEC_record_search_task_screen.md` §9).

Per the design-session brief: ONE role drafted end to end rather than a thin sketch of all of them. The
intake reviewer is the densest (hosts the inline waiver/commercial decision when a module is in
`intake_review` mode) and is the first test of the per-user-type shape.

---

## 0. Kevin's decisions — 2026-07-28 (first markup round)

1. **`intake_review` IS a task**: a new routable task type, assigned to **ORO Associate**, shown on
   My Tasks. Assignment is the standard model — **pool assignment, smart routing considered** (auto-
   assign on a clear specialization match, otherwise claim from pool).
2. **Parent-level task.** Some tasks are child-level; intake review is parent-level. The screen leads
   with parent-level info; **child-level request info sits behind a click-to-expand**.
3. **Non-MRR only.** This path never carries more than one child record. MRR requests do not spawn
   `intake_review`; their intake is the Request-Manager flow (to be drafted separately).
4. **Auto-complete:** if the request came from the portal and the requestor indicated that an attached
   record **fulfills** the search, the intake_review task is **marked completed automatically** (spawn +
   auto-complete so the audit trail is intact; the request proceeds without a stop, and the queue never
   shows it).
5. **(round 2) Only-when-needed is the DEFAULT.** The original intent — intake review only when the AI
   can't determine the routing team — generalizes to a trigger list, and becomes a **setup option**:
   - **only when needed** (default): the task spawns only when a trigger fires —
     (i) team undeterminable (absorbs today's `routing_review` task; "can't route" becomes a trigger of
     this task rather than a task of its own) · (ii) an eligibility review returned ·
     (iii) a waiver/commercial decision pending in `intake_review` mode · (iv) a sensitivity flag.
     Everything else routes straight to its team with no intake stop.
   - **always**: every non-MRR request pauses at intake review (cities that want day-1 defect review).
   The queue is therefore an **exceptions queue**, and both the queue ("Why it's here" column) and the
   task screen ("Here because:" line) surface the trigger.
   **The vague/overly-broad consequence Kevin flagged is already handled downstream:** the Record
   Search task screen carries the same Mark Vague / Mark Overly Broad markers (built 2026-07-14), wired
   to the full per-jurisdiction clarification machinery — a defect discovered after team assignment
   fires the identical process, just from the first fulfillment task. Mitigating the timing cost:
   vagueness and unroutability usually arrive together, so most defective requests still stop at intake
   via trigger (i). The honest residual trade (a vague-but-confidently-classified request in a
   hard-clock state is discovered mid-window rather than day 1) is stated in mockup annotation 14.

## 1. The shape being tested

- **Two screens make the role UI:** My Tasks filtered to intake work (the only router — under
  only-when-needed it is an *exceptions* queue, and every row says which trigger stopped it), and the
  Intake Review task screen. No global hub; no shared task shell. Cross-cutting pieces — clock chips,
  decided-by badges, the portal-results bar, the comms log — are proposed as a **component library**,
  drafted here inside one screen first.
- **Parent-scoped screen** (decision 2): parent strip, clock strip, eligibility, ledger, and the inline
  waiver panel are parent-level and always visible; the single record item (description, classification,
  routing, prelim search, Vague/Overly-Broad marking) is an expandable block. The TX tab draws it
  expanded, the OH tab collapsed, so both states are visible.

## 2. Panel → endpoint bindings (all Phase-7, all read-only GETs unless noted)

| Surface | Binds to |
|---|---|
| Clock strip + queue clock column | `request_clocks` rows through `tolling.computeStatus` → `kind`, `legalDeadline`, `operationalTarget`, `overdueMeaning`, `citation`, `exposures`. Copy comes from `overdueMeaning`, never hardcoded. |
| Panel gating (waiver, commercial, AG-anything, custodian referral, vagueness-denial) | `GET /api/jurisdiction-profile/branch-profile` → `capabilities` (`true | false | null`) + `unavailableStages`. **Only explicit `false` hides.** |
| Eligibility panel | evaluation recorded at submit (`requestCreate` → `eligibilityGate.evaluate`; reviews/advisories land as `ELIGIBILITY_REVIEW` / `ELIGIBILITY_ADVISORY` history notes). Dimension config: `GET /eligibility`. **Build note:** the screen wants the structured findings, not the prose note — needs a small read endpoint or a structured column; flagged in §4. |
| Ledger panel | `GET /ledger/request/:requestId` → balance + flags, or `{anonymous: true}` (render "does not apply", never "hidden"). Cross-request rule text: `GET /ledger`. |
| Inline waiver / commercial panels | `GET /approval-modules` → per module `{enabled, mode, routed_task}` + statutory-mandatory categories. Inline panel exists only when `mode = 'intake_review'` and the capability is not `false`. |
| Prelim search (inside the record-item expand) | same substrate as the record-search screen: `request_selected_records`, `request_intake_results` (R9), `request_search_intents.queries_tried`, library search. |
| Auto-complete (decision 4) | the portal's selected-records + search-intent substrate: requestor picks carry `request_selected_records`; "selection fulfills the request" is R9's `complete` intent (`request_search_intents`). Task spawn checks it and self-completes. |
| Vague / Overly Broad on the record item | existing `clarificationAction` paths (`reason: vague` / `overly_broad`), duty from `clarification_duty`. |
| Proceed → Fulfillment | central `taskRouting.applyStageTransition` on the child. |

## 3. The compliance treatments (mapping to the five rules)

- **(a) Clock kinds get two irreconcilable visual grammars.** Navy solid left-bar + citation =
  statutory (`response` / `agency_action`). Grey **dashed** = `operational_target`, always labeled
  "city service target — not a legal deadline". Thin outline = `requestor_window`. OH with no target
  set renders an honest "no deadline — no city target set" (and sorts by age in the queue), per the
  handoff: never invent a date.
- **(b) Three-valued gating** demonstrated by the two tabs; the mockup's closing note states the
  19-null-cities rule so a build never regresses to hide-on-falsy.
- **(c) Decided-by is a first-class badge vocabulary:** `a person` (named, amber for pending) ·
  `by statute` (mandatory categories, green-tinted, fires regardless of enabled) · `system ·
  statute-triggered` (money math, with citation and an explicit "nothing for you to decide") ·
  `recorded only` (ghost/dashed). External decisions name the decider (OH vexatious list = the court's).
- **(e) Anonymous** ledger panel states history *does not apply*; no implication of a hidden balance.
- **(d)** is deliberately **not** on this role's screens — the confirm-each-knob go-live checklist is an
  admin surface, proposed as the next draft.

## 4. What this draft forces (build implications, if the shape survives)

1. **The `intake_review` task type** (decisions 1 + 5): catalog entry (`MASTER` A1, owner ORO
   Associate), My Tasks routing (`Intake →`), eligibility via `user_task_types` so pool + smart
   routing work unchanged. Spawn is **trigger-driven, not stage-driven**: the trigger list of
   decision 5 in only-when-needed mode; every non-MRR request in always mode. Non-MRR spawn guard
   (decision 3): only single-child parents spawn it. The task must record **which trigger(s)** spawned
   it (the queue and screen display it).
2. **`routing_review` consolidation** (decision 5.i): "can't determine team" becomes a trigger of
   `intake_review`; the separate `routing_review` task type retires (catalog + `ROUTABLE_TASK_TYPES` +
   its auto-close-on-route behavior moves onto this task). One stop, not two overlapping ones.
3. **The setup option** lives with the other city workflow config (a `jurisdiction_rules` `intake`
   domain knob or sibling): `intake_review_mode: 'when_needed' | 'always'`, default `when_needed`.
4. **Auto-complete path** (decision 4): portal-born + requestor's selection carries the
   fulfills/`complete` intent → in when-needed mode it's simply a no-trigger case; in always mode the
   task is spawned and completed immediately (history row, no assignee). Note the adjacency to the
   *unbuilt* skip-gating recipe in `SPEC_record_search_task_screen.md` §1 (`wfr-selected-public` /
   `wfr-selected-private`) — same signal, two consumers; build once.
5. **Structured eligibility findings read.** Findings currently persist as prose history notes; the
   panel needs the structured `{blocks, reviews, advisories}` (+ a confirm action for `reviews` that
   the Proceed gate checks). In when-needed mode the reviews array is also a spawn trigger, so the
   structured read is needed at spawn time, not just render time.
6. **Proceed gate.** Resolution blocked (with the reason) while an inline waiver decision or an
   eligibility review is open — same pattern as the record-search Found gate (422 with a named cause).
7. **Component library seeds:** ClockChip (4 kinds + exposure warning), DecidedByBadge (4 values),
   PortalResultsBar, ParentStrip, RecordItemExpand, TriggerBadge ("why it's here").

## 5. Open questions for Kevin (remaining)

1. **The trigger list** (decision 5) — is the four-trigger set right, and is anything missing (e.g.
   should a request the requestor marked "search for more" beyond their picks ever stop here)?
2. **The visual grammars** — clock chips (navy solid vs grey dashed vs outline) and decided-by badges:
   right instinct? Colors are provisional per the §9 rule ("settle the color as we refine").
3. **Inline waiver at intake** — drafted with `fee_waiver` in `intake_review` mode to show the point of
   the screen; live default is `routed_task` (ORO Finance). Keep the panel conditional exactly on mode?
4. **Default expand state** of the record item — drafted TX-expanded / OH-collapsed to show both;
   which is the default when a reviewer opens the task?
5. **Queue columns** — clock-first sort, flags column, pool/claim rendering: anything missing (age,
   team, assignment)?
6. **Next role to draft** once this settles: the MRR / Request-Manager intake flow (now explicitly a
   separate path, decision 3), the admin go-live checklist (rule d), or the estimate screen's
   waiver-gate extension?

## 6. Explicitly not re-opened

Waiver/commercial module design (`DESIGN_fee_waiver_commercial.md`), ledger classes
(`DESIGN_requestor_ledger.md`), clock taxonomy (WS3), the per-user-type decision itself, and the
retirement of `RequestWorkspacePage`.
