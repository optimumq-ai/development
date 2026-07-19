// THE v2 STAFF-SCREEN TOKEN SET — SPEC_record_search_task_screen.md §9 (Kevin's mark-up, 2026-07-14).
//
// Gray ground, lighter gray boxes, white fields, #1E6091 as the one button colour:
//   --bg         #D8E0E8   "the shade of gray in the background"
//   --surface-2  #F2F6F9   "the lighter shade of gray in boxes"
//   --surface    #FFFFFF   "entry fields or data display fields as white"
//   --blue       #1E6091   "a little stronger and more blue" — the default for ALL buttons
//
// WHY THIS FILE EXISTS: these tokens were defined PRIVATELY inside RecordSearchTaskPage.js, so a second v2
// staff screen had no way to obey §9 except by copying them. That is the divergent-private-copy defect
// `verify_stages` was widened to catch on 2026-07-19 (`498bc4a`), when WorkflowPage.js turned out to carry
// its own 4-stage label map. A palette drifts exactly the way a vocabulary does, and it drifts SILENTLY:
// nothing fails, the screens just stop matching each other. Extracting it changes no rendered pixel.
//
// ⚠️ THIS IS NOT A PROMOTION OF THE PALETTE. §9 carries an explicit scope decision (Kevin, 2026-07-14):
// "the record-search MOCKUP only" — the redaction workstation keeps its darker token set, and the two staff
// screens are expected to visibly diverge UNTIL THE COLOUR IS SETTLED, because the point was to judge the
// colour on a real screen before promoting it system-wide. Moving the tokens into lib/ makes them
// importable; it does not decide who may import them. A NEW screen adopting this palette is still Kevin's
// call, not a consequence of this refactor.
//
// ⚠️ PROVENANCE — THIS IS A TRANSCRIPTION, NOT THE SOURCE. The tokens originate as CSS custom properties in
// PublicPortalV2Page.js (`.scv`), which is the fuller set: it is DARK-MODE AWARE
// (`@media (prefers-color-scheme:dark)`) and also defines --blue-strong, --shadow, --radius, --font-ui,
// --font-mono, --field-border and --chat-ground. What follows is the light-mode JS subset that
// RecordSearchTaskPage actually consumed, moved verbatim. The two are NOT unified and can still drift —
// unifying them means deciding whether staff screens get dark mode, which is a design decision, not a
// refactor. Recorded here so the next person finds the divergence instead of discovering it.
export const C = {
  ground: '#D8E0E8', surface: '#FFFFFF', surface2: '#F2F6F9', field: '#EBF3FB',
  ink: '#12232E', muted: '#5C6F7C', faint: '#8296A4',
  hair: '#D2DCE3', hairStrong: '#BECAD3',
  blue: '#1E6091', blueTint: '#E4EEF6', blueInk: '#0E3A5C',
  green: '#1B8A5A', greenTint: '#E1F2E9',
  amber: '#9A6512', amberTint: '#F6EBD6',
  crit: '#B02A37', critTint: '#F8E7E8',
  mono: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace'
};

export default C;
