export const meta = {
  name: 'rules-discovery-chunked',
  description: 'Discovery for a single DENSE state, split across category-scoped agents so no single structured response overflows (the NJ rules:[] failure). Merges the chunks into one discovery object, with a hard guard against silent empty-rules loss.',
  phases: [
    { title: 'Discover', detail: 'one agent per category-chunk, scoped to its areas' },
  ],
}

const CONTRACT = '/opt/optimumq/docs/rules_research/V2_state_research_prompt.md'
let ARGS = args
if (typeof ARGS === 'string') { try { ARGS = JSON.parse(ARGS) } catch (e) { ARGS = {} } }
const STATE = (ARGS && ARGS.state) || 'New Jersey'
const ABBRS = {Texas:'TX',California:'CA','New York':'NY',Florida:'FL',Illinois:'IL',Virginia:'VA',Washington:'WA',Arizona:'AZ',Georgia:'GA',Ohio:'OH',Pennsylvania:'PA',Michigan:'MI',Colorado:'CO',Oregon:'OR',Minnesota:'MN',Massachusetts:'MA','North Carolina':'NC','New Jersey':'NJ',Tennessee:'TN',Connecticut:'CT'}
const ST = ABBRS[STATE] || STATE.slice(0,2).toUpperCase()

// Category chunks — each a balanced slice so a dense statute fits one response.
// Override via args.chunks: [{ label, prefix, areas:[...] }]
const CHUNKS = (ARGS && ARGS.chunks && ARGS.chunks.length) ? ARGS.chunks : [
  { label: 'access-intake',     prefix: 'A', areas: ['Eligibility','Coverage/Definitions','Intake','Inspection','Clarification','Search','Custody/Routing'] },
  { label: 'timing-production', prefix: 'T', areas: ['Deadlines','Response/Acknowledgment','Communications','Production','Redaction','Special Records'] },
  { label: 'money-remedies',    prefix: 'M', areas: ['Fees','Payment','Denials','Appeals','Review','Enforcement'] },
]

const RULE = {
  type: 'object',
  properties: {
    rule_id: { type: 'string' }, category: { type: 'string' }, concept_key: { type: 'string' },
    legal_concept: { type: 'string' }, rule_type: { type: 'string' },
    config_home: { type: 'string', enum: ['parameter','structural'] },
    constraint_basis: { type: 'string', enum: ['fixed','ceiling','floor','soft-standard','n/a'] },
    atomic_rule: { type: 'string' }, trigger: { type: 'string' },
    clock_effect: { type: 'string', enum: ['none','sets-deadline','tolls','pauses','restarts','resets','terminal'] },
    clock_spec: { type: 'string' }, related_rule_ids: { type: 'array', items: { type: 'string' } },
    source_language: { type: 'string' }, is_paraphrase: { type: 'boolean' },
    source_authority: { type: 'string' }, effective_status: { type: 'string' }, official_link: { type: 'string' }, notes: { type: 'string' },
  },
  required: ['rule_id','category','concept_key','config_home','atomic_rule','clock_effect','source_language','is_paraphrase','source_authority'],
}
const CHUNK_SCHEMA = {
  type: 'object',
  properties: {
    state: { type: 'string' }, rules: { type: 'array', items: RULE },
    material_negatives: { type: 'array', items: { type: 'object', properties: { concept_key:{type:'string'}, note:{type:'string'} }, required:['note'] } },
    structural_branches: { type: 'array', items: { type: 'object', properties: { concept_key:{type:'string'}, description:{type:'string'} }, required:['concept_key','description'] } },
  },
  required: ['state','rules'],
}

phase('Discover')
const parts = await parallel(CHUNKS.map(c => () =>
  agent(
    `Research **${STATE}** public-records law and return configurable request-processing rules — but ONLY for these areas: **${c.areas.join(', ')}**. Ignore other areas; a sibling agent covers them. Be exhaustive WITHIN your areas (this state's statute is dense — capture every atomic rule in scope).

FIRST Read ${CONTRACT} — the FULL contract incl. the "Discovery discipline" section. Follow ALL of it: VERBATIM operative clause in source_language (is_paraphrase=true ONLY if you truly could not open the source — try hard to open the primary statute); NO contentless rules (empty -> a material_negative, not a rule); universal-access facts (any person / no residency / no purpose) as RULES with the shared eligibility keys, never negatives; soft deadlines -> clock_spec undefined-soft + config_home=structural; for PARAMETER rules set constraint_basis. Default config_home to **parameter** for anything value/threshold/window/rate-shaped; reserve **structural** for genuine process-shape forks. ONE override: ignore the "Prohibited output: JSON" line; return via the schema.

CRITICAL id rule: number your rules **${ST}-${c.prefix}01, ${ST}-${c.prefix}02, …** (prefix "${c.prefix}") so they don't collide with the other agents' rules. related_rule_ids may reference only your own ids.

Official ${STATE} sources only; inclusion test; one atomic rule per row. The rules array is the PRIMARY output — always populate it. Also return material_negatives and structural_branches you find within your areas.`,
    { label: `discover:${ST}:${c.label}`, phase: 'Discover', schema: CHUNK_SCHEMA, effort: 'high' }
  ).then(r => ({ chunk: c, r }))
))

// Merge chunks into one discovery object.
const rules = [], negs = [], branches = []
let failedChunks = 0
for (const p of parts) {
  if (!p || !p.r) { failedChunks++; continue }
  const r = p.r
  ;(r.rules || []).forEach(x => rules.push(x))
  ;(r.material_negatives || []).forEach(x => negs.push(x))
  ;(r.structural_branches || []).forEach(x => branches.push(x))
}
const verbatim = rules.filter(x => x.source_language && x.source_language.trim() && !x.is_paraphrase).length
const merged = { state: STATE, rules, material_negatives: negs, structural_branches: branches, verbatim_captured_count: verbatim }

// HARD GUARD against the silent empty-rules loss that motivated this workflow.
if (rules.length === 0) {
  return { error: `${STATE} chunked discovery returned ZERO rules — silent-loss guard tripped`, failedChunks, chunks: CHUNKS.length }
}
log(`${STATE} merged from ${CHUNKS.length - failedChunks}/${CHUNKS.length} chunks: ${rules.length} rules (${verbatim} verbatim), ${negs.length} negatives, ${branches.length} branches` + (failedChunks ? `  [${failedChunks} chunk(s) FAILED]` : ''))

const perChunk = parts.filter(Boolean).map(p => ({ chunk: p.chunk.label, rules: (p.r && p.r.rules || []).length }))
return { states: [merged], perChunk, failedChunks }
