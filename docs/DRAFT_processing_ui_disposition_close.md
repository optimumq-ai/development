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
from-closed transition guard (built with this).

## 2. New machinery rev 2 forces (beyond rev 1's bindings)

| Piece | Notes |
|---|---|
| Close actions on `RecordSearchTaskPage` | two rail buttons + popups; the no-records popup reads the effort trail / `request_search_intents` state live (both BUILT on the search side) |
| `close_approval` config | per department: `direct \| either \| approval_required` (per evidence-gated ending); pending-approval is a visible child state; lightweight approval task to the supervisor; on approval the close is the approver's recorded act |
| Deny-close-notify in Legal Review / compose | Draft 3/4 gain the finalize act (they already own content); disposition written on send |
| **Auto-release pipeline** | condition watcher on: flow-task terminality (with auto-bypass writer), funds balance (Draft 7 gate), pre-send review gate (config, default none), non-MRR guard. Auto-bypass completes the skipped task as a record with basis + badge (statute / system-condition / recorded) — never a silent omission |
| Pre-send review gate | config hook, default off; when on, the pipeline pauses at a review task instead of shipping |
| Disposition record screen | read from `disposition` + history + event/evidence links; route from the request header; no task type |
| Manual-endings popups | withdrawal-attach + close; §552.232 certification form (TX-gated) |
| Sweep manual-path removal | the two lapse endings lose their staff-selectable option |

Bindings unchanged from rev 1 where they exist: central `applyStageTransition` to `closed` +
history; `child_exemptions` (§5.7) citations; `clarificationTimeout` / `feeNonpayment` sweeps
(BUILT); release event writes `delivered_at` + `installment_no`; Draft 7 settlement at
last-record-ready; derived `parent_state = Complete` ends the MRR Management task.

## 3. Open questions for Kevin (rev 2)

1. **`close_approval` default** — `direct`, `either` (two buttons, your sketch), or
   `approval_required`? Drafted showing `either`.
2. **Rights for the two manual endings** (Withdrawn, Previously furnished) — drafted RM / ORO
   Associate and up, no dedicated task type (nothing queues at the Disposition record). Right
   lines? Should Withdrawn also be closeable by whoever currently holds the item's task?
3. **Reopen semantics** (carried from rev 1) — reopen restores the prior stage (drafted), or
   always lands at intake review for re-triage?
4. **RM-hold guard** (carried, still UNRATIFIED) — note required + requestor's installment
   request overrides the hold in entitlement jurisdictions; does not build until settled.
5. **Pre-send review** — any statute/city practice you know of that should ship with the review
   gate ON by default, or is off-unless-configured right?

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
