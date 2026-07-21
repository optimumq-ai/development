export const meta = {
  name: 'rules-wave-safe',
  description: 'State public-records rules blast, reconciliation-safe version. Per-CLUSTER partition verify (linear in clusters, not quadratic in pairs) + budget guard + hard agent cap. Drop-in replacement for rules-wave1-8states, which pairwise-exploded to 1068 agents and tripped the spend limit.',
  phases: [
    { title: 'Discover', detail: 'N states under the final V2 prompt (verbatim, no contentless, constraint basis)' },
    { title: 'Canonicalize', detail: 'candidate clusterer over all rules' },
    { title: 'Verify', detail: 'ONE partition agent per multi-state cluster (was: one agent per cross-state pair)' },
    { title: 'Apply+Pivot', detail: 'clique-cover reshape (JS) -> parameter tables, structural catalog, dictionary' },
    { title: 'Report', detail: 'wave deliverables + acceptance check (no split pair survives)' },
  ],
}

// ---- config ------------------------------------------------------------
// Pass states + a wave label via args, or fall back to the wave-1 ten.
const CONTRACT = '/opt/optimumq/docs/rules_research/V2_state_research_prompt.md'
const STATES = (args && args.states && args.states.length) ? args.states
  : ['Texas','California','New York','Florida','Illinois','Virginia','Washington','Arizona','Georgia','Ohio']
const WAVE = (args && args.wave) || 'wave'
// Safety rails — the whole point of this rewrite.
const MAX_VERIFY_AGENTS = (args && args.maxVerifyAgents) || 150   // hard ceiling on the Verify fan-out
const MIN_BUDGET_TO_VERIFY = 200_000                              // skip/abort Verify if the token budget can't cover it
const MIN_BUDGET_TO_PIVOT  = 120_000

// ---- exclusions --------------------------------------------------------
// Rule types we KNOW are out of scope for the configurable request-processing
// engine (e.g. office hours for in-person inspection, "no duty to create a
// record"). Filtering here — deterministically, after discovery — cuts noise
// and, more importantly, shrinks the Verify fan-out (the expensive step). All
// three lists OR together; anything matched is dropped before canonicalize
// (rows) or before verify (candidate families/keys), and logged.
// Populate from EXCLUSION_review.md. args.exclude can override/extend at runtime.
const EXCLUDE = {
  categories:        [],   // exact rule.category match, e.g. 'Inspection'
  conceptKeyMatches: [],   // substring match on a rule's coined concept_key, e.g. 'office_hours', 'create_record'
  candidateFamilies: [],   // candidate_key prefix before the first dot, e.g. 'inspection'
  candidateKeys:     [],   // exact reconciled candidate_key, e.g. 'inspection.office_hours'
  ...(args && args.exclude ? args.exclude : {}),
}
function rowExcluded(r){
  if (EXCLUDE.categories.includes(r.category)) return true
  const ck = (r.concept_key || '').toLowerCase()
  if (EXCLUDE.conceptKeyMatches.some(p => ck.includes(String(p).toLowerCase()))) return true
  return false
}
function candidateExcluded(c){
  const key = c.key || ''
  const fam = key.split('.')[0]
  return EXCLUDE.candidateFamilies.includes(fam) || EXCLUDE.candidateKeys.includes(key)
}

function abbr(s){ return ({Texas:'TX',California:'CA','New York':'NY',Florida:'FL',Illinois:'IL',Virginia:'VA',Washington:'WA',Arizona:'AZ',Georgia:'GA',Ohio:'OH',Pennsylvania:'PA',Michigan:'MI',Colorado:'CO',Oregon:'OR',Minnesota:'MN',Massachusetts:'MA','North Carolina':'NC','New Jersey':'NJ'})[s] || s.slice(0,2).toUpperCase() }
const budgetOk = (floor) => !budget.total || budget.remaining() > floor

