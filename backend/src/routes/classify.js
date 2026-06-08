const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all, get } = require('../db');
const Anthropic = require('@anthropic-ai/sdk');

router.post('/', requireAuth, async function(req, res) {
  var description = req.body.description;
  if (!description || description.length < 10) return res.status(400).json({ error: 'Description too short' });

  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  var depts = await all("SELECT id, name, code, processed_by FROM departments WHERE active = 1 AND (kind <> 'team' OR kind IS NULL) ORDER BY sort_order");
  var fallbackTeam = await get("SELECT id, name FROM departments WHERE kind = 'team' AND is_open_records = 1 ORDER BY sort_order LIMIT 1");
  var deptList = depts.map(function(d) { return d.code + ': ' + d.name; }).join(', ');

  var agencyName = await get('SELECT value FROM system_config WHERE key = ?', ['agency_name']);
  var agency = agencyName ? agencyName.value : 'City';

  var prompt = 'You are a public records classification assistant for ' + agency + '. Analyze this public records request and return a JSON object only — no other text.\n\nRequest description: "' + description + '"\n\nDepartments available: ' + deptList + '\n\nClassifications:\n- simple: Single clean digital record, 5 business days\n- standard: 1-3 items, standard content, 10 business days\n- complex: 4+ items or complex content, 20 business days\n- redaction_required: Any item requiring redaction review, 30 business days\n\nReturn ONLY this JSON:\n{\n  "classification": "simple|standard|complex|redaction_required",\n  "department_code": "two-letter code from the list above",\n  "confidence": 0-100,\n  "redaction_flag": true|false,\n  "mrr_flag": true|false,\n  "fee_waiver_signal": true|false,\n  "reasoning": "one sentence explanation",\n  "flags": ["any special flags like LEGAL_HOLD, SENSITIVE, ONGOING_INVESTIGATION"]\n}';

  try {
    var message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });

    var text = message.content[0].text.trim();
    var clean = text.replace(/```json|```/g, '').trim();
    var result = JSON.parse(clean);

    var dept = depts.find(function(d) { return d.code === result.department_code; });
    var teamId = (dept && dept.processed_by) ? dept.processed_by : (fallbackTeam ? fallbackTeam.id : null);
    var teamRow = teamId ? await get('SELECT id, name FROM departments WHERE id = ?', [teamId]) : null;
    result.custodian_department_id = dept ? dept.id : null;
    result.custodian_name = dept ? dept.name : null;
    result.department_id = teamId;
    result.department_name = teamRow ? teamRow.name : null;
    result.fulfillment_team_name = result.department_name;

    res.json(result);
  } catch(e) {
    console.error('Classification error:', e.message);
    res.status(500).json({ error: 'AI classification unavailable', details: e.message });
  }
});

module.exports = router;
