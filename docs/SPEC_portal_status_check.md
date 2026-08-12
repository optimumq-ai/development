# SPEC — Portal Status Check (citizen request-status lookup)

**Status: DRAFT 2026-08-12 — awaiting Kevin's design-direction confirmation (UI rule) and the §6 decisions.**
Source: Kevin's feature note `/home/optimumq/exchange/statuscheckandverification.txt` item (1).
Sibling feature: `SPEC_record_verification.md` (item 2) — separate feature, adjacent button on the portal home.

## 1. What this is, and the gap it closes

A citizen who submitted a request can look up where it stands, from the portal home page, using the request
number the confirmation screen and email already tell them to save. Today that promise has no mechanism behind
it:

- The wizard's confirmation says "**Please save this number** — you'll need it to check on or ask about your
  request" (`PublicPortalWizardPage.js:755-757`), and the confirmation email says the same (`email.js:105`).
- `SPEC_public_portal_intake.md:78` calls the number "the status-check fallback" — presuming a status check
  that was never specced or built.
- `REQUEST_FINANCIAL_PROFILE_DESIGN.md:427` explicitly deferred "a requestor portal status page (the emails
  are the requestor view)". This spec un-defers the lookup (not a full portal account/page — one modal).
- No public status endpoint exists (verified 2026-08-12: nothing in `publicChat.js` or `App.js` routes).

## 2. Entry point — the portal home page

