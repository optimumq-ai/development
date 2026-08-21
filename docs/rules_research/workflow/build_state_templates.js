// Phase 6 — per-state config template generator.
// Joins: workflow_overlay.json (node classes) + node_concept_map.json (node→concept homes)
//      + ../alignment/master_concept_dictionary.json (concept→members_by_state)
//      + ../pruned/pruned_discovery.json (rule records, 1116 rules)
// Emits: templates/<CODE>.json (one per state) + templates/SUMMARY.json
// Fails loud on: concept in map but not in dictionary; dictionary concept in no home;
// non-shared overlay node missing from map (or class mismatch); state rules unreachable.
const fs = require('fs');
const path = require('path');
const HERE = __dirname;

const overlay = require(path.join(HERE, 'workflow_overlay.json'));
const map = require(path.join(HERE, 'node_concept_map.json'));
const dict = require(path.join(HERE, '..', 'alignment', 'master_concept_dictionary.json'));
const pruned = require(path.join(HERE, '..', 'pruned', 'pruned_discovery.json'));
// Step 3 (2026-08-21): the verified fee layer — 35 items × 32 states, every cell
// CONFIRMED/CORRECTED by the step-2 gap pass. Source of fee_schedule.items below.
const feeMaster = require(path.join(HERE, '..', 'alignment', 'fee_master_list.json'));

const byKey = new Map(dict.map(c => [c.canonical_key, c]));
const ruleById = new Map();
const stateMeta = [];
for (const s of pruned) {
  stateMeta.push({ state: s.state, code: s.code, ruleIds: s.rules.map(r => r.rule_id) });
  for (const r of s.rules) ruleById.set(r.rule_id, r);
}

// ---------- audits ----------
const errors = [];
const referenced = new Set();
const collect = (arr, where) => (arr || []).forEach(k => {
  if (!byKey.has(k)) errors.push(`${where}: unknown concept '${k}'`);
  referenced.add(k);
});
for (const [nodeKey, spec] of Object.entries(map.nodes)) {
  collect(spec.concepts, nodeKey);
  collect(spec.activate, nodeKey);
  collect(spec.context, nodeKey);
  collect(spec.complement_of, nodeKey);
}
for (const [t, spec] of Object.entries(map.clock_matrix)) collect(spec.concepts, `clock:${t}`);
for (const sec of ['fee_schedule', 'program_setup', 'ledger', 'engine_notes'])
  collect(map[sec].concepts, sec);

for (const c of dict) if (!referenced.has(c.canonical_key))
  errors.push(`dictionary concept in NO home: ${c.canonical_key}`);

const overlayNodes = new Map(overlay.nodes.map(n => [`${n.page}.${n.node}`, n]));
for (const [nodeKey, spec] of Object.entries(map.nodes)) {
  const on = overlayNodes.get(nodeKey);
  if (!on) { errors.push(`map node not on overlay: ${nodeKey}`); continue; }
  if (on.class !== spec.class) errors.push(`class mismatch ${nodeKey}: overlay=${on.class} map=${spec.class}`);
}
for (const n of overlay.nodes) {
  if (n.class === 'shared') continue;
  if (!map.nodes[`${n.page}.${n.node}`]) errors.push(`overlay ${n.class} node unmapped: ${n.page}.${n.node}`);
}
if (errors.length) { console.error('AUDIT FAILED:\n' + errors.join('\n')); process.exit(1); }

// ---------- helpers ----------
const evidence = (conceptKey, code) => {
  const c = byKey.get(conceptKey);
  const ids = (c.members_by_state || {})[code] || [];
  return ids.map(id => {
    const r = ruleById.get(id);
    if (!r) return { rule_id: id, missing: true };
    const e = {
      rule_id: id,
      authority: r.source_authority || '',
      summary: (r.atomic_rule || '').length > 300 ? r.atomic_rule.slice(0, 297) + '…' : (r.atomic_rule || '')
    };
    if (r.clock_spec) e.clock_spec = r.clock_spec;
    if (r.clock_effect && r.clock_effect !== 'none') e.clock_effect = r.clock_effect;
    return e;
  });
};
const conceptBlock = (keys, code) => {
  const out = {};
  for (const k of keys || []) {
    const ev = evidence(k, code);
    if (ev.length) out[k] = ev;
  }
  return out;
};

// ---------- build ----------
const outDir = path.join(HERE, 'templates');
fs.mkdirSync(outDir, { recursive: true });
const summary = [];

