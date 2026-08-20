export const meta = {
  name: 'fee-gap-pass-slice2',
  description: 'Step 2 fee gap pass, source-grounded variant: per state, discover agent reads Kevin-supplied official texts in source_docs/ FIRST (web only for gaps/currency), then verify agent refutes row by row. payment.method out of scope.',
  phases: [
    { title: 'Discover', detail: 'one research agent per state; source_docs-grounded; writes fee_gap/raw/<ST>.json' },
    { title: 'Verify', detail: 'one refuter per state; writes fee_gap/verified/<ST>.json; returns verdict counts' },
  ],
}
const RR = '/opt/optimumq/docs/rules_research'
const PROMPT = RR + '/STEP2_fee_gap_research_prompt.md'
const V2 = RR + '/V2_state_research_prompt.md'
const SD = RR + '/fee_gap/source_docs'
let A = args; if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = {} } }
const STATES = (A && A.states && A.states.length) ? A.states : []
if (!STATES.length) return { error: 'no states' }
log(`fee gap pass (source-grounded): ${STATES.length} states → ${STATES.length * 2} agents max`)

const STATE_NOTES = {
  MA: 'Both layers supplied: MA_c66_s10 (statute) and MA_950cmr32 (the delegated Secretary-of-the-Commonwealth regulation — fee section 32.07). malegislature.gov prints no history lines, so DO one currency check on the web: any amendment to c.66 § 10 after the 2016 reform (2024-2026 sessions especially).',
  MI: 'MI_mcl_15.234 is complete through PA 91 of 2026 (history ends 2020 Act 38). Abandonment rule in subsec. (14) = existing library rule MI-0059. MCL 15.235 (response/appeal) was NOT supplied — fetch it on the web for the timing-linked items.',
  MN: 'MN_13.03_2025_statutes includes the NEW 2025 subd. 3(g) suspension rule (2025 c 35) — the known recency gap; capture it as a new rule row. The two MN_dpo_* files are OFFICIAL GUIDANCE (Commissioner advisory opinions) — cite as guidance layer, not statute. Delegated instrument to fetch on the web: Minn. Rules 1205.0300 subp. 4 and 1205.0400 subp. 5. § 13.04 subd. 3 (data-subject copies) was not supplied — fetch if needed for requestor-type items.',
  MO: 'MO_610.026 is the version effective 8/28/2025 (2025 H.B. 145 & 59 — first amendment since 2004): the subsec. 2(2) withdrawal regime (90/150 days, 6-month re-request fee carryover) is NEW — capture as new rule rows. Gross v. Parson (2021) annotation included: attorney review time is NOT chargeable as research time. § 610.023 (3-business-day response) was not supplied — fetch for timing-linked items.',
  NY: 'NY_pol_article6 (DOS text, §§ 84-90) is the authority. The other two NY_* files carry CAUTION headers — agency-specific, NOT municipal authority, illustration only. DOS page prints no history lines, so DO one currency check: 2024-2026 amendments to POL §§ 87/89 (the library holds a recent NY free-repeat-request item, NY-0026 — locate its statutory anchor). Architecture: § 87(1) obliges each public corporation to set fees BY REGULATION under the 25-cent ceiling — resolve ceiling vs value carefully.',
  OK: 'OK_24A.5_oscn2026 includes BOTH Laws 2025 SB 535 (eff. 11/1/2025) AND Laws 2026 SB 2184 c.217 § 72. MUST-DO web check: what did SB 2184 § 72 change in § 24A.5? Note the 25-cent cap binds "notwithstanding any state or local provision" — an express override of local enactments. OK_24A.3 (definitions) and OK_24A.21 (narrow LDA fee exemption) supplied; two OK_*_guidance files are guidance only.',
  OR: 'OR_ors192 is the current published edition (§ 192.324 history ends 2025 c.30 §1) and includes 192.311-192.478 with exemptions. MUST-DO web check (flagged in the provenance header): the 2026 regular session amended ch. 192 (2026 Session Laws ch. 93) — determine whether 2026 c.93 touches 192.324/192.329. County-clerk fee delegation in 192.324(4)(d)(B) (ORS 205.320) — follow if material.',
  VA: 'VA_2.2-3704 is complete (A-J), history ends 2023 c.534. TRAP: SB 56 (2026) passed the Senate but was NOT enacted — do not import its content from bill trackers. Optional web fetch: § 2.2-3704.1 (rights-and-responsibilities posting duty).',
  WA: 'WA has TWO files: WA_rcw_42.56.120 (fees, default ceilings, $2 flat fee, 10% deposit cap) and WA_rcw_42.56.070 certified 7/15/2026 (fee-schedule adoption with notice+public hearing, cost components, commercial-lists bar). RCW 42.56.520 (5-day response/estimates) was NOT supplied — fetch on the web for timing-linked items. Check for 2024-2026 amendments to .120 (history shown ends 2017 c 304).',
  WI: 'WI_ch19_certified is the certified statutes through 2025 Act 247 (pub. 8/5/2026) INCLUDING annotations: Milwaukee Journal Sentinel 2012 WI 65 (NO redaction fee outside § 19.35(3)(h)), George v. Record Custodian (no indigent exemption as of right), Hill v. Zimmerman (prepayment on reasonable estimate). § 19.35(3)(h) body-cam redaction regime (2023 Act 253) is in the text. The oft-Googled 25-cent/page figure is DOJ GUIDANCE, not law — do not record it as a statutory value.',
}

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
  return `You are the DISCOVER agent for the fee & estimate GAP PASS, state code **${st}** (source-grounded variant).

FIRST Read these two files, fully:
  1. ${PROMPT}  — the step-2 contract (the 36-item checklist, the resolution vocabulary, the DELEGATION-FOLLOW mandate, municipal scope, deliverables, JSON row schema).
  2. ${V2}      — the inherited discipline (anti-fabrication, VERBATIM operative clause + is_paraphrase, source hierarchy, the 18-column rule schema). One override: ignore its "Prohibited output: JSON" line — you WRITE JSON here.
SHORT-CIRCUIT: FIRST check whether ${RR}/fee_gap/raw/${st}.json ALREADY EXISTS and contains a "resolutions" array of exactly 36 rows (a previous run wrote it). If so, do NOT redo the research — Read it and return its compact summary (counts, path) and stop. Only if it is missing or incomplete do the full research below.
THEN Read your input slice: ${RR}/fee_gap/input/${st}.json — the state's 36 items (with the auto-derived prior status, prior rule ids, snippets — a prior, NOT truth), the 23 canonical fee/payment concepts, the state's existing fee/payment rule rows, its template block, and the run parameters.

SOURCE DOCUMENTS (this is the variant part): the owner has hand-collected OFFICIAL statute/regulation text for your state. List the directory ${SD}/ and Read EVERY file whose name starts with "${st}_", fully. Each begins with a PROVENANCE header naming the official source, fetch date and currency evidence — honor any CAUTION or NOTE lines (files marked agency-specific/illustration are NOT municipal authority; files marked GUIDANCE are the guidance layer, not statute). For any item these documents answer, treat the text as an OPENED official source: cite the underlying official source and link named in the provenance header, quote the operative clause VERBATIM from the file, and set source_type/official_link accordingly. Use web research ONLY for (a) items the source documents do not cover, (b) delegated instruments they reference, and (c) the currency checks in your state note below. Do not re-fetch what the documents already establish.

STATE NOTE (${st}): ${STATE_NOTES[st] || '(none)'}

OWNER DECISION (2026-08-20, binding): the item **payment.method** is OUT OF SCOPE for the state rules profile — card/electronic-payment acceptance is citywide finance-department policy, not a records rule. Do NOT research it. Emit its row with resolution "not_applicable", confidence "high", notes "out of scope per owner decision 2026-08-20 — finance-department policy, excluded from state rules profile", and null value/unit/basis/links.

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
SOURCE DOCUMENTS: the owner hand-collected official text in ${SD}/ (files named "${st}_*", each with a PROVENANCE header). For rows whose official_link matches a source named in a provenance header, verifying the verbatim quote against the source document file COUNTS as opening the source — Read the file and string-match. Honor CAUTION labels (agency-specific files are not municipal authority). For rows citing sources NOT covered by the source documents, open the official_link on the web as usual.
For EACH of the resolution rows (there should be 36): confirm the verbatim source_language is present in the opened source; confirm the value, unit and basis; confirm applies_to for MUNICIPALITIES (an agency-only figure recorded as a municipal value is a REFUTE); confirm currency (look for a 2024–2026 amendment of that section); confirm the resolution WORD is right (a "may charge up to" recorded as value instead of ceiling is a REFUTE; a soft standard recorded with a number is a REFUTE). EXCEPTION: the payment.method row is out of scope by owner decision — verify only that it is recorded as not_applicable with the out-of-scope note, and mark it CONFIRMED if so. Verdict per row: CONFIRMED | CORRECTED (supply the full corrected row) | REFUTED (say why) | UNVERIFIABLE (source could not be opened). Default to UNVERIFIABLE, never to CONFIRMED, when you could not open the source. Do NOT do new research beyond what is needed to check a row; do not add rows.

DELIVERABLE: Write ONE JSON file to exactly: ${RR}/fee_gap/verified/${st}.json with shape:
{ "code": "${st}", "verified_at": "<YYYY-MM-DD>", "rows": [ { "item_id": "", "verdict": "CONFIRMED|CORRECTED|REFUTED|UNVERIFIABLE", "why": "", "checked_link": "", "corrected_row": <full resolution row or null> } ], "notes": "" }
Then return ONLY the compact summary in the requested structured shape (verdict counts + the list of not-confirmed items). Do not paste the file into your answer.`
}

const results = await pipeline(
  STATES,
  st => agent(discoverPrompt(st), { label: `discover:${st}`, phase: 'Discover', schema: DISC_SUMMARY, effort: 'high' })
          .then(d => ({ st, disc: d }))
          .catch(e => ({ st, disc: null, error: 'discover: ' + String(e && e.message || e) })),
  r => {
    if (!r || !r.disc) return r
    if ((r.disc.resolutions_count || 0) < 36) log(`WARNING ${r.st}: discover resolved ${r.disc.resolutions_count}/36 items`)
    return agent(verifyPrompt(r.st), { label: `verify:${r.st}`, phase: 'Verify', schema: VER_SUMMARY, effort: 'high' })
      .then(v => ({ st: r.st, disc: r.disc, ver: v }))
      .catch(e => ({ st: r.st, disc: r.disc, ver: null, error: 'verify: ' + String(e && e.message || e) }))
  }
)
const rows = results.filter(Boolean)
const errored = rows.filter(r => !r.disc || !r.ver)
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
return { states: summary, requested: STATES.length, discovered: rows.filter(r => r.disc).length, verified: rows.filter(r => r.ver).length, errored: errored.map(e => e.st) }
