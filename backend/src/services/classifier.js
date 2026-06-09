// Reusable AI classification + routing.
// Maps a request description to a classification, custodian department, and the
// fulfillment team that department routes to (department.processed_by).
const Anthropic = require('@anthropic-ai/sdk');
const { all, get } = require('../db');

var DEADLINE_DAYS = { simple: 5, standard: 10, complex: 20, redaction_required: 30 };

async function classifyAndRoute(description) {
  if (!description || description.trim().length < 10) {
    throw new Error('Description too short to classify');
  }
  var depts = await all("SELECT id, name, code, processed_by FROM departments WHERE active = 1 AND (kind <> 'team' OR kind IS NULL) ORDER BY sort_order");
  var fallbackTeam = await get("SELECT id, name FROM departments WHERE kind = 'team' AND is_open_records = 1 ORDER BY sort_order LIMIT 1");
  var deptList = depts.map(function(d) { return d.code + ': ' + d.name; }).join(', ');
  var agencyRow = await get('SELECT value FROM system_config WHERE key = ?', ['agency_name']);
  var agency = agencyRow ? agencyRow.value : 'City';

  var prompt = 'You are a public records classification assistant for ' + agency + '. Analyze this public records request and return a JSON object only - no other text.\n\nRequest description: "' + description + '"\n\nDepartments available: ' + deptList + '\n\nClassifications:\n- simple: Single clean digital record, 5 business days\n- standard: 1-3 items, standard content, 10 business days\n- complex: 4+ items or complex content, 20 business days\n- redaction_required: Any item requiring redaction review, 30 business days\n\nReturn ONLY this JSON:\n{\n  "classification": "simple|standard|complex|redaction_required",\n  "department_code": "two-letter code from the list above",\n  "confidence": 0-100,\n  "redaction_flag": true|false,\n  "mrr_flag": true|false,\n  "fee_waiver_signal": true|false,\n  "reasoning": "one sentence explanation",\n  "flags": ["any special flags like LEGAL_HOLD, SENSITIVE, ONGOING_INVESTIGATION"]\n}';

  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });
  var text = (message.content[0] && message.content[0].text ? message.content[0].text : '').trim();
  var clean = text.replace(/```json|```/g, '').trim();
  var result = JSON.parse(clean);

  var dept = depts.find(function(d) { return d.code === result.department_code; });
  var teamId = (dept && dept.processed_by) ? dept.processed_by : (fallbackTeam ? fallbackTeam.id : null);
  var teamRow = teamId ? await get('SELECT id, name FROM departments WHERE id = ?', [teamId]) : null;

  return {
    classification: result.classification || 'standard',
    deadlineDays: DEADLINE_DAYS[result.classification] || 10,
    custodianDepartmentId: dept ? dept.id : null,
    custodianName: dept ? dept.name : null,
    departmentId: teamId,
    teamName: teamRow ? teamRow.name : null,
    redactionFlag: !!result.redaction_flag,
    isMrr: !!result.mrr_flag,
    feeWaiverSignal: !!result.fee_waiver_signal,
    confidence: result.confidence,
    reasoning: result.reasoning || '',
    flags: Array.isArray(result.flags) ? result.flags : []
  };
}

module.exports = { classifyAndRoute: classifyAndRoute, DEADLINE_DAYS: DEADLINE_DAYS };
