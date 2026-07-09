# Clarification / Vague-Description Policy Survey + Config Substrate (16 jurisdictions)

Purpose: define the configuration substrate for how OptimumQ handles a **vague, ambiguous, or
insufficiently-described** public-records request — the "Contact requestor for clarification" flow and its
effect on the statutory response clock. Answers `SPEC_record_search_task_screen.md` §5b's tolling-research
checklist with real citations, and establishes the per-jurisdiction variable set the auto-config engine will
target. Companion to `CITY_FEE_SURVEY.md` (fees) and `JURISDICTION_RULES.md` (multi-state axes).

Researched 2026-07-09. Two independent AI research passes were commissioned over overlapping jurisdiction
sets so their conclusions could be cross-checked (see §6 for the discrepancies that surfaced). Raw source
PDFs: `imports/research/vague_description_rules.pdf` (11 cities, city-organized) and
`imports/research/claude_vague_description_rules.pdf` (11 states, state-organized + schema-oriented).

## PROVENANCE / CAVEAT (read before relying on any row)
This is a STRUCTURAL survey built from statutory frameworks, AG guidance, and (where noted) agency practice.
Its reliable output is the **shape of the variable set** (§2) — the dimensions that vary across jurisdictions
and therefore must be configurable, not hardcoded. The specific per-jurisdiction VALUES in §3–§4 are
framework-typical starting points and **MUST be verified against each jurisdiction's current statute,
ordinance, and AG guidance by counsel licensed there before a customer relies on them.** Two points in
particular "shift under litigation": New Jersey's post-2024 practice and Washington's model-rule status. This
is consistent with the AUTO_CONFIG trust model (AI drafts → city reviews → city attests → live) and the
project's "legal research first" rule.

**Framing finding (both research passes agree):** *No jurisdiction on this list affirmatively REQUIRES an
agency to contact the requestor to clarify a vague request.* The laws split into: "may seek clarification,
with defined consequences" (WA, NJ, RI), "must offer narrowing before a BURDEN-based denial" (IL — a burden
rule, not a vagueness rule), "insufficient description is itself a denial ground" (MI, PA, KS), and silence
(AZ, OK, KS, MS, FL, NC and most cities). Because so many statutes are silent or use undefined terms
("reasonable period of time", "promptly"), the correct product posture is a **per-jurisdiction, agency-
configurable clarification policy that defaults to OFF/safe-manual** until the city populates and attests it.

---

## 1. How this rides existing architecture (no new invention)

The mechanism Kevin described — "upload a local policy document, have AI read it and populate the model, then
require review and edit; or turn the model off; or configure manually from established practice" — is already
the ratified architecture. This survey supplies the one missing piece: the **config substrate** (§2) that the
existing pipeline can populate.

| Capability | Already built as | This survey adds |
| --- | --- | --- |
| Upload policy doc → AI extracts config | `CONFIG_FRESHNESS` Slice B (source fetch: URL/upload/paste → source doc + per-domain extractors) | a **clarification-domain extractor target** |
| Human review + edit before apply | `CONFIG_FRESHNESS` Slice C (review → editable proposed config → disclaimer → agree → apply) + `AUTO_CONFIG` per-field provenance/confidence | the fields to review |
| "Turn the model off" | `AUTO_CONFIG` §2.3 hard attestation gate: un-attested area = SAFE/MANUAL, no auto action | the default posture for this area |
| "Configure manually from established practice" | area editor + provenance tag `established_practice` | the manual field set |
| The clock pause/resume itself | `DEADLINE_TOLLING` engine (`request_clocks`, `clock_tolls`, reason `clarification_pending` already declared, currently un-triggered) | the policy that decides WHETHER/HOW to toll |

Per `AUTO_CONFIG` §1 ("expressiveness precedes automation"): build the substrate that can HOLD the rule first
(§2), then point the extractor at it. This doc is that substrate spec.

---

## 2. The config substrate — clarification-policy variable set (THE CONTRACT)

One `clarification_policy` record per jurisdiction. Every field carries the standard auto-config metadata:
`value`, `source` (`statute | ordinance | ag_guidance | established_practice | default_off`), `citation`
(section + locator), `confidence` (0..1). All fields default to **unspecified/off** — a safe posture that
takes no automated action until the city populates and attests the area.