`/portal` (`PublicPortalPage.js`) today has two rows: the Records Library and Create a Request. This feature
adds a **third row shared with feature 2** — two buttons, side by side, in the landing's existing
blurb-plus-button row grammar:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Already submitted a request, or holding a certified record?           │
│                                                                        │
│  [ Check Request Status ]        [ Verify a Certified Record ]         │
└────────────────────────────────────────────────────────────────────────┘
```

Clicking **Check Request Status** opens a modal (no navigation away from the landing):

```
┌─ Check Request Status ────────────────────────────────┐
│  Enter your request number. It is on your             │
│  confirmation email and looks like 2026-000123.       │
│                                                       │
│  Request number   [ 2026-______ ]                     │
│  Email address    [ ____________ ]   (see §6.1)       │
│                                                       │
│                       [ Cancel ]  [ Check Status ]    │
└───────────────────────────────────────────────────────┘
```

⚠️ UI rule: the landing page is **v1** (inline styles — not a design reference). The row and the modal are
built in the v2 idiom (the wizard's scoped-CSS pattern, `PublicPortalWizardPage.js` `STYLES`), not by copying
the landing's inline styles. Design direction on the modal's look needs Kevin's agreement before build.

## 3. The lookup contract

**Input.** The PARENT request number only (Kevin's call, for simplicity). Normalization is forgiving:
whitespace trimmed, case-insensitive, and a child-suffixed number (`2026-000123-2`) is accepted by stripping
the suffix and answering for the parent — a citizen who somehow holds a component number should not be told
"no match" for a request that exists. All parent facts are read THROUGH the parent
(`services/requestScope.js` — `numberExpr`/`parentFact`), never off a child row.

**Single-record request (n = 1)** — returns:
- Requestor name
- Stage, as the staff Request Queue displays it: the `STAGE_LABELS` pill (`lib/stages.js` /
  `services/stages.js`) — Intake Review · Awaiting Payment · Record Search · Exemption Review · AG Review ·
  Redaction Review · Redaction · Delivery · Closed.

**MRR (n > 1)** — returns:
- Requestor name, parent request number, and the parent roll-up the queue shows (`N records`,
  `Complete` / `In Process` from `parentState()`).
- One line per child, exactly as the queue's Request Number column renders children: the `–{child_no}`
  subrequest marker (never the internal full suffixed number), the summarized description
  (`component_label`, else the 60-character description snippet), and that child's stage label.

```
┌─ Request 2026-000123 ─────────────────────────────────┐
│  Requestor: Jordan Alvarez        In Process · 3 records
│                                                       │
│  –1  Police report, June 12 incident      Delivery    │
│  –2  Body camera footage, June 12         Redaction   │
│  –3  911 call recording, June 12          Record Search│
│                                                       │
│  Questions? Contact {agency contact email/phone}.     │
└───────────────────────────────────────────────────────┘
```

**No match** — one uniform answer regardless of WHY (number unknown, or identity check failed — see §6.1),
so the endpoint is not an oracle for which numbers exist:
> "We could not find a request matching what you entered. Check the number against your confirmation email,
> or contact {agency contact} for help."

## 4. API

`POST /api/public/request-status` — unauthenticated, mounted with the other `/api/public` routes
(`publicChat.js`), **rate-limited per IP with the existing `checkRate`** (the same guard as
`/api/public/chat`; sequential numbers make unthrottled lookup a scraping surface).

Request: `{ requestNumber, email }` (email per §6.1).
Response: always `200`.
- `{ found: false, message }` — the uniform no-match answer.
- `{ found: true, requestNumber, requestorName, isMrr, processStatus, stage, stageLabel, children: [ { childNo, label, stage, stageLabel } ] }`
  — `children` present only for MRR; `stage`/`stageLabel` at top level only for n = 1.

Read-only. No rows written anywhere (a citizen read must never create history or tasks). Nothing about
money, files, staff names, teams, deadlines, or internal ids is ever returned.

## 5. Explicitly out of scope (recorded so they are choices, not oversights)

- A requestor account / login / full status page (the 2026-07 deferral stands; this is one lookup modal).
- Closure reasons, fee balances, deadline dates, or document downloads in the response. Stage only. (Any of
  these can be a later additive decision; each is a disclosure decision Kevin has not made.)
- Notifying staff that a lookup happened.

## 6. Open decisions `[OPEN — Kevin]`

### 6.1 The identity gate — what unlocks the answer
Request numbers are **sequential** (`2026-000005`, `nextRequestNumber`), and the prior design position is
explicit: *"Do NOT verify by the raw request number — it is sequential / guessable… Human reference ≠ access
key"* (`DESIGN_split_canvas_intake.md`, certification section). A lookup keyed on the number alone returns
the **requestor's name** to anyone who types consecutive numbers — i.e. a harvestable list of who is asking
the city for what.

| Option | Citizen enters | Anyone-with-a-number sees | Friction |
|---|---|---|---|
| A (as written in the feature note) | number | name + stages | none |
| **B (recommended)** | number + the email on the request | nothing (uniform no-match unless both match) | one extra field the requestor certainly has |
| C | number + a per-request lookup token printed in the confirmation email | nothing | citizen must find the token; confirmation email must change |

Recommendation: **B.** It discloses status only to someone who already knows both facts, costs one field,
and needs no schema or email changes. (TX makes requestor identity largely public on paper, but serving it
as a free bulk-enumeration API is a different act than answering a records request about requestors.)

### 6.2 Stage labels, citizen-facing glosses
Kevin's note: stage "as displayed on request queue page" — honored verbatim in §3. Optional refinement: a
one-line plain-language gloss under the pill (e.g. Record Search → "Staff are locating the records you
asked for"), per the terminology register (plain names, consequences stated simply). Default if undecided:
labels only, no glosses.

## 7. Tests

`backend/tests/verify_status_check.js` (via `npm test` only, `testEnv.enforce()`):
- n=1 lookup returns name + stage label; MRR lookup returns children with `–n` markers, labels, per-child
  stages, and the parent roll-up; child-suffixed input resolves to the parent.
- Identity gate (per §6.1 decision): wrong email → the SAME uniform no-match body as an unknown number
  (assert byte-equal messages — the no-oracle property).
- Rate limit fires; response never contains money/deadline/staff/internal-id fields (schema allowlist
  assertion).