const RULE = {
  type: 'object',
  properties: {
    rule_id: { type: 'string' }, category: { type: 'string' }, concept_key: { type: 'string' },
    legal_concept: { type: 'string' }, rule_type: { type: 'string' },
    config_home: { type: 'string', enum: ['parameter','structural'] },
    constraint_basis: { type: 'string', enum: ['fixed','ceiling','floor','soft-standard','n/a'], description: 'parameters only: how the state binds the value; n/a for structural' },
    atomic_rule: { type: 'string' }, trigger: { type: 'string' },
    clock_effect: { type: 'string', enum: ['none','sets-deadline','tolls','pauses','restarts','resets','terminal'] },
    clock_spec: { type: 'string' }, related_rule_ids: { type: 'array', items: { type: 'string' } },
    source_language: { type: 'string' }, is_paraphrase: { type: 'boolean' },
    source_authority: { type: 'string' }, effective_status: { type: 'string' }, official_link: { type: 'string' }, notes: { type: 'string' },
  },
  required: ['rule_id','category','concept_key','config_home','atomic_rule','clock_effect','source_language','is_paraphrase','source_authority'],
}
const DISCOVERY_SCHEMA = {
  type: 'object',
  properties: {
    state: { type: 'string' }, rules: { type: 'array', items: RULE },
    material_negatives: { type: 'array', items: { type: 'object', properties: { concept_key:{type:'string'}, note:{type:'string'} }, required:['note'] } },
    structural_branches: { type: 'array', items: { type: 'object', properties: { concept_key:{type:'string'}, description:{type:'string'} }, required:['concept_key','description'] } },
    verbatim_captured_count: { type: 'integer' },
  },
  required: ['state','rules','verbatim_captured_count'],
}

// RESUME: pass args.discoveryResults (e.g. from docs/rules_research/wave1/salvage/discovery.json)
// to skip the 10 expensive high-effort research agents and reuse a prior run's discovery.
phase('Discover')
let states
if (args && args.discoveryResults && args.discoveryResults.length) {
  states = args.discoveryResults.filter(Boolean)
  log(`RESUME: reusing ${states.length} salvaged discovery results — Discover phase skipped.`)
} else {
  const disc = await parallel(STATES.map(s => () =>
    agent(
      `Research **${s}** public-records law and return configurable request-processing rules. This is a WAVE of a 50-state build; if there is no shared dictionary yet, coin concept_key slugs freely (state-neutral family.thing) — they will be reconciled after.

FIRST Read ${CONTRACT} — the FULL contract incl. the "Discovery discipline" section. Follow ALL of it: VERBATIM operative clause in source_language (is_paraphrase=true ONLY if you truly could not open the source — try hard to open the primary statute); NO contentless rules (empty -> a material_negative, not a rule); universal-access facts (any person / no residency / no purpose) as RULES with the shared eligibility keys, never negatives; soft deadlines -> clock_spec undefined-soft + config_home=structural; for PARAMETER rules set constraint_basis (fixed | ceiling | floor | soft-standard) — a state gives a constraint, the city fills the value. ONE override: ignore the "Prohibited output: JSON" line; return via the schema.

Official ${s} sources only; inclusion test; one atomic rule per row. Cover the common areas thoroughly (eligibility, intake, response/acknowledgment deadlines, search, fees & payment, redaction, denials, appeals, production) so there is rich cross-state overlap. Accuracy over count.`,
      { label: `discover:${abbr(s)}`, phase: 'Discover', schema: DISCOVERY_SCHEMA, effort: 'high' }
    )
  ))
  states = disc.filter(Boolean)
}
if (states.length < Math.min(5, STATES.length)) return { error: 'too few states discovered', got: states.length }

function isContentless(r){ return (!r.source_language || !r.source_language.trim()) && (!r.clock_effect || r.clock_effect==='none') && (!r.trigger || /^(none|n\/a|)$/i.test((r.trigger||'').trim())) && !r.config_home }
const rows = []
states.forEach(s => s.rules.filter(r=>!isContentless(r)).forEach(r => rows.push({
  state: s.state, st: abbr(s.state), rule_id: r.rule_id, concept_key: r.concept_key, category: r.category,
  config_home: r.config_home, constraint_basis: r.constraint_basis || 'n/a', atomic_rule: r.atomic_rule,
  source_language: r.source_language||'', is_paraphrase: !!r.is_paraphrase, clock_effect: r.clock_effect,
  clock_spec: r.clock_spec||'', source_authority: r.source_authority||'',
})))
// EXCLUDE out-of-scope rule types before anything downstream sees them.
const preExcludeCount = rows.length
const excludedRows = rows.filter(rowExcluded)
for (let i = rows.length - 1; i >= 0; i--) if (rowExcluded(rows[i])) rows.splice(i, 1)
const rowById = {}; rows.forEach(r => rowById[r.rule_id] = r)
if (excludedRows.length) {
  const byCat = {}; excludedRows.forEach(r => { byCat[r.category] = (byCat[r.category]||0)+1 })
  log(`Excluded ${excludedRows.length}/${preExcludeCount} rows as out-of-scope: ` + Object.entries(byCat).map(([k,v])=>`${k} ${v}`).join(', '))
}
log(`Discovered: ` + states.map(s => `${abbr(s.state)} ${s.rules.length}r/${s.verbatim_captured_count}v`).join('  ') + `  | usable rows after exclusions: ${rows.length}`)

