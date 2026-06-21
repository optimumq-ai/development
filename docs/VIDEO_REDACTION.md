# Video & Audio Redaction - Assessment & Integration Plan
(captured 2026-06-17, from Kevin's earlier standalone build, pre-Optimum-Q)

## What exists (two browser-only HTML workbenches; annotation/review layer, no server)
- redaction_synthetic.html: self-contained DEMO. Synthetic animated body-cam scene (officers,
  civilians, vehicles with readable plates) on HTML5 Canvas + simulated audio waveform. Draw boxes
  (face/plate/manual; black/pixelate/mosaic), simulated auto-detect, audio region redaction
  (silence/tone/noise), review mode, timelines, stats, JSON export. NO video file needed -> sales demo.
- redaction_realvideo.html: same UI, accepts a real dropped video. REAL face detection via
  @vladmandic/face-api TinyFaceDetector (CDN). Real waveform via Web Audio API. Current-frame only.

Export JSON: videoRedactions[{x,y,w,h,type,style,label,startTime,endTime,detected}] in native pixels;
audioRedactions[{startTime,endTime,style}]; fps/totalFrames/duration. Meant to feed server-side ffmpeg.

## Fit (strong - mirrors document redaction): annotate -> review -> server BURN -> store output, keep
original. Video is another media type. JSON ~ zones; ffmpeg ~ redactionApply.js; review ~ RedactionReviewPage.

## Gaps / hard parts
1. FFMPEG BURN NOT BUILT (the part that makes the actual redacted file). ffmpeg not installed on droplet.
   Burn = JSON -> filter chain (drawbox per box enable='between(t,a,b)'; pixelate/mosaic via crop+scale
   or boxblur; audio volume=0 / tone / anoise per range).
2. DETECTION ACCURACY on real body-cam is the hard problem (shaky/low-light/oblique -> misses + false
   positives). Human frame review mandatory + built in. Production body-cam redaction is feasible but
   LABOR-HEAVY on long clips; synthetic demo is flawless.
3. Single-frame detection only -> need detect-all-frames (interval sampling) + ideally tracking. Real
   plate detection not built.
4. No DB persistence / portal embedding / workflow trigger yet.
5. Compute/scale: heavy; long clips need a durable job queue (reuse mass-redaction queue) + storage.
6. Audio redaction is manual; auto (transcribe -> find PII -> bleep) is future.

## Recommended sequence
Phase 1 (fast, high demo value): install ffmpeg; build JSON->ffmpeg burn service; embed the SYNTHETIC
  workbench as a staff-portal video-redaction panel; demo end-to-end (annotate -> burn -> redacted mp4).
Phase 2: real-video workbench + DB persistence against a redaction job (reuse redaction-jobs subsystem);
  store redacted output + preserve original; trigger from fulfillment when a record type needs redaction.
Phase 3: detect-all-frames + tracking; rules-driven pre-population (exemption library/record type);
  durable processing queue; later auto-audio via transcription.

## Notes
- CDN dep @vladmandic/face-api@1.7.13 (self-host for air-gapped/on-prem).
- HTML files not yet code-reviewed or in repo; review + commit before integrating. Assessed from
  SUMMARY.md + PROMPT_FOR_OPUS.md.

## Internal vs External redaction MODE (admin toggle) - added 2026-06-17 per Kevin
Admin setting selects how a jurisdiction handles VIDEO/AUDIO redaction (documents stay internal):
- INTERNAL: Optimum Q built-in workbench + server-side ffmpeg burn (Phases above).
- EXTERNAL: city uses its own third-party AV redaction tool. For now (no connector) = manual
  pause/check-in: (1) request PAUSES at the AV-redaction step (held); (2) staff downloads the
  original; (3) redaction happens offline in the city's tool; (4) staff CHECKS IN the redacted file;
  OQ stores it as the redacted output, keeps the original, records who/when + "external" provenance,
  and the workflow RESUMES.
Granularity: a config setting; system-level to start, can move to per-jurisdiction profile later.
Defensibility: external mode trusts the city's tool - include a reviewer attestation on check-in for
  chain of custody. Original always preserved.
Future: a real connector (push original out, poll, pull redacted file back) rides the connector
  pattern - deferred.
Build note: external pause+check-in is the first concrete piece of workflow hold/resume; build
  self-contained now (like the review screen), wire into routing/My-Tasks during the routing phase.

## "Release as-is" safety model + team-level AV mode (added 2026-06-17 per Kevin)
Core rule: a taxonomy "no redaction required" flag is a TYPE-LEVEL PRESUMPTION, not an INSTANCE-LEVEL
guarantee. The specific file can always differ (a bystander, a minor, a screen showing PII, a spoken
account number). The flag sets the default path and lowers effort; it NEVER authorizes silent
auto-release. The only true bypass of human eyes is content already vetted and sitting in the PUBLIC
REPOSITORY (vetting already happened there). Distinguish "no redaction required" from "no review
required" - presumed-releasable still gets a fast, INFORMED human confirmation.

How the reviewer knows, without leaving the system:
1. Taxonomy carries presumption + WHAT-TO-WATCH-FOR: the record type points at the exemptions that
   could apply (Exemption Reference Library), so even a "usually public" type says "check for
   bystanders / displayed documents / minors."
2. Advisory CONTENT SCAN of the specific file: the same face/object detection that powers redaction,
   run non-committally, reports what is actually present ("4 faces, a screen-share segment, speech")
   - an in-system heads-up before deciding.
3. In-system preview + a CONFIRMATION / ATTESTATION recorded before release.

Maturity gradient: early on the per-request confirmation IS the vetting; each confirmed release can be
promoted into the public repository, so the next request for it is instant and never re-reviewed.
Safety does not depend on maturity; effort drops as vetted content accumulates.

Team-level AV redaction MODE (refines the earlier system/jurisdiction toggle): redaction
responsibility/tooling is fragmented by department (PD bodycam -> external tool like Axon/Veritone;
IT/Facilities security video -> varies; Clerk meeting video -> usually released as-is under
open-meetings law). So AV redaction mode is set per RESPONSIBLE TEAM, as a jurisdiction DEFAULT with
team OVERRIDE. Values: internal | external | not_required. "not_required" = the presumptively-
releasable path above (still confirmed), never a silent skip.

Market note (domain knowledge; verify when search available): commercial video redaction tools are
overwhelmingly law-enforcement products (Axon Redaction Assistant, Veritone Redact, CaseGuard,
Motorola/WatchGuard, Genetec). Non-police video (security/CCTV, meeting recordings) is handled ad hoc
- IT/Facilities/Clerk, often manual or via the system/streaming vendor, often already public or
withheld under security exemptions.

---

## Phase 1 progress (build log)

- ffmpeg/ffprobe installed on droplet (apt, v4.4.2). This was THE missing piece.
- Built `backend/src/services/avRedactionApply.js` - server-side "burn":
  - `apply({inputPath, outputPath, zones})` -> re-encodes a redacted copy (h264/aac, +faststart).
  - Video zones: `black` => `drawbox` solid fill (gold-standard, irreversible); `blur` => crop+boxblur+overlay; `pixelate`/`mosaic` => crop+neighbor-scale down/up+overlay. Any unknown style FAILS SAFE to solid black.
  - All zones time-gated via `enable='between(t,start,end)'`.
  - Audio zones: silence via `volume=0` gated to the window (tone/noise map to silence for now - content is removed either way).
  - Coordinate scaling: zones drawn in refWidth/refHeight are scaled to the actual probed video resolution.
  - Reusable as a library (require) and as a CLI (node avRedactionApply.js in out zones.json).
- VERIFIED end-to-end on a generated clip: valid output; black-box region = pure black (000000) inside its time window, normal color (non-black) outside it, control region untouched; pixelate overlay + audio-silence ran clean.

### Remaining Phase 1
- Pull the two standalone HTML workbench files into the repo + code-review (needs access to the uploaded files; not reachable from the droplet over SSH).
- Port the synthetic workbench into the app as a staff screen (draw/adjust zones -> export zone JSON).
- Backend "internal redaction" endpoint: given a request's A/V file + zone JSON, run the burn, store output as a redacted request_files row, preserve original, record provenance (parallels the external check-in flow).
- Later (Phase 2/3): real-video detection, DB persistence of zones, job queue for heavy compute, detect-all-frames + tracking.

---

## STATUS (2026-06-20): Phase 1 COMPLETE - parked by Kevin

In use now: server-side ffmpeg burn (avRedactionApply.js, black/pixel/mosaic + audio silence, time-gated, native-px coords); INTERNAL mode (workbench draws boxes -> apply-internal burns -> redacted copy stored, original preserved, zones + attestation recorded); EXTERNAL mode (send-out hold -> check-in attested redacted copy); NOT-REQUIRED release-as-is attestation gate; mode-aware AvRedactionPanel; "Redaction for Audio/Video" tab shown only when A/V is involved (av_applicable via EXISTS); in-app drawing workbench (manual boxes + browser face auto-detect via face-api TinyFaceDetector, per-appearance tracking by re-detection, keep-visible exemption, finer sampling/overlapping box-hold); 1GB upload cap; inline upload in the tab.

Decision: leave as-is for now; revisit later to improve function + interface.

Deferred (revisit with a paying customer / GPU): GPU Python detection sidecar (YOLO-face + RetinaFace + WBF + ByteTrack), license-plate detection, smoother tracking/interpolation, guided play-pause-verify review, audio waveform UI, background job queue for long clips, cloud-API detection option. DO GPU pricing reviewed: low-tier cards ~$0.45-0.82/hr; bursty (destroy when idle) ~$10-15/mo; "stop" does NOT halt GPU billing per DO agent (verify) - must destroy.