| # | Field | Type | Meaning | Default |
| --- | --- | --- | --- | --- |
| 1 | `clarification_clock_effect` | enum (6) | What the statutory response clock does when a clarification is sent | `no_fixed_clock` or off |
| 2 | `clarification_duty` | enum: `none` · `required_before_denial` · `required_before_burden_denial` | Must the agency offer clarification before acting? | `none` |
| 3 | `vague_is_denial_ground` | bool | Can "insufficiently specific" itself justify a denial? | `false` |
| 4 | `clarification_grace_days` | int \| null | **The grace period** — days the requestor has to respond to a clarification before the request may be abandoned/closed. `null` = statute silent → agency-configurable | `null` |
| 5 | `abandonment_grace_days` | int \| null | Optional **internal safety buffer** after the requestor window lapses before the system auto-closes, so staff can intervene. Not a legal value — a product-safety margin | `null` |
| 6 | `abandonment_closure` | enum: `allowed` · `via_denial` · `not_allowed` · `unspecified` | Whether / how a non-responding request may be closed | `unspecified` |
| 7 | `closure_notice_required` | bool | Must a written denial/closure notice be sent when a vague request is closed | `false` |

### 2.1 `clarification_clock_effect` — the six models
This is the crux variable; it decides how the tolling engine behaves. Every surveyed jurisdiction maps to
exactly one:

- **`no_fixed_clock`** — no statutory day-count; only a "promptly / reasonable time" standard. Track elapsed
  time for reasonableness; nothing to toll. *(NC, AZ, OK, FL, Charlotte, Tulsa, Miami, Phoenix)*
- **`runs_no_stop`** — a fixed statutory clock keeps running; the agency must respond or deny within it;
  sending a clarification does **not** pause it. *(GA, PA, CA, IL, KS, MS, San Francisco, Pittsburgh, Atlanta)*
- **`toll_pause_resume`** — clock pauses when clarification is sent and resumes where it left off on reply.
  *(WA — effective/practice; NJ — GRC practice; RI — statutory, § 38-2-7(b))*
- **`toll_and_restart`** — clock pauses, then **restarts fresh as a new request** upon receipt of the
  clarification. *(AL — statutory, § 36-12-44(g); the cleanest example on the list)*
- **`start_gate`** — the clock never STARTS until the request is specific enough to identify the records.
  *(MI/Dearborn — see §6 for the cross-doc nuance)*
- **`operational_hold`** — a statutory response clock exists but tolling is legally unsettled; agency holds
  work operationally while tracking agency-elapsed time and requestor-wait time separately. *(AR/Fayetteville)*

### 2.2 The two grace windows are distinct (do not conflate)
The research exposed two separately-configurable timing windows:
- **`clarification_grace_days`** = the *requestor-side* window ("respond within X days or we may close").
  Statutory almost nowhere; WA model-rule = **30 days**; FL agency practice (FDLE) = **30 days**. This is the
  "grace period" concept.
- The *agency-side* statutory response deadline + its extension (WA 5 biz-day options, MS 7→14, SF 10+14, MI
  5→10, Boise 3→10) is NOT a clarification variable — it lives in the `DEADLINE_TOLLING` engine's clock
  `duration`/`extension_days`. Listed here only so the two are never merged.

### 2.3 Mapping to the tolling engine
`clarification_clock_effect` selects the engine behavior when the record-search screen's "Contact requestor"
button fires (this is the natural first caller of the declared-but-unused `clarification_pending` toll):

| clock_effect | Engine action on "Contact requestor" | On reply | On no-reply after grace |
| --- | --- | --- | --- |
| `no_fixed_clock` | none (no clock) | resume work | `abandonment_closure` per policy |
| `runs_no_stop` | none — clock keeps running | resume work | may deny within window |
| `toll_pause_resume` | `toll(clock, 'clarification_pending')` | `resume(clock)` | close per policy |
| `toll_and_restart` | `toll(...)` | on reply, restart clock fresh (new start_at) | close per policy |
| `start_gate` | do not `startClocksForRequest` yet | start clock on valid reply | close per policy |
| `operational_hold` | mark request pending; do NOT toll legal clock; log wait | resume | close per policy |

---

## 3. Per-jurisdiction notes

Organized by state (controlling law) with the surveyed city under it, since the state statute/AG guidance
almost always controls and the city fills operational detail.