phase('Canonicalize')
const CANON_SCHEMA = {
  type: 'object',
  properties: {
    candidate_concepts: { type: 'array', items: { type: 'object', properties: {
      candidate_key: { type: 'string' }, definition: { type: 'string' }, config_home: { type: 'string' },
      member_rule_ids: { type: 'array', items: { type: 'string' } },
    }, required: ['candidate_key','member_rule_ids'] } },
  },
  required: ['candidate_concepts'],
}
// RESUME: pass args.canon (e.g. salvage/canonicalize.json) to reuse a prior clusterer run.
let canon
if (args && args.canon && args.canon.candidate_concepts) {
  canon = args.canon
  log(`RESUME: reusing ${canon.candidate_concepts.length} salvaged candidate concepts — Canonicalize phase skipped.`)
} else {
  canon = await agent(
    `You are the CANDIDATE clusterer for a ${states.length}-state master list. Group these rules into candidate concepts by shared operative rule, judged from VERBATIM source_language (weight verbatim over paraphrase). Merge across DIFFERENT slugs when rules coincide. A candidate concept = the same LEVER (the underlying thing a city/engine configures, or the same procedural obligation), NOT the same value. Put rules that plausibly describe one lever into one candidate even if their day-counts, fee amounts, constraint basis, or parameter/structural labels differ — the Verify step will confirm or split. Return every usable rule_id in at least one candidate.

RULES:
${JSON.stringify(rows.map(r => ({ id: r.rule_id, st: r.st, cat: r.category, home: r.config_home, basis: r.constraint_basis, rule: r.atomic_rule, verbatim: r.source_language, clock: r.clock_effect })))}`,
    { label: 'canonicalize', phase: 'Canonicalize', schema: CANON_SCHEMA, effort: 'high' }
  )
}
if (!canon) return { error: 'canonicalize failed', states: states.length }

// candidate clusters, cleaned to real rule_ids (members already exclude dropped rows via rowById)
const candidatesAll = (canon.candidate_concepts||[]).map(c => ({
  key: c.candidate_key, definition: c.definition||'', config_home: c.config_home||'',
  members: (c.member_rule_ids||[]).filter(id => rowById[id]).map(id => ({ rule_id: id, st: rowById[id].st })),
})).filter(c => c.members.length > 0)
// EXCLUDE whole candidate families/keys before the (expensive) Verify fan-out.
const droppedCands = candidatesAll.filter(candidateExcluded)
const candidates = candidatesAll.filter(c => !candidateExcluded(c))
if (droppedCands.length) log(`Excluded ${droppedCands.length} candidate concepts by family/key: ` + droppedCands.map(c=>c.key).join(', '))

// ============================================================================
// VERIFY — one PARTITION agent per multi-state cluster.
// Old design fanned out one agent per cross-state PAIR: sum of N*(N-1)/2 over
// clusters -> 1068 high-effort agents -> tripped the monthly spend limit and
// aborted at the 1000-agent cap. Here each cluster is ONE agent that returns
// a same-lever partition of its members, so the fan-out is linear in the
// number of clusters (bounded, and hard-capped below).
// ============================================================================
phase('Verify')
const toVerify = candidates.filter(c => new Set(c.members.map(x=>x.st)).size >= 2)
log(`Candidates: ${candidates.length}  |  multi-state clusters to verify: ${toVerify.length}  |  verify agents: ${Math.min(toVerify.length, MAX_VERIFY_AGENTS)} (cap ${MAX_VERIFY_AGENTS})`)

