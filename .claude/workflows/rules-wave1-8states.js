export const meta = {
  name: 'rules-wave1-8states',
  description: 'Wave 1 of the 50-state blast: 8 states, full reconciliation with apply-verdicts + pairwise-complete verify. Seeds the concept dictionary.',
  phases: [
    { title: 'Discover', detail: '8 states under the final V2 prompt (verbatim, no contentless, constraint basis)' },
    { title: 'Canonicalize', detail: 'candidate clusterer over all rules' },
    { title: 'Verify', detail: 'pairwise-COMPLETE on every multi-member candidate cluster' },
    { title: 'Apply+Pivot', detail: 'clique-cover reshape (JS) -> parameter tables, structural catalog, dictionary' },
    { title: 'Report', detail: 'wave-1 deliverables + acceptance check (no split pair survives)' },
  ],
}

const CONTRACT = '/opt/optimumq/docs/rules_research/V2_state_research_prompt.md'
const STATES = ['Texas','California','New York','Florida','Illinois','Virginia','Washington','Arizona','Georgia','Ohio']
function abbr(s){ return ({Texas:'TX',California:'CA','New York':'NY',Florida:'FL',Illinois:'IL',Virginia:'VA',Washington:'WA',Arizona:'AZ',Georgia:'GA',Ohio:'OH'})[s] || s.slice(0,2).toUpperCase() }

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

phase('Discover')
const disc = await parallel(STATES.map(s => () =>
  agent(
    `Research **${s}** public-records law and return configurable request-processing rules. This is WAVE 1 of a 50-state build; there is no shared dictionary yet, so coin concept_key slugs freely (state-neutral family.thing) — they will be reconciled after.

FIRST Read ${CONTRACT} — the FULL contract incl. the "Discovery discipline" section. Follow ALL of it: VERBATIM operative clause in source_language (is_paraphrase=true ONLY if you truly could not open the source — try hard to open the primary statute); NO contentless rules (empty → a material_negative, not a rule); universal-access facts (any person / no residency / no purpose) as RULES with the shared eligibility keys, never negatives; soft deadlines → clock_spec undefined-soft + config_home=structural; for PARAMETER rules set constraint_basis (fixed | ceiling | floor | soft-standard) — a state gives a constraint, the city fills the value. ONE override: ignore the "Prohibited output: JSON" line; return via the schema.

Official ${s} sources only; inclusion test; one atomic rule per row. Cover the common areas thoroughly (eligibility, intake, response/acknowledgment deadlines, search, fees & payment, redaction, denials, appeals, production) so there is rich cross-state overlap. Accuracy over count.`,
    { label: `discover:${abbr(s)}`, phase: 'Discover', schema: DISCOVERY_SCHEMA, effort: 'high' }
  )
))
const states = disc.filter(Boolean)
if (states.length < 5) return { error: 'too few states discovered', got: states.length }

