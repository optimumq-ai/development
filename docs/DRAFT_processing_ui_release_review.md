# DRAFT — Processing UI, session 1 (screen 9): Release Review & Power Mode

**Status:** DESIGN DRAFT for Kevin's markup, 2026-07-29. Not a spec, not for build. Ninth screen,
born from the 7/29 item-by-item session on Draft 8 rev 2's pre-send review gate; becomes part of
`SPEC_processing_ui.md` with the rest when the shape settles.
**Mockup:** `docs/mockups/PROCESSING_UI_draft9_release_review.html` (tracked; viewing copy in
`/home/optimumq/exchange`) — Frame A: My Tasks with the Release Review group and its Power-mode
entry; Frame B: power mode itself (approve-and-next, one screen, no navigation); Frame C: the
return-with-note popup. Single city (Austin, TX); the gate is city policy, so OH renders
identically.

---

## 0. Kevin's direction — 2026-07-29 (verbatim intent, structured)

1. When the pre-send review gate is ON, a real **task type and task role** carry the work.
2. **POWER MODE:** instead of click-into-task / navigate-out / click-next, a dedicated surface
   lets the reviewer **approve and go to the next item without leaving the screen** — the
   approved record's data disappears, the next request's data populates in place.

## 1. The task type: `release_review`

- **Spawn:** the auto-release pipeline's other three conditions are met (all flow tasks terminal
  with recorded-basis bypasses · balance ≤ 0 · non-MRR) and the city's pre-send gate is ON →
  spawn `release_review` instead of shipping. The task holds the assembled outgoing package.
- **Routing:** standard `{assignee_role, task_name}` config (the approval-modules pattern);
  **suggested default: ORO Supervisor**; "Release Review" joins the task menus of ORO
  Supervisor / Director, optionally [Team] Fulfillment Supervisor for cities that want review
  inside the team. Eligibility via `user_task_types`; pool + smart routing unchanged.
- **The two-eyes rule:** the reviewer must not be the person who completed the item's **last
  flow task** — a same-eyes review is theater. Enforced at assignment, not etiquette.
- **Approve** fires the release event (release + notice + `Closed – Delivered` +
  `delivered_at` + `installment_no`, one event) with the **approver recorded as the actor**.
- Normal path always exists: the task opens one-at-a-time from My Tasks like any other. Power
  mode is an **accelerator, not a replacement**.

## 2. Power mode — the shape

- **Entry:** a "Power mode (n) →" button on the Release Review group header in My Tasks (and on
  the single-task screen: "Continue in power mode").
- **One screen, one item at a time.** Populated in place, newest-deadline-first (clock-aware
  ordering, same as every queue): parent strip · the released set (page count, preview) · the
  **withholding log / redaction inventory with citations** — the substance that needs eyes, on
  the surface, never behind a click · the notice exactly as the requestor will receive it ·
  the item's flags (ledger, eligibility, anything amber).
- **Three acts, keyboard-driven, no navigation:**
  - **Approve & send → next** (`A`) — fires the release event, this reviewer recorded; the item
    clears and the next populates.
  - **Skip →** (`S`) — leaves the task in the queue untouched, moves on (for the one that needs
    a phone call first).
  - **Return with note…** (`R`) — sends the item back to the team/task that produced it with a
    required note (the Draft-4 "return with guidance" pattern); the pipeline resumes when the
    fix lands and conditions re-satisfy. This button is what makes the review real.
- **Progress strip:** "#3 of 12 · 9 remaining · 2 skipped" — skipped items resurface at the end
  of the pass.
- **Guardrails against rubber-stamping:** every approval is an individually recorded act (this
  reviewer, this item, this timestamp — audit-identical to the one-at-a-time path); the
  reviewable substance renders on the power surface itself; no bulk-approve, no select-all —
  the unit of action is one item, always.

## 3. Bindings

| Surface | Binds to |
|---|---|
| Task type | NEW `release_review` catalog entry (MASTER A1 addendum at ratification); spawner = the pipeline's gate branch |
| Gate knob | the Draft 8 rev-2 go-live checklist knob (`suggested_default: off`, unconfirmed ⚠, rule-d machinery) |
| Routing config | approval-modules `{assignee_role, task_name}` pattern; `user_task_types` eligibility; two-eyes rule checked against the item's last flow-task completer |
| Package panel | release-event preview: `fulfilled_records`, withholding log (§5.7 citations), assembled notice (`feeNotice` / closure-notice content) |
| Approve | the release event, verbatim (Draft 8 rev 2 §1) — approver recorded |
| Return | task-return-with-note (Draft 4 pattern) targeting the producing task; pipeline re-arms on fix |
| Queue / progress | My Tasks Release Review group; power-mode ordering = clock-aware queue order |

## 4. The pattern, deliberately scoped (first-build lesson)

Power mode is a **per-task-type surface built from library components** (PowerQueue shell:
progress strip + act row + populate-in-place), NOT a generic shared screen every reviewable thing
gets crammed into. Release review is the first instance. Obvious future customers, each getting
its own tuned variant when its turn comes: the `close_approval = approval_required` supervisor
queue (Draft 8), routed waiver decisions (Draft 2). None of those build in v1.

## 5. Open questions for Kevin

1. **Default role** — ORO Supervisor as suggested default, or Director-configurable-only with no
   suggestion?
2. **Two-eyes rule scope** — drafted as "not the last flow-task completer." Stricter option:
   nobody who completed *any* flow task on the item. Small-city reality says keep it narrow?
3. **Skip ordering** — skipped items resurface at end of pass (drafted), or stay skipped until
   the next session?
4. **Metrics** — should Director oversight see per-reviewer pace (items/hour, seconds-per-item)?
   Useful for staffing, easy to read as surveillance. Drafted: counts only, no timing.
5. **Keyboard keys** — A / S / R drafted; any collision with your conventions?

## 6. Not re-opened

The gate's default and knob treatment (decided 7/29, Draft 8 rev 2 §3.5); the release event's
content and one-act rule; the pipeline's four conditions; §5.8 vocabulary; the per-user-type UI
direction.
