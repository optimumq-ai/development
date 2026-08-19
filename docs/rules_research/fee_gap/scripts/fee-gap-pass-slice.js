export const meta = {
  name: 'fee-gap-pass-slice',
  description: 'Step 2 fee gap pass: per state, one discover agent (36-item resolution, delegation-follow, writes raw/<ST>.json) then one verify agent (refute row by row, writes verified/<ST>.json). Linear, capped.',
  phases: [
    { title: 'Discover', detail: 'one research agent per state; writes fee_gap/raw/<ST>.json; returns compact summary' },
    { title: 'Verify', detail: 'one refuter per state; writes fee_gap/verified/<ST>.json; returns verdict counts' },
  ],
}
const RR = '/opt/optimumq/docs/rules_research'
const PROMPT = RR + '/STEP2_fee_gap_research_prompt.md'
const V2 = RR + '/V2_state_research_prompt.md'
let A = args; if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = {} } }
const STATES = (A && A.states && A.states.length) ? A.states : []
if (!STATES.length) return { error: 'no states' }
const MAX = 32
const RUN = STATES.slice(0, MAX)
if (RUN.length < STATES.length) log(`CAP: dropping ${STATES.length - RUN.length} states beyond ${MAX}: ${STATES.slice(MAX).join(',')}`)
log(`fee gap pass: ${RUN.length} states → ${RUN.length * 2} agents max (1 discover + 1 verify each)`)

