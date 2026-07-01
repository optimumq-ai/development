// Taxonomy-driven AI classification + routing, with general-knowledge fallback.
// One model call returns TWO signals: (1) the best-matching record type from the
// curated taxonomy with a confidence, and (2) a general-knowledge department guess.
// Code (not a second model) picks: taxonomy match when confident, else the
// general-knowledge department, else Open Records. Routing always ends at
// owning department -> its processed_by fulfillment team.
const Anthropic = require('@anthropic-ai/sdk');
const { all, get } = require('../db');

var DEADLINE_DAYS = { simple: 5, standard: 10, complex: 20, redaction_required: 30 };
var TAXONOMY_CONFIDENCE = 70; // >= this on the record-type match => route by taxonomy

function parseArr(v) { try { var a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

async function classifyAndRoute(description) {
  if (!description || description.trim().length < 10) throw new Error('Description too short to classify');

  var depts = await all("SELECT id, name, code, processed_by FROM departments WHERE active = 1 AND (kind <> 'team' OR kind IS NULL) ORDER BY sort_order");
  var fallbackTeam = await get("SELECT id, name FROM departments WHERE kind = 'team' AND is_open_records = 1 ORDER BY sort_order LIMIT 1");
  var teams = await all("SELECT id, name FROM departments WHERE kind = 'team'");
  var deptById = {}; depts.forEach(function(d){ deptById[d.id] = d; });
  var teamById = {}; teams.forEach(function(t){ teamById[t.id] = t; });

  var rts = await all("SELECT rt.id, rt.code, rt.name, c.name AS category_name, rt.synonyms, rt.keywords, (SELECT department_id FROM record_type_departments WHERE record_type_id = rt.id AND role = 'owner' ORDER BY sort_order LIMIT 1) AS owner_department_id, (SELECT department_id FROM record_type_departments WHERE record_type_id = rt.id AND role = 'fulfiller' ORDER BY sort_order LIMIT 1) AS fulfiller_team_id FROM record_types rt LEFT JOIN categories c ON c.id = rt.category_id WHERE rt.status = 'active' ORDER BY c.sort_order, rt.sort_order");
  var rtByCode = {}; rts.forEach(function(rt){ rtByCode[rt.code] = rt; });

  var taxoLines = rts.map(function(rt){
    var also = parseArr(rt.synonyms).concat(parseArr(rt.keywords)).slice(0, 8).join(', ');
    return rt.code + ' | ' + rt.name + ' | ' + (rt.category_name || '') + (also ? ' | also called: ' + also : '');
  }).join('\n');
  var deptList = depts.map(function(d){ return d.code + ': ' + d.name; }).join(', ');
  var agencyRow = await get('SELECT value FROM system_config WHERE key = ?', ['agency_name']);
  var agency = agencyRow ? agencyRow.value : 'City';

  var prompt = 'You are a public records classification assistant for ' + agency + '. Analyze the request and return ONLY a JSON object.\n\n'
    + 'Request: "' + description + '"\n\n'
    + 'STEP 1 - Match to the agency record-type catalog below. Pick the ONE record type whose meaning best fits the request. Use the record type names and their "also called" terms together with your understanding of what the request is asking for. If nothing in the catalog is a reasonable fit, set record_type_code to null.\n\n'
    + 'RECORD TYPE CATALOG (code | name | category | also called):\n' + taxoLines + '\n\n'
    + 'STEP 2 - Independently, using general knowledge of how a city is organized, say which department this request belongs to. If the request is off-topic, nonsensical, or too vague to place with any confidence, set department_code to null instead of guessing. Departments: ' + deptList + '\n\n'
    + 'Classifications: simple (single clean digital record, 5d), standard (1-3 items, 10d), complex (4+ items or complex, 20d), redaction_required (any redaction review needed, 30d).\n\n'
    + 'Return ONLY this JSON:\n{\n'
    + '  "record_type_code": "code from the catalog, or null",\n'
    + '  "record_type_confidence": 0-100,\n'
    + '  "department_code": "two-letter code from the department list, or null if no department reasonably fits",\n'
    + '  "classification": "simple|standard|complex|redaction_required",\n'
    + '  "redaction_flag": true|false,\n  "mrr_flag": true|false,\n  "fee_waiver_signal": true|false,\n'
    + '  "reasoning": "one sentence",\n  "flags": ["LEGAL_HOLD|SENSITIVE|ONGOING_INVESTIGATION if any"]\n}';

  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var message = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 600, messages: [{ role: 'user', content: prompt }] });
  var text = (message.content[0] && message.content[0].text ? message.content[0].text : '').trim();
  var result = JSON.parse(text.replace(/```json|```/g, '').trim());

  var rtConf = typeof result.record_type_confidence === 'number' ? result.record_type_confidence : 0;
  var matchedRt = (result.record_type_code && rtByCode[result.record_type_code]) ? rtByCode[result.record_type_code] : null;

  var ownerId = null, routingBasis = 'unassigned';
  if (matchedRt && rtConf >= TAXONOMY_CONFIDENCE && matchedRt.owner_department_id && deptById[matchedRt.owner_department_id]) {
    ownerId = matchedRt.owner_department_id;
    routingBasis = 'taxonomy';
  } else {
    var dept = depts.find(function(d){ return d.code === result.department_code; });
    if (dept) { ownerId = dept.id; routingBasis = 'general'; }
  }

  var ownerDept = ownerId ? deptById[ownerId] : null;
  var teamId = (ownerDept && ownerDept.processed_by) ? ownerDept.processed_by : (fallbackTeam ? fallbackTeam.id : null);
  // Per-record-type fulfillment-team override (record_type_departments role='fulfiller'):
  // a confident taxonomy match naming a fulfiller team wins over the owning department's default
  // team, so a record can be OWNED BY one City Department but FULFILLED BY a different team.
  if (routingBasis === 'taxonomy' && matchedRt && matchedRt.fulfiller_team_id && teamById[matchedRt.fulfiller_team_id]) teamId = matchedRt.fulfiller_team_id;
  if (routingBasis === 'unassigned') teamId = null; // catch-all: leave the request Unassigned for triage rather than stamping a real team
  var team = teamId ? teamById[teamId] : null;

  return {
    classification: result.classification || 'standard',
    deadlineDays: DEADLINE_DAYS[result.classification] || 10,
    recordTypeId: matchedRt ? matchedRt.id : null,
    recordTypeName: matchedRt ? matchedRt.name : null,
    recordTypeConfidence: rtConf,
    custodianDepartmentId: ownerId,
    custodianName: ownerDept ? ownerDept.name : null,
    departmentId: teamId,
    teamName: team ? team.name : null,
    routingBasis: routingBasis,
    redactionFlag: !!result.redaction_flag,
    isMrr: !!result.mrr_flag,
    feeWaiverSignal: !!result.fee_waiver_signal,
    confidence: result.record_type_confidence,
    reasoning: result.reasoning || '',
    flags: Array.isArray(result.flags) ? result.flags : []
  };
}

module.exports = { classifyAndRoute: classifyAndRoute, DEADLINE_DAYS: DEADLINE_DAYS, TAXONOMY_CONFIDENCE: TAXONOMY_CONFIDENCE };
