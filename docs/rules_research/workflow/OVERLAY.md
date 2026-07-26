# State-gated overlay — the Phase-6 bridge (v2.5, 2026-07-26)

Every flow node on the 7 diagram pages is classified — the classification is rendered on the
diagram itself (unmarked = shared · ◆ = value knob · ▲ = state-gated branch), emitted to
`workflow_overlay.json` by the build, and summarized here. **This is the work-list for Phase 6:**
the ◆ nodes are where per-state config templates fill values (drawing on the ~55 parameter/mixed
concepts in `../alignment/master_concept_dictionary.json`); the ▲ nodes are the state-gated
branches a state profile switches on/off; the unmarked nodes are written once and never vary.

**Totals: 115 flow nodes — 60 shared · 30 value-knobs (◆) · 25 state-branches (▲)**

## Master  (27 nodes: 16 shared · 7 ◆ · 4 ▲)

**◆ Value knobs:** `g1` Request submitted · `g4` Acknowledgment auto-sent · `p3` Estimate Data · `dd` Deposit before · `bv` VAGUE → Clarification · `bn` NO RECORD FOUND · `f2` Estimate Review (config: $ threshold +

**▲ State branches:** `g2` Requester eligible? · `s1` Fee-waiver requested · `s2` Commercial-rate requested · `br` NOT OURS → proper custodian

## Clarification  (14 nodes: 6 shared · 4 ◆ · 4 ▲)

**◆ Value knobs:** `n2` Send clarification / assist request · `n3` Await requester response · `close` CLOSE item (withdrawn) · `d4` Materially revised?

**▲ State branches:** `d1` Assist / confer required · `deny` Deny as vague / overbroad · `d2` Clock effect of sending? · `duty` Still vague after reasonable effort →

## Estimate-Fee  (21 nodes: 10 shared · 8 ◆ · 3 ▲)

**◆ Value knobs:** `dreq` Estimate required? · `addt` NOT ESTIMABLE YET → · `frev` Estimate Review (config: $ threshold + reviewer: · `fcom` Send itemized good-faith estimate / · `drsp` Requester response · `optout` opt-out / no response · `ddep` Deposit / pay before · `cnp` nonpayment (MO 90d · OR 60d ·

**▲ State branches:** `dwv` Fee waiver · `wrev` Review (public-interest / indigent / · `proc` No → proceed to work; collect at end

## Denial  (17 nodes: 5 shared · 4 ◆ · 8 ▲)

**◆ Value knobs:** `nreason` Select reason(s) from config library · `dlegal` Legal approval · `ncomm` Compose denial communication · `ddl` Denial deadline?

**▲ State branches:** `dag` Mandatory EXTERNAL ruling · `dprev` Previous determination · `ag1` Prepare AG ruling request — · `agclk` HARD CLOCKS (from receipt; · `agnot` Requestor notices: · `agwait` AWAIT AG ruling [external] · `agdec` AG ruling? · `agrel` RELEASE ordered / deemed public →

## Records-Search  (14 nodes: 9 shared · 2 ◆ · 3 ▲)

**◆ Value knobs:** `bn` NONE → NO RECORD FOUND (master branch) · `inst` INSTALLMENTS / partial production (7 states):

**▲ State branches:** `prog` BUT extraction/programming of EXISTING · `web` WEBSITE SATISFIES (8 states incl. OK ¶6): · `spec` SPECIAL-RECORD CLASS? (overlay)

## Redaction  (12 nodes: 7 shared · 4 ◆ · 1 ▲)

**◆ Value knobs:** `r1` Review against exemption / reason library · `pii` MANDATORY / AUTO-REDACT CLASSES · `r2` Apply redactions — mark visibly / note each · `d3` Legal review needed?

**▲ State branches:** `tp` THIRD-PARTY NOTICE / CLAIM (state-gated)

## Disposition  (10 nodes: 7 shared · 1 ◆ · 2 ▲)

**◆ Value knobs:** `fmt` Deliver in requested format / medium

**▲ State branches:** `hold` PAY-BEFORE-RELEASE (AL·AZ·IL·KS·MA·NE·NV·OH) · `caps` REQUESTOR-LEDGER CHECK (class D)

## Reading it for Phase 6

- A **state config template** = (1) a value for every ◆ knob reachable in that state, (2) an
  on/off (+ parameters) for every ▲ branch, (3) nothing at all for shared nodes.
- The knob VALUES come from the parameter/mixed concepts in the master dictionary; the branch
  GATES come from its structural concepts. The per-state rows in `members_by_state` say which
  states activate what — the template generator should read the dictionary, not this file.
- ⚠ config-not-law edges (clarification/estimate/nonpayment windows for most states) are ◆ knobs
  WITHOUT statutory values — the template must mark them "city policy, default N days".
