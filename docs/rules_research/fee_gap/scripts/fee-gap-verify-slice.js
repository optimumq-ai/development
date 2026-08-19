export const meta = {
  name: 'fee-gap-verify-slice',
  description: 'Verify-only pass for the fee gap: one refuter agent per state over an EXISTING raw/<ST>.json; writes verified/<ST>.json. Short-circuits when the verified file already exists.',
  phases: [
    { title: 'Verify', detail: 'one refuter per state; writes fee_gap/verified/<ST>.json; returns verdict counts' },
  ],
}
const RR = '/opt/optimumq/docs/rules_research'
const PROMPT = RR + '/STEP2_fee_gap_research_prompt.md'
let A = args; if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = {} } }
const STATES = (A && A.states && A.states.length) ? A.states : []
if (!STATES.length) return { error: 'no states' }
log(`fee gap VERIFY-ONLY: ${STATES.length} states → ${STATES.length} agents max`)

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

function verifyPrompt(st) {
  return `You are the VERIFY agent for the fee & estimate GAP PASS, state code **${st}**. Your job is to REFUTE, not to confirm.

SHORT-CIRCUIT: if ${RR}/fee_gap/verified/${st}.json ALREADY EXISTS with a "rows" array covering the items, do NOT redo — Read it and return its compact summary. Otherwise:
FIRST Read ${PROMPT} (section "The VERIFY pass") and then Read the discover output: ${RR}/fee_gap/raw/${st}.json.
For EACH of the resolution rows (there should be 36): open the official_link (and, where the row cites a delegated instrument, that instrument); confirm the verbatim source_language is present in the opened source; confirm the value, unit and basis; confirm applies_to for MUNICIPALITIES (an agency-only figure recorded as a municipal value is a REFUTE); confirm currency (look for a 2024–2026 amendment of that section); confirm the resolution WORD is right (a "may charge up to" recorded as value instead of ceiling is a REFUTE; a soft standard recorded with a number is a REFUTE). Verdict per row: CONFIRMED | CORRECTED (supply the full corrected row) | REFUTED (say why) | UNVERIFIABLE (source could not be opened). Default to UNVERIFIABLE, never to CONFIRMED, when you could not open the source. Do NOT do new research beyond what is needed to check a row; do not add rows.

DELIVERABLE: Write ONE JSON file to exactly: ${RR}/fee_gap/verified/${st}.json with shape:
{ "code": "${st}", "verified_at": "<YYYY-MM-DD>", "rows": [ { "item_id": "", "verdict": "CONFIRMED|CORRECTED|REFUTED|UNVERIFIABLE", "why": "", "checked_link": "", "corrected_row": <full resolution row or null> } ], "notes": "" }
Then return ONLY the compact summary in the requested structured shape (verdict counts + the list of not-confirmed items). Do not paste the file into your answer.`
}

const results = await parallel(STATES.map(st => () =>
  agent(verifyPrompt(st), { label: `verify:${st}`, phase: 'Verify', schema: VER_SUMMARY, effort: 'high' })
    .then(v => ({ st, ver: v }))
    .catch(e => ({ st, ver: null, error: String(e && e.message || e) }))
))
const rows = results.filter(Boolean)
const summary = rows.map(r => ({
  st: r.st,
  confirmed: r.ver ? r.ver.confirmed : null, corrected: r.ver ? r.ver.corrected : null,
  refuted: r.ver ? r.ver.refuted : null, unverifiable: r.ver ? r.ver.unverifiable : null,
  rows_checked: r.ver ? r.ver.rows_checked : null,
  not_confirmed: r.ver ? (r.ver.not_confirmed_items || []).map(x => x.item_id + ':' + x.verdict) : null,
  error: r.error || null,
}))
log('DONE: ' + summary.map(s => `${s.st} C${s.confirmed} c${s.corrected} R${s.refuted} U${s.unverifiable}`).join(' | '))
return { states: summary, requested: STATES.length, verified: rows.filter(r => r.ver).length, errored: rows.filter(r => !r.ver).map(e => e.st) }
