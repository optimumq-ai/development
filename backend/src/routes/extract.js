const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all, get } = require('../db');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/', requireAuth, upload.single('document'), async function(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No document uploaded' });

  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var agencyRow = get('SELECT value FROM system_config WHERE key = ?', ['agency_name']);
  var agency = agencyRow ? agencyRow.value : 'City';
  var depts = all('SELECT id, name, code FROM departments WHERE active = 1 ORDER BY sort_order');
  var deptList = depts.map(function(d) { return d.code + ': ' + d.name; }).join(', ');

  var isImage = req.file.mimetype.startsWith('image/');
  var isPdf = req.file.mimetype === 'application/pdf';

  if (!isImage && !isPdf) return res.status(400).json({ error: 'Only PDF and image files are supported' });

  var mediaType = req.file.mimetype;
  var base64Data = req.file.buffer.toString('base64');

  var prompt = 'You are a public records intake assistant for ' + agency + '. Extract information from this document and return ONLY a JSON object with no other text.\n\nDepartments: ' + deptList + '\n\nExtract these fields (use null if not found):\n{\n  "requestor_name": "full name of person making the request",\n  "requestor_email": "email address",\n  "requestor_phone": "phone number",\n  "requestor_type": "individual|journalist|nonprofit|attorney|researcher|business",\n  "description": "complete description of what records they are requesting - use their exact words as much as possible",\n  "delivery_method": "email|mail|pickup",\n  "classification": "simple|standard|complex|redaction_required",\n  "department_code": "two letter code from the department list",\n  "redaction_flag": true or false,\n  "mrr_flag": true or false,\n  "fee_waiver_signal": true or false,\n  "letter_date": "date of the letter in YYYY-MM-DD format if found",\n  "confidence": {\n    "requestor_name": 0-100,\n    "requestor_email": 0-100,\n    "requestor_phone": 0-100,\n    "description": 0-100,\n    "classification": 0-100,\n    "department_code": 0-100\n  },\n  "reasoning": "one sentence summary of what was requested and any flags"\n}';

  try {
    var contentBlock;
    if (isPdf) {
      contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } };
    } else {
      contentBlock = { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };
    }

    var message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }]
    });

    var text = message.content[0].text.trim();
    var clean = text.replace(/```json|```/g, '').trim();
    var result = JSON.parse(clean);

    var dept = depts.find(function(d) { return d.code === result.department_code; });
    result.department_id = dept ? dept.id : null;
    result.department_name = dept ? dept.name : null;

    res.json(result);
  } catch(e) {
    console.error('Extraction error:', e.message);
    res.status(500).json({ error: 'Document extraction failed', details: e.message });
  }
});

module.exports = router;