### Alabama — Birmingham *(clock_effect: `toll_and_restart`)*
Ala. Code §§ 36-12-43, 36-12-44; City of Birmingham Public Records Procedures. The cleanest example: statute
requires a request to identify records with reasonable specificity and says a public officer is **not
obligated to respond** to a request that is vague, ambiguous, overly broad, or unreasonable in scope. Under
§ 36-12-44(g), if the officer seeks clarification, **all statutory timelines are tolled and RESTART upon
receipt of the clarification as though the requester submitted a new request.** No mandatory abandonment
period; the request simply remains unprocessable until made proper. Workflow: Pending Clarification → pause
clock → restart on clarification → allow administrative closure after configurable days.
- `clarification_duty`=none · `vague_is_denial_ground`=true · `clarification_grace_days`=null (configurable) ·
  `abandonment_closure`=allowed (configurable) · `closure_notice_required`=(practice).

### Arkansas — Fayetteville *(clock_effect: `operational_hold`)*
Arkansas FOIA requires a request "sufficiently specific to enable the custodian to locate the records with
reasonable effort," and written responses within the statutory period. No Fayetteville-specific or state rule
found that the clock expressly pauses on clarification. Model as: operational hold; statutory tolling not
established; require a written clarification notice; optional denial/closure if no response.
- `clarification_clock_effect`=operational_hold · `clarification_grace_days`=null · `abandonment_closure`=unspecified.

### Oklahoma — Tulsa *(clock_effect: `no_fixed_clock`)*
51 O.S. § 24A.5 requires "prompt, reasonable access" (both terms undefined; case law/AG gloss "prompt" as
excluding only unreasonable delay — no day-count clock). Tulsa's EO is unusually detailed: requests must
describe records with reasonable specificity — a general time frame, identifiable records (not general
information), and search terms that don't generate an unreasonably large result set. City Clerk/custodian may
ask the requester to clarify an unreasonably vague, open-ended, or insufficient request; **if it remains
insufficient after clarification, the request may be denied.** For email/text searches, if the request lacks a
date range of six months or less and an originator/recipient/subject, the City will ask for clarification.
- `vague_is_denial_ground`=true (by city policy) · `clarification_duty`=none · statute otherwise silent.

### North Carolina — Charlotte *(clock_effect: `no_fixed_clock`)*
G.S. Ch. 132 — the sparsest on the list. Records furnished "as promptly as possible"; that phrase is the
entire timing standard (no day counts). NC AG guide: no specific waiting period. No NC or Charlotte clock-pause
rule for vague requests; clarification is operational, not a formal toll. Written-reasons denial is convention/
case-law driven, not statutory. Model: track agency-elapsed and requester-wait time separately.

### Georgia — Atlanta *(clock_effect: `runs_no_stop`)*
Georgia Open Records Act: respond within **3 business days**. If records exist but aren't immediately
available, the response must describe them and give timing/cost estimates. AG guidance recommends written
requests as better practice for documenting scope/timing. No Georgia rule found that a vague-request
clarification stops or restarts the 3-business-day obligation. Model: clarification does **not** auto-stop the
initial response deadline; respond within 3 business days, then place in Pending Clarification.

### Pennsylvania — Pittsburgh *(clock_effect: `runs_no_stop`)*
PA Right-to-Know Law: a written request should identify/describe the records with sufficient specificity to
let the agency ascertain what's requested. The Office of Open Records treats specificity as a major issue and
provides a court-derived balancing-test worksheet. Normal response deadline **5 business days**; if
insufficiently specific, the agency may deny on that basis. No automatic tolling found; denial carries appeal
risk. Model: if vague, issue denial or clarification within 5 business days; `vague_is_denial_ground`=true.

### Michigan — Dearborn *(clock_effect: `start_gate` per city research; see §6)*
Michigan FOIA (MCL 15.233/15.235) requires a written request that describes the record sufficiently to let
the public body find it. Michigan agencies literally provide a checkbox for "request does not describe the
record sufficiently to determine what record is sought." Two readings surfaced (see §6): the city pass reads
it as a **start-gate** (valid-request clock starts only when the request sufficiently describes records); the
state pass reads it as a fixed 5-business-day clock (one 10-day extension) on which an insufficient request may
be **denied** (`vague_is_denial_ground`=true, `abandonment_closure`=via_denial). Both agree: written denial
notice with explanation + appeal rights; requester may rewrite (re-files) or sue on sufficiency.
Dearborn page: detailed list of records required; responses in 5–15 business days with an extension letter if
not ready in five.