function isContentless(r){ return (!r.source_language || !r.source_language.trim()) && (!r.clock_effect || r.clock_effect==='none') && (!r.trigger || /^(none|n\/a|)$/i.test((r.trigger||'').trim())) && !r.config_home }
const rows = []
states.forEach(s => s.rules.filter(r=>!isContentless(r)).forEach(r => rows.push({
  state: s.state, st: abbr(s.state), rule_id: r.rule_id, concept_key: r.concept_key, category: r.category,
  config_home: r.config_home, constraint_basis: r.constraint_basis || 'n/a', atomic_rule: r.atomic_rule,
  source_language: r.source_language||'', is_paraphrase: !!r.is_paraphrase, clock_effect: r.clock_effect,
  clock_spec: r.clock_spec||'', source_authority: r.source_authority||'',
})))
const rowById = {}; rows.forEach(r => rowById[r.rule_id] = r)
log(`Discovered: ` + states.map(s => `${abbr(s.state)} ${s.rules.length}r/${s.verbatim_captured_count}v`).join('  ') + `  | total usable rows: ${rows.length}`)

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
const canon = await agent(
  `You are the CANDIDATE clusterer for a 10-state master list. Group these rules into candidate concepts by shared operative rule, judged from VERBATIM source_language (weight verbatim over paraphrase). Merge across DIFFERENT slugs when rules coincide.

A CONCEPT IS THE LEVER, NOT THE VALUE (ruled 2026-07-21). Rules describing the SAME underlying lever are ONE concept even when they differ in:
  - value (5 days vs 10 days; 15¢ vs 25¢) — the value is a per-state cell, not a new concept;
  - constraint basis (fixed vs ceiling vs floor vs soft-standard "reasonable"/"promptly") — basis is a per-state attribute;
  - config_home labeling (one state's rule looks like a parameter, another's like a structural note) — the home is a property of the lever, resolved later, NOT a reason to separate.
Example: the initial response window is ONE concept — NY 5 days, CA 10 days, GA 3 days, and TX/FL/AZ/OH "promptly/reasonable" (soft) all belong to \`deadline.initial_response_window\`, differing only by basis+value.
SPLIT into different concepts ONLY on a genuine SHAPE or OBLIGATION difference: a different obligation (time-to-ACKNOWLEDGE vs time-to-COMPLY-or-deny are different concepts), a different fee TYPE (copy vs search), a different record class, a toll-vs-terminal clock, or a judicial-vs-administrative fork.

It is fine to over-group on value/basis — the pairwise-verify pass will split only genuine shape/obligation differences. Return candidate concepts by member_rule_ids (exact rule_id strings).

Rules (${rows.length}):
${JSON.stringify(rows.map(r => ({ rule_id:r.rule_id, st:r.st, concept_key:r.concept_key, category:r.category, config_home:r.config_home, constraint_basis:r.constraint_basis, atomic_rule:r.atomic_rule, source_language:r.source_language, clock_effect:r.clock_effect, clock_spec:r.clock_spec })))}`,
  { label: 'canonicalize', phase: 'Canonicalize', schema: CANON_SCHEMA, effort: 'high' }
)
if (!canon) return { error: 'canonicalize failed', states: states.length }

// candidate clusters, cleaned to real rule_ids
const candidates = (canon.candidate_concepts||[]).map(c => ({
  key: c.candidate_key, definition: c.definition||'', config_home: c.config_home||'',
  members: (c.member_rule_ids||[]).filter(id => rowById[id]).map(id => ({ rule_id: id, st: rowById[id].st })),
})).filter(c => c.members.length > 0)
// cross-state pairs to verify (pairwise-COMPLETE within every multi-member candidate)
const pairs = []
candidates.forEach((c, ci) => {
  const m = c.members
  for (let i=0;i<m.length;i++) for (let j=i+1;j<m.length;j++) {
    if (m[i].st !== m[j].st) pairs.push({ ci, a: m[i].rule_id, b: m[j].rule_id })
  }
})
const multiCount = candidates.filter(c => new Set(c.members.map(x=>x.st)).size >= 2).length
log(`Candidates: ${candidates.length}  |  multi-state: ${multiCount}  |  cross-state pairs to verify: ${pairs.length}`)

