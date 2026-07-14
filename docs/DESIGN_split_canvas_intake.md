# DESIGN — Split-Canvas Portal Intake (recovered)

**Status:** `[DESIGN — not built]` · design direction from the requestor (Kevin), recovered 2026-07-10.
**Origin:** Reconstructed from `info_lost_recaptured.pdf` after two session drops lost the live brainstorm.
This is the authoritative capture so it is never lost again. Supersedes nothing yet; when built it revises
`SPEC_public_portal_intake.md` §2 (chat-only intake) and §4/§5 (form fallback / fee-choice).

## Global surface standard `[AGREED 2026-07-10 — via mockup]`
A three-layer value system, validated interactively in the clickable mockup. Candidate app-wide standard
(not just this screen). Grounded in a human-factors read: a light-grey box on white reads as *disabled* to
users conditioned by early software, so **white must mean "active/editable,"** and grounds must be tinted.

| Layer | Role | Light | Dark |
|---|---|---|---|
| Page (around panels) | outermost frame | `#D8E0E8` | `#0A1017` |
| Panel ground (form background + chat message area) | the surface a panel sits on | `#EBF3FB` | `#131E29` |
| Active surface (text inputs, message bubbles) | anything editable/interactive | `#FFFFFF` | `#1E3040` |

Rules: active = white (raised with a 1px border + whisper of shadow); panel grounds one step tinted; page one
step darker again for contrast. Chat ground applies **only while the conversation is active**. Bubbles are
white for BOTH speakers — side (left agent / right requestor) carries identity, not colour.

**Temperature-match rule (why the greys "match"):** perceived warm/cool ≈ **B − R** (blue channel minus red).
Two greys coordinate when their B−R is equal; a larger B−R is cooler. To lighten a grey **without** warming it,
add the same amount to all three channels — do NOT pull toward white (that shrinks B−R and secretly warms it).
Page and panel grounds above are both tuned to **B − R = 16**.

## Why this exists (problems it solves)
1. **Postal mail is non-functional** — intake never captures a mailing/home address. Verified 2026-07-10:
   `[[CONTACT_FORM]]` collects Name/Email/Phone only (`publicChat.js:28`); the request INSERT has **no address
   column** (`publicChat.js:297-298`). `delivery_method='mail'` therefore has nowhere to mail to. This is the
   same gap tracked in `SPEC_public_portal_intake` §5b and HANDOFF (intake mailing-address capture).
2. **Chat is a clumsy way to collect structured facts** — name/email/phone/address/delivery collected
   conversationally means many back-and-forth volleys and confusing inline text boxes.
3. **Fix:** collect the *structured facts* in a dedicated panel (form), reserve the *conversation* for the one
   thing chat is good at — building a good record description — and give search results their own canvas.

## Layout — chat moves RIGHT, left is a two-phase canvas
Chat window docked far right. The open space from the left edge to the chat box is a large left panel that
**morphs through two phases**:

```
PHASE 0 (intake form)                 PHASE 1/2 (results canvas)
┌───────────────────────┬───────┐    ┌───────────────┬───────┬───────┐
│  REQUESTOR INFO (form)│ CHAT  │    │ thin instr. bar        │ CHAT │
│  live box:            │(idle/ │    ├───────────────┬───────┤(active)
│   Name  [_________]   │ locked│    │ SEARCH RESULTS│SELECTED│      │
│   Email [_________]   │ until │    │  (large area) │ ~25%  │      │
│   [Send Email Verif.] │ form  │    │  ▣ result     │ col.  │      │
│   [Verification Rec'd]│ done) │    │  ▣ result     │ small │      │
│   [✓ Visually checked │       │    │  ▣ result     │ fonts │      │
│      for accuracy]    │       │    │               │       │      │
│  ── (below dimmed ────│       │    │               │[multi-│      │
│      until a verify   │       │    │               │ select│      │
│      button pressed) ─│       │    │               │ + btn]│      │
│   Phone [_________]   │       │    │               │       │      │
│   Delivery / address  │       │    │ [ Proceed ]   │       │      │
│   [ Proceed to AI     │       │    └───────────────┴───────┴──────┘
│     Search ]          │       │
└───────────────────────┴───────┘
```

