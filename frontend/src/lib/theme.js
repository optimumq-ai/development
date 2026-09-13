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
// DISPLAY THEMES (Kevin, 2026-09-13 — docs/SPEC_display_theme.md). Every colour in the staff app is now a
// CSS variable, generated into src/theme/tokens.css by scripts/theme/build-tokens.js: the standard theme
// resolves each variable to its original hex (pixel-identical), and two high-contrast themes remap them.
// The values below are therefore the SEMANTIC subset (--oq-t-*); the hex each one meant in the standard theme
// is recorded beside it, and stays the source of truth for the standard block in tokens.css. Fills of an
// accent colour use the *Bg twin (blueBg, greenBg, amberBg, critBg) — same hex as the text token in the
// standard theme, but a dark theme needs the fill and the text to go different ways.
export const C = {
  ground: 'var(--oq-t-ground)',           // #D8E0E8
  surface: 'var(--oq-t-surface)',         // #FFFFFF
  surface2: 'var(--oq-t-surface2)',       // #F2F6F9
  field: 'var(--oq-t-field)',             // #EBF3FB
  ink: 'var(--oq-t-ink)',                 // #12232E
  muted: 'var(--oq-t-muted)',             // #5C6F7C
  faint: 'var(--oq-t-faint)',             // #8296A4
  hair: 'var(--oq-t-hair)',               // #D2DCE3
  hairStrong: 'var(--oq-t-hairStrong)',   // #BECAD3
  blue: 'var(--oq-t-blue)',               // #1E6091  (text, lines)
  blueBg: 'var(--oq-t-blueBg)',           // #1E6091  (fills)
  blueTint: 'var(--oq-t-blueTint)',       // #E4EEF6
  blueInk: 'var(--oq-t-blueInk)',         // #0E3A5C
  green: 'var(--oq-t-green)',             // #1B8A5A
  greenBg: 'var(--oq-t-greenBg)',         // #1B8A5A
  greenTint: 'var(--oq-t-greenTint)',     // #E1F2E9
  amber: 'var(--oq-t-amber)',             // #9A6512
  amberBg: 'var(--oq-t-amberBg)',         // #9A6512
  amberTint: 'var(--oq-t-amberTint)',     // #F6EBD6
  crit: 'var(--oq-t-crit)',               // #B02A37
  critBg: 'var(--oq-t-critBg)',           // #B02A37
  critTint: 'var(--oq-t-critTint)',       // #F8E7E8
  mono: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace'
};

// The three display choices offered in the account menu. `key` is the wire value (users.ui_theme and the
// browser's oq_theme); labels and descriptions are the user-facing copy — plain words, no jargon.
export const THEMES = [
  { key: 'standard', label: 'Standard colours', description: 'The regular look.' },
  { key: 'hc-light', label: 'High contrast, light', description: 'Black text and strong borders on white panels.' },
  { key: 'hc-dark', label: 'High contrast, dark', description: 'White text on dark panels; bright status colours.' },
];
export const THEME_STORAGE_KEY = 'oq_theme';
export function isTheme(k) { return THEMES.some(function (t) { return t.key === k; }); }

// Apply a theme to the document. The standard theme is the ABSENCE of the attribute, so a browser that has
// never chosen anything renders exactly as before. Also remembered per browser so the login screen honours it.
export function applyTheme(key) {
  var k = isTheme(key) ? key : 'standard';
  try {
    if (k === 'standard') document.documentElement.removeAttribute('data-oq-theme');
    else document.documentElement.setAttribute('data-oq-theme', k);
    localStorage.setItem(THEME_STORAGE_KEY, k);
  } catch (e) { /* no DOM / storage: nothing to do */ }
  return k;
}
export function currentTheme() {
  try { var k = localStorage.getItem(THEME_STORAGE_KEY); return isTheme(k) ? k : 'standard'; } catch (e) { return 'standard'; }
}

export default C;
