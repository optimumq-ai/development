# DESIGN — Split-Canvas Portal Intake (recovered)

**Status:** `[DESIGN — not built]` · design direction from the requestor (Kevin), recovered 2026-07-10.
**Origin:** Reconstructed from `info_lost_recaptured.pdf` after two session drops lost the live brainstorm.
This is the authoritative capture so it is never lost again. Supersedes nothing yet; when built it revises
`SPEC_public_portal_intake.md` §2 (chat-only intake) and §4/§5 (form fallback / fee-choice).

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
- *(Fee-choice §5 — commercial / waiver — is a natural fit for this panel too; open question below.)*

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
- **Top:** thin instructions bar.
- **Right sub-column (~25% width):** a **Selected Records** column; selected items render in **much smaller
  fonts** than the results. Agent: "Review Search results. Selected records will move to the panel on the right."
- Instruction on screen: when selection is done **or** you determine no records match, click **Proceed** at
  the bottom.
- On Proceed: **screen fades to dark, the results still showing disappear.** A **multi-select with a click
  button** sits at the bottom of the right column, offering **two options**:
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

## Open questions (for the working session)
1. **Verification gate wording/logic** — are "Verification Email Received" and "Visually Reviewed for Accuracy"
   two mutually-exclusive buttons, and does pressing one disable the other? What re-enables the dimmed section
   exactly?
2. **Where does address live in the data model** — new `requests.mailing_address` column (+ structured
   street/city/state/zip?) vs a single freeform block. Postal clarification (§5b) currently takes an inline
   address; this would make it a real persisted field.
3. **Fee-choice (§5)** — does the "commercial requester / fee waiver" opt-in live in this Phase-0 panel, or
   stay in chat?
4. **MRR** — the per-description loop is exactly the MRR item-by-item intake (§6). One description = one child?
   How is "combined vs separate" decided here?
5. **Mobile / narrow** — a side-by-side split can't hold on a phone. Does the left canvas stack above chat,
   or become a step-through?
6. **Green-tag / public-ready** — "download all public-ready records identified by the green tag" needs the
   released/public-ready tagging surfaced on result cards (ties to the redaction "released records" path).

## Build note
Per the UI rule, this needs an agreed design direction before any screen is built — this doc **is** that
direction, pending Kevin's confirmation. Backend pieces already exist to reuse: `[[VERIFY_EMAIL]]`/Resend,
PATH (a)/(b) fork, native + library + email-count search modes, selected-records persist-at-submit,
released-records surfacing. The two genuinely new builds are the **Phase-0 form panel** (incl. address
capture + gate) and the **results-canvas layout** (incl. selected column + two-option finalize).
