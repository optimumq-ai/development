'use strict';
// BW9b — THE RESEARCH-TEXT RESOLVER (Draft 10 §4.5, drill-down decided IN 2026-08-11).
//
// Every statute-derived fact in a jurisdiction_rules config carries `source_rule_ids` (or concept
// arrays of {rule_id, authority, summary}). The full records behind those ids — atomic rule,
// trigger, and the verbatim SOURCE LANGUAGE — live in the research corpus the Phase-6 gather
// produced: docs/rules_research/pruned/pruned_discovery.json (32 states, ~2100 rules). This
// module is the read-only bridge: rule_id → record, for the editor's provenance drill-down.
//
// READ-ONLY BY DESIGN. The corpus is the gather's output, never edited here — the
// never-hand-edit-generated-templates rule. A city that disagrees with a rule edits its CONFIG
// (as a cited proposal); the research record stays what the research found.
//
// The file is ~MBs and read lazily ONCE per process, indexed by rule_id. A missing corpus or an
// unknown id answers null — the screen renders "research record not available", never a 500:
// drill-down is a courtesy, not a dependency.
var fs = require('fs');
var path = require('path');

var CORPUS_PATH = process.env.RULES_RESEARCH_PATH ||
  path.join(__dirname, '..', '..', '..', 'docs', 'rules_research', 'pruned', 'pruned_discovery.json');
// The step-2 fee-gap pass banked its NEW rules (ids <ST>-9NNN — overhead, media, certification, commercial,
// bands, cap, repeat…) in a second file the fee templates cite by id. Until 2026-09-14 only the pruned corpus
// was read, so every 9NNN citation answered "no research record" and the Fee rules cite popups for
// Commercial surcharge and Certified copy charge opened empty (Kevin's 2026-09-13 markup).
var GAP_CORPUS_PATH = process.env.RULES_RESEARCH_GAP_PATH ||
  path.join(__dirname, '..', '..', '..', 'docs', 'rules_research', 'alignment', 'fee_gap_new_rules.json');

var index = null;   // rule_id -> record (with state attached)
var loadedAt = null;

function load() {
  if (index) return index;
  index = {};
  try {
    var raw = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
    (Array.isArray(raw) ? raw : []).forEach(function (state) {
      (state.rules || []).forEach(function (r) {
        if (r && r.rule_id && !index[r.rule_id]) {
          index[r.rule_id] = Object.assign({ state: state.state || null, state_code: state.code || null }, r);
        }
      });
    });
    loadedAt = new Date().toISOString();
  } catch (e) {
    console.error('[rulesResearch] corpus unavailable:', e && e.message);
  }
  try {
    var gap = JSON.parse(fs.readFileSync(GAP_CORPUS_PATH, 'utf8'));
    var byState = (gap && gap.rules_by_state) || {};
    Object.keys(byState).forEach(function (code) {
      (byState[code] || []).forEach(function (r) {
        if (r && r.rule_id && !index[r.rule_id]) index[r.rule_id] = Object.assign({ state: null, state_code: code, corpus: 'fee_gap' }, r);
      });
    });
    loadedAt = loadedAt || new Date().toISOString();
  } catch (e) {
    console.error('[rulesResearch] fee-gap corpus unavailable:', e && e.message);
  }
  return index;
}

// One record, or null. Fields of interest downstream: legal_concept, rule_type, atomic_rule,
// trigger, clock_effect, source_language (the verbatim statute text), category, concept_key.
function rule(ruleId) {
  if (!ruleId) return null;
  return load()[ruleId] || null;
}

// Resolve a list of ids into { found: {id: record}, missing: [ids] } — absence shown as absence.
function resolve(ruleIds) {
  var found = {}, missing = [];
  (ruleIds || []).forEach(function (id) {
    var r = rule(id);
    if (r) found[id] = r; else missing.push(id);
  });
  return { found: found, missing: missing };
}

module.exports = { rule: rule, resolve: resolve, CORPUS_PATH: CORPUS_PATH, GAP_CORPUS_PATH: GAP_CORPUS_PATH,
  _stats: function () { load(); return { rules: Object.keys(index || {}).length, loadedAt: loadedAt }; } };
