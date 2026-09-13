'use strict';
// DISPLAY THEME TOKENS — docs/SPEC_display_theme.md §3 (the discipline half of the feature).
//
// The three colour schemes work only because EVERY colour in the staff frontend is a CSS variable generated
// into src/theme/tokens.css. The moment someone types '#1F4E79' into a style again, that element is stuck
// in the standard colours under both high-contrast themes — and nothing else would notice. This harness is
// the thing that notices. It reads the frontend SOURCE (no DB, no API), so it never touches live data.
//
//   A. no raw colour literal in staff-facing source (citizen-facing files are excluded by design)
//   B. every variable the source uses is defined in tokens.css, in all three blocks
//   C. the standard block is pixel-faithful: --oq-<role>-<hex> resolves to exactly that hex
//   D. the semantic tokens lib/theme.js exports are the ones the generator defines
//   E. the wire values the menu offers are the ones the API accepts
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs'), path = require('path');

var pass = 0, fail = 0;
function ok(l, c, detail) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (c || !detail ? '' : '\n          ' + detail)); }
var SRC = '/opt/optimumq/frontend/src';
var EXCLUDE = [/^pages\/Public/, /^pages\/PaperFormPage\.js$/, /^pages\/ContributePage\.js$/, /^pages\/MagicPage\.js$/, /^components\/StatusCheckModal\.js$/, /^components\/VerifyRecordModal\.js$/, /^theme\//];
var files = []; (function walk(d) { fs.readdirSync(d).forEach(function (f) { var p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx|ts|tsx|css)$/.test(f)) files.push(p); }); })(SRC);
function rel(p) { return path.relative(SRC, p); }
var staff = files.filter(function (p) { return !EXCLUDE.some(function (r) { return r.test(rel(p)); }); });

console.log('=== A. NO RAW COLOUR LITERALS IN STAFF SOURCE ===');
var LIT = /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?![0-9A-Fa-f])/g;
var offenders = [];
staff.forEach(function (p) {
  if (rel(p) === 'lib/theme.js') return;                 // its comments record the hex each token meant
  fs.readFileSync(p, 'utf8').split('\n').forEach(function (line, i) {
    var t = line.trim(); if (/^(\/\/|\*|\/\*)/.test(t)) return;
    if (/ctx\.(fill|stroke)Style/.test(line)) return;     // canvas drawing is not CSS (AvWorkbench)
    var code = line.replace(/\/\/.*$/, '');
    if (LIT.test(code)) offenders.push(rel(p) + ':' + (i + 1) + '  ' + t.slice(0, 100));
    LIT.lastIndex = 0;
  });
});
ok('A1 no hex colour literal outside the generated tokens (' + staff.length + ' files scanned)', offenders.length === 0, offenders.slice(0, 8).join('\n          '));

console.log('\n=== B. EVERY VARIABLE IN USE IS DEFINED, IN ALL THREE THEMES ===');
var css = fs.readFileSync(path.join(SRC, 'theme', 'tokens.css'), 'utf8');
function block(sel) { var i = css.indexOf(sel + ' {'); if (i < 0) return null; return css.slice(i, css.indexOf('\n}', i)); }
var blocks = { standard: block(':root'), light: block('[data-oq-theme="hc-light"]'), dark: block('[data-oq-theme="hc-dark"]') };
ok('B1 tokens.css has the standard, hc-light and hc-dark blocks', !!(blocks.standard && blocks.light && blocks.dark));
var used = {};
staff.forEach(function (p) { var m, re = /var\(--oq-[a-zA-Z0-9-]+\)/g, s = fs.readFileSync(p, 'utf8'); while ((m = re.exec(s))) used[m[0].slice(4, -1)] = true; });
var usedList = Object.keys(used);
var missing = {};
Object.keys(blocks).forEach(function (k) { missing[k] = usedList.filter(function (v) { return blocks[k] && blocks[k].indexOf('  ' + v + ':') === -1; }); });
ok('B2 ' + usedList.length + ' variables in use; all defined in the standard block', missing.standard.length === 0, missing.standard.slice(0, 8).join(', '));
ok('B3 all defined in hc-light', missing.light.length === 0, missing.light.slice(0, 8).join(', '));
ok('B4 all defined in hc-dark', missing.dark.length === 0, missing.dark.slice(0, 8).join(', '));

