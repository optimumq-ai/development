# Desktop research — per-state process flows (Kevin, July 2026)

Kevin's parallel research pass, produced with Claude (Fable) on Claude Code desktop — a separate
environment not connected to this repo. Delivered 2026-07-26 as `desktop research states.zip` via the
exchange folder; vendored here as a citable input.

## Contents — 29 states × 3 formats

- `documents/` — `<state>_process_flow.md` — **the substance**. One uniform template per state:
  Scope → Governing clock → Phases 1–6 (Intake · Vague-request · Search · Review/Redaction/Denial ·
  Fees · Fulfillment) → Deadline & clock summary → Remedies → Key authorities table → Portal design
  notes → Uncertainties. Statute vs `[Practice]` flagged inline; citations throughout.
- `flowcharts/` — `<state>_flowchart.html` — visual rendering of the same content.
- `workbooks/` — `<state>_records_process.xlsx` — spreadsheet re-packaging of the same content
  (sheets: Process Flow · Deadlines & Clock · Fees & Payment · Denials & Remedies · Key Authorities ·
  Portal Notes).

**Coverage vs our 32-state discovery set:** 28 overlap · adds **Kentucky** (not in our set) ·
lacks AL, AZ, FL, NE (in our set). Scope = email-based *copy* requests, inspection excluded
(matches our prune), but **includes remedies/external appeals which we deliberately cut** — treat
those sections as reference only (compliant-automation scope).

## Why it matters: 2025 legislative currency

These docs track 2024–2025 session laws that our wave discovery (from code mirrors) partly missed.
Probed 2026-07-26 against `pruned/pruned_discovery.json`:

| State | 2025 change captured here | In our working set? |
|---|---|---|
| TX | **HB 4219 (eff. 9/1/25)**: §552.221(f) 10-bd no-records notice, (g) previous-determination notice, §552.301(b) specific-exceptions requirement, §552.328 requestor complaint + sanctions; also §552.2325 catastrophe tolling (2019) | **Missing** → supplements |
| OK | SB 535 (eff. 5/29/25): AG Public Access Counselor, §24A.40, 10-bd pre-suit review | **Missing** → supplements |
| UT | SB 277 / SB 64 / HB 69 (2025) | **Missing** → supplements |
| KS | HB 2134 (eff. 7/1/25): actual-cost-only fees | Concept present, amendment uncited |
| OH | HB 265/315, SB 29/109 (eff. 4/9/25) | Already present ✓ |
| CA | AB 370 cyberattack unusual-circumstance | Already present ✓ |

Post-HB 4219 the TX 10-business-day checkpoint has **five exits** (produce · certify later date ·
no-records notice · previous-determination notice · AG-ruling request stating specific exceptions) and
no request may silently close — this reshapes the Denial-page AG-referral branch in
`../workflow/`.

## Status & caveats

- **Reference input, not authoritative source.** Summary-level narrative, different grain than our
  atomic rule set (`../pruned/pruned_discovery.json`). Anything folded into the working set goes
  through `../supplements/` with primary-source verification first.
- Each doc carries its own **Uncertainties** section — read it before relying on a claim. Notably:
  the TX HB 4219 detail rests on convergent secondary sources (official bill analysis, OAG 2025
  legislative update, TML guide) because the codified text was unfetchable at research time.
- Related reference inputs: `../chatgpt_pilot/` (Kevin's earlier ChatGPT pass, 33 docs).