### Idaho — Boise *(clock_effect: `runs_no_stop`, tending `start_gate`)*
Idaho Public Records Act: short deadlines — residents generally get approval/denial within **3 working days**,
extendable to 10; nonresident deadlines longer. No express vague-request tolling rule. Requests must
specifically describe the subject matter and records and include a specific date range. Model: require
specificity/date-range fields; permit denial or "incomplete" status if not specific enough.

### Florida — Miami *(clock_effect: `no_fixed_clock`)*
Florida Ch. 119 — the loosest framework: **no express response deadline at all**; per case law the only
permitted delay is the reasonable time to retrieve records and delete exempt portions ("reasonable time"
language is pervasive). Agencies **cannot deny merely because a request is too broad or doesn't specifically
identify records**; if it's unclear what's sought, the office must contact the requester and should assist by
explaining how it keeps records. Miami's request page asks for date ranges, keywords, and departments because
broad searches may return thousands of documents. No fixed clock pause; document a good-faith clarification
attempt. FDLE agency practice closes on 30-day non-response — administrative practice, not law — which is
exactly why a **per-jurisdiction agency-configurable clarification window** is the right model here.
- `clarification_grace_days`=30 (agency practice, low confidence) · `abandonment_closure`=allowed (practice).

### Arizona — Phoenix *(clock_effect: `no_fixed_clock`)*
A.R.S. § 39-121 et seq.: public records open for inspection during office hours; records furnished
"promptly" (undefined; no day-count clock). No fixed response clock like many states; guidance emphasizes
prompt access and the duty to maintain records reasonably necessary for official activity. No Phoenix rule
that clarification pauses/restarts a clock. Model as a promptness/reasonableness jurisdiction: operational
hold, no statutory toll/restart, track total elapsed time for reasonableness. Failure to respond promptly is
treated as a denial (appeal rights attach).

### California — San Francisco *(clock_effect: `runs_no_stop`)*
CPRA requires records made promptly available when a request reasonably describes identifiable records; case
law tempers this because requesters may not know exact file names/structures (agency must assist). Agencies
generally have **10 days** to determine whether they hold disclosable responsive records, with a possible
**14-day extension** for unusual circumstances. SF Sunshine Ordinance overlay: 10 calendar days to respond,
extendable 14 in certain circumstances; departments **cannot refuse to respond**, and failure can lead to
discipline/legal action. Clarification is allowed/encouraged but does **not** clearly stop the clock; still
require the 10-day response or a valid extension.

### Washington — (statewide; not city-specific) *(clock_effect: `toll_pause_resume`)*
RCW 42.56.520 — the most complete statutory scheme surveyed. Contact requirement: none (the agency *may* ask
to clarify as one of its five-business-day response options). Additional response time may be based on the need
to clarify intent — so **clarification effectively extends the clock** — and per *Hikel*, the clarification
letter must still include a time estimate. Requester-response clock: not in statute, but the AG model rule
(WAC 44-14-04003) says if the requester doesn't respond within **30 days** (or another specified time), the
agency may consider the request **abandoned** and *should* send a closing letter (advisory, not mandatory).
Non-response closure: yes — if the requester fails to respond and the entire request is unclear, the agency
need not respond; otherwise it must respond to the clear portions.
- `clarification_grace_days`=30 (model rule) · `abandonment_closure`=allowed · `closure_notice_required`=false ("should").

### New Jersey — (statewide) *(clock_effect: `toll_pause_resume` — practice)*
OPRA, as amended by P.L. 2024, c.16. Contact requirement: none; per the GRC a custodian **may** (not must)
seek clarification of a broad/unclear request, in writing within **7 business days** of receipt. Closure
without asking: yes — a custodian need not research files to figure out what might be responsive; the 2024
amendments let custodians deny requests requiring more than reasonable efforts to clarify, and communications
requests missing the statutory specificity elements (job title/account, subject matter, a reasonable time
period) are invalid. Denial requires a written response with legal citation. Clock: seeking clarification
counts as a valid response within the 7-business-day window; GRC practice treats the clock as **suspended**
pending reply, but the statute states no explicit toll. (NJ post-2024 practice is exactly the kind of thing
that shifts under litigation — verify.)

