# DRAFT — Processing UI, session 1 (screen 8): Disposition / Close

**Status:** DESIGN DRAFT for Kevin's markup, 2026-07-28. Not a spec, not for build. The eighth and
final screen of the session-1 set; becomes part of `SPEC_processing_ui.md` when the shape settles.
**Mockup:** `docs/mockups/PROCESSING_UI_draft8_disposition_close.html` (tracked; viewing copy in
`/home/optimumq/exchange`) — Frame A: the close surface (no-records worked example); Frame B: the
Delivered path (release event + the two blank MRR matrix rows). Single city; OH is one annotation.

---

## 1. The shape

- **A close surface opened from a task, returning to it** (the Denial-compose pattern). Dispositions
  are child-level and exactly the eight §5.8 endings; the parent is never closable — it derives
  `Complete` when the last child ends (no parent disposition, mixed endings stay per-child).
- **Every ending has a named evidence gate**, shown as a chip on the option:
  | Disposition | Gate |
  |---|---|
  | No records located | non-empty effort trail + every duty-carrying description answered + required reasoning note; the two gates never feed each other |
  | Withdrawn by requestor | the withdrawal communication on file (a choice, not silence) |
  | Previously furnished | TX §552.232 certification (prior request #, date, match) — an ending, not a denial; state-gated |
  | Not in our custody / referred | custodian named + referral record |
  | Denied | **locked** — reachable only via Denial compose / the AG band (citations + letter live there) |
  | Delivered | **written by the release event**, never asserted (release + funds check + notice + `delivered_at` + `installment_no`, one event) |
  | No response · Non-payment | normally the config-gated sweeps; manual use demands the sweep's own evidence |
- **Every closure owes a notice.** Content per disposition (denial content invariant); close = one
  act, disposition + notice; blocked-with-reason like every gate in the set.
- **Sweep closures render as records**: system-per-attested-config badge, numeric basis, notice
  trail — never silent.
- **The two MRR matrix rows ship blank and are presented together** (`delivery_mode` ×
  `notice_packaging`, §15 — no vendor default; n = 1 degenerates correctly; WA entitlement removes
  `hold_all` from the menu as a constraint).
- **Reopen**: Director authority + required note, and the missing from-closed transition guard
  (flagged doc-debt) becomes part of this build.

## 2. Bindings

| Surface | Binds to |
|---|---|
| Disposition write | child `disposition` (§5.8 vocabulary) via central `applyStageTransition` to `closed` + history |
| No-records gate | effort trail (`request_history` action list) + `request_search_intents` blanket resolve (both BUILT on the record-search side) |
| Denied lock | Draft 3 compose / Draft 4 AG band set it; `child_exemptions` (§5.7) carries citations |
| Previously furnished | NEW: certification record (prior request ref, date, attestation of match); TX-gated |
| Referral | custodian referral record + letter (outreach pattern); `custodian_referral` capability |
| Sweeps | `clarificationTimeout` (No response; `closure_notice_required` → notice-owed) and `feeNonpayment` sweep (Non-payment) — both BUILT |
| Release event | Draft 7 funds check + `fulfilled_records` + withholding log + notice; writes `delivered_at`, `installment_no` |
| Matrix rows | §15 MRR Rule Matrix (`delivery_mode`, `notice_packaging`) — blank until the city answers; WA constraint |
| RM hold | §5.8 `hold_override` — drafted per the spec's recommended, UNRATIFIED guard (note required + requestor-override in entitlement jurisdictions); does not build until ratified |
| Parent completion | derived `parent_state = Complete` when all children terminal; ends the MRR Management task; Draft 7 settlement already triggered at last-record-ready |

## 3. Open questions for Kevin

1. **Ratify or reverse the RM-hold guard** (spec-flagged OPEN): note required + requestor's
   installment request overrides the hold in entitlement jurisdictions. The override does not build
   until this is settled.
2. **Who closes what?** Drafted: the task-holder closes evidence-gated endings (no-records,
   referral, previously-furnished); Withdrawn closeable by anyone holding the request with the
   communication on file; reopen = Director. Right authority lines?
3. **Manual No-response / Non-payment** — drafted as allowed with the sweep's evidence. Or should
   these be sweep-only (manual path removed entirely)?
4. **Notice send on close** — one combined act (drafted). Any closure where the notice should be
   separable (e.g., postal letters queued for printing)?
5. **Reopen semantics** — reopen restores the prior stage, or always lands at intake review for
   re-triage?

## 4. Not re-opened

The §5.8 vocabulary itself, the retired parent roll-up ("partially granted" stays retired), notice
content invariants (§15.4), §5.9 never-a-payment-hold, the sweeps' config gating, the mixed-outcome
notice question (stays with the notices field-design pass).
