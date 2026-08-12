# SPEC — Record Verification (certified-record authenticity check)

**Status: DRAFT 2026-08-12 — awaiting Kevin's design-direction confirmation (UI rule) and the §8 decisions.**
Source: Kevin's feature note `/home/optimumq/exchange/statuscheckandverification.txt` item (2).
Sibling feature: `SPEC_portal_status_check.md` (item 1) — separate feature, adjacent button on the portal home.
Foundation: `DESIGN_split_canvas_intake.md` "Certification (certified copies) `[DESIGN — not built]`" — this
spec ratifies that sketch's digital-binding design and supersedes it where they differ.

## 1. The finding this spec has to absorb: certification is HALF-BUILT

Verification presumes a certified artifact. Verified 2026-08-12, there isn't one — certification today is a
**fee input and a promise**:

1. **The wizard promises an unbuilt page.** The intake checkbox says "Include a page attesting the records
   are true and accurate" (`PublicPortalWizardPage.js:525`). Nothing anywhere generates that page.
2. **The opt-in reaches no human.** Only the fee estimator reads `requests.certification_requested`
   (`feeEstimates.js:126,161`). No staff screen shows it; delivery and closure never mention it.
3. **No integrity anchor exists.** Neither `fulfilled_records` nor `request_files` has any hash/checksum
   column. Nothing today could support "this file is the certified one."
4. **The parent/child placement is wrong.** `SPEC_parent_child_lifecycle.md` §5.1 lists
   `certification_requested` as PARENT-only; `requestCreate.js` copies it onto every child (it is in
   `COLUMNS` but in neither `PARENT_NULL` nor `CHILD_FIELDS`). Because estimates run per work row, an MRR
   can price certification once per child instead of once per request — a double-charging defect.
5. **Two intake paths drop the opt-in silently**: the legacy inline `POST /api/requests/public`
   (`server.js:20-42`) and staff `NewRequestPage`.

So this feature is built in two parts: **Part A** finishes certification (the artifact and its anchors);
**Part B** is the portal verification flow Kevin described. Part B cannot exist without Part A.

## 2. Part A — the certified artifact

### 2.1 Certification is a PARENT fact (answers Kevin's MRR question)
`certification_requested` moves to parent-only in `requestCreate` (added to `PARENT_NULL`), read through the
parent everywhere (`requestScope.parentFact`), matching `SPEC_parent_child_lifecycle.md` §5.1. The fee
engine's "one certification unit per priced component, once per request" shape is already correct — the fix
ends the per-child double count. The two dropped intake paths start carrying the opt-in.

### 2.2 The integrity anchor: hash at release
At release (the `fulfilled_records` insert path — `redactionApply.js` / `structuredRedaction.js` /
`redactionBypass.js`), compute **SHA-256 of the output file** and store it:

- `fulfilled_records.content_sha256` (new column) — the full hash, computed for EVERY released record,
  certified or not (measure-always; certification gates what is *presented*, not what is *recorded* — the
  established measure-always/gate-visibility pattern).
- **Verification code** = the first 16 hex characters of `content_sha256`, displayed uppercase in groups of
  four: `A1B2-C3D4-E5F6-0789`. Derived, never stored separately (one source of truth). Entry is
  case/dash/space-insensitive. Codes are compared only WITHIN one request's records, so 64 bits is
  collision-proof in practice while staying typeable from a printed sheet — this answers the feature note's
  "hash might not be optimal due to length."

### 2.3 The certification sheet
Generated with `pdf-lib` (precedent: the Vaughn Index builder, `redactionApply.js:101-167`), saved to
`uploads/` and inserted as a `request_files` row (`Certification - {request_number}.pdf`), joining the
release package the same way the withholding log does. Delivery of the sheet is the delivery of the records
— out-of-band today; it inherits any future delivery mechanism automatically. Contents:

- City name, attestation wording (clerk name/title, "true and correct copy", date), the PARENT request
  number, page counts.
- **Per released record**: the child marker and label (`–1 Police report…`), its verification code, and its
  full SHA-256 in small print (judge-grade comparison; the code is the human-typeable form).
- **Per non-delivering child** (denied, no records, withdrawn): one line stating the outcome — the sheet is
  honest about the whole request, per Kevin's note ("the certification sheet would need to be sent
  regardless").
- Verification instructions: "To verify, visit the {city} Open Records portal and choose Verify a Certified
  Record," plus the request number and codes needed.
- ⚠️ NOT in scope: the separate "no-record-located certification" concept (`FEE_ESTIMATE_VARIABLE_MAP.md`
  §8.3) — a different instrument; do not conflate (the sheet lists a no-records outcome, it does not certify
  it).

### 2.4 When the sheet is produced (the MRR timing rule — ratifying Kevin's assumption)
The sheet covers the WHOLE request, so it is generated **when the parent derives Complete** — i.e. when the
last open child reaches a terminal state, regardless of that child's disposition. n = 1 is not a special
case: parent completion coincides with the single child's completion. Records released earlier (per-child
delivery) already carry their hashes from §2.2; the sheet arrives once, at the end, listing them all.
Idempotent: re-deriving Complete never generates a second sheet.

### 2.5 Staff visibility
The workspace shows a "Certification requested" marker on certified requests (parent fact), so fulfillment
staff finally learn the requestor asked. Minimal surface; placement agreed at design direction.

### 2.6 Page stamping — deferred, recorded
The prior design's "every page stamped Page X of N" anti-tamper measure is DEFERRED (it touches every
release, certified or not, and has layout risk on odd page sizes). The hash makes substitution detectable
for the digital path; X-of-N hardens the print path and can be its own slice later. `[OPEN — Kevin]` if he
wants it now.