for (const sm of stateMeta) {
  const { state, code } = sm;
  const t = {
    state, code,
    _meta: {
      phase: 6,
      generated_by: 'build_state_templates.js',
      reading: 'knobs = fill a value per ◆ (statutory blocks are the evidence; city_config marks local policy). branches = ▲ on/off. clock_matrix/fee_schedule/program_setup/ledger = engine data tables. fee_schedule.items = the step-3 verified fee layer (value/unit/basis/engine_field/applies_to per master-list item, every cell verify-confirmed); fee_schedule.statutory_evidence = concept-level evidence.'
    },
    knobs: {}, branches: {}, clock_matrix: {}, fee_schedule: {}, program_setup: {}, ledger: {},
    audit: {}
  };

  for (const [nodeKey, spec] of Object.entries(map.nodes)) {
    const label = overlayNodes.get(nodeKey).label;
    if (spec.class === 'param') {
      const statutory = conceptBlock(spec.concepts, code);
      const knob = { label, statutory };
      if (spec.city_config) knob.city_config = spec.city_config.note;
      if (!Object.keys(statutory).length && !spec.city_config)
        knob.city_config = 'No statutory constraint in this state — city policy.';
      t.knobs[nodeKey] = knob;
    } else {
      const activators = conceptBlock(spec.activate, code);
      const context = conceptBlock(spec.context, code);
      let active;
      if (spec.states_override) active = spec.states_override.includes(code);
      else if (spec.complement_of) active = !Object.keys(conceptBlock(spec.complement_of, code)).length;
      else active = Object.keys(activators).length > 0;
      const br = { label, active };
      if (Object.keys(activators).length) br.activated_by = activators;
      if (spec.complement_of) {
        const blockers = conceptBlock(spec.complement_of, code);
        if (Object.keys(blockers).length) br.suppressed_by = blockers;
      }
      if (Object.keys(context).length) br.context = context;
      if (spec.override_note) br.note = spec.override_note;
      if (spec.city_config) br.city_config = spec.city_config.note;
      t.branches[nodeKey] = br;
    }
  }

  for (const [timer, spec] of Object.entries(map.clock_matrix)) {
    const ev = conceptBlock(spec.concepts, code);
    t.clock_matrix[timer] = Object.keys(ev).length
      ? { present: true, statutory: ev }
      : { present: false, note: 'No statutory timer — city operational target only (soft-standard pattern S-002).' };
  }
  for (const [sec, secKey] of [['program_setup', 'program_setup'], ['ledger', 'ledger']])
    t[sec] = conceptBlock(map[secKey].concepts, code);

  // fee_schedule (step 3 shape): items = the verified fee layer (one row per master-list
  // item — value/unit/basis/engine_field/applies_to); statutory_evidence = the original
  // concept-level evidence block.
  const feeItems = {};
  for (const item of feeMaster.items) {
    const cell = (item.states[code] || {}).verified;
    if (!cell) { errors.push(`fee_schedule: no verified cell for ${item.id}/${code}`); continue; }
    const row = {
      label: item.label,
      engine_field: item.home,
      type: item.type,
      resolution: cell.resolution,
      value: cell.value,
      unit: cell.unit,
      basis: cell.basis,
      applies_to: cell.applies_to,
      rule_type: cell.rule_type,
      authority: cell.source_authority,
      rule_ids: [...(cell.resolved_by_rule_ids || []), ...(cell.new_rule_ids || [])],
      verdict: cell.verdict,
      verified_at: cell.verified_at,
    };
    if (cell.notes) row.notes = cell.notes.length > 300 ? cell.notes.slice(0, 297) + '…' : cell.notes;
    feeItems[item.id] = row;
  }
  t.fee_schedule = { items: feeItems, statutory_evidence: conceptBlock(map.fee_schedule.concepts, code) };
  if (errors.length) { console.error('FEE LAYER FAILED:\n' + errors.join('\n')); process.exit(1); }

  // audit: every state rule reachable through some home
  const reach = new Set();
  for (const k of referenced) for (const id of (byKey.get(k).members_by_state || {})[code] || []) reach.add(id);
  const unreferenced = sm.ruleIds.filter(id => !reach.has(id));
  t.audit = { rules_total: sm.ruleIds.length, rules_referenced: sm.ruleIds.length - unreferenced.length, unreferenced_rule_ids: unreferenced };

  fs.writeFileSync(path.join(outDir, `${code}.json`), JSON.stringify(t, null, 1));
  summary.push({
    code, state,
    branches_active: Object.entries(t.branches).filter(([, b]) => b.active).map(([k]) => k),
    timers_present: Object.entries(t.clock_matrix).filter(([, v]) => v.present).map(([k]) => k),
    rules: t.audit.rules_total, unreferenced: unreferenced.length
  });
}

fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 1));
const bad = summary.filter(s => s.unreferenced);
console.log(`wrote ${summary.length} templates to templates/`);
console.log('branch activation counts:');
const counts = {};
for (const s of summary) for (const b of s.branches_active) counts[b] = (counts[b] || 0) + 1;
for (const [b, n] of Object.entries(counts).sort((a, b2) => b2[1] - a[1])) console.log(`  ${b}: ${n} states`);
if (bad.length) console.log('STATES WITH UNREFERENCED RULES:', bad.map(s => `${s.code}(${s.unreferenced})`).join(' '));
else console.log('audit clean: all state rules reachable through the mapping');
