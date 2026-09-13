#!/usr/bin/env node
// THEME CODEMOD — routes every hard-coded colour literal in the STAFF frontend through a CSS variable.
//
//   '#1F4E79' in a `color:`     →  'var(--oq-fg-1f4e79)'
//   '#1F4E79' in a `background:`→  'var(--oq-bg-1f4e79)'
//   '#E5E7EB' in a `border:`    →  'var(--oq-ln-e5e7eb)'
//   '#DC2626' in a hue-named or positional slot (role unknowable here) → 'var(--oq-x-dc2626)'
//
// The variable NAME carries the value AND the role, so the standard theme is pixel-identical (every
// variable resolves to the hex in its own name — see build-tokens.js) and a high-contrast theme can map
// the same hex differently as text, as a fill and as a line. That role split is what makes a value-keyed
// scheme work: 'white' as a button's text must stay white on a dark theme while 'white' as a card must not.
//
// Why a codemod and not hand edits: 4,000 literals across 85 files (the private-copy palette drift that
// lib/theme.js documents). Run once, kept for the record; build-tokens.js is the piece that runs again.
//
// Usage:  node scripts/theme/codemod.js [--apply]      (default is a dry run that prints the report)
'use strict';
const fs = require('fs'), path = require('path');
const SRC = path.resolve(__dirname, '../../src');
const APPLY = process.argv.includes('--apply');

// Citizen-facing surfaces keep their own design (and their own dark mode); the staff theme never reaches them.
const EXCLUDE = [
  /^pages\/Public/, /^pages\/PaperFormPage\.js$/, /^pages\/ContributePage\.js$/, /^pages\/MagicPage\.js$/,
  /^components\/StatusCheckModal\.js$/, /^components\/VerifyRecordModal\.js$/,
  /^lib\/theme\.js$/,            // the shared token set is rewritten by hand (semantic --oq-t-* names)
  /^index\.css$/,                // Tailwind layer file, edited by hand
  /^theme\//,                    // generated output
];

const FG = /^(color|fill|stroke|caretColor|textDecorationColor|WebkitTextFillColor|stopColor|tc|fg|c|ink|text|tone|mute|muted|faint|dim|ph|statute|thead-ink)$|Ink$|Fg$/;
const BG = /^(background|backgroundColor|backgroundImage|accentColor|bg|b|wash|ground|surface|surface2|field|card|panel|page|thead|statuteBg|accentSoft|goodSoft|warnSoft|critSoft)$|Bg$|Soft$|Tint$|-bg$|-tint$/;
const LN = /^(border\w*|outline\w*|boxShadow|textShadow|bd|line|edge|hair|hairStrong|border|shadow)$|Line$|-line$/;
function roleOf(key) { if (!key) return null; if (FG.test(key)) return 'fg'; if (BG.test(key)) return 'bg'; if (LN.test(key)) return 'ln'; return 'x'; }

// Helpers that take colours POSITIONALLY. Verified against each signature.
const POSITIONAL = {
  'components/MassJobsPanel.js': { btn: ['bg', 'fg', 'ln'] },
  'components/SourcesConfig.js': { badge: ['bg', 'fg'] },
  'components/ui/FeeEstimatePanel.js': { box: ['bg', 'ln', 'fg'] },
  'components/ui/FeeWaiverDecisionPanel.js': { btn: ['fg', 'bg'] },
  'pages/AgentRulesPage.js': { small: ['bg', 'fg'] },
  'pages/OrgPage.js': { chip: ['bg', 'fg'] },
  'pages/UserTypesPage.js': { chip: [null, 'bg', 'fg'] },
  'pages/TaxonomyPage.js': { pill: ['bg', 'fg'] },
};