// GUARD 1: hard agent cap. If a run ever produced more multi-state clusters
// than the cap, verify the largest ones and log what was left unverified
// (an unverified cluster stays intact — conservative, and it's reported).
const verifyList = toVerify
  .slice()
  .sort((a,b) => b.members.length - a.members.length)
  .slice(0, MAX_VERIFY_AGENTS)
const skippedForCap = toVerify.length - verifyList.length
if (skippedForCap > 0) log(`WARNING: ${skippedForCap} multi-state clusters exceeded the verify cap and were left UNVERIFIED (kept intact).`)

// GUARD 2: budget. If we can't afford the verify phase, stop cleanly with
// partial results instead of firing agents that will all fail on the limit.
if (!budgetOk(MIN_BUDGET_TO_VERIFY)) {
  return { error: 'insufficient token budget for Verify phase', remaining: budget.remaining(), candidates: candidates.length, states: states.length }
}

const PARTITION_SCHEMA = {
  type: 'object',
  properties: {
    groups: { type: 'array', items: { type: 'object', properties: {
      lever: { type: 'string' },
      member_rule_ids: { type: 'array', items: { type: 'string' } },
    }, required: ['member_rule_ids'] } },
  },
  required: ['groups'],
}
function partitionPrompt(c) {
  const lines = c.members.map(m => {
    const r = rowById[m.rule_id]
    return `- ${r.rule_id} (${r.st}): ${r.atomic_rule}\n    verbatim: ${r.source_language || '(none)'}\n    config_home: ${r.config_home}  basis: ${r.constraint_basis}  clock: ${r.clock_effect} ${r.clock_spec}`
  }).join('\n')
  return `Partition this candidate cluster of public-records rules from different states into groups, where each group is the SAME LEVER — the same underlying thing a city/engine configures, or the same procedural obligation. A LEVER, not a value.

Put two rules in the SAME group when they differ ONLY in:
  - value (5 days vs 10 days vs 3 days; 15c vs 25c) — the value is a per-state cell;
  - constraint basis (fixed vs ceiling "shall not exceed" vs floor vs soft-standard "reasonable"/"promptly", INCLUDING fixed-vs-soft: a hard 5-day window and a soft "promptly" window are the SAME lever, different basis);
  - config_home labeling (one reads parameter, the other structural) — home is a property of the lever, decided later; do NOT split on it.
Put them in DIFFERENT groups only on a genuine SHAPE/OBLIGATION/TYPE difference: a different obligation (time-to-ACKNOWLEDGE vs time-to-COMPLY-or-deny), a different fee TYPE (copy vs search), a different record class (ordinary vs special-format), a toll-vs-terminal clock, or a judicial-vs-administrative fork. Example that must stay together: NY "5 business days to respond" and CA "10 days to determine" IF both are the initial-response lever; separate them only if one is acknowledge-receipt and the other is produce/comply — judge from the verbatim.

Return every member_rule_id in EXACTLY ONE group. If the whole cluster is one lever, return a single group with all members. Give each group a short lever name.

Candidate "${c.key}"${c.definition ? ` — ${c.definition}` : ''}
Members:
${lines}`
}

const partitions = await parallel(verifyList.map(c => () =>
  agent(partitionPrompt(c), { label: `verify:${c.key}`, phase: 'Verify', schema: PARTITION_SCHEMA, effort: 'high' })
    .then(p => ({ c, p }))
))

// Build the HOLD set from the partitions: any two members the SAME group are
// a hold; members in different groups (or in an errored/unverified cluster)
// are simply absent from holdSet -> cliqueCover splits them conservatively.
const holdSet = new Set()
let verifyErrors = 0
for (const entry of partitions) {
  if (!entry) { verifyErrors++; continue }
  const { p } = entry
  if (!p) { verifyErrors++; continue }              // agent errored — NOT a "split" signal; just leaves this cluster unheld
  ;(p.groups || []).forEach(g => {
    const ids = (g.member_rule_ids || []).filter(id => rowById[id])
    for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) holdSet.add([ids[i],ids[j]].sort().join('|'))
  })
}
// GUARD 3: if most verify agents errored (classic spend-limit cascade), the
// partition is meaningless — abort loudly instead of shipping an all-split dict.
if (verifyList.length > 0 && verifyErrors > verifyList.length / 2) {
  return { error: 'Verify phase mostly failed (likely spend limit / API errors) — not shipping a corrupted dictionary', verifyErrors, attempted: verifyList.length, remaining: budget.remaining() }
}
function holds(aId, bId){ return aId === bId || holdSet.has([aId,bId].sort().join('|')) }
log(`Verify done: ${verifyList.length} clusters partitioned (${verifyErrors} errored), ${holdSet.size} hold-pairs`)