console.log('\n=== C. THE STANDARD THEME IS PIXEL-FAITHFUL ===');
var unfaithful = [];
(blocks.standard || '').split('\n').forEach(function (line) {
  var m = /--oq-(fg|bg|ln)-([0-9a-f]{6}):\s*(#[0-9A-Fa-f]{6});/.exec(line);
  if (m && m[3].toLowerCase() !== '#' + m[2]) unfaithful.push(line.trim());
  var x = /--oq-x-([0-9a-f]{6}):\s*var\(--oq-(fg|bg|ln)-([0-9a-f]{6})\);/.exec(line);
  if (x && x[1] !== x[3]) unfaithful.push(line.trim());
});
ok('C1 every value-keyed variable resolves to the hex in its own name', unfaithful.length === 0, unfaithful.slice(0, 5).join('\n          '));
var semantic = { ground: '#D8E0E8', surface: '#FFFFFF', surface2: '#F2F6F9', field: '#EBF3FB', ink: '#12232E', muted: '#5C6F7C', faint: '#8296A4', hair: '#D2DCE3', hairStrong: '#BECAD3', blue: '#1E6091', blueBg: '#1E6091', blueTint: '#E4EEF6', blueInk: '#0E3A5C', green: '#1B8A5A', greenBg: '#1B8A5A', greenTint: '#E1F2E9', amber: '#9A6512', amberBg: '#9A6512', amberTint: '#F6EBD6', crit: '#B02A37', critBg: '#B02A37', critTint: '#F8E7E8' };
var drift = Object.keys(semantic).filter(function (k) { return (blocks.standard || '').indexOf('  --oq-t-' + k + ': ' + semantic[k] + ';') === -1; });
ok('C2 the §9 semantic tokens keep their 2026-07-14 values in the standard block', drift.length === 0, drift.join(', '));

console.log('\n=== D. lib/theme.js AND THE GENERATOR AGREE ===');
var theme = fs.readFileSync(path.join(SRC, 'lib', 'theme.js'), 'utf8');
var exported = []; var re = /^\s+(\w+): 'var\(--oq-t-(\w+)\)'/gm, m; while ((m = re.exec(theme))) exported.push(m[2]);
var undefinedT = exported.filter(function (t) { return (blocks.standard || '').indexOf('--oq-t-' + t + ':') === -1; });
ok('D1 every C.* token (' + exported.length + ') is defined by the generator', exported.length >= 20 && undefinedT.length === 0, undefinedT.join(', '));
ok('D2 the C.* fills have their *Bg twins (dark theme sends fill and text different ways)', ['blueBg', 'greenBg', 'amberBg', 'critBg'].every(function (t) { return exported.indexOf(t) !== -1; }));

console.log('\n=== E. MENU AND API SPEAK THE SAME WIRE VALUES ===');
var menuKeys = []; re = /\{ key: '([a-z-]+)', label:/g; while ((m = re.exec(theme))) menuKeys.push(m[1]);
var route = fs.readFileSync('/opt/optimumq/backend/src/routes/auth.js', 'utf8');
var apiKeys = (/const UI_THEMES = \[([^\]]+)\]/.exec(route) || [, ''])[1].split(',').map(function (s) { return s.trim().replace(/'/g, ''); }).filter(Boolean);
ok('E1 menu offers standard, hc-light, hc-dark', menuKeys.join(',') === 'standard,hc-light,hc-dark', menuKeys.join(','));
ok('E2 API accepts exactly those', apiKeys.join(',') === menuKeys.join(','), apiKeys.join(','));
ok('E3 standard is the absence of the attribute (applyTheme removes it)', /removeAttribute\('data-oq-theme'\)/.test(theme));
ok('E4 tokens.css blocks are keyed on the same attribute', /\[data-oq-theme="hc-light"\]/.test(css) && /\[data-oq-theme="hc-dark"\]/.test(css));

console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
