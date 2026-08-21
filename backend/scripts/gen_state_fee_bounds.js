// Generates src/data/state_fee_bounds.json from the verified fee layer in
// docs/rules_research/alignment/fee_master_list.json (step-2 gap pass, every cell
// verify-confirmed against official sources, 2026-08).
//
// Output: per state, per fee-engine config path, what state law allows:
//   kind:  ceiling | floor | fixed | actual_cost | restricted | silent | info
//   value: the numeric bound where the statute prints one (null otherwise)
//   text:  the human sentence shown next to the input
//   citation: the statutory authority
//
// Re-run after any master-list re-merge: node scripts/gen_state_fee_bounds.js
'use strict';
const fs = require('fs');
const path = require('path');

const MASTER = '/opt/optimumq/docs/rules_research/alignment/fee_master_list.json';
const OUT = path.join(__dirname, '..', 'src', 'data', 'state_fee_bounds.json');

// master item id → the fee_profiles config path(s) the bound governs
const ITEM_PATHS = {
  'dup.bw.rate': ['duplication.bw.rate'],
  'dup.color.rate': ['duplication.color.rate'],
  'dup.oversized.rate': ['duplication.oversized.rate'],
  'dup.specialty.rate': ['duplication.specialty.rate'],
  'certification': ['certification.rate'],
  'labor.search.rate': ['labor.search.rate'],
  'labor.review.rate': ['labor.review.rate'],
  'labor.programming.rate': ['labor.programming.rate'],
  'labor.overheadPct': ['labor.overheadPct'],
  'rules.freePages': ['requestRules.freePageAllowance'],
  'rules.freeLaborHours': ['requestRules.freeLaborHours'],
  'rules.estimateNotifyThreshold': ['requestRules.estimateNotifyThreshold'],
  'rules.deposit.threshold': ['requestRules.deposit.threshold'],
  'rules.deposit.percent': ['requestRules.deposit.percent'],
  'estimate.requesterResponseDays': ['estimatePolicy.requesterResponseDays'],
  'estimate.revisionNotifyPercent': ['estimatePolicy.revisionNotifyPercent'],
  'estimate.validityDays': ['estimatePolicy.estimateValidityDays'],
  'rules.maxFee': ['requestRules.maxFee'],
  'rules.minFee': ['requestRules.minFee'],
  'rules.deMinimis': ['requestRules.deMinimis'],
  'media': ['media.cd', 'media.dvd', 'media.usb'],
  'delivery': ['delivery.email', 'delivery.pickup', 'delivery.mail', 'delivery.handling'],
  'av': ['av.perRecording', 'av.perMinute'],
};

function kindOf(cell) {
  switch (cell.resolution) {
    case 'ceiling': return 'ceiling';
    case 'floor': return 'floor';
    case 'value': return 'fixed';
    case 'range': return 'ceiling'; // enforce the top of the range; text carries the full shape
    case 'actual_cost_standard': return 'actual_cost';
    case 'defers_to_city': case 'silent': return 'silent';
    default: return 'info'; // structural, not_applicable, delegated_unresolved
  }
}

function numeric(v) {
  if (v == null) return null;
  const m = String(v).replace(/[$,]/g, '').match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  return m ? Number(m[1]) : null;
}

function textOf(cell, kind, num) {
  const cite = cell.source_authority ? ' · ' + cell.source_authority : '';
  const isUsd = /^USD/.test(cell.unit || '');
  const unitTail = cell.unit ? ' ' + String(cell.unit).replace(/^USD ?/, '') : '';
  const amount = num == null ? null : (isUsd ? '$' + num : String(num)) + unitTail;
  if (kind === 'ceiling') {
    return (amount != null ? 'STATE LAW: no more than ' + amount : 'STATE LAW: capped — ' + (cell.value || 'see statute')) + cite;
  }
  if (kind === 'floor') {
    return (amount != null ? 'STATE LAW: at least ' + amount : 'STATE LAW: sets a minimum — ' + (cell.value || 'see statute')) + cite;
  }
  if (kind === 'fixed') {
    return (amount != null ? 'STATE LAW: set by statute at ' + amount : 'STATE LAW: set by statute — ' + (cell.value || 'see statute')) + cite;
  }
  if (kind === 'actual_cost') return 'STATE LAW: actual cost at most — no set figure, no markup' + cite;
  if (kind === 'silent') return 'THE LAW IS SILENT — your city decides.';
  return (cell.notes ? String(cell.notes).slice(0, 200) : 'See the state profile.') + cite;
}

const master = JSON.parse(fs.readFileSync(MASTER, 'utf8'));
const states = {};
let cells = 0;
for (const item of master.items) {
  const paths = ITEM_PATHS[item.id];
  if (!paths) continue;
  for (const [code, st] of Object.entries(item.states)) {
    const cell = st && st.verified;
    if (!cell) continue;
    // agency-only regimes do not bind a municipality's schedule
    const agencyOnly = cell.applies_to === 'state_agencies_only';
    const kind = agencyOnly ? 'silent' : kindOf(cell);
    const num = agencyOnly ? null : numeric(cell.value);
    const rec = {
      item: item.id, kind: kind, value: num, unit: cell.unit || null,
      citation: cell.source_authority || null,
      text: agencyOnly ? 'THE LAW IS SILENT for municipalities — the figures in this state’s statute bind state agencies only.' : textOf(cell, kind, num),
    };
    states[code] = states[code] || {};
    for (const p of paths) { states[code][p] = rec; cells++; }
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: 'docs/rules_research/alignment/fee_master_list.json (verified layer, step-2 fee gap pass)',
  states: states,
}, null, 1));
console.log('wrote', OUT, '-', Object.keys(states).length, 'states,', cells, 'path-bounds');
const ok = states.OK || {};
console.log('spot OK duplication.bw.rate:', JSON.stringify(ok['duplication.bw.rate']));
