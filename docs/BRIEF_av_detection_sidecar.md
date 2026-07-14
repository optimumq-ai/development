# BRIEF — GPU Detection Sidecar for Video/Audio Redaction

**Audience:** a *separate* project, on a separate machine, with no access to the OptimumQ codebase.
**Written:** 2026-07-14. **Status:** brief for an isolated build. **Risk posture:** bounded experiment — if it
fails, nothing in the main product breaks, because the sidecar is optional by construction.

> **Read §1 before anything else.** The single most common way this project fails is by building the wrong half.

---

## 0. TL;DR

Build a **stateless GPU service** that takes a video file and returns a **JSON list of redaction zones**
(boxes with time ranges). It does **not** redact anything, does **not** talk to a database, and does **not**
have a UI. A separate, already-working system burns the pixels and stores the file.

**Input:** a video file. **Output:** this exact JSON. That is the entire contract.

---

## 1. THE MOST IMPORTANT THING: what this is NOT

This sidecar is **not the product differentiator**, and it must not be scoped as if it were.

- The **burn** (turning boxes into a redacted MP4) is **already built and verified** in the parent system —
  ffmpeg `drawbox` / crop+boxblur / mosaic, time-gated per zone, audio silencing, fails safe to solid black on
  any unrecognized style. **Do not rebuild it. Do not touch it.**
- The **workbench UI** (draw boxes, scrub, review) is **already built.**
- The **legal/exemption layer** — recording *why* each redaction was applied — is being built **separately, in
  the parent system, without a GPU.** It is the actual competitive moat (see §7). **It is not this project's job.**

**What is missing, and all this project must deliver:** *good automatic detection of the things that need
redacting, with stable identity across frames.* Everything else already exists.

**Detection is commodity.** Axon, Veritone, and CaseGuard all have it. Building it well buys **parity**, not
advantage. Scope it accordingly: this is plumbing, and plumbing should be boring.

---

## 2. The contract (this is the whole interface)

The parent system's burn service consumes exactly this shape today:

```jsonc
{
  "videoRedactions": [
    {
      "x": 412, "y": 188, "w": 96, "h": 96,      // pixels, in the coordinate space of refWidth/refHeight
      "style": "black",                           // "black" | "blur" | "pixelate" | "mosaic"
      "startTime": 12.40,                         // seconds, float
      "endTime": 18.95
    }
  ],
  "audioRedactions": [
    { "startTime": 30.1, "endTime": 33.8, "style": "silence" }   // "silence" | "tone" | "noise"
  ],
  "refWidth": 1920,                               // the resolution the boxes were computed against;
  "refHeight": 1080                               // the burn service rescales to the real video if they differ
}
```

**Extended fields this project SHOULD emit** (additive — the burn service ignores what it doesn't know, and the
parent system will consume them):

```jsonc
{
  "trackId": "person-3",        // STABLE across frames. See §4 — this is the hard part and the valuable part.
  "class": "face",              // "face" | "license_plate" | "screen" | "document" | "tattoo" | "child"
  "confidence": 0.91,
  "frames": [                   // OPTIONAL but strongly preferred: per-keyframe boxes for smooth interpolation
    { "t": 12.40, "x": 412, "y": 188, "w": 96, "h": 96 },
    { "t": 12.90, "x": 430, "y": 191, "w": 98, "h": 97 }
  ]
}
```

> **`trackId` is the highest-value field in this document.** A human reviewer does not want 1,400 unrelated
> boxes; they want **"person 3"** — one identity they can accept, reject, or re-classify **once**, across the
> whole clip. Detection without tracking multiplies the human's work instead of dividing it. **A tracker that
> is merely good beats a detector that is excellent.**

**Style defaulting:** emit `"black"` unless told otherwise. Solid black is the irreversible, gold-standard
redaction. Blur and pixelation are reversible-ish and are a policy choice the *agency* makes, not the detector.

---

## 3. What to detect, in priority order

Priority is driven by what actually gets redacted out of US police video under public-records law:

1. **Faces** — by far the most common. Must work on **body-worn camera** footage, which means:
   **motion blur, extreme low light, oblique/profile angles, partial occlusion, fisheye distortion, subjects at
   3 feet and at 90 feet in the same frame.** This is a *much* harder distribution than the frontal, well-lit
   faces most face detectors are benchmarked on. **Assume every off-the-shelf benchmark number is a lie for
   this domain.**
2. **License plates** — second most common, and often legally mandatory.
3. **Screens / monitors / paperwork held to camera** — MDT screens, driver's licenses, documents. High legal
   risk (they leak PII in bulk), and commonly missed.
4. **Audio** — voices, names, addresses spoken aloud, radio traffic. *(Stretch: transcribe → find PII → emit
   audio ranges. Do not attempt until video is solid.)*

**Explicitly NOT in scope:** deciding *whether* something should be redacted. That is a legal judgment made by a
human in the parent system. **This service proposes; a person disposes.**

---

## 4. The actual hard problem (and why the GPU is here)

**Detection is not the hard part. Identity across time is.**

A per-frame detector on a 43-minute body-cam clip at 30fps runs ~77,000 frames and emits a chaotic cloud of
boxes that flicker, drop out behind occlusion, and re-appear as "new" people. That output is **worse than
useless** to a reviewer — it is *more* work than drawing boxes by hand, which is what the parent system's
manual workbench already does.

**The pipeline that works:**