## 3. Part B — the portal verification flow

Entry: the **Verify a Certified Record** button (portal home third row, `SPEC_portal_status_check.md` §2).

```
Step 1 ┌─ Verify a Certified Record ────────────────────┐
       │  Enter the request number printed on the       │
       │  certification sheet (looks like 2026-000123). │
       │  Request number  [ __________ ]   [ Continue ] │
       └────────────────────────────────────────────────┘
   → unknown number:   "The number entered has no matching request."
   → not certified:    "Verification is available only for certified records."
   → certified:        Step 2

Step 2 ┌─ Choose how to verify ─────────────────────────┐
       │  [ Verify a digital file ]  (enter its code)   │
       │  [ Compare visually ]       (view the record)  │
       └────────────────────────────────────────────────┘

File   ┌─ Verify a digital file ────────────────────────┐
       │  Record (MRR only):  [ –1 Police report ▾ ]    │
       │  Verification code:  [ ____-____-____-____ ]   │
       │                                  [ Verify ]    │
       └────────────────────────────────────────────────┘
   → match:     "VERIFIED — this code matches the certified record."
   → no match:  "The code entered does not match this record."

Visual ┌─ Compare visually ─────────────────────────────┐
       │  Verification code first (§8.1), then the      │
       │  stored certified PDF renders for side-by-side │
       │  comparison with the copy in hand.             │
       └────────────────────────────────────────────────┘
   → non-document file type (video, audio, imagery):
     "Visual comparison is available for documents only. For this
      file type, use digital file verification instead."
```

- **MRR**: after Step 1 the certified request's released records are listed by child marker + label; the
  citizen picks which record to verify. n = 1 skips the picker.
- **Visual validation is PDF-only** (the release pipeline outputs PDFs for documents); any other output type
  gets the redirect message above. We do not build viewers for other media (Kevin's body-cam example).

## 4. API

All unauthenticated, `/api/public/*`, rate-limited with `checkRate`:

- `POST /api/public/verify/lookup` `{ requestNumber }` →
  `{ state: 'no_match' | 'not_certified' | 'certified', records: [ { childNo, label, fileKind } ] }`
  (records listed only when certified; labels and child markers only — no file ids, no hashes).
- `POST /api/public/verify/code` `{ requestNumber, childNo?, code }` → `{ verified: true | false, message }`.
  Comparison is prefix-match of the normalized code against `content_sha256`, scoped to that request's
  released records.
- `GET /api/public/verify/view/...` — the visual-validation document stream, gated per §8.1's decision
  (never by request number alone), serving the exact stored certified output file.

## 5. Prerequisite hardening (found 2026-08-12, fixed in this slice)

`GET /api/public/file/:id` (`publicChat.js:691`) checks only `status='released'` and **omits the
`published = 1` gate every sibling library query applies** — contradicting `SPEC_public_library.md:14-16`
("released-to-requestor ≠ public"). A record released to one requestor but never published is served to
anyone holding the file UUID. The verification viewer must not inherit that door, and the door itself gets
the missing gate. (Library pages pass both flags, so adding the gate breaks nothing published.)

## 6. Data changes

- `fulfilled_records.content_sha256 TEXT` (nullable; populated at release going forward; backfill for
  existing released rows by hashing files on disk — a one-time script through the real schema path).
- `requests.certification_requested` → parent-only semantics (§2.1). No new tables.

## 7. Tests

`backend/tests/verify_record_verification.js` (via `npm test` only): parent-fact placement (child rows carry
0; MRR estimate prices certification once); hash written on release; sheet generated exactly once at parent
Complete, listing non-delivering children; lookup state machine (no_match / not_certified / certified —
byte-exact messages); code verify match + mismatch + cross-child mismatch; visual gate (PDF renders only
under §8.1's rule; non-PDF gets the redirect message); the §5 published gate.

## 8. Open decisions `[OPEN — Kevin]`

### 8.1 What unlocks the visual viewer
The feature note opens the viewer from the request number alone. The prior design decided the opposite:
*"Do NOT verify by the raw request number — sequential/guessable… Human reference ≠ access key"*
(`DESIGN_split_canvas_intake.md`). Numbers are enumerable, so number-alone means anyone can page through
requests and READ every certified record, published or not.

| Option | Viewer opens on | Exposure |
|---|---|---|
| A (feature note) | request number alone | certified records readable by enumeration |
| **B (recommended)** | request number + that record's verification code | only holders of the certified copy/sheet can view — the code IS the access key, which is exactly what the sheet prints it for |

Recommendation: **B.** It keeps Kevin's exact flow shape (the code field simply sits at the top of the
viewer step), honors the recorded "human reference ≠ access key" decision, and costs a verifier nothing —
anyone comparing visually is holding the sheet with the code on it. File verification already requires the
code by definition. Certified-existence (Step 1's yes/no) stays number-only per the feature note.

### 8.2 Certification-only scope
The note leans toward verification only for certified records. §2.2 hashes EVERY release regardless
(measure-always), so widening later (e.g. verify any released record) is a presentation decision, not a
schema change. Default: certified-only, as written.

### 8.3 Page stamping now or later — §2.6.

## 9. Build order recommendation

NOT one pass with the status check. Status check is one endpoint + one modal against existing data —
shippable alone. Verification carries schema change, release-path hashing, sheet generation, parent-fact
migration, staff surface, and a viewer. Recommended: **slice 1 = status check; slice 2 = Part A
(certification finished); slice 3 = Part B (verification portal)** — each verified and committed on its own,
per the process rules. The portal-home row ships in slice 1 with the Verify button present but opening a
"coming soon"-free path: the button simply ships in slice 3 (no dead buttons on the public portal).
