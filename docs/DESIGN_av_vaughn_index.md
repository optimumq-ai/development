# Design — The Vaughn Index for Audio/Video (why, not just who and when)

**Status:** SPECIFIED, **NOT BUILT — parked by Kevin 2026-07-14.** *"I won't make a decision on whether or not to
build it until I work through this build enough to see requests process correctly."* Correct call: the core
request loop comes first. This document exists so the decision, when it comes, is a decision and not a redesign.

**No GPU. No detection. No new UI surface.** This is a field, a picker, and a report — over machinery that already
exists.

Companions: `VIDEO_REDACTION.md` (Phase 1, built + parked 2026-06-20) · `DESIGN_delegated_av_fulfillment.md` ·
`SPEC_redaction_automation.md` · `BRIEF_av_detection_sidecar.md` (the *other* half — commodity, separable).

---

## 1. The defect, stated exactly

We already have a per-jurisdiction exemption library and we already force document redactions to cite it:

```
DOCUMENTS   redaction_zones.rule_id ──► redaction_rules ──► legal_sources
            (x, y, w, h, page_no, rule_id, note, review_state, created_by)
            Every box carries its legal basis, its approval status, and its statute.

AUDIO/VIDEO av_redaction_tasks.zones_json
            [{ x, y, w, h, style, startTime, endTime }]
            ── nothing. No rule. No basis. No statute. No citation.
```

**We do exactly what we criticize the market for.** The 2026-07-14 research found that GovQA *"forces every
redaction to cite an exemption statute"* on documents and then hands video to Veritone, whose own documentation
tells users *"you must **manually** apply redaction codes to multimedia redacted in Veritone."* Every DEMS
(Veritone, Genetec, Motorola) logs **who redacted and when** — chain of custody, built for an evidence unit
worried about admissibility — and **not one of them logs why**, because their buyer was never a records officer
worried about a Vaughn index.

**Our own AV zones have the same hole.** That is the whole of this document.

### Why it is not merely untidy

**Washington, WAC 44-14-04004:** an agency *"must identify the redaction and **state the basis for the claimed
exemption**."* **There is no video carve-out.** The obligation attaches to the *record*, not the *file format*.

A city releasing redacted body-cam footage out of OptimumQ today can produce a beautiful exemption log for the
three PDFs and **nothing at all** for the two videos in the same request. That is not a missing feature. That is
**a release the city cannot defend**, produced by a system that told them they were done.

---

## 2. The fix: ONE exemption catalog, not two

**AV zones reference the SAME `redaction_rules` library the document side already uses.** We do not build a
second catalog, a video-specific reason list, or a parallel enum. The whole value is that a request releasing
**three PDFs and two videos produces ONE exemption log**, in one vocabulary, citing one set of statutes.

*(This is the same instinct as ARCHITECTURE's "one task-routing role catalog" and "one request-creation helper."
A second catalog is how the two halves drift until they contradict each other in front of a judge.)*

### The zone shape gains a basis

```jsonc
{
  "x": 412, "y": 188, "w": 96, "h": 96,
  "style": "black",
  "startTime": 12.40, "endTime": 18.95,

  "ruleId": "rule-…",        // ──► redaction_rules. THE LEGAL BASIS.
  "basisNote": "",           // free text, for when no rule fits (see §4 — never left silently empty)
  "trackId": "person-3",     // optional; from the detection sidecar if it ever exists
  "createdBy": "user-…"
}
```

Persist as `av_redaction_zones` (a real table, mirroring `redaction_zones`) rather than leaving it inside
`zones_json`. **A JSON blob cannot be queried, and a Vaughn index is a query.** `zones_json` stays as the burn
service's input contract — it is the *rendering* of the zones, not the *record* of them.

**The burn service does not change.** `avRedactionApply.js` reads `{x,y,w,h,style,startTime,endTime}` and ignores
what it does not know. The legal layer is additive and invisible to ffmpeg — which is exactly why this is cheap.

---

## 3. Both modes must produce a basis — including the one we don't control

`VIDEO_REDACTION.md` already defines the two modes (Kevin, 2026-06-17). The Vaughn layer lands in both, but the
work is different, and the *external* case is the interesting one.

### INTERNAL mode — the workbench forces the pick
The existing drawing workbench gains a **required basis picker per zone**. Draw a box → choose the exemption →
the box is committed. **Axon already works this way** when an agency enables reasons: *"you will be **required**
to select a redacted object and reason before redacting."* We should not be weaker than the tool we are
replacing.

### EXTERNAL mode — capture what the outside tool could not tell us
The city redacts in Axon / Veritone / CaseGuard and **checks the finished file back in.** Three realities, and
the design must survive all three:

