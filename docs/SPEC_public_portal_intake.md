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
- **Phase 3 — Multi-record detection:** two+ record types routing to different departments → ask combined vs separate (quick replies); records `mrrChoice`. `[PARTIAL — choice captured; "separate" performs NO split (see MRR spec)]`
- **Phase 4 — Fee waiver:** yes/no public-interest question → `[[FEE_WAIVER_INFO:yes|reason]]`. `[BUILT — superseded by §5 design]`
- **Phase 5 — Confirm & submit:** summary → explicit confirmation → `[[SUBMIT_READY]]{json}[[END_SUBMIT]]` with contact, delivery, description, feeWaiver, isMrr, mrrChoice.
- **Quick replies:** `[[QUICK_REPLIES: A | B]]` tappable buttons; max one per message; only for closed questions; typing always works.

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