phase('Apply+Pivot')
// APPLY — deterministic clique cover: a member joins a group only if it HOLDs
// with ALL members already in that group. Never puts a split pair together.
function cliqueCover(members){
  const groups = []
  for (const m of members){
    let placed = false
    for (const g of groups){ if (g.every(x => x.st === m.st || holds(m.rule_id, x.rule_id))){ g.push(m); placed = true; break } }
    if (!placed) groups.push([m])
  }
  return groups
}
const finalConcepts = []
let splitEvents = 0
candidates.forEach(c => {
  const groups = cliqueCover(c.members)
  if (groups.length > 1) splitEvents++
  groups.forEach((g, gi) => finalConcepts.push({
    key: groups.length > 1 ? `${c.key}__${gi+1}` : c.key,
    definition: c.definition, config_home: c.config_home,
    states: [...new Set(g.map(x=>x.st))], members: g.map(x=>x.rule_id),
    wasSplitFrom: groups.length > 1 ? c.key : null,
  }))
})
// ACCEPTANCE CHECK: no cross-state SPLIT pair may survive inside any final concept.
let violations = 0
finalConcepts.forEach(fc => { const ids = fc.members; for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){ if(rowById[ids[i]].st!==rowById[ids[j]].st && !holds(ids[i],ids[j])) violations++ } })
const multiFinal = finalConcepts.filter(fc => fc.states.length >= 2)
log(`Apply-verdicts: ${candidates.length} candidates -> ${finalConcepts.length} final concepts (${splitEvents} split); multi-state: ${multiFinal.length}; acceptance violations: ${violations}`)

// GUARD 4: budget before the (single, expensive) pivot agent.
if (!budgetOk(MIN_BUDGET_TO_PIVOT)) {
  return { error: 'insufficient budget for Pivot — returning verified concepts without master-list pivot',
    remaining: budget.remaining(), finalConcepts, multiState: multiFinal.length, acceptanceViolations: violations }
}

const PIVOT_SCHEMA = {
  type: 'object',
  properties: {
    dictionary: { type:'array', items:{ type:'object', properties:{ canonical_key:{type:'string'}, definition:{type:'string'}, config_home:{type:'string'}, states:{type:'array',items:{type:'string'}} }, required:['canonical_key','definition'] } },
    parameter_table: { type:'array', items:{ type:'object', properties:{ canonical_key:{type:'string'}, cells:{type:'array', items:{ type:'object', properties:{ st:{type:'string'}, basis:{type:'string'}, value:{type:'string'}, citation:{type:'string'} }, required:['st'] }} }, required:['canonical_key','cells'] } },
    structural_catalog: { type:'array', items:{ type:'object', properties:{ canonical_key:{type:'string'}, shape:{type:'string'}, states:{type:'array',items:{type:'string'}} }, required:['canonical_key','shape'] } },
  },
  required: ['dictionary','parameter_table','structural_catalog'],
}
const conceptsForPivot = multiFinal.concat(finalConcepts.filter(fc => fc.states.length === 1)).map(fc => ({
  canonical_key: fc.key, definition: fc.definition, config_home: fc.config_home, states: fc.states,
  members: fc.members.map(id => ({ st: rowById[id].st, rule_id: id, config_home: rowById[id].config_home, constraint_basis: rowById[id].constraint_basis, atomic_rule: rowById[id].atomic_rule, clock_spec: rowById[id].clock_spec, source_authority: rowById[id].source_authority })),
}))
const pivot = await agent(
  `These are the VERIFIED final concepts for a ${states.length}-state master list (${states.map(s=>abbr(s.state)).join('/')}), already reconciled and split-checked. Build the master-list outputs. Do NOT re-merge or re-split — take the concepts as given.

ONE config_home PER CONCEPT: a concept's home is a property of the LEVER, not the state. If members disagree (some tagged parameter, some structural), decide by the lever: if it is a tunable value/threshold/window/rate (even where a state's basis is soft-standard or the state is absent), it is a PARAMETER; reserve STRUCTURAL for genuine process-shape forks (a stage, branch, gate, or eligibility fork). Do not emit the same lever as parameter in one state and structural in another.

For each concept emit a dictionary entry (canonical_key, one-line definition, the SINGLE config_home, states). For PARAMETER concepts, add a parameter_table row: per-state cells with constraint basis (fixed/ceiling/floor/soft-standard), the value/bound, and citation — the state gives a CONSTRAINT, the city fills the value; a state with no number carries basis=soft-standard (or is absent -> a material negative, not a cell). For STRUCTURAL concepts, add a structural_catalog row: the shape of the path/stage and which states have it.

Concepts:
${JSON.stringify(conceptsForPivot)}`,
  { label: 'pivot', phase: 'Apply+Pivot', schema: PIVOT_SCHEMA, effort: 'high' }
)

