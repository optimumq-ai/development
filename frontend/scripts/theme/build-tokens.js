#!/usr/bin/env node
// THEME TOKEN GENERATOR — emits src/theme/tokens.css from the variables the source actually uses.
//
// Scans src/ for `var(--oq-<role>-<hex>)` (written by codemod.js) and `var(--oq-t-<name>)` (lib/theme.js)
// and writes three blocks:
//   :root                        the STANDARD theme — every value-keyed variable resolves to the hex in its
//                                own name, so nothing on screen moves (verified by pixel diff, 2026-09-13)
//   [data-oq-theme="hc-light"]   high contrast, light  — Kevin's swatch folder, mapping below
//   [data-oq-theme="hc-dark"]    high contrast, dark   — same swatches, inverted grounds
//
// Re-run after adding colours:  node scripts/theme/build-tokens.js     (tests/verify_theme_tokens checks
// that every variable in use is defined here and that no raw colour literal has crept back into staff code).
//
// THE MAPPING is by value AND role (text / fill / line), with one data-driven rule: a pale status tint
// becomes a solid fill only where the text that sits on it goes black (the dark -800 tones); a tint whose
// partner stays coloured (e.g. #FEF2F2 under #DC2626 error text) stays pale, because red-on-red is unreadable.
// Kevin's palette has no light tint of royal and no green or amber that passes 4.5:1 as text on white, so in
// the light theme green/amber TEXT goes black and their FILLS carry the colour. Decisions and ratios:
// docs/SPEC_display_theme.md.
'use strict';
const fs = require('fs'), path = require('path');
const SRC = path.resolve(__dirname, '../../src');
const OUT = path.join(SRC, 'theme', 'tokens.css');
const hints = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'hints.json'), 'utf8'));

// ---- Kevin's swatches (~/exchange/colorsuploaded.zip, 2026-09-13) ----------------------------------------
const K = {
  white: '#ffffff', lightgray: '#b8b8b8', lightslate: '#777777', midslate: '#555555', asphault: '#2a2a2a', black: '#0c0c0c',
  royal: '#3c28bc', violet: '#8d33cc', vday: '#ba1428', red: '#ff0206', yellow: '#ffe02c', green: '#00cc05',
  // unused on purpose: muted white #fcfbfb (indistinguishable from white), carbon #0e0e0e (from nearly black),
  // wasabi #48b547 and dijon #a79424 (fail as text on white; 2.6:1 and 3.0:1)
};