const DISC_SUMMARY = {
  type: 'object',
  properties: {
    state: { type: 'string' }, code: { type: 'string' },
    file_written: { type: 'string', description: 'absolute path of the raw JSON you wrote' },
    resolutions_count: { type: 'integer', description: 'must be 36' },
    by_resolution: { type: 'object', additionalProperties: { type: 'integer' } },
    new_rule_rows: { type: 'integer' }, delegations_followed: { type: 'integer' }, delegations_unresolved: { type: 'integer' },
    items_low_confidence: { type: 'array', items: { type: 'string' } },
    research_date: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['state', 'code', 'file_written', 'resolutions_count', 'by_resolution', 'new_rule_rows'],
}
const VER_SUMMARY = {
  type: 'object',
  properties: {
    code: { type: 'string' }, file_written: { type: 'string' },
    confirmed: { type: 'integer' }, corrected: { type: 'integer' }, refuted: { type: 'integer' }, unverifiable: { type: 'integer' },
    rows_checked: { type: 'integer' },
    not_confirmed_items: { type: 'array', items: { type: 'object', properties: { item_id: { type: 'string' }, verdict: { type: 'string' }, why: { type: 'string' } }, required: ['item_id', 'verdict'] } },
    notes: { type: 'string' },
  },
  required: ['code', 'file_written', 'confirmed', 'corrected', 'refuted', 'unverifiable', 'rows_checked'],
}

function discoverPrompt(st) {
  return `You are the DISCOVER agent for the fee & estimate GAP PASS, state code **${st}**.

FIRST Read these two files, fully:
  1. ${PROMPT}  — the step-2 contract (the 36-item checklist, the resolution vocabulary, the DELEGATION-FOLLOW mandate, municipal scope, deliverables, JSON row schema).
  2. ${V2}      — the inherited discipline (anti-fabrication, VERBATIM operative clause + is_paraphrase, source hierarchy, the 18-column rule schema). One override: ignore its "Prohibited output: JSON" line — you WRITE JSON here.
SHORT-CIRCUIT: FIRST check whether ${RR}/fee_gap/raw/${st}.json ALREADY EXISTS and contains a "resolutions" array of exactly 36 rows (a previous run wrote it). If so, do NOT redo the research — Read it and return its compact summary (counts, path) and stop. Only if it is missing or incomplete do the full research below.
THEN Read your input slice: ${RR}/fee_gap/input/${st}.json — the state's 36 items (with the auto-derived prior status, prior rule ids, snippets — a prior, NOT truth), the 23 canonical fee/payment concepts, the state's existing fee/payment rule rows, its template block, and the run parameters.

Run parameters (Kevin, 2026-08-19): scope = MUNICIPALITIES ONLY (record whether each figure binds municipalities, state agencies only, or all public bodies; resolve for the local-body regime, note the other); recency = check 2024–2026 session laws and rule amendments for the fee/payment sections; estimate calibration is OUT of scope.

Research with official ${st} sources only (statute, administrative code / AG rules, published fee schedules, AG opinions, official guidance) — open the sources; verbatim operative clauses; never fabricate or infer a figure; follow every statutory delegation to the instrument that actually holds the number and extract it (new rule row, linked by related_rule_ids, cited to the instrument); if the instrument cannot be found/opened → delegated_unresolved with a search log.

DELIVERABLE: Write ONE JSON file to exactly this path: ${RR}/fee_gap/raw/${st}.json with this shape:
{
  "state": "<name>", "code": "${st}", "research_date": "<YYYY-MM-DD>", "current_law_statement": "<sessions reviewed, codified availability, guidance-vs-law gaps>",
  "resolutions": [ <exactly 36 rows — one per item_id in the input slice, in the input's order — each in the resolution row schema from the step-2 contract> ],
  "new_rules": [ <V2 18-column rule rows (+is_paraphrase) for every instrument/rule you add or amend; ids in the ${st}-9NNN namespace; amends/supersedes field naming an existing id when correcting one> ],
  "delegations_followed": [ { "statute_cite": "", "instrument": "", "instrument_cite": "", "official_link": "", "opened": true, "figures_extracted": "", "applies_to": "" } ],
  "applicability_notes": [ "…" ],
  "coverage_matrix": { "<item_id>": "Resolved-from-existing-rule | Resolved-from-new-rule | Documented-absence | Delegated-unresolved | Source-inaccessible" },
  "material_negatives": [ "…" ], "gaps_manual_verification": [ "…" ], "proposed_concept_keys": [ { "key": "", "definition": "", "rule_ids": [] } ]
}
Every resolution row MUST carry: item_id, resolution (one of value | ceiling | floor | range | actual_cost_standard | defers_to_city | structural | silent | delegated_unresolved | not_applicable), value, unit, basis, rule_type, applies_to (municipalities | state_agencies_only | all_public_bodies | unclear), resolved_by_rule_ids, new_rule_ids, source_authority, source_type, official_link, source_language (VERBATIM or is_paraphrase=true), is_paraphrase, effective_status, confidence (high|medium|low), manual_verification, notes. A number in a prior snippet is NOT automatically the item's value — confirm it belongs to THIS item, in THIS unit, for MUNICIPALITIES.

After writing the file, return ONLY the compact summary in the requested structured shape (counts + path). Do not paste the file contents into your final answer.`
}

function verifyPrompt(st) {
  return `You are the VERIFY agent for the fee & estimate GAP PASS, state code **${st}**. Your job is to REFUTE, not to confirm.

SHORT-CIRCUIT: if ${RR}/fee_gap/verified/${st}.json ALREADY EXISTS with a "rows" array covering the items, do NOT redo — Read it and return its compact summary. Otherwise:
FIRST Read ${PROMPT} (section "The VERIFY pass") and then Read the discover output: ${RR}/fee_gap/raw/${st}.json.
For EACH of the resolution rows (there should be 36): open the official_link (and, where the row cites a delegated instrument, that instrument); confirm the verbatim source_language is present in the opened source; confirm the value, unit and basis; confirm applies_to for MUNICIPALITIES (an agency-only figure recorded as a municipal value is a REFUTE); confirm currency (look for a 2024–2026 amendment of that section); confirm the resolution WORD is right (a "may charge up to" recorded as value instead of ceiling is a REFUTE; a soft standard recorded with a number is a REFUTE). Verdict per row: CONFIRMED | CORRECTED (supply the full corrected row) | REFUTED (say why) | UNVERIFIABLE (source could not be opened). Default to UNVERIFIABLE, never to CONFIRMED, when you could not open the source. Do NOT do new research beyond what is needed to check a row; do not add rows.

DELIVERABLE: Write ONE JSON file to exactly: ${RR}/fee_gap/verified/${st}.json with shape:
{ "code": "${st}", "verified_at": "<YYYY-MM-DD>", "rows": [ { "item_id": "", "verdict": "CONFIRMED|CORRECTED|REFUTED|UNVERIFIABLE", "why": "", "checked_link": "", "corrected_row": <full resolution row or null> } ], "notes": "" }
Then return ONLY the compact summary in the requested structured shape (verdict counts + the list of not-confirmed items). Do not paste the file into your answer.`
}

const results = await pipeline(
  RUN,
  st => agent(discoverPrompt(st), { label: `discover:${st}`, phase: 'Discover', schema: DISC_SUMMARY, effort: 'high' })
          .then(d => ({ st, disc: d })),
  r => {
    if (!r || !r.disc) return { st: (r && r.st), disc: null, ver: null, error: 'discover returned null' }
    if ((r.disc.resolutions_count || 0) < 36) log(`WARNING ${r.st}: discover resolved ${r.disc.resolutions_count}/36 items`)
    return agent(verifyPrompt(r.st), { label: `verify:${r.st}`, phase: 'Verify', schema: VER_SUMMARY, effort: 'high' })
      .then(v => ({ st: r.st, disc: r.disc, ver: v }))
      .catch(e => ({ st: r.st, disc: r.disc, ver: null, error: String(e && e.message || e) }))
  }
)
const rows = results.filter(Boolean)
const errored = rows.filter(r => !r.disc || !r.ver)
if (errored.length > rows.length / 2) log(`ABORT-LEVEL: ${errored.length}/${rows.length} states have a missing discover or verify result — treat this run as FAILED infra, not as data`)
const summary = rows.map(r => ({
  st: r.st,
  resolved: r.disc ? r.disc.resolutions_count : null,
  by_resolution: r.disc ? r.disc.by_resolution : null,
  new_rules: r.disc ? r.disc.new_rule_rows : null,
  delegations: r.disc ? [r.disc.delegations_followed, r.disc.delegations_unresolved] : null,
  confirmed: r.ver ? r.ver.confirmed : null, corrected: r.ver ? r.ver.corrected : null, refuted: r.ver ? r.ver.refuted : null, unverifiable: r.ver ? r.ver.unverifiable : null,
  not_confirmed: r.ver ? (r.ver.not_confirmed_items || []).map(x => x.item_id + ':' + x.verdict) : null,
  error: r.error || null,
}))
log('DONE: ' + summary.map(s => `${s.st} ${s.resolved}/36 → C${s.confirmed} c${s.corrected} R${s.refuted} U${s.unverifiable}`).join(' | '))
return { states: summary, requested: RUN.length, discovered: rows.filter(r => r.disc).length, verified: rows.filter(r => r.ver).length, errored: errored.map(e => e.st) }