const LIT = /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?![0-9A-Fa-f])|(['"])(white|black)\1/g;
const hex6 = (v) => { v = v.replace(/['"]/g, '').toLowerCase(); if (v === 'white') return 'ffffff'; if (v === 'black') return '000000'; v = v.slice(1); return v.length === 3 ? v.split('').map(c => c + c).join('') : v; };

function positionalRole(file, before) {
  const map = POSITIONAL[file]; if (!map) return null;
  // find the innermost unclosed call `name(` before the literal and count depth-0 commas since it
  let depth = 0, callStart = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === ')' || ch === ']' || ch === '}') depth++;
    else if (ch === '(' || ch === '[' || ch === '{') { if (depth === 0) { callStart = i; break; } depth--; }
  }
  if (callStart < 0 || before[callStart] !== '(') return null;
  const nm = /(\w+)\s*$/.exec(before.slice(0, callStart)); if (!nm || !map[nm[1]]) return null;
  let commas = 0; depth = 0;
  for (let i = callStart + 1; i < before.length; i++) { const ch = before[i]; if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--; else if (ch === ',' && depth === 0) commas++; }
  return map[nm[1]][commas] || null;
}

function classify(file, line, idx, lit) {
  const trimmed = line.trim();
  if (/^(\/\/|\*|\/\*)/.test(trimmed)) return { role: 'skip:comment' };
  let before = line.slice(0, idx);
  if (before.includes(' // ')) return { role: 'skip:comment' };
  if (/^['"]/.test(lit)) { /* quoted word: `before` ends just before the quote */ }
  // canvas / data values are not CSS
  if (/ctx\.(fill|stroke)Style/.test(line) || /V_STYLES|useState\(/.test(line)) return { role: 'skip:notcss' };
  let m;
  if ((m = /(\w+)=\{?\s*["']?$/.exec(before))) return { role: roleOf(m[1]), key: m[1], how: 'attr' };
  if ((m = /\.style\.(\w+)\s*=\s*$/.exec(before))) return { role: roleOf(m[1]), key: m[1], how: 'assign' };
  if ((m = /--([\w-]+):\s*$/.exec(before))) return { role: roleOf(m[1]), key: '--' + m[1], how: 'cssvar' };
  const pr = positionalRole(file, before); if (pr) return { role: pr, how: 'positional' };
  const ks = [...before.matchAll(/(?:^|[\s,{(;])([A-Za-z_][\w-]*):(?!:)/g)];
  if (ks.length) { const key = ks[ks.length - 1][1]; return { role: roleOf(key), key, how: 'key' }; }
  // `var bannerBg = cond ? '#..' : '#..'`, `function scoreBg(p) { return ... }`, `const COLORS = [...]`: the
  // NAME is the only hint. A hue-named or nameless slot becomes role x — resolved per value by build-tokens.js
  // to that value's dominant role in the codebase (a tint is a fill wherever it appears, a -800 tone is text).
  if ((m = /(?:var|const|let)\s+(\w+)\s*=[^=]*$/.exec(before)) || (m = /function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*$/.exec(before))) return { role: roleOf(m[1]), key: m[1], how: 'decl' };
  if (/^['"]/.test(lit)) return { role: 'skip:word' };   // a bare 'white'/'black' with no CSS context is data
  return { role: 'x', how: 'fallback' };
}

const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx|ts|tsx)$/.test(f)) files.push(p); } })(SRC);
const report = { converted: 0, byRole: {}, skipped: [], unknown: [], pairs: {}, values: {} };
for (const abs of files) {
  const rel = path.relative(SRC, abs);
  if (EXCLUDE.some(r => r.test(rel))) continue;
  const lines = fs.readFileSync(abs, 'utf8').split('\n'); let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; if (!LIT.test(line)) { LIT.lastIndex = 0; continue; } LIT.lastIndex = 0;
    const lineBg = [], lineFg = [];
    const out = line.replace(LIT, (lit, q, word, idx) => {
      const c = classify(rel, line, idx, lit);
      if (!c.role || c.role.startsWith('skip')) { report.skipped.push(rel + ':' + (i + 1) + ' ' + lit + ' ' + (c.role || '')); return lit; }
      if (c.role === 'unknown') { report.unknown.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 110)); return lit; }
      const h = hex6(lit), v = 'var(--oq-' + c.role + '-' + h + ')';
      report.converted++; report.byRole[c.role] = (report.byRole[c.role] || 0) + 1;
      (report.values[h] = report.values[h] || {})[c.role] = ((report.values[h] || {})[c.role] || 0) + 1;
      if (c.role === 'bg') lineBg.push(h); if (c.role === 'fg') lineFg.push(h);
      return q ? q + v + q : v;   // keep the quotes of 'white' / "white"
    });
    for (const b of lineBg) for (const f of lineFg) report.pairs[b + '>' + f] = (report.pairs[b + '>' + f] || 0) + 1;
    if (out !== line) { lines[i] = out; changed = true; }
  }
  if (changed && APPLY) fs.writeFileSync(abs, lines.join('\n'));
}
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out', 'hints.json'), JSON.stringify({ values: report.values, pairs: report.pairs }, null, 1));
console.log((APPLY ? 'APPLIED' : 'DRY RUN') + ': converted ' + report.converted + ' literals; roles ' + JSON.stringify(report.byRole));
console.log('skipped ' + report.skipped.length + ':'); report.skipped.forEach(s => console.log('  ' + s));
console.log('unknown ' + report.unknown.length + ':'); report.unknown.forEach(s => console.log('  ' + s));
