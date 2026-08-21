#!/usr/bin/env node
// Merge the 22-state verified gap-pass results into alignment/fee_master_list.json
// as a `verified` layer per item-state cell, and bank the new 9NNN rules in
// alignment/fee_gap_new_rules.json.
//
// Contract (STEP2 prompt + VERIFY_ROLLUP):
//   - Only CONFIRMED rows enter as verified; CORRECTED rows enter with the
//     verify agent's corrected_row substituted for the raw resolution.
//   - payment.method is EXCLUDED everywhere (owner decision 2026-08-20:
//     card acceptance is finance-department policy, city-wide, not
//     open-records-specific). The item moves to excluded_items; new 9NNN
//     rules referenced ONLY by payment.method rows are excluded with it.
//
// Idempotent: re-running rebuilds the same verified layer from the same inputs.

'use strict'
const fs = require('fs')
const path = require('path')

const RR = '/opt/optimumq/docs/rules_research'
const MASTER = path.join(RR, 'alignment/fee_master_list.json')
const NEW_RULES_OUT = path.join(RR, 'alignment/fee_gap_new_rules.json')
const EXCLUDED_ITEM = 'payment.method'
const MERGED_AT = '2026-08-21'

const master = JSON.parse(fs.readFileSync(MASTER, 'utf8'))

// Merge every state that has BOTH a raw and a verified file — full idempotent rebuild.
const STATES = master.states.filter(st =>
  fs.existsSync(path.join(RR, `fee_gap/raw/${st}.json`)) &&
  fs.existsSync(path.join(RR, `fee_gap/verified/${st}.json`)))
console.log('merging states:', STATES.join(' '))

// ---- load raw + verified per state --------------------------------------
const rawByState = {}, verByState = {}
for (const st of STATES) {
  rawByState[st] = JSON.parse(fs.readFileSync(path.join(RR, `fee_gap/raw/${st}.json`), 'utf8'))
  verByState[st] = JSON.parse(fs.readFileSync(path.join(RR, `fee_gap/verified/${st}.json`), 'utf8'))
}

// ---- build verified layer ------------------------------------------------
const counts = { confirmed: 0, corrected: 0, excluded_rows: 0, cells: 0 }
const problems = []

function pickVerifiedCell (st, itemId) {
  const raw = rawByState[st].resolutions.find(r => r.item_id === itemId)
  const ver = verByState[st].rows.find(r => r.item_id === itemId)
  if (!raw || !ver) { problems.push(`${st}/${itemId}: missing ${!raw ? 'raw' : 'verify'} row`); return null }
  let row = raw, verdict = ver.verdict
  if (verdict === 'CORRECTED') {
    if (!ver.corrected_row) { problems.push(`${st}/${itemId}: CORRECTED without corrected_row`); return null }
    row = ver.corrected_row; counts.corrected++
  } else if (verdict === 'CONFIRMED') {
    counts.confirmed++
  } else {
    problems.push(`${st}/${itemId}: verdict ${verdict} — not eligible for verified layer`)
    return null
  }
  return {
    resolution: row.resolution,
    value: row.value ?? null,
    unit: row.unit ?? null,
    basis: row.basis ?? null,
    rule_type: row.rule_type ?? null,
    applies_to: row.applies_to ?? null,
    resolved_by_rule_ids: row.resolved_by_rule_ids || [],
    new_rule_ids: row.new_rule_ids || [],
    source_authority: row.source_authority ?? null,
    source_type: row.source_type ?? null,
    official_link: row.official_link ?? null,
    source_language: row.source_language ?? null,
    is_paraphrase: row.is_paraphrase ?? null,
    effective_status: row.effective_status ?? null,
    confidence: row.confidence ?? null,
    notes: row.notes ?? null,
    verdict,
    verified_at: verByState[st].verified_at || null,
  }
}

let excludedItem = null
master.items = master.items.filter(item => {
  if (item.id === EXCLUDED_ITEM) { excludedItem = item; return false }
  return true
})
const alreadyExcluded = !excludedItem &&
  (master.excluded_items || []).some(e => e.item && e.item.id === EXCLUDED_ITEM)
if (!excludedItem && !alreadyExcluded) throw new Error(`master list has no item ${EXCLUDED_ITEM} and no excluded_items record`)