### Rhode Island — (statewide) *(clock_effect: `toll_pause_resume` — statutory)*
APRA. Contact requirement: none specified. Closure without asking: denial available; any denial must be in
writing with reasons and appeal procedures. Clock: **yes, explicitly** — response time is tolled pending
receipt of payment and/or further clarification per R.I. Gen. Laws § 38-2-7(b); the 10-business-day period
(extendable 20 for "good cause") may be tolled pending a prepayment or clarification request. In practice a
tolled request just sits (no abandonment/notification specified).

### Illinois — (statewide) *(clock_effect: `runs_no_stop`; `clarification_duty`: `required_before_burden_denial`)*
FOIA, 5 ILCS 140 — the mandatory-**conference** outlier, but scoped to **burdensome categorical** requests,
not vagueness per se. Before invoking the unduly-burdensome exemption on a categorical request, the public body
**shall** extend the requester an opportunity to **confer** to reduce the request to manageable proportions; if
it then denies, it must specify in writing why compliance would be burdensome (treated as a denial). For pure
vagueness the statute is silent — § 3.3 says the Act doesn't compel bodies to interpret/advise requesters on
meaning. Clock: no toll for the conference; ordinary clock **5 business days + one 5-day extension**; parties
may agree in writing to extend. Critically, a body that **fails to respond on time may not treat the request
as unduly burdensome at all** — so waiting silently for clarification forfeits the exemption. (This is the
bridge to the overly-burdensome topic — the conference machinery is shared.)

### Kansas — (statewide) *(clock_effect: `runs_no_stop`)*
KORA, K.S.A. 45-218/45-220. Contact requirement: none specified; the statute lets agencies require the
requester to furnish the information needed to ascertain the records desired (a clarification hook, no duty).
Closure: denial available (insufficient identification, or unreasonable-burden grounds); written statement of
grounds required on request. Clock: each request acted on **as soon as possible, but not later than the end of
the third business day**; if access isn't granted immediately, the custodian must give a detailed explanation
of the cause for delay and the earliest time the record will be available — a clarification letter within 3
days satisfies "acting on" the request, but there's **no statutory toll**.

### Mississippi — (statewide) *(clock_effect: `runs_no_stop`)*
§ 25-61-5. Contact requirement: nothing specified. Clock: **7 working days** (agencies may adopt shorter by
policy), extendable to **14 working days** with a written explanation of why more time is needed; denial must
be in writing with reasons and kept on file. No clarification mechanism, tolling provision, requester-response
window, or abandonment/closure provision specified — silent on each.

---

## 4. Summary matrices

### 4.1 Clock effect + grace, by jurisdiction
| Jurisdiction | Governing law | clock_effect | vague=denial? | grace_days (requester) | abandonment_closure | notice req'd |
| --- | --- | --- | --- | --- | --- | --- |
| Birmingham, AL | Ala. Code § 36-12-43/44 | toll_and_restart | yes | configurable | allowed | practice |
| Fayetteville, AR | Arkansas FOIA | operational_hold | — | null | unspecified | — |
| Tulsa, OK | 51 O.S. § 24A.5 + City EO | no_fixed_clock | yes (policy) | null | may deny | — |
| Charlotte, NC | G.S. Ch. 132 | no_fixed_clock | — | null | unspecified | convention |
| Atlanta, GA | GA Open Records Act | runs_no_stop | — | null | unspecified | — |
| Pittsburgh, PA | PA RTKL | runs_no_stop | yes | null | via_denial | yes |
| Dearborn, MI | MI FOIA 15.233/.235 | start_gate¹ | yes¹ | n/a | via_denial | yes |
| Boise, ID | Idaho PRA | runs_no_stop | yes | null | unspecified | — |
| Miami, FL | FL Ch. 119 | no_fixed_clock | no | 30 (practice) | allowed (practice) | — |
| Phoenix, AZ | A.R.S. § 39-121 | no_fixed_clock | — | null | unspecified | — |
| San Francisco, CA | CPRA + Sunshine Ord. | runs_no_stop | — | null | unspecified | — |
| Washington | RCW 42.56.520 | toll_pause_resume | — | 30 (model rule) | allowed | false ("should") |
| New Jersey | OPRA (2024 c.16) | toll_pause_resume² | yes (invalid req) | null | via_denial | yes |
| Rhode Island | APRA § 38-2-7(b) | toll_pause_resume | — | null | unspecified | yes |
| Illinois | FOIA 5 ILCS 140 | runs_no_stop | — (burden only) | null | via_denial | yes |
| Kansas | KORA 45-218/220 | runs_no_stop | yes | null | via_denial | on request |
| Mississippi | § 25-61-5 | runs_no_stop | — | null | unspecified | yes |

