# DRAFT — Processing UI, session 1 (screen 8): Disposition / Close — **rev 2**

**Status:** DESIGN DRAFT rev 2 for Kevin's markup, 2026-07-29. Not a spec, not for build. Rev 2
supersedes rev 1's *shape* (a close surface opened from a task) with **Kevin's 7/28 direction:
closing happens where the evidence lives**; the §5.8 vocabulary and every evidence gate carry over
unchanged. Becomes part of `SPEC_processing_ui.md` when the shape settles.
**Mockup:** `docs/mockups/PROCESSING_UI_draft8_disposition_close.html` (tracked; viewing copy in
`/home/optimumq/exchange`) — Frame A: the close buttons inside Record Search + the confirm popup
(A′) with the supervisor-approval variant; Frame B: the auto-release pipeline (Kevin's
record-search-only worked example) + the sweep closures; Frame C: the Disposition record
(informational) with the two manual endings and Reopen. Single city; OH is one annotation.

---

## 0. Kevin's direction — 2026-07-28 markup (what rev 2 encodes)

1. **Inline closes, minimum clicks.** The person doing the work ends the item from their own task
   UI — e.g. "No records found — close…" inside Record Search — via a small confirm popup that
   states what will be written and sent. No separate close interface to navigate to.
2. **Optional supervisor approval**, department-level: close pending until the supervisor
   approves, or two buttons (Submit / Route to supervisor) letting the closer choose.
3. **Denial finalizes in the deciding UI**: legal review's determination carries a
   deny-close-notify act right there — no extra hop.
4. **Delivery and closure are automatic from conditions** (non-MRR): when the last flow task is
   terminal — completed manually or **auto-bypassed with a recorded basis** (zero-fee waiver ⇒
   payment auto-completes) — and the outstanding balance is ≤ 0, the item ships, notifies, and
   closes with no one touching it. Payment due ⇒ pending until balance ≤ 0, then ships. Unless a
   statute/config requires review before send.
5. **No-response and Non-payment are sweep-only** — they close from data with the communication
   auto-triggered; no manual path (resolves rev 1 open question 3).
6. **Draft 8's screen becomes informational** — dispositions display here with their evidence;
   the only manual acts left are the endings with no task to live in (Withdrawn, Previously
   furnished — Kevin: "perhaps manually clicking on this page is the only way") and Reopen.
7. Kevin's open items, drafted in rev 2 and flagged below: not-in-custody from the search task
   (his "tbd" — drafted yes), access/rights for this screen, whether the manual endings need a
   task type (drafted no).

## 1. The shape (rev 2) — where each ending is finalized