## Phase 0 — Left panel = structured intake form (chat idle)
- A single **"live" box**. Top region: **Name** and **Email** fields, then the email-accuracy gate buttons:
  - **Send Email Verification** → sends the real verification email (reuse existing `[[VERIFY_EMAIL]]` /
    Resend path).
  - **Verification Email Received** → citizen confirms they got + clicked it.
  - **Click to indicate the email address has been visually checked for accuracy** → the manual-review
    acknowledgement alternative to verifying.
- **Gate:** everything **below** the top region is **dimmed / inaccessible** until **either**
  "Verification Email Received" **or** "Visually Reviewed for Accuracy" is pressed. Forces an accurate email
  before the rest of the form is usable.
- Below the gate: **Phone**, **delivery preference**, and — the whole point — **mailing/home address**
  (new; needed for postal + the §5b clarification-by-mail path).
- Bottom: **"Proceed to AI Search"** button. Clicking it **triggers the chat agent to turn on.**
- **Fee-choice** (§5) also lives in this panel — see "Fee-choice placement" below `[RESOLVED 2026-07-10]`.

## Trigger → Phase 1 — Chat builds the description (one record at a time)
On Proceed, chat activates. Tentative opening script (verbatim from design):
> "Thank you for using the {city name} AI Powered Open Record Search. I will work with you to create
> description content that assures optimal search results. It is important to note that if you are requesting
> more than one type of record, it is important that the search description for each is entered individually.
> Please enter a description of a requested record."

- Agent asks clarifying / follow-up questions until the citizen has no more to add **or** stops.
- When the description reads complete and well-worded, agent confirms:
  > "Your request is as follows: (final content), do you agree?"
- **Yes → the search for that description runs** (this is the handoff into the results canvas).

## Phase 2 — Left panel morphs to the results canvas
- On Proceed from the form, the form **dissolves** and a **large results box slides in** filling the area.
- **Top:** persistent instruction banner spanning the full width of the search box (agreed copy 2026-07-10):
  > "Review the search results, and check the box to select a record. All records with the selection box checked
  > appear in the right column. When you have completed selection, click **Proceed** and continue your
  > conversation with the AI Open Record Assistant."
- **Right sub-column (~25% width):** a **Selected Records** column; selected items render in **much smaller
  fonts** than the results. Agent: "Review Search results. Selected records will move to the panel on the right."
- Instruction on screen: when selection is done **or** you determine no records match, click **Proceed** at
  the bottom.
- On Proceed: **screen fades to dark, the results still showing disappear.** A **multi-select with a click
  button** sits at the bottom of the right column, offering **two options** `[SUPERSEDED — see Decisions locked:
  replaced by the "Available now — Public Records Library" tag + library fulfillment]`:
  1. **"Download all public-ready records identified by the green tag, then submit remaining records for
     required processing."**
  2. **"Submit all records for required processing."**

## The "another record?" loop
- After the option is chosen, agent asks: **"Would you like to search for more records?"**
  - **Yes →** loop back to *"Please enter a description of a requested record."* (builds toward MRR — multiple
    descriptions = multiple record types).
  - **No →** continue to finalize/submit.
- **In the loop, the agent is format-aware:** if a description is for **email/text** or **police video** (PATH
  (b) formats — not instantly searchable), the agent says the request is for a **type of record that cannot be
  included immediately in results**, and **the search will be conducted by the Open Records team.** (Reuses the
  existing PATH (a)/(b) fork in `publicChat.js`.)

## Decisions locked — 2026-07-10 mockup session
Validated interactively in the clickable prototype. These update the Phase 0 / Phase 2 designs above.
- **Surface standard** — adopted app-wide (see top section).
- **START HERE** header replaces "Tell us who you are"; instruction reads: "Provide information in the form
  below. When all information is entered, click PROCEED. This will activate the AI Open Record Agent on the
  right, and it will guide you through record search."
- **Email-accuracy gate** — a **"Send verification email now"** button sits inline with the email field; the
  lower form stays locked until the requestor clicks **Email address verified** (enabled only after send) OR
  **Visually verified** (always available). No "optional / or" framing.