1. **Sample** frames (do not run every frame — 5–10 fps is usually plenty; interpolate between).
2. **Detect** — an ensemble beats any single model. Suggested, from the parent project's own earlier notes:
   **YOLO-face + RetinaFace**, fused with **Weighted Box Fusion (WBF)**. Add a plate detector.
3. **Track** — **ByteTrack** (or similar) to assign a stable `trackId` through occlusion and re-appearance.
4. **Interpolate + dilate** — fill gaps between keyframes, and **grow every box by a margin**. See below.
5. **Emit** merged time ranges per `trackId`.

### The asymmetry that must govern every threshold

> **A false positive costs a reviewer two seconds. A false negative is an unrecallable privacy breach that can
> end a records officer's career and expose the city to liability.**

Therefore, everywhere you would normally tune for F1 or mAP:

- **Bias hard toward recall.** Over-detect. Let the human delete.
- **Dilate every box** (10–20% margin). A box that clips the edge of a face has *failed*.
- **Hold a box through a detection gap** rather than dropping it — if a track disappears for 300ms behind a car
  door and comes back, **keep it redacted through the gap.**
- **Never silently drop a low-confidence detection.** Emit it with its confidence and let the reviewer decide.

**The correct failure mode is an annoyed reviewer, never a leaked face.**

---

## 5. Deliverable

A service (HTTP or CLI, your choice — HTTP is easier to wire) that:

```
POST /detect   { "videoPath": "...", "classes": ["face","license_plate"], "sampleFps": 6 }
  -> 202 { "jobId": "..." }
GET  /jobs/:id -> { "status": "queued|running|done|failed", "progress": 0.42, "result": { ...zones JSON... } }
```

**Must be a job queue, not a synchronous call.** A 43-minute clip is minutes of GPU work; ~9 videos per incident
is normal. A synchronous API will time out and it will be rewritten. Build it async from hour one.

**Non-functional:**
- **Runs fully offline / air-gapped.** The parent product is sold **on-premise to cities**. A cloud API call is
  a **non-starter** — it would ship criminal-justice video to a third party. **No model may phone home. Weights
  must be vendored locally.**
- Dockerized, single `docker compose up`.
- Log progress. A 20-minute silent job is indistinguishable from a hung one.

---

## 6. Acceptance criteria — how we'll know it's real

Do not accept synthetic-footage results. The parent project's own notes record the trap plainly:
*"synthetic demo is flawless"* while real body-cam is the hard case.

- [ ] Runs on a **real, publicly-released body-worn-camera clip** (they are widely available — use actual
      released PRA footage), **not** a stock video of people walking in daylight.
- [ ] **Recall on faces ≥ 98%** measured against a **hand-labeled** ground truth. *A miss is the failure mode
      that matters; precision can be mediocre and the tool is still a win.*
- [ ] **Stable `trackId`** — one person walking through occlusion and back into frame is **one** track, not four.
- [ ] Emits JSON that the existing burn service consumes **with zero changes to that service.** This is the
      contract test, and it is the only integration that matters.
- [ ] Handles a **40+ minute** clip without OOM.
- [ ] **Degrades honestly:** on failure it returns an error, never an empty zone list. **An empty result must
      never be indistinguishable from "nothing to redact"** — that is a silent, catastrophic failure mode.

---

## 7. Context: why this is worth doing at all (and what NOT to expect from it)

Research (2026-07-14, ~50 primary sources) into how US cities actually handle body-cam public-records requests:

- **No open-records platform on the market has a video viewer or clipper.** Not GovQA, NextRequest, JustFOIA,
  FOIAXpress, Laserfiche, GovPilot, or Accela.
- Redaction burden is the bottleneck: **~10 minutes of staff time per 1 minute of footage, *per redacted
  subject*** (Seattle PD and Thurston County, independently stopwatch-verified). **~9 videos per incident.**
  Phoenix PD has **~40,000 pending records requests**; one requester was quoted a **six-year** wait.
- **Up to 40% of dispatches that should have body-cam video have none** (San Diego City Auditor). So
  *"no responsive video"* is a **normal** outcome, not a failure — the system must be able to *prove* a diligent
  search, not merely assert one.

**So the detection sidecar attacks a real and expensive bottleneck.** Good.

**But be clear-eyed about what it does NOT do:**

- It does **not** differentiate the product. Axon's *Redaction Assistant* already does in-DEMS auto-redaction and
  is **explicitly marketed against** routing video through a FOIA platform. If a city has it, they will use it.
- **The differentiator is the legal layer, not the pixels.** Research finding, and it is stark: **every video
  redaction tool in the market records *who* redacted and *when* — and almost none record *why*.** Veritone's own
  documentation tells users *"you must manually apply redaction codes to multimedia."* GovQA **enforces**
  exemption citation on documents and **abandons it on video.** Meanwhile Washington's **WAC 44-14-04004**
  requires an agency to *"identify the redaction and state the basis for the claimed exemption"* — **with no
  video carve-out.**
- **The parent system's own zones have the same hole today** — `{x, y, w, h, style, startTime, endTime}`, with
  **no exemption field.** Closing that is a **cheap, no-GPU change to the existing workbench**, and it is where
  the actual advantage is.

> **Sequencing advice, stated plainly:** the **exemption/Vaughn layer is the moat and costs almost nothing.**
> This GPU sidecar is the **commodity** and costs real effort. **Do not let the expensive, fun, commodity half
> crowd out the cheap, boring, valuable half.** They are independent — which is precisely why this sidecar is
> safe to hand to a separate project on a separate machine.
