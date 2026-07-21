export const meta = {
  name: 'rules-discovery-only',
  description: 'Discovery-only rules gathering: one high-effort research agent per state under the refined V2 contract, returning structured rules. No canonicalize/verify/pivot — just collect. Faithful reproduction of the earlier run\'s Discover phase.',
  phases: [
    { title: 'Discover', detail: 'one agent per state, verbatim + no-contentless + constraint-basis discipline' },
  ],
}

const CONTRACT = '/opt/optimumq/docs/rules_research/V2_state_research_prompt.md'
let ARGS = args
if (typeof ARGS === 'string') { try { ARGS = JSON.parse(ARGS) } catch (e) { ARGS = {} } }
const STATES = (ARGS && ARGS.states && ARGS.states.length) ? ARGS.states : []
if (!STATES.length) return { error: 'no states supplied — pass args.states', argsType: typeof args }
function abbr(s){ return ({Texas:'TX',California:'CA','New York':'NY',Florida:'FL',Illinois:'IL',Virginia:'VA',Washington:'WA',Arizona:'AZ',Georgia:'GA',Ohio:'OH',Pennsylvania:'PA',Michigan:'MI',Colorado:'CO',Oregon:'OR',Minnesota:'MN',Massachusetts:'MA','North Carolina':'NC','New Jersey':'NJ',Tennessee:'TN'})[s] || s.slice(0,2).toUpperCase() }

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
    `Research **${s}** public-records law and return configurable request-processing rules. This is a WAVE of a 50-state build; if there is no shared dictionary yet, coin concept_key slugs freely (state-neutral family.thing) — they will be reconciled after.

FIRST Read ${CONTRACT} — the FULL contract incl. the "Discovery discipline" section. Follow ALL of it: VERBATIM operative clause in source_language (is_paraphrase=true ONLY if you truly could not open the source — try hard to open the primary statute); NO contentless rules (empty -> a material_negative, not a rule); universal-access facts (any person / no residency / no purpose) as RULES with the shared eligibility keys, never negatives; soft deadlines -> clock_spec undefined-soft + config_home=structural; for PARAMETER rules set constraint_basis (fixed | ceiling | floor | soft-standard) — a state gives a constraint, the city fills the value. ONE override: ignore the "Prohibited output: JSON" line; return via the schema.

Official ${s} sources only; inclusion test; one atomic rule per row. Cover the common areas thoroughly (eligibility, intake, response/acknowledgment deadlines, search, fees & payment, redaction, denials, appeals, production) so there is rich cross-state overlap. Accuracy over count.`,
    { label: `discover:${abbr(s)}`, phase: 'Discover', schema: DISCOVERY_SCHEMA, effort: 'high' }
  )
))
const states = disc.filter(Boolean)
log(`Discovered: ` + states.map(s => `${abbr(s.state)} ${s.rules.length}r/${s.verbatim_captured_count}v`).join('  '))
return { states, requested: STATES, got: states.length }
