# Consolidated Spec — Domain 1: Public Portal & Intake Agent
**Current design only.** Superseded content removed. Verified against code + DB on 2026-07-08.
Status legend: `[BUILT]` · `[PARTIAL]` · `[NOT BUILT]` · `[DEFERRED]` · `[DECISION]`

## 1. Portal landing page `[BUILT — reworked 2026-07-07]`
Two-block layout under a centered welcome: Public Ready Records Library description + "Access Public Ready Records Library" button; Open Records Request Portal description + "Create an Open Records Request" button. Both solid blue, equal 340px. Deep-link `/portal?start=request` opens the chat directly.

## 2. Intake chat agent (AI, Anthropic API) `[BUILT]`
Phased conversation; agent emits bracketed markers the system acts on.
- **Phase 1 — Contact:** greet, emit `[[CONTACT_FORM]]` → one form (name, email, phone-optional). Optional email verification: `[[VERIFY_EMAIL:addr]]` sends a real verification email (Resend, live) and waits; `[[VERIFY_SKIPPED:addr]]` proceeds. Then delivery preference (email | postal).
- **Phase 2 — Description:** elicit records sought; clarify one question at a time (dates, departments, people/events, format); confirm scope in plain language.
- **Phase 2.4 — Format fork:**
  - **PATH (a) documents/forms/police video** → searchable; go to 2.5.
  - **PATH (b) email/text, audio, photos, database exports, paper** → no library search; explain once, warmly; gather targeted details (senders/recipients + date range for email; date/location/incident for AV; event/date/location for photos); skip search.
  - **Email/text special case:** `[[EMAIL_SEARCH:terms]]` runs a **count-only** search (no content exposed); agent relays only the count and helps narrow if large (count-then-narrow).
- **Phase 2.5 — Library search (PATH a):** `[[SEARCH_QUERY:...]]` → system searches; results injected as UNTRUSTED DATA; result-aware reply asks "any match?" (quick replies). Citizen selections are injected into agent context and **persisted on the request at submit**; agent will not re-search after selection and moves to finalize.
- **Phase 3 — Multi-record handling:** the per-record intake loop produces **one item per described record** under **one request** (one number, one parent-level fee). **No "combined vs separate" question** — combining is the default and the only path (MRR model, `SPEC_tasks_roles_mrr_fees.md` §12). The only ≥2-item choice is **delivery timing** (each-as-ready vs hold-all). `[SUPERSEDES the old "ask combined vs separate / mrrChoice" design — that question is retired]`
- **Phase 4 — Fee waiver:** yes/no public-interest question → `[[FEE_WAIVER_INFO:yes|reason]]`. `[BUILT — superseded by §5 design]`
- **Phase 5 — Confirm & submit:** summary → explicit confirmation → `[[SUBMIT_READY]]{json}[[END_SUBMIT]]` with contact, delivery, description, feeWaiver, isMrr. `[mrrChoice retired — combining is the default; delivery-timing (each-as-ready vs hold-all) replaces it, §12]`
- **Quick replies:** `[[QUICK_REPLIES: A | B]]` tappable buttons; max one per message; only for closed questions; typing always works.

## 2b. Split-canvas v2 intake agent (`/portal/v2`) `[PARTIAL — form + chat engine built; results canvas + submit pending]`
The split-canvas portal (design: `DESIGN_split_canvas_intake.md`) inverts the intake model: a **Phase-0 structured form** (left canvas) owns identity, email-accuracy gate, delivery, mailing address, fee-choice, and certification; the **chat agent** (right panel) does ONLY record **descriptions + search + the one-record-at-a-time (MRR) loop**. Built as a new page alongside the chat-first `/portal`.
- **Backend agent flow** `[BUILT — slice 3]`: `POST /public/chat` with `mode:"split_canvas"` selects `SYSTEM_PROMPT_SPLIT_CANVAS` (`publicChat.js`). It reuses the full search stack (`[[SEARCH_QUERY]]` → library search + AI relevance judge; `[[EMAIL_SEARCH]]` count-only for email/text; PATH (a)/(b) format fork; result-aware second-pass reply; `[[QUICK_REPLIES]]`) but **never** collects contact info, verifies email, asks delivery/fees, or emits `[[SUBMIT_READY]]`/`[[CONTACT_FORM]]`/`[[VERIFY_EMAIL]]`/`[[FEE_WAIVER_INFO]]` — those markers are barred; the form owns them. Result-aware and no-result reply text is mode-aware (points at "the results view", not chat cards; never re-asks for delivery). Default (chat-first) `/portal` flow unchanged.
- **Opening script** is the verbatim design greeting, seeded **client-side** (display-only), so it is never sent to the API (Messages API needs a user-first turn); the first API call is the citizen's first description.
- **Frontend chat engine** `[BUILT — slice 3]` (`PublicPortalV2Page.js`): PROCEED activates the panel (left form goes inert), real user/assistant turns, typing indicator, tappable quick replies, and a **read-only** rendering of returned records in chat. Latest `searchResults`/`searchQuery` are captured in state for the results canvas.
- **Pending:** results **canvas** (morph the left panel to the interactive results grid + Selected-Records column, per-child attach-and-clear) `[slice 4]`; form→`/public/submit` wiring `[slice 5]`; mobile step-through toggle `[slice 6]`; cut over `/portal`. Structured-field storage (address, fee-choice, `requestor_type`) already persisted `[slice 1]`.

## 3. Handoff → request `[BUILT]`
Submit inserts the request (`submission_channel` recorded), sets classification-based deadline days, persists selected records, then AI classification + workflow routing run (Domain 5). Fee-waiver flag stored. `is_mrr` stored.

## 4. Form fallback `[BUILT]`
"Prefer a form?" link swaps chat for a traditional form (contact, description, delivery). `[GAP: no fee-choice field — see §5; no commercial field]`

## 5. Fee-choice intake — default-forward `[NOT BUILT — replaces Phase 4 design]`
Prominent "Continue with standard rates" default; under an "only if one applies" divider, two opt-ins with descriptions: **Request a fee waiver** and **I'm a commercial requester** ("subject to review"); "you can also just type." Waiver → reason follow-up → `fee_waiver_requested`. Commercial → sets `purpose='commercial'` so the staff estimate opens on commercial (staff confirm). Commercial approval `[DEFERRED — on customer demand]`. Applies to chat AND form. Needs a richer widget than `[[QUICK_REPLIES]]`.
**Current gap:** nothing captures commercial today; `purpose` set only by staff.

## 6. MRR item-by-item intake `[NOT BUILT — DECISION]`
Agent elicits ONE description per child: detect-and-propose from free text, validate each item back individually, then "anything else?" catch-all. >1 item at handoff → MRR. (Full processing: MRR spec §12.)

## 7. Known gaps / open
- Quick Reply rich widgets (choices with descriptions, date/time modes) — designed, `[NOT BUILT]`; needed by §5.
- Chat banner too tall / auto-scroll fix — committed UX backlog.
- Phase-4 fee capture (§5) and MRR intake (§6) are THE two intake builds pending.
- Search quality stack (floor, AI relevance judge, taxonomy router) lives in Domain 3/7 specs.