// ---- colour maths -----------------------------------------------------------------------------------------
function rgb(h) { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255); }
function hsl(h) {
  const [r, g, b] = rgb(h); const max = Math.max(r, g, b), min = Math.min(r, g, b); const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min; const s = d / (1 - Math.abs(2 * l - 1));
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; hue = (hue * 60 + 360) % 360;
  return { h: hue, s, l };
}
function lum(h) { const c = rgb(h).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

// family: the hue a colour READS as. Very dark or very desaturated colours are neutral whatever their hue.
function family(h) {
  const { h: hue, s, l } = hsl(h);
  if (l >= 0.985) return 'neutral';
  const tint = l >= 0.85;
  if (s < (l < 0.2 ? 0.5 : tint ? 0.5 : 0.35)) return 'neutral';   // near-blacks read neutral unless clearly hued (#03543F is green)
  if (hue < 20 || hue >= 335) return 'red';
  if (hue < 70) return 'amber';
  if (hue < 170) return 'green';
  if (hue < 260) return 'blue';        // teal and cyan read as blue here
  return 'purple';                     // indigo, violet, magenta, pink
}
const isTint = h => hsl(h).l >= 0.85;
const isWhite = h => hsl(h).l >= 0.9 && hsl(h).s < 0.5;

// dominant text partner of a fill, from the codemod's same-line pairs
const partnerOf = {};
for (const k in hints.pairs) { const [bg, fg] = k.split('>'); if (!partnerOf[bg] || hints.pairs[k] > partnerOf[bg].n) partnerOf[bg] = { fg: '#' + fg, n: hints.pairs[k] }; }
const partner = h => partnerOf[h.replace('#', '')];
// a pale chip like #E1F2E9 is too desaturated to read as green by its own numbers, but the text on it is
// green (#1B8A5A): the partner names the family
function fillFamily(h) {
  const f = family(h); if (!isTint(h) || f !== 'neutral') return f;
  const p = partner(h); const pf = p ? family(p.fg) : 'neutral';
  return (pf === 'red' || pf === 'green' || pf === 'amber') ? pf : f;
}

// ---- LIGHT --------------------------------------------------------------------------------------------------
const L = {
  fg(h) {
    const f = family(h), { l } = hsl(h);
    if (isWhite(h)) return K.white;
    if (f === 'neutral') return l < 0.68 ? K.black : K.midslate;   // hierarchy comes from weight and size; 3.8:1 muted-on-gray was the alternative
    if (f === 'blue') return K.royal;
    if (f === 'purple') return K.violet;
    if (f === 'red') return l < 0.40 ? K.black : K.vday;           // -800 tones sit on tints that become solid red
    return K.black;                    // amber, green: no swatch passes 4.5:1 on white
  },
  bg(h) {
    const f = fillFamily(h), { l } = hsl(h);
    if (l >= 0.985) return K.white;
    if (isTint(h)) {
      if (f === 'neutral') return K.lightgray;
      if (f === 'red' || f === 'amber' || f === 'green') {
        const p = partner(h); const saturate = !p || L.fg(p.fg) === K.black;
        return saturate ? ({ red: K.red, amber: K.yellow, green: K.green })[f] : K.white;
      }
      return K.white;                  // blue / purple tints: fields, info chips
    }
    if (f === 'neutral') return l < 0.3 ? K.black : K.midslate;
    return ({ blue: K.royal, purple: K.violet, red: K.vday, amber: K.yellow, green: K.green })[f];
  },
  ln(h) {
    const f = family(h);
    if (isWhite(h) && hsl(h).l >= 0.985) return K.white;
    if (f === 'neutral' || isTint(h)) return K.black;
    return ({ blue: K.royal, purple: K.violet, red: K.vday, amber: K.black, green: K.black })[f];
  },
};
// ---- DARK ---------------------------------------------------------------------------------------------------
const D = {
  fg(h) {
    const f = family(h), { l } = hsl(h);
    if (isWhite(h)) return K.white;
    if (f === 'neutral') return l < 0.38 ? K.white : l < 0.68 ? K.lightgray : K.lightslate;
    if (f === 'blue' || f === 'purple') return K.white;   // royal 2.1:1 and violet 2.4:1 fail as text on asphault
    return ({ red: K.red, amber: K.yellow, green: K.green })[f];
  },
  bg(h) {
    const f = fillFamily(h), { l } = hsl(h);
    if (l >= 0.985) return K.asphault;
    if (isTint(h)) return K.black;     // ground, boxes, chips, selected rows, fields: all nearly black on asphault panels (muted text stays legible)
    if (f === 'neutral') return l < 0.3 ? K.midslate : K.lightslate;
    return ({ blue: K.violet, purple: K.violet, red: K.red, amber: K.yellow, green: K.green })[f];
  },
  ln(h) {
    const f = family(h);
    if (isWhite(h) && hsl(h).l >= 0.985) return K.white;
    if (f === 'neutral' || isTint(h)) return K.lightslate;
    return ({ blue: K.violet, purple: K.violet, red: K.red, amber: K.yellow, green: K.green })[f];
  },
};

// ---- semantic tokens (lib/theme.js C.*) --------------------------------------------------------------------
const T = {
  //            standard    light          dark
  ground:     ['#D8E0E8', K.lightgray,   K.black],
  surface:    ['#FFFFFF', K.white,       K.asphault],
  surface2:   ['#F2F6F9', K.lightgray,   K.midslate],
  field:      ['#EBF3FB', K.white,       K.black],
  ink:        ['#12232E', K.black,       K.white],
  muted:      ['#5C6F7C', K.black,       K.lightgray],   // light: same rule as the value map — neutral text below l .68 goes black
  faint:      ['#8296A4', K.black,       K.lightgray],
  hair:       ['#D2DCE3', K.black,       K.lightslate],
  hairStrong: ['#BECAD3', K.black,       K.lightslate],
  blue:       ['#1E6091', K.royal,       K.white],      // as text and lines
  blueBg:     ['#1E6091', K.royal,       K.violet],     // as a fill (white text on it)
  blueTint:   ['#E4EEF6', K.white,       K.midslate],
  blueInk:    ['#0E3A5C', K.royal,       K.white],
  green:      ['#1B8A5A', K.black,       K.green],
  greenBg:    ['#1B8A5A', K.green,       K.green],
  greenTint:  ['#E1F2E9', K.green,       K.black],
  amber:      ['#9A6512', K.black,       K.yellow],
  amberBg:    ['#9A6512', K.yellow,      K.yellow],
  amberTint:  ['#F6EBD6', K.yellow,      K.black],
  crit:       ['#B02A37', K.vday,        K.red],
  critBg:     ['#B02A37', K.vday,        K.red],
  critTint:   ['#F8E7E8', K.white,       K.black],      // partner is crit (stays coloured) → pale
};

// ---- collect what the source uses ---------------------------------------------------------------------------
const used = new Set(); const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx|ts|tsx|css)$/.test(f) && !p.endsWith('tokens.css')) files.push(p); } })(SRC);
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/var\(--oq-(fg|bg|ln|x|t)-([0-9a-f]{6}|[A-Za-z0-9]+)\)/g)) used.add(m[1] + '-' + m[2]);
const values = new Set(); for (const u of used) { const [r, v] = u.split('-'); if (r !== 't') values.add(v); }

