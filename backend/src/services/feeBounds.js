// Statutory fee bounds — what state law allows for each fee-engine config value.
// Data: src/data/state_fee_bounds.json, generated from the verified 32-state fee layer
// (docs/rules_research/alignment/fee_master_list.json) by scripts/gen_state_fee_bounds.js.
//
// Two consumers:
//  - GET /fee-profiles/bounds → the composer/config screens show the bound next to each input;
//  - check(config, code) at save time → a config that exceeds a state ceiling (or undercuts a
//    floor, or contradicts a statute-set figure) is REFUSED server-side, in plain language,
//    whatever screen tried to save it. The AI extraction path is covered by the same gate.
'use strict';
var BOUNDS = require('../data/state_fee_bounds.json');

function forState(code) {
  return (code && BOUNDS.states[String(code).toUpperCase()]) || null;
}

function getPath(obj, dotted) {
  var cur = obj;
  var parts = dotted.split('.');
  for (var i = 0; i < parts.length; i++) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

// A tolerance for float comparison on money values.
var EPS = 1e-9;

// Returns [{path, kind, entered, allowed, citation, message}] — empty when the config is lawful.
// Only numeric, scalar bounds are enforced; "actual"/null/tiered values pass through (the bound
// still displays in the UI). A tiered rate is checked band-by-band against a numeric ceiling.
function check(config, code) {
  var bounds = forState(code);
  if (!bounds || !config || typeof config !== 'object') return [];
  var violations = [];
  Object.keys(bounds).forEach(function (path) {
    var b = bounds[path];
    if (b.value == null) return; // no numeric figure to enforce
    var entered = getPath(config, path);
    var candidates = [];
    if (typeof entered === 'number') candidates.push(entered);
    // graduated tiers on a rate path: check each band's rate
    if (/^duplication\./.test(path) && /\.rate$/.test(path)) {
      var tiers = getPath(config, path.replace(/\.rate$/, '.tiers'));
      if (Array.isArray(tiers)) tiers.forEach(function (t) { if (t && typeof t.rate === 'number') candidates.push(t.rate); });
    }
    if (!candidates.length) return;
    candidates.forEach(function (v) {
      var msg = null;
      if (b.kind === 'ceiling' && v > b.value + EPS) {
        msg = 'Above the state limit of ' + fmt(b) + '.';
      } else if (b.kind === 'floor' && v < b.value - EPS) {
        msg = 'Below the state minimum of ' + fmt(b) + '.';
      } else if (b.kind === 'fixed' && v > b.value + EPS) {
        // A statute-set figure authorizes a charge; a city may charge less, never more.
        msg = 'The statute sets this figure at ' + fmt(b) + ' — a higher charge is not authorized. To assert the law has changed, file a proposal with a citation on the Fee & cost schedule section.';
      }
      if (msg) violations.push({
        path: path, kind: b.kind, entered: v, allowed: b.value,
        citation: b.citation || null,
        message: msg + (b.citation ? ' (' + b.citation + ')' : ''),
      });
    });
  });
  return violations;
}

function fmt(b) {
  var usd = /^USD/.test(b.unit || '');
  return (usd ? '$' + b.value : String(b.value)) + (b.unit ? ' ' + String(b.unit).replace(/^USD ?/, '').split('(')[0].trim() : '');
}

module.exports = { forState: forState, check: check };