phase('Verify')
const VERDICT_SCHEMA = { type:'object', properties:{ verdict:{type:'string',enum:['hold','split']}, reason:{type:'string'} }, required:['verdict','reason'] }
function verifyPrompt(a, b) {
  return `Do these two rules describe the SAME LEVER (the same underlying thing a city/engine configures or the same procedural obligation)? A LEVER, not a value — so HOLD when they differ ONLY in:
  - value (5 days vs 10 days vs 3 days; 15¢ vs 25¢) — the value is a per-state cell;
  - constraint basis (fixed vs ceiling "shall not exceed" vs floor vs soft-standard "reasonable"/"promptly", INCLUDING fixed-vs-soft: a hard 5-day window and a soft "promptly" window are the SAME lever, different basis);
  - config_home labeling (one reads parameter, the other structural) — home is a property of the lever, decided later; do NOT split on it.
SPLIT only on a genuine SHAPE/OBLIGATION/TYPE difference: a different obligation (time-to-ACKNOWLEDGE vs time-to-COMPLY-or-deny), a different fee TYPE (copy vs search), a different record class (ordinary vs special-format), a toll-vs-terminal clock, or a judicial-vs-administrative fork. Example that must HOLD: NY "5 business days to respond" and CA "10 days to determine" IF both are the initial-response lever; SPLIT them only if one is acknowledge-receipt and the other is produce/comply — judge that from the verbatim.

RULE 1 (${a.st}): ${a.atomic_rule}
  verbatim: ${a.source_language || '(none)'}
  config_home: ${a.config_home}  basis: ${a.constraint_basis}  clock: ${a.clock_effect} ${a.clock_spec}
RULE 2 (${b.st}): ${b.atomic_rule}
  verbatim: ${b.source_language || '(none)'}
  config_home: ${b.config_home}  basis: ${b.constraint_basis}  clock: ${b.clock_effect} ${b.clock_spec}`
}
const verdicts = await parallel(pairs.map(p => () =>
  agent(verifyPrompt(rowById[p.a], rowById[p.b]), { label: `verify:${p.a}~${p.b}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' })
    .then(v => v ? { ...p, verdict: v.verdict, reason: v.reason } : { ...p, verdict: 'split', reason: 'verify errored -> conservative split' })
))
const holdSet = new Set(verdicts.filter(v => v.verdict === 'hold').map(v => [v.a, v.b].sort().join('|')))
function holds(aId, bId){ return aId === bId || holdSet.has([aId,bId].sort().join('|')) }
log(`Verify done: ${verdicts.filter(v=>v.verdict==='hold').length} hold / ${verdicts.filter(v=>v.verdict==='split').length} split`)

phase('Apply+Pivot')
// APPLY THE VERDICTS — deterministic clique cover: a member joins a group only if it HOLDs with ALL members
// already in that group (unchecked/split -> not hold). Non-transitive-safe: never puts a split pair together.
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
log(`Apply-verdicts: ${candidates.length} candidates -> ${finalConcepts.length} final concepts (${splitEvents} candidates split); multi-state: ${multiFinal.length}; acceptance violations: ${violations}`)

// PIVOT — parameter tables + structural catalog + dictionary, from the VERIFIED final concepts.
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
  `These are the VERIFIED final concepts for a 10-state master list (TX/CA/NY/FL/IL/VA/WA/AZ/GA/OH), already reconciled and split-checked. Build the master-list outputs. Do NOT re-merge or re-split — take the concepts as given.

ONE config_home PER CONCEPT (ruled 2026-07-21): a concept's home is a property of the LEVER, not the state. If members disagree (some tagged parameter, some structural), decide by the lever: if it is a tunable value/threshold/window/rate (even where a state's basis is soft-standard or the state is absent), it is a PARAMETER; reserve STRUCTURAL for genuine process-shape forks (a stage, branch, gate, or eligibility fork). Do not emit the same lever as parameter in one state and structural in another.

For each concept emit a dictionary entry (canonical_key, one-line definition, the SINGLE config_home, states). For PARAMETER concepts, add a parameter_table row: per-state cells with constraint basis (fixed/ceiling/floor/soft-standard), the value/bound, and citation — the state gives a CONSTRAINT, the city fills the value; a ceiling and a fixed of the same lever are the same concept, different basis; a state with no number carries basis=soft-standard (or is absent → a material negative, not a cell). For STRUCTURAL concepts, add a structural_catalog row: the shape of the path/stage and which states have it.

Concepts:
${JSON.stringify(conceptsForPivot)}`,
  { label: 'pivot', phase: 'Apply+Pivot', schema: PIVOT_SCHEMA, effort: 'high' }
)

phase('Report')
const respWindow = (pivot&&pivot.parameter_table||[]).filter(p => /response|initial.*window|acknowledg|determination.*window/i.test(p.canonical_key||''))
const report = await agent(
  `Write the report (markdown, for the technical product owner). This is a 10-STATE run (TX/CA/NY/FL/IL/VA/WA/AZ/GA/OH) that RE-RECONCILES under two granularity fixes ruled 2026-07-21 — (A) a concept is the LEVER not the value (value/basis/config-home differences do NOT split a concept), and (B) one config_home per concept. It adds Georgia (3-business-day window — a NEW value) and Ohio (soft "reasonable" — no fixed window) specifically to test whether they FOLD INTO existing concepts instead of minting new ones. The prior 8-state run produced 173 concepts and had fragmented the response window into 3 concepts keyed by value; the test is whether that is now fixed.

DISCOVERY: ${states.map(s => `${abbr(s.state)} ${s.rules.length}r/${s.verbatim_captured_count}v/${(s.material_negatives||[]).length}neg`).join(' · ')} | usable rows: ${rows.length}
RECONCILIATION: ${candidates.length} candidate concepts -> ${finalConcepts.length} final concepts after apply-verdicts (${splitEvents} candidates split by verify); ${multiFinal.length} multi-state, ${pairs.length} cross-state pairs verified (${verdicts.filter(v=>v.verdict==='hold').length} hold / ${verdicts.filter(v=>v.verdict==='split').length} split).
ACCEPTANCE CHECK: ${violations} surviving split-pair violations (MUST be 0).
RESPONSE-WINDOW CONCEPT(S) FOUND (the fragmentation test): ${JSON.stringify(respWindow)}
DICTIONARY (${(pivot&&pivot.dictionary||[]).length} concepts): ${JSON.stringify((pivot&&pivot.dictionary||[]).slice(0,90))}
PARAMETER TABLE (sample): ${JSON.stringify((pivot&&pivot.parameter_table||[]).slice(0,30))}
STRUCTURAL CATALOG: ${JSON.stringify(pivot&&pivot.structural_catalog||[])}

Sections:
## 1. Did the fixes work? — LEAD with this. (a) Is the initial response window now ONE concept with per-state cells (NY 5 / CA 10 / GA 3 / soft for TX/FL/AZ/OH), or still fragmented by value? (b) Did config_home unify (no lever that is parameter in one state and structural in another)? (c) How did GA and OH map — did they fold into existing concepts (good) or mint new value-keyed ones (bad)? (d) Concept count: 10 states = ${(pivot&&pivot.dictionary||[]).length} concepts vs 8 states = 173 — did adding 2 states grow the count roughly in line with real new legal surface, or did the collapse actually REDUCE fragmentation? Give a clear worked/partly/not-worked verdict.
## 2. The master list — distinct concepts, parameter vs structural. Highlight cross-state PARAMETER concepts with per-state basis+value; note where a state is ABSENT (material negative).
## 3. Structural forks — the state-specific paths/stages found (TX AG pre-clearance, VA residency condition, WA/others), confirming they are catalogued as structural not flattened to parameters.
## 4. Reconciliation health — did apply-verdicts fire (candidates split), was the acceptance check clean, verbatim capture rate, contentless count. Any state whose discovery looks weak.
## 5. Ready for wave 2? — is this dictionary a sound seed to feed the next 8-10 states, and what to watch. Be specific and honest.`,
  { label: 'wave1-report', phase: 'Report', effort: 'high' }
)

return {
  report,
  stats: { states: states.map(s=>({st:abbr(s.state),rules:s.rules.length,verbatim:s.verbatim_captured_count})), usableRows: rows.length,
    candidates: candidates.length, finalConcepts: finalConcepts.length, splitEvents, multiState: multiFinal.length,
    pairsVerified: pairs.length, holds: verdicts.filter(v=>v.verdict==='hold').length, splits: verdicts.filter(v=>v.verdict==='split').length,
    acceptanceViolations: violations, dictSize: (pivot&&pivot.dictionary||[]).length },
  dictionary: pivot&&pivot.dictionary, parameter_table: pivot&&pivot.parameter_table, structural_catalog: pivot&&pivot.structural_catalog,
  finalConcepts, verdicts,
}
