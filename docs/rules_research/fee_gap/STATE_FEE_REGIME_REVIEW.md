# State Fee-Regime Review — 32 states, compiled from existing research only

**Date:** 2026-08-19 · **Compiled for:** Kevin's review before any further research agents are spawned.
**No new research was performed.** Every claim below traces to material we already hold:

| Source | What it is | Trust level |
|---|---|---|
| `fee_gap/raw/<ST>.json` (22 states) | Fresh official-source research, 2026-08-19, 36 items/state, verbatim clauses, delegation-follow | **Anchor** (4 of 22 verified) |
| `fee_gap/verified/<ST>.json` (AL AZ CA CO) | Adversarial refute pass on the raw rows | Anchor, verified |
| `alignment/fee_master_list.json` (all 32) | Auto-derived from the July wave-discovery library (pruned corpus) | Library layer; currency = July 2026 |
| `desktop_research/documents/*.md` (29 states) + `chatgpt_pilot/*.docx` (32 states) | Third-party AI compilations Kevin uploaded (ChatGPT/DeepSeek era; vendored) | **Leads only — never authority.** May cite non-official sources. |

**Tag vocabulary** (roll-ups; the real resolution is per-ITEM in the raw files — a tag never erases an
item-level statutory exception):

- **STATUTE-VALUED — appears complete**: the legislature's own text carries the operative figures; no
  outside instrument left unfollowed.
- **DELEGATED → <instrument>**: the statute points at an outside instrument for numbers. Instrument named,
  described, and (unless noted) opened with figures extracted.
- **DEFERS TO CITY (constraints listed)**: fee-setting is the city's, bounded by whatever statutory
  ceilings/process rules exist. "Stop here" applies to the deferred items only; listed exceptions stay
  binding library rules.
- **ACTUAL-COST STANDARD**: a soft statutory ceiling ("actual cost" / "reasonable") with no schedule — a
  flavor of defers-to-city.
- **PENDING GAP PASS**: no 2026-08-19 raw file; classification rests on the July library (currency
  unchecked) + third-party leads. Lower confidence by construction.

---

## Headline findings

1. **No state is a pure single-tag regime.** Every "defers" state still legislates *something* binding
   (a deposit cap, a labor prohibition, a waiver rule, an estimate duty). The mixed-regime concern is
   confirmed everywhere — classification below is roll-up + named exceptions, never tag-only.