function dominantRole(v) { const c = hints.values[v] || {}; const cand = ['bg', 'fg', 'ln'].filter(r => c[r]); if (!cand.length) return isTint('#' + v) ? 'bg' : 'fg'; return cand.sort((a, b) => c[b] - c[a])[0]; }

const lines = ['/* GENERATED by scripts/theme/build-tokens.js — do not edit by hand. */', ''];
function block(sel, pick, tpick, extra) {
  lines.push(sel + ' {');
  (extra || []).forEach(function (d) { lines.push('  ' + d + ';'); });
  for (const name of Object.keys(T)) lines.push('  --oq-t-' + name + ': ' + tpick(T[name]) + ';');
  for (const v of [...values].sort()) {
    const h = '#' + v;
    for (const r of ['fg', 'bg', 'ln']) if (used.has(r + '-' + v) || (used.has('x-' + v) && dominantRole(v) === r)) lines.push('  --oq-' + r + '-' + v + ': ' + pick(r, h) + ';');
    if (used.has('x-' + v)) lines.push('  --oq-x-' + v + ': var(--oq-' + dominantRole(v) + '-' + v + ');');
  }
  lines.push('}', '');
}
block(':root', (r, h) => h.toUpperCase(), t => t[0]);
// Text with no colour of its own inherits from <html>: black in the standard theme (nothing sets it), so the
// two themes set it here — the dark theme's page headings were black on black without this. color-scheme
// tells the browser to draw native controls (selects, scrollbars, date pickers) for a dark page.
block('[data-oq-theme="hc-light"]', (r, h) => L[r](h), t => t[1], ['color: ' + K.black, 'color-scheme: light']);
block('[data-oq-theme="hc-dark"]', (r, h) => D[r](h), t => t[2], ['color: ' + K.white, 'color-scheme: dark']);
// The two themes also thicken hairlines? No — widths live in the components; the mapping is colour only.
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, lines.join('\n'));

// ---- review table: what each value became, and the worst text-on-fill ratios the pairs imply ---------------
const missingT = [...used].filter(u => u.startsWith('t-') && !T[u.slice(2)]);
if (missingT.length) { console.error('UNDEFINED semantic tokens: ' + missingT.join(', ')); process.exit(1); }
const rows = [...values].sort((a, b) => (sum(hints.values[b]) - sum(hints.values[a]))).map(v => { const h = '#' + v; return [h, sum(hints.values[v]), family(h), L.fg(h), L.bg(h), L.ln(h), D.fg(h), D.bg(h), D.ln(h)].join('\t'); });
function sum(o) { return Object.values(o || {}).reduce((a, b) => a + b, 0); }
fs.writeFileSync(path.join(__dirname, 'out', 'mapping.tsv'), 'value\tuses\tfamily\tL.fg\tL.bg\tL.ln\tD.fg\tD.bg\tD.ln\n' + rows.join('\n'));
const weak = [];
for (const k in hints.pairs) { const [bg, fg] = k.split('>'); for (const [nm, th] of [['light', L], ['dark', D]]) { const c = contrast(th.bg('#' + bg), th.fg('#' + fg)); if (c < 4.5) weak.push({ theme: nm, bg, fg, n: hints.pairs[k], to: th.bg('#' + bg) + ' / ' + th.fg('#' + fg), c: c.toFixed(1) }); } }
weak.sort((a, b) => b.n - a.n);
fs.writeFileSync(path.join(__dirname, 'out', 'weak-pairs.json'), JSON.stringify(weak, null, 1));
console.log('tokens.css: ' + values.size + ' values, ' + used.size + ' variables in use, ' + lines.length + ' lines; weak text-on-fill pairs (<4.5:1): light ' + weak.filter(w => w.theme === 'light').length + ', dark ' + weak.filter(w => w.theme === 'dark').length + ' → scripts/theme/out/weak-pairs.json');