¹ Michigan reading is contested across the two research passes — see §6. ² NJ tolling is GRC practice, not
explicit statute.

### 4.2 Distribution of the crux variable (why it must be configurable)
- `no_fixed_clock`: NC, AZ, OK, FL (+ Charlotte, Phoenix, Tulsa, Miami) — ~4 states
- `runs_no_stop`: GA, PA, CA, IL, KS, MS, ID — ~7 states
- `toll_pause_resume`: WA, NJ, RI — 3 states
- `toll_and_restart`: AL — 1 state
- `start_gate`: MI — 1 state (contested)
- `operational_hold`: AR — 1 state

No single default serves a majority; the modal value (`runs_no_stop`) covers under half. This is the
quantitative case for a per-jurisdiction field rather than a hardcoded behavior.

---

## 5. Cross-document discrepancies + open decisions

### 5.1 Discrepancies between the two research passes (flagged, not resolved)
- **Michigan clock model.** City pass → `start_gate` (clock starts only on a sufficient request). State pass →
  fixed 5-business-day clock on which an insufficient request is **denied** (`runs_no_stop` +
  `vague_is_denial_ground`). Both agree on written denial + rewrite/appeal. **Decision needed** before MI ships;
  likely `start_gate` is the more accurate statutory reading but verify against MCL 15.235.
- **Oklahoma (Tulsa) vs bare OK statute.** State statute is silent/promptness (`no_fixed_clock`); Tulsa's EO
  adds specificity requirements and a deny-if-still-vague rule. City ordinance layers ON TOP of the silent
  state law — a good test case for the profile precedence stack (city overrides state where stricter/defined).

### Open decisions for Kevin
1. **`clarification_grace_days` — single value or per-classification?** Statutes give one number where they
   give any (WA/FL = 30). Recommend a single value now; revisit if a jurisdiction differentiates by request type.
2. **`abandonment_grace_days` scope.** Confirm this internal safety buffer is wanted as a first-class field vs.
   a global tickler setting. Recommend per-jurisdiction field (some cities will want 0, others a cushion).
3. **`operational_hold` vs `runs_no_stop`.** Are these distinct enough to keep separate, or collapse AR into
   `runs_no_stop`? Kept separate here because AR's tolling is legally *unsettled* (not affirmatively "keeps
   running"), which matters for the legal-defensibility disclaimer.
4. **Precedence stack.** Tulsa/Dearborn show city ordinance refining silent/looser state law. The profile needs
   a documented state→city override rule (defer to `JURISDICTION_PROFILE_DESIGN` precedence work).
5. **Notice content.** `closure_notice_required`=true jurisdictions (MI/NJ/RI/MS/IL/PA) need a written
   denial/closure letter — ties into the address-capture gap flagged in `SPEC_record_search_task_screen.md`
   §5b (no mailing address is captured at intake).

---

## 7. What this feeds
- `SPEC_record_search_task_screen.md` §5b — the "Contact requestor" button becomes the first caller of the
  `clarification_pending` toll; behavior selected by `clarification_clock_effect`.
- `DEADLINE_TOLLING_DESIGN.md` — `clarification_pending` toll reason gets a real trigger + the restart/start-gate
  variants (currently only pause/resume is modeled).
- `AUTO_CONFIG_DESIGN.md` / `CONFIG_FRESHNESS_DESIGN.md` — a new `clarification` (or `deadlines`-sub) domain
  extractor targets the §2 substrate; rides the existing upload → extract → review → attest pipeline.
- `JURISDICTION_PROFILE_DESIGN.md` — a `clarification_policy` config store surfaces as a profile section with
  its own version/provenance/attestation.

## 8. Build order implied (per AUTO_CONFIG §1: expressiveness before automation)
1. **Substrate** — `clarification_policy` config store + area editor (manual + off), the §2 fields with
   provenance. Un-attested → safe/manual. *(no AI yet)*
2. **Trigger** — wire the record-search "Contact requestor" action to the tolling engine via
   `clarification_clock_effect`; implement the six behaviors incl. restart + start-gate.
3. **Extractor** — point a config-freshness extractor at an uploaded local policy doc → drafts the §2 fields
   with citations/confidence → existing review/attest UI.