| The external tool | What we can get | What we do on check-in |
|---|---|---|
| **Axon** (reasons enabled) | A per-mask **Redacted Object and Reason**. *Whether it survives the CSV export is **UNVERIFIED** — see §6.* | If it exports: **map its reason codes onto our `redaction_rules`** and ingest. If not: the reviewer transcribes them. Either way, structured. |
| **CaseGuard / VIDIZMO** | An exemption log naming a statutory basis | Ingest or transcribe. |
| **Veritone / Genetec / Motorola** | **Nothing. Chain of custody only.** | The reviewer supplies the basis **in our UI, at check-in.** |

**This is the manual re-key that every agency in the country is doing badly, by hand, outside the tool — or not
at all.** We cannot make the external tool emit a basis it does not have. **We can be the place it lands, once,
structured, attested, and attached to the release.** That is not a consolation prize; per the research it is the
part of the workflow nobody owns.

> **Ties to `DESIGN_delegated_av_fulfillment.md`:** Position A (full offload, the external system returns the
> Vaughn data to us) is **dead** — no vendor exposes the metadata to an external system and no DEMS emits a
> completion signal. Reality forces **Position B**, and Position B **only works if the basis is captured on the
> way back in.** This design is what makes Position B legally sound instead of merely convenient.

---

## 4. THE HARD RULE: never imply a basis we do not have

A zone must carry **either** a `ruleId` **or** a `basisNote`. **Never neither.**

And at release, the exemption log must **visibly distinguish**:

- **CITED** — a zone bound to an approved `redaction_rules` entry with a statute. Defensible.
- **UNCITED** — a zone with only free text, or with a basis transcribed from a tool that gave no statute.
  **Surfaced to the reviewer as a gap, and stamped as such on the log.**

**The system must never render an uncited redaction as though it had a legal basis.** A Vaughn index that
*looks* complete and is not is worse than no index at all: it is a document a city will file with a court,
believing it.

This is the same discipline as `second_notice_required` and `overbroad_is_denial_ground` — **an unresearched
legal claim ships OFF and visible, never quietly ON.**

---

## 5. The deliverable: one exemption log per RELEASE, across all media

The point of the whole exercise.

- **One `GET /api/requests/:id/exemption-log`** that walks **document** zones *and* **AV** zones through the
  **same** `redaction_rules` → `legal_sources` join, and renders **one** index.
- Per entry: the record, the location (page number *or* timecode + track), the exemption cited, the statute text,
  who applied it, when, and whether it is **CITED or UNCITED**.
- **Timecode is the video analogue of a page number.** `00:12:40–00:18:55, person 3, face` is the citation
  locator, and it reads exactly like `p. 4, ¶ 2` does on the document side.
- Attaches to the release, and to any denial.

**Nothing in the market produces this.** Not because it is hard — because the document vendors never had video
and the video vendors never had a records officer.

---

## 6. Open, and honest

1. **Does Axon's redaction-reason survive its CSV export?** `[UNVERIFIED — the highest-value unknown here]`
   The live product guide documents the **Redacted Object and Reason** field (and makes it *mandatory* when
   enabled). Axon **marketing** claims the exemption log is *"automatically attached to the redacted file."* But
   the **product guide only ever describes the CSV as object type + start/end times — it never states the reason
   is a column**, and no sample export, screenshot, or agency PRA package containing one could be found anywhere.
   **Do not design ingest against that CSV until someone exports one from a real tenant.** Transcription-on-
   check-in works regardless and is the safe default.
2. **Do the seeded `redaction_rules` cover the AV cases?** The library was built for documents. Body-cam brings
   exemptions documents rarely raise — **bystander privacy, minors, medical distress, undercover officers, the
   interior of a private residence.** The catalog is shared; **its CONTENT may need an AV pass.** That is a
   research task, and per house rules an unresearched exemption ships unseeded.
3. **Mandatory or optional?** Axon makes the reason mandatory *when the agency turns it on*. Proposal: **require
   a basis (rule OR note) always**; require a **CITED** basis only where the jurisdiction's library is seeded and
   attested. This never blocks a city whose library is empty, and never lets one pretend it isn't.
4. **`keep-visible` zones.** The existing workbench has a keep-visible concept. A decision *not* to redact can
   also need a justification. Out of scope here; noted so it is not lost.

---

## 7. Why this is the cheap half

| | This (Vaughn layer) | The detection sidecar (`BRIEF_av_detection_sidecar.md`) |
|---|---|---|
| Hardware | **None.** Existing box. | A GPU. |
| Hard problems | None. A FK, a picker, a report. | Face detection on shaky, low-light, oblique body-cam. Multi-object tracking. |
| What it buys | **The thing no competitor has.** | **Parity.** Axon, Veritone and CaseGuard all already have it. |
| If it fails | It won't. | A weekend. |

**The expensive, interesting half is the commodity. The cheap, boring half is the moat.** They are fully
independent — which is why the sidecar can go to a separate machine and this can wait for the core loop to be
right.

**Parked deliberately. The request loop comes first.**