- **Single phone box**; **mailing address** (structured street1/street2/city/state/zip — see "Mailing address
  data model") unlocks only for postal delivery.
- **Selected Records = per-child, attach-and-clear** (NOT a running accumulation). One description = one child
  request. On Proceed, that child's selected records **attach to the child**, and both the results area and the
  Selected panel **clear**; the "another record?" loop opens a fresh canvas. Rationale: keeps per-record
  provenance clean for downstream processing / fee / redaction; a single growing pile blurs which record answers
  which ask. (Backlog #236 provenance-per-record aligns.)
- **Immediate-download records** — **tag only:** "Available now — Public Records Library." No in-panel download
  button; at submit these fulfill through the existing released-records / Public Library path. Fee: **per-page
  copy cost only, or free** — never labor/redaction (there is none). **Supersedes** the Phase-2 "download
  public-ready now vs submit all" two-option fork above.
- **Include certification** — a **parent-level checkbox on the Phase 0 form** (see next section). Kept off the
  chat agent by design: reduces misread risk, and anyone who needs certification recognizes the box instantly.
  **Discoverability (2026-07-10):** unlike the rest of the lower form (fully dimmed behind the email gate), the
  certification checkbox is **visible-but-disabled before the gate** — with an "Available once your email is
  confirmed above" hint — so the option is never missed on first glance. The gate enables it on confirm and
  re-disables (and unchecks) it on re-lock. (Mockup: the locked region dims its children individually, exempting
  the `.cert-visible` row, since CSS opacity on the parent would otherwise cap the child.)

## Search-completeness intent + refine-and-search-again `[DESIGNED 2026-07-13 with Kevin — ready to build; BACKLOG R9]`

**The gap this closes.** Phase 2 captured **which records were selected** and nothing about **what the selection
meant**. Selection was doing double duty as an implicit completeness claim, so two requestor intents had no
expression: *"nothing here matches, but file my request anyway"* (an empty selection read as abandonment, not as
an instruction to search) and *"these match, but keep looking — there should be more"* (a partial selection was
indistinguishable from a complete one, so a request the requestor considered open could be fulfilled from the
selected set and closed).

### 1. The refine loop — one description, many searches `[NEW]`
A description is no longer one-shot. The results canvas carries the **query that produced these results in an
editable field** at the top ("Searching for: …") with a **Search again** button, and a **"Tried already:"** line
listing the earlier queries for this description. Re-searching **replaces the results**; the **Selected Records
column keeps everything already picked** and new picks **add** to it (dedup by record id; each stays removable).

This moves the attach-and-clear boundary: **clear on Proceed, not on each search.** Within one description the
requestor may search → select → re-describe → search again → select more, accumulating into one Selected panel.
Only **Proceed** closes that description out and asks what the selection means. (The locked per-child
attach-and-clear decision of 2026-07-10 is unchanged in intent — the child is still one description with its own
selections; refining just means the child can be built from several searches.)

The agent narrates each re-run in chat ("I re-ran that — 3 new results"); it does not own the control.

### 2. Intent capture — conditional, at Proceed `[NEW]`
**With ≥1 record selected** — Proceed **fades the results dark** (the fade already in the Phase-2 design) and
raises a small window with **two buttons**:
- **"These are all the records I want for this description"** → intent **`complete`**
- **"Also have the Open Records team search for more"** → intent **`search_more`**
- plus a quiet **‹ Keep refining** escape back to the canvas (the requestor realizes mid-decision they want another search).

**With 0 records selected** — there is **no popup**. The Proceed button *itself* becomes the answer:
**"Submit to Open Records team for search"** → intent **`no_match_search`**. Nothing was selected, so there is no
choice to offer; asking would be ceremony.

**PATH (b) descriptions** (email/text, audio, photos, data exports, paper) are **never searched** — no results are
ever shown, so the requestor is never asked. Their child is recorded automatically with intent **`not_searchable`**.
Kept distinct from `no_match_search` because the searcher needs to know whether the portal already searched and came
up empty, or never searched at all.

### 3. Persistence `[NEW]` — the per-description row the DB never had
Today the client's `children[]` are flattened at submit: descriptions concatenated into one `description` string,
selections flattened into one undifferentiated `request_selected_records` list. Intent is a property **of a
description**, so it needs the per-description row to exist. This slice creates it — and in doing so restores the
per-child provenance the 2026-07-10 decision wanted:

- **`request_search_intents`** `[NEW table]` — one row per described record: `id · request_id · seq · description ·
  intent ('complete' | 'search_more' | 'no_match_search' | 'not_searchable') · queries_tried (JSON array, in order) ·
  created_at`.
- **`request_selected_records.intent_id`** `[NEW nullable column]` → the description its selection answers.
  Nullable; pre-existing rows stay NULL and render ungrouped.

`queries_tried` is not bookkeeping — it tells the searcher **what the portal already searched**, so they don't
repeat it.

**Forward-compat with MRR:** when real parent/child splitting lands (`SPEC_tasks_roles_mrr_fees` §12,
`BUILD_PRIORITY` item 11), each `request_search_intents` row **is** a child request — the row carries the child's
description, its selections and its intent. This table is the shape that migration wants, not an obstacle to it.

### 4. Surfacing to staff `[NEW]`
`RequestWorkspacePage`'s existing "Records the Requestor Selected from Search Results" panel **groups by
description** instead of listing one flat pile. Each group is headed by its description, an **intent chip**, and
the queries already tried:

| Intent | Chip | What the searcher must understand |
|---|---|---|
| `complete` | neutral — "Requestor: this is everything" | The selection answers the ask. |
| `search_more` | **amber, loud** — "Requestor asked us to search for MORE" | **Fulfilling from the selection alone closes a request the requestor considers open.** |
| `no_match_search` | **amber** — "No match in the portal results — team search required" | The portal searched and found nothing they wanted. Not abandonment. |
| `not_searchable` | blue — "Not portal-searchable — team must pull" | Email/AV/photos/data/paper. Never searched. |

When the **record-search task screen** is built (`SPEC_record_search_task_screen.md`), these become that task's
instruction block — the first thing the searcher reads. Until then, the request workspace is the surface.

### 4b. The NOT-SELECTED set must persist too `[NEW — Kevin's mark-up 2026-07-14, decision #2]`

R9 as designed (2026-07-13) accumulates the **Selected** column across re-searches and clears on Proceed. It says
nothing about the records the requestor was **shown and passed over** — and today those persist **nowhere**. They
are ephemeral in the chat. That is the gap Kevin's mark-up closes:

> *"At any point where the existing files in the search result window clear, save those with the record. All
> cleared files for a request should accumulate **invisible to the requestor** and carry with the request."*

**`request_intake_results`** `[NEW table]` — one row per candidate the portal **showed and the requestor did not
take**: `id · request_id · intent_id` (→ `request_search_intents`, the description it was shown under) ·
`record_id · title · source_system · public_availability · shown_in_query` (which of the `queries_tried` surfaced
it) · `created_at`.

**Write points — every results-clear, not just Proceed:**

| Event | Selected column | Results canvas | Write |
|---|---|---|---|
| **Search again** (re-run within one description) | keeps everything picked | **replaced** | the displaced, unpicked results → `request_intake_results` |
| **Proceed** (closes the description out) | flushed to `request_selected_records` | **cleared** | the remaining unpicked results → `request_intake_results` |

**Dedup rules:**
- Dedup both sets by `record_id` **within a request**.
- **Selection wins.** A record passed over in search 1 and *selected* in search 3 is **selected only** — it moves
  out of `request_intake_results` rather than existing in both. The searcher must never see a record listed as
  "requestor declined this" when the requestor in fact took it.

**Invisible to the requestor.** This set is never rendered back into the portal. It exists solely so the
**record-search task screen** (`SPEC_record_search_task_screen.md` §2.3) can tell the searcher *"the portal already
showed them these 12 and they took 2"* — and so the searcher does not re-surface a record the requestor already
rejected.

**The bar `[NEW]`** — near the top of the search UI, **"Self Service Portal Search Results"** with two buttons:
`Selected Records (n)` · `Records Not Selected (n)`, each opening its list. Specified in
`SPEC_record_search_task_screen.md` §2.3; noted here because **this table is its data source** and R9 is what
creates it.

> **Sequencing:** the record-search task screen's carried-forward panel **cannot show real data until this ships.**
> R9 is now a **prerequisite** of that screen, not a parallel track.

### 5. Explicitly NOT in this slice (decided 2026-07-13)
- **No mechanical gate.** A `search_more` / `no_match_search` intent is **captured and surfaced, not enforced** —
  nothing blocks fulfillment off the selected records. A block needs an un-block (a searcher must be able to say
  *"I searched; there is nothing more"*), and that is the **explicit found/not-found resolution state** already
  queued as `BUILD_PRIORITY` **item 5** (D7). Building a half-gate here would be redone there. **When item 5 lands,
  an unresolved `search_more` / `no_match_search` intent is exactly what it should block delivery on** — noted in
  that item.
- **No routing change.** Whether a `complete` selection should shorten or skip record search (the built-but-unwired
  `request_selected_records` → `workflowEngine` gap, `SPEC_record_search_task_screen` §1) stays out. Intent makes
  that decision *possible*; it is not this slice.
- **No fee/estimate change.** A `search_more` request cannot have a final estimate until the team searches; the
  estimate flow is untouched here.

## Email-accuracy gate — state machine `[RESOLVED 2026-07-10]`
Resolves Open Question #1. Prototyped in `docs/mockups/split_canvas_intake.html`. The gate guards the lower
form (Phone · delivery · **mailing address** · certification · PROCEED); its whole job is to force an accurate
email before anything else is usable.

**One flag, two paths.** Gate state is a single boolean `email_confirmed`, set by *either* route — they are NOT
mutually exclusive choices, just two ways to satisfy the same flag. Whichever fires wins; the other button is
hidden. The route taken is recorded as `email_verification_method ∈ {attested, visual}` for downstream audit.

**Trust model = self-attest** (decided 2026-07-10, kept as prototyped). "Email address verified" is a citizen
self-assertion that they received the mail — there is **no backend token/poll**; it only proves the address is
well-formed + the citizen claims delivery. (Code-entry / link-poll were considered and declined for now; if a
stronger guarantee is ever wanted, that is a self-contained upgrade to this one button + a verify route.)

**Buttons & enablement:**
- **Send verification email now** — enabled whenever the Email field is a valid format. On click: fires the real
  send (reuse `[[VERIFY_EMAIL]]`/Resend), then disables itself ("✓ sent — check your inbox") and **enables
  "Email address verified."**
- **Email address verified** — disabled until a send has happened for the current address. On click →
  `email_confirmed=true`, `method=attested`.
- **Visually verified** — **always available** (decided 2026-07-10), independent of Send; the escape hatch for a
  citizen with no immediate inbox access ("carefully review the address you typed, then click"). On click →
  `email_confirmed=true`, `method=visual`. Consequence, accepted: the email round-trip is effectively optional;
  the weaker method is simply recorded, not blocked.

**On confirm (either path):** lower region un-dims, lock note hides, gate shows the green/satisfied style, the
winning button shows its "✓" done state, the other is hidden, both disabled.

**Re-lock rule (decided 2026-07-10 — closes the stale-confirmation hole):** editing the **Email** field after
the gate is satisfied **resets it to pristine** — `email_confirmed=false`, `method` cleared, lower region
re-dims, both buttons restored (Verified disabled-until-resend, Visually enabled), Send re-enabled. Guarantees
the confirmed address always equals the address on file (you can't verify A then submit B). Implemented as
`resetGate()` in the mockup, fired from the Email `input` handler whenever a send-or-confirm had occurred.

**PROCEED** stays disabled until: Name present · Email valid · `email_confirmed` · (mailing address present when
delivery = mail). Clicking it activates the chat agent (Phase 1).

## Mailing address data model `[RESOLVED 2026-07-10]`
Resolves Open Question #2. Closes the postal gap tracked since HANDOFF slice (i) and `SPEC_public_portal_intake`
§5b: intake never captured an address, so `delivery_method='mail'` had nowhere to mail and every postal
clarification re-asked inline.

**Verified current state (code, 2026-07-10):** `requests` has `requestor_name/_email/_phone/_type` +
`delivery_method` (default `email`) and **no address column** (`schema.postgres.sql`). Intake `[[CONTACT_FORM]]`
collects Name/Email/Phone only; the INSERT (`publicChat.js:297`) has no address. Postal clarification
(`clarificationAction.js:87-94`) takes an **inline `mailingAddress`** at send time, throws `ADDRESS_REQUIRED`
when absent, and only writes it into the effort-trail note — never persisted.

**Decision — structured, postal-gated:**
- **Storage:** five nullable columns on `requests` — `mailing_street1`, `mailing_street2`, `mailing_city`,
  `mailing_state`, `mailing_zip`. Country implicit US for now (add `mailing_country` only when a non-US need
  is real). Chose structured over a freeform block for format validation, clean letter + envelope rendering,
  and future residency/fee logic — cheap to add now, painful to retrofit later.
- **Capture scope (kept as locked):** the address sub-form is shown/required **only when `delivery_method='mail'`.**
  Email-delivery requests capture no address. Required fields = street1 · city · state · zip (street2 optional);
  PROCEED blocks on `delivery=mail` + incomplete address. Mockup: 5 fields in `#addrBlock`, gated by `setDelivery`.
- **Consumers:**
  - **Postal record delivery** — reads the stored columns; no more dead-end.
  - **Postal clarification (§5b)** — `clarificationAction`/`clarificationNotice` should prefer the stored address
    when present; the inline `mailingAddress` opt + `ADDRESS_REQUIRED` throw **stay** as the fallback for
    email-delivery and legacy requests (which have no stored address). No breaking change to that path.
  - **Certification** — certified copies are often mailed; a certified+postal request already carries the address.

**Build recipe — `[BUILT]`:**
1. Schema `[slice 1]`: five `mailing_*` columns on `requests` (`schema.postgres.sql` + `schema.sql`); nullable, no backfill.
2. Intake `[slices 1 + 5]`: the Phase-0 form submits the structured fields when `delivery=mail`; `/public/submit` persists them.
3. Clarification `[slice 1b]`: `clarificationAction.resolveMailingAddress(reqRow, opts)` — precedence **inline → stored `mailing_*` → none**; `doOutreach` uses it (only throws `ADDRESS_REQUIRED` when neither exists) and `preview` reports `addressRequired` = mail-and-none + returns the on-file `mailingAddress`. `findRequest` now selects the `mailing_*` columns.
4. Render `[slice 1b]`: `resolveMailingAddress` formats the structured columns into a clean multi-line block (`street1 / street2 / City, ST ZIP`) that `clarificationNotice.renderLetterHtml` renders under the requestor name.

## Fee-choice placement `[RESOLVED 2026-07-10]`
Resolves Open Question #3. Decision (Kevin): the fee-choice opt-ins live in the **Phase-0 form**, next to
certification — not in chat. Consistent with the design thesis (structured facts → form; conversation →
description only) and it removes the "richer widget than `[[QUICK_REPLIES]]`" problem `SPEC_public_portal_intake`
§5 flagged for the chat path. Both flags are **request-level / parent-level** (like certification and the fee
computation itself, per `SPEC_tasks_roles_mrr_fees §12` L3) — captured once on the Phase-0 form, which runs
once per request regardless of item count.

**Verified current state (code, 2026-07-10):** fee waiver is captured **only in chat** today (Phase 4 →
`[[FEE_WAIVER_INFO]]` → `fee_waiver_requested`; approval-task routing already built, HANDOFF slice c).
**Commercial is entirely unbuilt** — §5 wants `purpose='commercial'` but there is **no `purpose` column**;
`requestor_type` exists (default `individual`) but is hardcoded `'individual'` at the INSERT
(`publicChat.js:298`). "nothing captures commercial today."

**UX (default-forward, §5):**
- A **"Fees — standard rates apply by default"** lead; under an **"only if one applies"** divider, two opt-in
  check-rows:
  - **Request a fee waiver** — for nonprofit / journalist / researcher / non-commercial public-interest.
    Checking it **reveals a reason textarea** ("briefly describe the public-interest purpose"). → `fee_waiver_requested=1` (+ reason).
  - **I'm a commercial requester** — "subject to review; commercial rates may apply." → the commercial flag.
- **Mutually exclusive** (design inference, override if unwanted): a non-commercial public-interest waiver
  contradicts declaring commercial use, so checking one clears the other. Prototyped this way.
- Neither checked ⇒ standard rates (the default path; no friction for the common case).

**Storage / build recipe (turnkey, not built):**
1. **Waiver** — reuse the existing `fee_waiver_requested` flag + capture the reason (add `fee_waiver_reason`
   if not already persisted — the chat path passes `feeWaiverReason` in SUBMIT_READY but the INSERT
   at `publicChat.js:297-298` does **not** store it today; fold it in). Downstream approval task already built.
2. **Commercial** — set **`requestor_type='commercial'`** at intake (reuse the existing column; no new
   `purpose` column needed — supersede §5's `purpose` wording). Staff estimate should open on commercial rates
   when `requestor_type='commercial'`; commercial approval stays `[DEFERRED — on customer demand]` per §5.
3. **Form submit** — the Phase-0 form (and the split-canvas submit path when built) passes both flags; extend
   the request writer to persist them. Applies once at request level.
4. Chat no longer needs the fee-choice widget — Phase 4 fee-waiver prompting can be **retired from the agent
   script** once the form owns it (leave the agent able to *acknowledge* if a citizen raises fees, but not to
   capture — the form is canonical).

Mockup: `#waiverRow` / `#commercialRow` under a `.fee-choice` block in the Phase-0 form, waiver reveals
`#waiverReasonBlock`, mutual exclusion + a Fees line in the review summary.

## Mobile / narrow layout `[RESOLVED 2026-07-10]`
Resolves Open Question #5. On a phone the side-by-side split (canvas left, chat right) can't hold. Decision
(Kevin): **step-through** — show **one surface at a time**, advanced by the same phase transitions as desktop,
with a **Form/Results ↔ Chat toggle** for the phases where both are relevant. Chosen over stacking (canvas
above chat) because the flow is inherently sequential and a stacked results grid + Selected column + chat is a
long, unfocused scroll where the active surface isn't obvious.

**Behavior (≤860px; prototyped in the mockup):**
- A sticky **two-button toggle** at the top of the stage: **Form/Results** and **Assistant** (with a
  new-message **dot**). Hidden ≥861px — desktop keeps the true side-by-side.
- **Phase 0 (form):** canvas surface shown; the Assistant tab is **disabled** (chat is idle until PROCEED).
- **PROCEED:** the Assistant tab enables and the view switches to **chat** (describe the record). The canvas
  toggle relabels **"Results."**
- **Results ready:** view switches to **canvas** to review + select; the agent's follow-up message lands as an
  **unread dot** on the Assistant tab (opening chat clears it).
- **Selected Records** column drops **below** the results list (stacked, own scroll) instead of a 27% side
  column.
- **Proceed → "search for more?"** returns to **chat**; the finalize + review/submit scrims force **canvas**
  (they're absolute within the results panel). Loop repeats.
- One surface is always the natural focus; the toggle is the manual escape hatch. Reduced-motion + restart
  (`location.reload()`) paths unaffected.

Mechanics: a `.m-canvas`/`.m-chat` class on `#stage` shows exactly one child (`.stage.m-canvas > .chat{display:none}`
etc.), all inside the `@media (max-width:860px)` block so desktop is untouched; `setMobileView()` drives it
from the phase transitions.

## Certification (certified copies) `[DESIGN — not built]`
Parent-level option captured at intake; the certified artifact is produced at **release**, by a clerk.

**What "certified" means here.** A physical certified copy carries a clerk's attestation (name / title, "true
and correct copy" wording), a hand-embossed seal, often a signature across the seal — either as a stamped block
on the document or a separate certification page. The design problem is reproducing that trust for a **digital**
copy in a way that **survives printing** and stands up in front of a judge.

**Already exists (verified in code 2026-07-10):**
- **Fee engine prices certification** — `feeEngine.js` has a certification line item, **once per request /
  parent-level**, `count × rate`, unit configurable (`per_record` / per-page); it's in the extracted per-city
  fee policy (`feePolicyExtract.js`), on the fee notice (`feeNotice.js`), and staff can set a certification
  count on an estimate (`feeEstimates.js`). "Parent-level application" is the documented intent
  (`FEE_ESTIMATE_KNOWLEDGE.md`). City certified-copy rates are catalogued in `FEE_ESTIMATE_VARIABLE_MAP.md` /
  `CITY_FEE_SURVEY.md`.
- **Separate concept — do not conflate:** a **"no-record-located certification"** (certifying that *no* record
  exists) is a different, already-flagged gap (`FEE_ESTIMATE_VARIABLE_MAP.md` §8.3).

**Gaps (not built):**
1. **Requestor-facing capture** — nothing asks the requestor today (staff-only). → the Phase 0 checkbox fills
   this; it sets `certification.count` (1 when checked), feeding the existing fee engine.
2. **Certification-page template + generator** — city-specific; not in code or spec.
3. **Verification route + token** — does not exist.
4. **Spec section** — none today.

**Digital binding + verification design (recommended):**
- **Certification page** appended to the same PDF: clerk name / title, attestation wording, date, **page count**,
  request number, and a **document fingerprint (SHA-256)**.
- **Every page stamped** with the request number and **"Page X of N."** X-of-N makes page removal / insertion
  evident — the anti-tamper workhorse.
- **Online verification** (e.g. `city.gov/records/verify`): enter the code → the system opens the **exact stored
  certified file** in a viewer for visual comparison and shows the same hash. Judge-facing proof; mirrors how real
  court / recorder "certified electronic copy" systems work.
- **Do NOT verify by the raw request number** — it is sequential / guessable; an enumerable URL would expose other
  requests. Print the request number for humans; make the verify link carry a **separate non-guessable token**.
  Human reference ≠ access key.
- **Blockchain: rejected** — irrelevant once printed for a judge; portal-lookup + hash gives the same
  tamper-evidence without the overhead.
- **Optional digital-native layer:** PKI-sign the released PDF (Adobe "signed & valid" ribbon) for the digital
  copy — nice-to-have, not required for the print path.

**Why very buildable:** rides existing infra — the redaction output pipeline already stamps pages and appends a
generated page (Vaughn index) via `pdf-lib`; the released-records store already ties the output file to the
request; the fee engine already prices it. New work = template + generator, per-page stamp on certified output,
verify route + token, and a spec. **Release-stage slice**; the intake checkbox is the only part on this screen.

## Open questions (for the working session)
1. **Verification gate wording/logic** — `[RESOLVED 2026-07-10 — see "Email-accuracy gate state machine" below.]`
   Not two competing toggles: **one `email_confirmed` flag**, satisfied by *either* path; the winner is recorded
   and the other button is hidden. Trust model = **self-attest** (kept as-is); **Visually verified = always
   available** (equal escape hatch for no-inbox-access); editing the email after unlock **re-locks the gate**.
2. **Where does address live in the data model** — `[RESOLVED 2026-07-10 — see "Mailing address data model"
   below.]` **Structured** columns (`mailing_street1/street2/city/state/zip`, country implicit US), **captured
   only when `delivery_method='mail'`** (unchanged locked decision). Persisting it lets postal delivery + postal
   clarification (§5b) read a stored address instead of re-asking; the inline `ADDRESS_REQUIRED` path stays as
   the fallback for email-delivery / legacy requests that carry no stored address.
3. **Fee-choice (§5)** — `[RESOLVED 2026-07-10 — see "Fee-choice placement" below.]` Lives in the **Phase-0
   form** (with certification), NOT chat. Default-forward: standard rates by default, an "only if one applies"
   pair of opt-ins (fee waiver → reason box; commercial requester). Chat stays description-only; removes the
   "richer widget than QUICK_REPLIES" problem §5 flagged.
4. **MRR** — the per-description loop is the MRR item-by-item intake (§6). `[RESOLVED — one description = one
   item under one request; one number, one parent-level fee; NO "combined vs separate" (retired); the only
   ≥2-item choice is delivery timing. Clean model: SPEC_tasks_roles_mrr_fees §12. Staff-side management UI is the
   open follow-on (§12.1: RM workspace hub + estimate + search + early-release).]`
5. **Mobile / narrow** — `[RESOLVED 2026-07-10 — see "Mobile / narrow layout" below.]` **Step-through** (one
   surface at a time), not a stack: the side-by-side split collapses to a single surface with a **Form/Results ↔
   Chat toggle**, driven by the same phase transitions as desktop. Chosen over stacking because the flow is
   inherently sequential and a stacked results-grid + chat is a long, unfocused scroll.
6. **Green-tag / public-ready** — needs the released/public-ready tagging surfaced on result cards (ties to the
   redaction "released records" path). `[UPDATED — now an "Available now — Public Records Library" tag; no inline
   download; per-page-or-free fee. See Decisions locked.]`

## Build note
Per the UI rule, this needs an agreed design direction before any screen is built — this doc **is** that
direction, pending Kevin's confirmation. Backend pieces already exist to reuse: `[[VERIFY_EMAIL]]`/Resend,
PATH (a)/(b) fork, native + library + email-count search modes, selected-records persist-at-submit,
released-records surfacing. The two genuinely new builds are the **Phase-0 form panel** (incl. address
capture + gate) and the **results-canvas layout** (incl. selected column + two-option finalize).