phase('Report')
const dict = (pivot && pivot.dictionary) || []
const respWindow = ((pivot&&pivot.parameter_table)||[]).filter(p => /response|initial.*window|acknowledg|determination.*window/i.test(p.canonical_key||''))
const report = await agent(
  `Write the report (markdown, for the technical product owner) for the ${WAVE} run: states ${states.map(s=>abbr(s.state)).join('/')}. Reconciliation ran under two granularity rules: (A) a concept is the LEVER not the value (value/basis/config-home differences do NOT split a concept), and (B) one config_home per concept.

DISCOVERY: ${states.map(s => `${abbr(s.state)} ${s.rules.length}r/${s.verbatim_captured_count}v/${(s.material_negatives||[]).length}neg`).join(' · ')} | usable rows: ${rows.length}
RECONCILIATION: ${candidates.length} candidate concepts -> ${finalConcepts.length} final concepts after apply-verdicts (${splitEvents} candidates split by verify); ${multiFinal.length} multi-state. Verify: ${verifyList.length} multi-state clusters partitioned (${verifyErrors} errored${skippedForCap>0?`, ${skippedForCap} skipped for cap`:''}), ${holdSet.size} hold-pairs.
ACCEPTANCE CHECK: ${violations} surviving split-pair violations (MUST be 0).
RESPONSE-WINDOW CONCEPT(S) FOUND (the fragmentation test): ${JSON.stringify(respWindow)}
DICTIONARY (${dict.length} concepts): ${JSON.stringify(dict.slice(0,90))}
PARAMETER TABLE (sample): ${JSON.stringify(((pivot&&pivot.parameter_table)||[]).slice(0,30))}
STRUCTURAL CATALOG: ${JSON.stringify((pivot&&pivot.structural_catalog)||[])}

Sections:
## 1. Reconciliation verdict — LEAD with this. (a) Is the initial response window ONE concept with per-state cells, or still fragmented by value? (b) Did config_home unify (no lever that is parameter in one state and structural in another)? (c) Concept count and whether it tracks real new legal surface vs fragmentation.
## 2. The master list — distinct concepts, parameter vs structural. Highlight cross-state PARAMETER concepts with per-state basis+value; note where a state is ABSENT (material negative).
## 3. Structural forks — the state-specific paths/stages found, confirming they are catalogued as structural not flattened to parameters.
## 4. Reconciliation health — did apply-verdicts fire, was the acceptance check clean, verbatim capture rate, contentless count, any weak state discovery, and any clusters left unverified by the cap.
## 5. Ready for the next wave? — is this dictionary a sound seed to feed the next states, and what to watch. Be specific and honest.`,
  { label: `${WAVE}-report`, phase: 'Report', effort: 'high' }
)

return {
  report,
  stats: { states: states.map(s=>({st:abbr(s.state),rules:s.rules.length,verbatim:s.verbatim_captured_count})), usableRows: rows.length,
    candidates: candidates.length, finalConcepts: finalConcepts.length, splitEvents, multiState: multiFinal.length,
    clustersVerified: verifyList.length, verifyErrors, skippedForCap, holdPairs: holdSet.size,
    acceptanceViolations: violations, dictSize: dict.length },
  dictionary: pivot&&pivot.dictionary, parameter_table: pivot&&pivot.parameter_table, structural_catalog: pivot&&pivot.structural_catalog,
  finalConcepts,
}