for (const item of master.items) {
  for (const st of STATES) {
    const cell = pickVerifiedCell(st, item.id)
    if (!cell) continue
    if (!item.states[st]) item.states[st] = {}
    item.states[st].verified = cell
    counts.cells++
  }
}
// count excluded payment.method rows for the ledger
for (const st of STATES) {
  if (verByState[st].rows.some(r => r.item_id === EXCLUDED_ITEM)) counts.excluded_rows++
}

// ---- new 9NNN rules bank, minus payment-only rules ------------------------
const excludedRuleIds = {}
const newRulesByState = {}
let bankedRules = 0, droppedRules = 0
for (const st of STATES) {
  const raw = rawByState[st]
  const refs = {}
  for (const r of raw.resolutions) for (const id of (r.new_rule_ids || [])) (refs[id] = refs[id] || []).push(r.item_id)
  const keep = [], drop = []
  for (const rule of raw.new_rules || []) {
    const referrers = refs[rule.rule_id] || []
    const paymentOnly = referrers.length > 0 && referrers.every(x => x === EXCLUDED_ITEM)
    if (paymentOnly) drop.push(rule.rule_id)
    else keep.push(rule)
  }
  newRulesByState[st] = keep
  if (drop.length) excludedRuleIds[st] = drop
  bankedRules += keep.length; droppedRules += drop.length
}

fs.writeFileSync(NEW_RULES_OUT, JSON.stringify({
  generated: MERGED_AT,
  purpose: 'New 9NNN rule rows discovered by the step-2 fee gap pass (source: fee_gap/raw/<ST>.json), banked for the rules library. Rules referenced ONLY by the excluded payment.method item are listed under excluded, not banked.',
  states_covered: STATES,
  rule_count: bankedRules,
  excluded: {
    reason: 'payment.method excluded per owner decision 2026-08-20 — card/payment-instrument acceptance is finance-department policy, applies city-wide, not open-records-specific.',
    rule_ids_by_state: excludedRuleIds,
  },
  rules_by_state: newRulesByState,
}, null, 1))

// ---- master top-level bookkeeping -----------------------------------------
master.verified_layer = {
  merged_at: MERGED_AT,
  states: STATES,
  cells: counts.cells,
  confirmed: counts.confirmed,
  corrected: counts.corrected,
  method: 'Per item-state cell, states[ST].verified holds the gap-pass resolution row (verify verdict CONFIRMED, or the verify agent\'s corrected_row where CORRECTED). Rows and full verify evidence: fee_gap/raw/<ST>.json + fee_gap/verified/<ST>.json; rollup: fee_gap/VERIFY_ROLLUP.md. New 9NNN rules: alignment/fee_gap_new_rules.json. The auto-derived status fields alongside are the ORIGINAL 2026-08-19 auto layer, kept for comparison; step 3 consumes the verified layer.',
}
master.excluded_items = master.excluded_items || []
const existingExclusion = master.excluded_items.find(e => e.item && e.item.id === EXCLUDED_ITEM)
if (existingExclusion) {
  existingExclusion.excluded_new_rule_ids_by_state = excludedRuleIds
} else {
  master.excluded_items.push({
    excluded_at: MERGED_AT,
    reason: 'Owner decision 2026-08-20 (Kevin): card/payment-instrument acceptance is finance-department policy, applies broadly to a city, not specifically to open records; a rules-profile item for it would be confusing. Excluded from the state rules profile at merge and in future gap passes.',
    excluded_new_rule_ids_by_state: excludedRuleIds,
    item: excludedItem,
  })
}

fs.writeFileSync(MASTER, JSON.stringify(master, null, 1))

// ---- report ----------------------------------------------------------------
console.log('MERGE COMPLETE')
console.log('items in master now:', master.items.length, '(payment.method in excluded_items)')
console.log('verified cells written:', counts.cells, `(expect ${master.items.length * STATES.length})`)
console.log('confirmed:', counts.confirmed, 'corrected:', counts.corrected)
console.log('payment.method rows excluded:', counts.excluded_rows)
console.log('new rules banked:', bankedRules, '— payment-only rules excluded:', droppedRules)
if (problems.length) { console.log('PROBLEMS:'); problems.forEach(p => console.log(' -', p)); process.exitCode = 1 }
else console.log('no problems')