2. **Louisiana (Kevin's example) — the statute is live, but Kevin's instinct about Google results is
   half right in an important way.** Opened at legis.la.gov on 2026-08-19: La. R.S. 44:32(C) actively
   speaks — "reasonable fees for making copies," a **mandatory posted fee schedule** (Act 247 of 2023),
   advance payment authority (Act 411 of 2024), labor never chargeable (C)(3), discretionary indigent
   waiver. The independent desktop-research doc agrees clause-for-clause. **What Google gets wrong:** the
   "$0.25/page Louisiana fee" sites cite is LAC 4:I.301 — the **state-agency** uniform schedule under
   R.S. 39:241. It does **not** bind cities. So: no state-mandated *rate* for municipalities (correct
   instinct), but the deferral-plus-constraints statute was never struck (the 2026 bill that would have
   set rates, SB 493, was withdrawn 4/22/2026 and is not law).
3. **Deferral rules ARE in the library.** For all 22 gap-passed states, every defers-to-city /
   actual-cost resolution is anchored to a rule — mostly existing library rules; 19 items across 10
   states anchor to NEW rule rows sitting in the raw files awaiting the merge step. Zero unanchored.
4. **Third-party compilations produced NO surviving deltas for the 22 gap-passed states.** Every candidate
   (IL voluminous-data tiers, PA Act-22 police A/V regime, CT $20 scanner ceiling, LA posted-schedule
   duty) is already in our raw files. For the 10 pending states the third-party docs corroborate the
   library and flag recency items, most of which the July library already has (checked: MO HB 145
   withdrawal ✔, OK SB 535 $75 threshold ✔, NY 6-month free-repeat ✔, MI 45-day abandonment ✔, WA 10%
   deposit ceiling ✔, WI Act 253 ✔). Genuinely unconfirmed in the library: **MN's 2025 five-business-day
   suspension rule** (Minn. Stat. 13.03 subd. 3(g)) — MN's fee coverage is the thinnest (3 fee rules).
5. **The ceiling-vs-deferral distinction Kevin asked for is preserved item-by-item** in the raw files
   (resolution vocabulary separates `value` / `ceiling` / `actual_cost_standard` / `defers_to_city`), so
   the future local-policy validator can tell "city sets $0.20 under a $0.25 ceiling — fine" from
   "city exceeds a fixed cap — compliance flag."
6. **One genuinely unresolved delegation in 22 states:** NC certified-copy fees ("as provided by law" —
   no municipal instrument locatable; treated as `delegated_unresolved`, manual-verification flag).

---

## The 32 states

**Quick-scan table** (C = raw-file coverage 36/36; V = verified):

| St | Roll-up tag | Basis | Remaining work |
|---|---|---|---|
| AL | DEFERS TO CITY ("reasonable fee set by the public officer", SB270 2024) | C+V (36/36 CONFIRMED) | none |
| AZ | DEFERS TO CITY (no copy rates at all) | C+V (36/36 CONFIRMED) | none |
| CA | ACTUAL-COST STANDARD (direct cost of duplication) | C+V (29 conf, 7 corrected-in-place) | none |
| CO | STATUTE-VALUED + one delegation (labor cap → Leg. Council CPI posting, followed) | C+V (36/36 CONFIRMED) | none |
| CT | STATUTE-VALUED — appears complete | C | verify pass |
| FL | STATUTE-VALUED — appears complete | C | verify pass |
| GA | STATUTE-VALUED — appears complete | C | verify pass |
| ID | STATUTE-VALUED — appears complete | C | verify pass |
| IL | STATUTE-VALUED (ceilings) — appears complete | C | verify pass |
| IN | STATUTE-VALUED (ceilings; city schedule under them) | C | verify pass |
| KS | ACTUAL-COST STANDARD + statutory process values | C | verify pass |
| LA | DEFERS TO CITY (posted schedule mandatory) — see headline 2 | C | verify pass |
| MA | PENDING — library reads STATUTE-VALUED | library | full gap pass |
| MI | PENDING — library reads STATUTE-VALUED (dense) | library | full gap pass |
| MN | PENDING — library thin; 2025 amendment unconfirmed | library | full gap pass |
| MO | PENDING — library reads STATUTE-VALUED | library | full gap pass |
| NC | ACTUAL-COST STANDARD; certification delegated-unresolved | C | verify pass |
| NE | STATUTE-VALUED — appears complete (LB43 2024 rewrite) | C | verify pass |
| NJ | STATUTE-VALUED — appears complete (researched from scratch) | C | verify pass |
| NV | ACTUAL-COST, labor prohibited (SB287 2019) | C | verify pass |
| NY | PENDING — library reads STATUTE-VALUED (ceilings) | library | full gap pass |
| OH | ACTUAL-COST ("at cost", judicially construed) | C | verify pass |
| OK | PENDING — library reads STATUTE-VALUED (ceilings) | library | full gap pass |
| OR | PENDING — library reads ACTUAL-COST + estimate gates | library | full gap pass |
| PA | DELEGATED → OOR Official RTKL Fee Schedule (followed) | C | verify pass |
| SC | DEFERS TO CITY within statutory ceilings | C | verify pass |
| TN | DELEGATED → OORC Schedule of Reasonable Charges (followed) | C | verify pass |
| TX | DELEGATED → AG rules, 1 TAC ch. 70 (followed; 49 new rules) | C | verify pass |
| UT | DEFERS TO CITY (ordinance mandatory) + statutory framework | C | verify pass |
| VA | PENDING — library reads ACTUAL-COST + process values | library | full gap pass |
| WA | PENDING — library reads STATUTE-VALUED (default schedule) | library | full gap pass |
| WI | PENDING — library reads ACTUAL-COST + thresholds | library | full gap pass |

### States that delegate figures to an OUTSIDE instrument (the Texas pattern) — Kevin's ask #2

Binding on **municipalities**:
- **TX** → Attorney General rules, **1 Tex. Admin. Code ch. 70** (§70.3 rates: $0.10/page, oversize $0.50, labor $15/hr, programming $28.50/hr, 20% overhead; §70.7 estimates/deposits; §70.13 body-cam $10+$1/min). Followed and fully extracted; municipal ceilings = 25% above AG rates absent an exemption request. Municipal-court-clerk copies separately defer to city ordinance (§552.266).
- **TN** → **Office of Open Records Counsel "Schedule of Reasonable Charges"** (under T.C.A. §8-4-604, eff. 2017): $0.15 B&W / $0.50 color ceilings, ≥1 free labor hour, aggregation ≥4 requests/month, model-policy blanks the entity fills. Followed and extracted.
- **PA** → **Office of Open Records Official RTKL Fee Schedule** (under 65 P.S. §67.1307(b), current adoption Dec 30 2024): B&W ≤$0.25/copy (≤$0.20 past 1,000), color ≤$0.50, CD ≤$1, no labor ever. Followed. OOR also approves per-agency "enhanced electronic access" fees case-by-case.
- **CO** (one item) → labor-rate cap set by **Legislative Council Staff CPI posting** under §24-72-205(6)(b): $41.37/hr eff. 7/1/2024–6/30/2029. Followed. Criminal-justice-record fees separately delegated to the municipality's governing body (§24-72-306).

**State-agency-only** instruments (recorded for the agency regime; do NOT bind cities — the classic
Google bad-data source): LA → LAC 4:I.301 ($0.25/page, DOA); NV → NAC 239.863-.869 + State Library manual
($25 estimate / deposit rules, executive branch); FL → Fla. Admin. Code 1-2.0031 ("extensive" = >15 min,
Dept. of State) + AG Sunshine Manual (guidance); KS → Exec. Order 18-05 (100 free pages, residents,
executive branch); AL → Governor's EO 734 ($20/hr, executive branch); IN → the IDOA uniform state-agency
copying fee **could not be located** (recorded; agency-only, so no municipal impact); CT → DAS/BEST
guidelines for computer-record fees (components only, no rates).

### States with (near-)NO legislative fee content — Kevin's ask #3

**No state has literally zero.** The closest to "the statute names no numbers at all":
- **AZ** — no copy rate, no labor rule, no deposit/estimate scheme for ordinary records; custodian sets
  fees ("may charge a fee if the facilities are available"). The ONLY figures: $46/video-hour ceiling for
  local law-enforcement video (2023) and the commercial-purpose regime. AG opinions supply scope limits
  (non-commercial fee = copying + postage), not rates. Verified 36/36.
- **AL** — SB270 (2024) rewrote the act around "a reasonable fee set by the public officer"; only figures
  are deposit ≤100% of estimate. Verified 36/36.
- **NC** — actual-cost ceiling only; no rate, no deposit, no estimate, no waiver provisions; certification
  fee delegated to a "law" nobody can locate for municipalities (unresolved).
- **NV** — actual cost only ("ink, toner, paper, media, postage"), labor categorically prohibited since
  SB 287 (2019) *repealed* the extraordinary-use fee. Watch-out recorded: some city schedules still list
  repealed labor fees — charging them is challengeable, and a local-policy upload with labor lines should
  flag against the statutory prohibition, not against a rate table.
- **OH** — "at cost" construed by the Ohio Supreme Court as actual cost excluding labor; only statutory
  figures are the 2025 LE-video caps ($75/hr-of-video, $750/request, 20% overrun notice).

### Per-state notes — the 22 gap-passed states

- **AL — DEFERS TO CITY, verified.** "Reasonable fee set by the public officer" (§36-12-44, SB270 2024);
  deposit may be 100% of estimate. No delegated instrument exists (confirmed §36-12-45(a)(4)). Payment
  method defers to municipal governing body (§11-103-1, convenience-fee ceiling = processor's fee).
  2026 session checked (Act 2026-592 — no fee content).
- **AZ — DEFERS TO CITY, verified.** See above. One unopened source: pre-2000 AG opinion I86-090 (azag.gov
  404s old slugs; content known via later opinions) — cosmetic.
- **CA — ACTUAL-COST, verified (7 rows corrected in place).** Direct cost of duplication; labor never,
  EXCEPT statutory construction/programming cost-shift (§7922.575(b)); pay-before-release statutory;
  record-specific override §81008 ($0.10/page + $5 retrieval, binds city clerks as filing officers). No
  statutory waiver. The 7 CORRECTED verify rows all preserve the resolution ("silent" stands) and fix a
  paraphrase/source-language flag — no value changed.
- **CO — STATUTE-VALUED, verified.** $0.25/page ceiling; labor $41.37/hr after 1 free hour, ONLY if a
  written fee policy was posted before the request (a config-relevant precondition); CPI redelegation
  followed; credit-card acceptance mandatory if accepted elsewhere.
- **CT — STATUTE-VALUED.** 50¢/page municipal ceiling; $10 prepay threshold (100% of estimate);
  certification $1 + 50¢/page; town-clerk records override at $1/page (§7-34a); DAS guidelines for
  computer-stored records (no rates); hand-scanner fee ceiling $20. 2024–2026 sessions checked (only
  exemption edits).
- **FL — STATUTE-VALUED.** 15¢/page (+5¢ duplex), $1 certification ceiling, "extensive" special service
  charge (statute names no threshold; the 15-minute figure is the Dept. of State rule, state agencies —
  cities set their own definition by policy); deposit/prior-debt/waiver structural permissions come from
  case law + AGOs collected in the Sunshine Manual (no figures). Last fee amendment 2021; 2024–26 clean.
- **GA — STATUTE-VALUED.** All figures in §50-18-71: 10¢/page, lowest-paid-employee salary rate, first ¼hr
  free, $25 estimate trigger, $500 prepayment trigger, prior-debt prepayment. No delegated instrument —
  record-specific fee statutes (court clerks, GBI, DOT) don't bind general municipal records.
- **ID — STATUTE-VALUED.** Resident: 100 free pages + 2 free labor hours, then lowest-paid-staff rates
  (attorney redaction at lowest-paid-attorney rate); nonresident regime from 2025 ch. 298 (no free
  allowances); mandatory itemization, no lump sums; mandatory 3-prong resident public-interest waiver.
  No delegation (IDAPA checked — none binds cities).
- **IL — STATUTE-VALUED (ceilings).** 50 free B&W pages then 15¢ ceiling; $1 certification; commercial:
  $10/hr after 8 free hours; voluminous e-data tiers ($20/$40/$100); fee-forfeiture on missed deadline;
  deposit 100% allowed only for commercial/recurrent/voluminous tracks. City adopts its own published
  scale UNDER these ceilings (§6(b)) — defers-within-ceilings recorded. Crash reports $5 / driver
  abstracts $20 via Vehicle Code (record-specific). PAC binding opinion 25-014 (Dec 2025) on body-cam
  media cost captured.
- **IN — STATUTE-VALUED (ceilings).** 10¢/25¢ ceilings (or actual cost if greater, labor excluded), $5
  certification, $150 LE-recording cap, 105% direct-cost formula for electronic; fiscal body MUST adopt
  the local schedule under the ceilings; email delivery free by statute. HEA 1360 (eff. 7/1/2026)
  nonresident supplemental fees ($0.25/page + $25/hr ceilings) captured. IDOA state-agency instrument
  unlocatable (agency-only).
- **KS — ACTUAL-COST + process values.** 2025 HB 2134 rewrote §45-219: actual cost incl. staff time
  (lowest-cost staff, salary only, no benefits), itemized statement on request, 5-hr/$200 contact duty,
  3-business-day deemed-withdrawal, 100% advance payment allowed. No municipal rate anywhere ($.25
  "deemed reasonable" now applies only to NFP entities under §45-240(c) — a trap for stale citations).
- **LA — DEFERS TO CITY (posted schedule mandatory).** See headline 2. Items: labor never chargeable;
  indigent waiver discretionary; deposit threshold defers to city; electronic-copy fees allowed
  ("transmission of electronic copies", 2023). 2025–26 sessions checked: no change; SB 493 withdrawn.
- **NC — ACTUAL-COST.** No rates; "extensive use" special service charge (no statutory trigger);
  certification delegated-unresolved (the one open delegation in the 22); State-CIO fee mediation is
  procedural only. Governor's 2018 guidance ($0.05/page) recorded as cabinet-agency-regime only.
- **NE — STATUTE-VALUED.** LB43 (2024): residents 8 free cumulative labor hours then chargeable;
  nonresidents from hour zero; $50 deposit threshold; 10-business-day estimate response or request lapses;
  $1 certification default (§25-1280). AG Outline safe harbor (≤25¢/page unquestioned) recorded as
  guidance, not law.
- **NJ — STATUTE-VALUED (researched from scratch — no prior corpus).** P.L.2024 c.16: 5¢/7¢ per page;
  special service charge at actual direct cost (GRC 14-point analysis, lowest-capable-employee, no
  fringe); $5 deposit threshold; commercial expedite ≤200%; crime victims free; electronic free. GRC
  rules (N.J.A.C. 5:105) checked — no fee figures. **NJ's NON-fee domains still need full discovery
  (separate task, unchanged).**
- **NV — ACTUAL-COST, labor prohibited.** See above. Estimate/deposit/certification items defer to city
  (fee list must be posted); NAC figures recorded as executive-branch regime with applies_to flags.
- **OH — ACTUAL-COST.** See above. AG model policy has blank rates (guidance); accident reports $4
  (record-specific); BMV rule agency-only.
- **PA — DELEGATED → OOR schedule (followed).** Plus statutory: $100 prepayment threshold, 60-day
  unclaimed-copies disposal, email delivery free, review labor barred. De-minimis defers to agency.
  Act 22 police A/V is a separate non-RTKL regime ("reasonable fees", undefined) — recorded.
- **SC — DEFERS TO CITY within ceilings.** Public body MUST develop and post its fee schedule online;
  ceilings: lowest-paid-capable-employee prorated salary (search/retrieval/redaction chargeable from
  minute one; disclosability review free); deposit ≤25% of anticipated cost (a real statutory cap);
  balance due at production; commercial-rate ceiling on copies; electronic transmission exempt from copy
  charges. AG-office schedule figures are its own agency schedule, not a state instrument.
- **TN — DELEGATED → OORC instruments (followed).** Schedule of Reasonable Charges + Frequent/Multiple
  policy + Safe Harbor + Model Policy: 15¢/50¢ ceilings, ≥1 free labor hour (floor — entity may raise),
  estimate required before any charge, prior-debt bar, aggregation ≥4/month (floor), GIS commercial
  surcharge 10% (20% with approval). Several items (free pages, deposit threshold, de-minimis, min fee,
  waiver) expressly defer to the entity's policy blanks. State agencies have a separate UAPA-rule regime
  (out of municipal scope).
- **TX — DELEGATED → 1 TAC ch. 70 (followed; 49 new rule rows).** Full AG rate table extracted; municipal
  +25% ceilings; §552.275 periodic personnel-time cap (≥36 hr/yr, 15 for small bodies); $40 estimate
  trigger; 20% revision rule; deposit thresholds $100/$50 by body size; 60-day withdrawal; deposit
  restarts the clock (deemed-received rule); body-cam $10 + $1/min.
- **UT — DEFERS TO CITY (ordinance mandatory) + framework.** §63G-2-203(3)(c): political subdivisions
  set fees by ordinance (§63G-2-701 makes the ordinance/policy mandatory); statutory framework: first ¼hr
  free (with the 10-day repeat-requester exception), lowest-paid-capable-employee ceiling, $50 prepay
  threshold + prior-debt prepayment, disclosability review free. All copy-rate/media/certification items
  defer to the ordinance.

### Per-state notes — the 10 PENDING states (July library + third-party leads; currency unchecked)

- **MA — library reads STATUTE-VALUED** (12 valued items): 5¢/page cap, labor ≤$25/hr with 2 free hours
  (municipalities >20k population; ≤20k may charge from hour one), Supervisor-approval gate for higher
  rates, fees barred entirely if the 10-business-day response was missed. Third-party adds nuance to
  confirm in the gap pass: segregation/redaction labor chargeable only if required by law or
  Supervisor-approved; "employee time" includes necessary vendors (§10(f)).
- **MI — library reads STATUTE-VALUED, dense** (18 valued items): 10¢/sheet cap, lowest-paid-capable
  wage + ≤50% fringe, 15-min increments rounded down, "unreasonably high costs" gate on search/redaction
  labor, $50 deposit trigger with **50% deposit cap** (the one true partial-deposit cap in the corpus),
  45/48-day abandonment, 5%/day late-response fee reduction (to 50%), $20 indigency discount with
  affidavit. Gap pass should confirm the 100%-deposit prior-nonpayer conditions.
- **MN — library THIN (3 fee rules) — weakest state in the corpus.** 25¢/page for ≤100 B&W pages (flat
  track, no add-ons), actual cost (incl. search/retrieval labor, NEVER separation) above/other; data
  subjects never pay search. **2025 amendment (subd. 3(g): 5-business-day retrieval suspension) not found
  in the library — recency gap confirmed.** Priority for the gap pass.
- **MO — library reads STATUTE-VALUED** and already carries HB 145 (90-day/150-day fee-nonpayment
  withdrawal + notice). 10¢/page cap, duplication labor ≤ average clerical rate, research at actual cost,
  lowest-cost-employee duty, 100% prepayment allowed. Gap pass to confirm the 8/28/2025 text and the
  six-month resubmission rule.
- **NY — library reads STATUTE-VALUED (ceilings)** incl. the 6-month free-repeat rule (NY-0026). 25¢/page
  ≤9×14; electronic-record prep labor only when ≥2 hours, at lowest-paid-capable salary; search/review
  never chargeable; estimate duty at the 2-hour trigger. Agencies' own FOIL rules (21 NYCRR 1401) govern
  prepayment practice — defers.
- **OK — library reads STATUTE-VALUED (ceilings)** incl. SB 535 (OK-S03): 25¢/page ceiling, $1 certified
  ceiling, search fee only for commercial/disruptive requests and NEVER when release is in the public
  interest, advance payment above $75 or on outstanding fees (eff. 11/1/2025), posted schedule mandatory
  (principal office + county clerk). Gap pass to confirm SB 535 text and the mandatory refund of excess.
- **OR — library reads ACTUAL-COST + estimate gates**: fees "reasonably calculated to reimburse actual
  cost" (search labor chargeable even if nothing found; attorney time only for redaction, not exemption
  analysis); $25 written-estimate-and-confirmation gate; duty suspended from fee notice until paid/waived;
  **mandatory closure at 60 days of nonpayment** (§192.329(3)(b)); discretionary public-interest waiver
  with DA-petition review. 2025 county-clerk carve-out (HB 3385) is irrelevant to cities — note only.
- **VA — library reads ACTUAL-COST + process values**: "actual cost incurred" ceiling, no
  extraneous/overhead fees, pre-search charge notice + estimate-on-request (2022 c. 756), estimate tolls
  the clock, 30-day estimate nonresponse = withdrawn, deposit allowed >$200, prior-debt rule (30+ days
  overdue). **Bad-data trap confirmed for the list:** SB 56 (2026, median-rate labor cap) passed the
  Senate but was NOT enacted — Google surfaces it; library correctly lacks it; the gap pass must
  re-confirm no 2026 special-session revival.
- **WA — library reads STATUTE-VALUED (default schedule)** incl. the deposit ceiling (WA-0031): agencies
  either adopt an actual-cost schedule after notice + public hearing or use statutory defaults (15¢/page
  print, 10¢ scan, 5¢/4 files uploaded, 10¢/GB, $2 flat-fee option); **deposit ≤10% of estimate** —
  the strictest deposit cap in the corpus; installment payment; customized-service charge with mandatory
  estimate; search/review/redaction labor never chargeable (hearing-adopted schedules can add
  copying-act line items — Seattle's $0.41/min upload — a local-policy validation nuance).
- **WI — library reads ACTUAL-COST + thresholds**: "actual, necessary and direct cost" (no rate; DOJ
  guidance ~15¢ typical, >25¢ suspect); location labor all-or-nothing at $50 (below: zero; at/above: full
  actual cost); prepayment >$5; review/redaction never chargeable (2012 WI 65) except LE A/V redaction
  (§19.35(3)(h), 2023 Act 253, in library); contractor-held records at actual cost incl. contractor
  charges. No programming duty at all (§19.35(1)(L)).

---

## What this means for further agent work (Kevin decides)

- **AL, AZ, CA, CO:** done — discovered, verified, deferral rules anchored. Nothing to spawn.
- **18 gap-passed, unverified states:** the research exists; the remaining work is the **verify (refute)
  pass only** — 18 agents, one per state, no new discovery. The slice workflows short-circuit discovery
  automatically.
- **10 pending states:** full gap pass (discover + verify) still owed if Kevin wants uniform verified
  coverage. None of the 10 reads as pure defers-to-city in the library — all have statutory fee content —
  so under Kevin's own stop-rule none can be skipped on deferral grounds. MN first (thin + confirmed
  recency gap), VA and OK carry known 2025/2026 recency checks.
- **No state qualifies for "skip entirely — defers and the library already says so"**: the defers states
  (AL, AZ, LA, UT, SC, KS, NV, NC, OH) all carry statutory exceptions worth having verified, and 7 of
  those 9 are already discovered anyway. The stop-rule's real payoff is in step 3+: for deferred ITEMS the
  template ships "city sets this" instead of a value, and no further research is ever queued for them.
- **Merge step still owed** (after verify): fold CONFIRMED/CORRECTED resolutions + new rule rows into
  `alignment/fee_master_list.json` as the `verified` layer, which also lands the 19 new deferral-anchor
  rules into the library.