| §5.8 ending | Finalized | Actor / trigger |
|---|---|---|
| No records located | **Record Search task** — popup carries the full gate (effort trail + descriptions answered + required reasoning note; the two gates never feed each other) | task-holder; optional supervisor approval |
| Not in our custody / referred | **Record Search task** — popup names the custodian; referral record + letter ride the close (Kevin's tbd, drafted yes) | task-holder; same approval config |
| Denied | **Legal Review / Denial compose** — deny + close + notify is one act in the deciding UI; citations + letter live there (unchanged lock) | empowered role (Sr. Legal / compose) |
| Delivered | **Auto release event** when 4 conditions hold: all flow tasks terminal (done or bypassed-with-basis) · balance ≤ 0 · no pre-send review gate · non-MRR. Manual release stays for MRR (Draft 7 funds gate) | system, per attested config; every bypass records its basis |
| No response · Non-payment | **Sweeps only** — manual path removed | system, numeric basis + notice on the record |
| Withdrawn by requestor | **Disposition record screen** — gate: withdrawal communication on file (a choice, not silence) | RM / ORO Associate+ (drafted; open) |
| Previously furnished | **Disposition record screen** — TX §552.232 certification (prior request #, date, match); state-gated | RM / ORO Associate+ (drafted; open) |

Constants carried from rev 1: every closure owes a notice and close = **one act** (disposition +
notice, blocked-with-reason); child-level only, the parent derives `Complete` and is never closable;
sweep/auto closures render as records (badge, numeric basis, notice trail); Delivered is written by
the release event, never asserted; a redacted release is still Delivered (withholding log carries
the detail); the two MRR matrix rows (`delivery_mode` × `notice_packaging`, §15) ship blank and are
presented together; WA entitlement removes `hold_all`; reopen = Director + note + the missing
from-closed transition guard (built with this) — **the reopen popup also asks where the item
resumes: prior stage (default) or intake review for re-triage** (riding Draft 1c's trigger list as
trigger (v)); reopen itself is silent — the subsequent outcome speaks (decided 7/29).

## 2. New machinery rev 2 forces (beyond rev 1's bindings)

| Piece | Notes |
|---|---|
| Close actions on `RecordSearchTaskPage` | two rail buttons + popups; the no-records popup reads the effort trail / `request_search_intents` state live (both BUILT on the search side) |
| `close_approval` config | per department: `direct \| either \| approval_required` (per evidence-gated ending); **default `either`** (decided 7/29); pending-approval is a visible child state; lightweight approval task to the supervisor; on approval the close is the approver's recorded act |
| Deny-close-notify in Legal Review / compose | Draft 3/4 gain the finalize act (they already own content); disposition written on send |
| **Auto-release pipeline** | condition watcher on: flow-task terminality (with auto-bypass writer), funds balance (Draft 7 gate), pre-send review gate (config, default none), non-MRR guard. Auto-bypass completes the skipped task as a record with basis + badge (statute / system-condition / recorded) — never a silent omission |
| Pre-send review gate | default off, shipped as an **unconfirmed ⚠ go-live-checklist knob** a named person must confirm (rule-d machinery; decided 7/29). When ON: spawns the new **`release_review` task type** instead of shipping — routed per config (suggested default: ORO Supervisor; never the person who completed the item's last flow task); approve fires the release event with the approver recorded. Reviewed at speed via **power mode** — see Draft 9 |
| Disposition record screen | read from `disposition` + history + event/evidence links; route from the request header; no task type |
| Manual-endings popups | withdrawal-attach + close; §552.232 certification form (TX-gated). **Rights (decided 7/29):** Withdrawn — ORO Associate+ *and* the item's current task-holder (communication attached, same popup); Previously furnished — ORO Associate+ only (cross-request certification is an office-level act) |
| `Process withdrawal` spawner | decided 7/29: when a communication is logged as a withdrawal, spawn a small task to the RM / ORO pool — no standing task type, exists only when a withdrawal actually arrives; closes the forgotten-withdrawal gap (clock otherwise keeps running on a request nobody wants) |
| Sweep manual-path removal | the two lapse endings lose their staff-selectable option |

Bindings unchanged from rev 1 where they exist: central `applyStageTransition` to `closed` +
history; `child_exemptions` (§5.7) citations; `clarificationTimeout` / `feeNonpayment` sweeps
(BUILT); release event writes `delivered_at` + `installment_no`; Draft 7 settlement at
last-record-ready; derived `parent_state = Complete` ends the MRR Management task.

## 3. Rev-2 open questions — ALL DECIDED with Kevin, 2026-07-29 (item-by-item session)

1. **`close_approval` default = `either`** — both commit buttons drawn; the closer chooses per
   case; cities flip to `direct` or `approval_required` in setup.
2. **Manual-endings rights:** Withdrawn closeable by ORO Associate+ **and** the item's current
   task-holder (communication attached, same popup — same trust level as closing no-records);
   Previously furnished stays ORO Associate+ (formal cross-request certification). No standing
   task type at the Disposition record — but **a "Process withdrawal" task spawns when a
   communication is logged as a withdrawal** (RM / ORO pool), so a withdrawal can never sit
   unprocessed while the clock runs.
3. **Reopen = the hybrid.** The Director's reopen popup (note already required) also asks where
   the item resumes: **prior stage (default)** or **intake review for re-triage** — the latter
   riding Draft 1c's trigger list as trigger (v), no new machinery. Reopen is silent; the
   subsequent outcome is what speaks to the requestor. Clocks are never reset — the original
   history stands, exposures show honestly; a reopened child un-derives the parent (and
   reactivates MRR Management where it had ended).
4. **RM-hold guard RATIFIED, with the prevention refinement.** Note always required. In an
   entitlement jurisdiction with an installment request on file, the hold control is **disabled
   with the reason and citation shown** (prevention, not fight); if the installment request
   arrives while a hold stands, the hold **auto-lifts and the RM is notified** — the only true
   override case, and it is statute-on-verified-facts (the same asymmetry as the mandatory fee
   waiver, so rule (c) is not breached). Never a payment hold (§5.9, unchanged). The override
   now builds.
5. **Pre-send review default = off, as a mandatory go-live decision:** ships as an unconfirmed
   ⚠ checklist knob (`suggested_default: off`) that a named person must consciously confirm —
   no city gets silent automation nobody chose; the confirming act IS the human decision to
   automate. Statutory pre-release steps (legal review, AG band, third-party notice) already
   ride the flow as tasks, so the gate is city policy, not law. When ON, work lands on the new
   `release_review` task type and is cleared at speed via **power mode — Draft 9**.

## 4. Resolved by this round (no longer open)

Rev 1's q2 (who closes what → the finalize-where-evidence-lives table), q3 (manual lapse closes →
sweep-only), q4 (notice separable → close+notice stay one act, automatic on auto-closes). And from
the 7/28 markup: this screen's purpose (informational record), access (request header, read-only
for anyone with the request), and the auto-delivery concept itself.

## 5. Not re-opened

The §5.8 vocabulary and evidence gates, the retired parent roll-up ("partially granted" stays
retired), notice content invariants (§15.4), §5.9 never-a-payment-hold, the sweeps' config gating,
the mixed-outcome notice question (stays with the notices field-design pass), Draft 7's MRR
settlement method.
