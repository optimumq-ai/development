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
