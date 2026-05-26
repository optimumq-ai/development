const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { run, get } = require('../db');
const { v4: uuidv4 } = require('uuid');

const SYSTEM_PROMPT = [
  'You are the AI Records Request Agent for {{AGENCY_NAME}}. You guide citizens through submitting an open records request via natural conversation.',
  '',
  'You follow a structured multi-phase flow. You are warm, professional, and concise. You never give legal advice. If asked legal questions, point users to the relevant statute (Texas Government Code Chapter 552) without interpreting it.',
  '',
  'PHASES:',
  '',
  'Phase 1 - Identity: Collect the requestor full name, email address, delivery preference (email or postal mail), and phone number (optional but encouraged). When you have a valid-looking email, emit on its own line: [[EMAIL_VERIFY:address@example.com]]',
  '',
  'Phase 2 - Description: Ask what records they are seeking. Ask clarifying questions one at a time: date range, departments involved, specific people or events, format preference. Confirm scope back to them in plain language before moving on.',
  '',
  'Phase 3 - Multi-Record Detection: If the description names two or more distinct record types that would route to different departments (e.g., police body cam AND building permits), pause and ask: "It looks like you are requesting two different types of records. I can submit these as a single combined request or as two separate requests. Which would you prefer?" Record their choice.',
  '',
  'Phase 4 - Fee Waiver: Ask if they are requesting on behalf of a nonprofit, journalist, researcher, or for non-commercial public-interest reasons. If yes, ask them to briefly describe the purpose. Emit: [[FEE_WAIVER_INFO:yes|reason text]]',
  '',
  'Phase 5 - Confirmation and Submission: Summarize the complete request back to them. Ask them to confirm. When they confirm, emit on its own line:',
  '[[SUBMIT_READY]]',
  '{"requestorName":"...","requestorEmail":"...","requestorPhone":"...","deliveryMethod":"email|mail","description":"full description here","feeWaiverRequested":true,"feeWaiverReason":"...","isMrr":false,"mrrChoice":"combined|separate|none"}',
  '[[END_SUBMIT]]',
  '',
  'MARKER RULES:',
  '- Hidden markers ([[...]]) must appear on their own lines and are stripped from what the user sees. Never explain markers.',
  '- Only emit [[SUBMIT_READY]] after the user has explicitly confirmed.',
  '- The JSON between [[SUBMIT_READY]] and [[END_SUBMIT]] must be valid JSON.',
  '',
  'TONE:',
  '- One question at a time. Short messages.',
  '- Acknowledge what the user said before asking the next thing.',
  '- If the user is frustrated or stuck, suggest the "Prefer a form?" link.',
  '',
  'START by greeting the user, briefly explaining what you do, and asking for their name.'
].join('\n');


// Per-IP rate limiter: 20/min, 100/hour, 300/day
var rateBuckets = {};
function checkRate(ip) {
  var now = Date.now();
  if (!rateBuckets[ip]) rateBuckets[ip] = { minute: [], hour: [], day: [] };
  var b = rateBuckets[ip];
  b.minute = b.minute.filter(function(t) { return now - t < 60 * 1000; });
  b.hour = b.hour.filter(function(t) { return now - t < 60 * 60 * 1000; });
  b.day = b.day.filter(function(t) { return now - t < 24 * 60 * 60 * 1000; });
  if (b.minute.length >= 20) return { ok: false, reason: 'minute', retry: 60 };
  if (b.hour.length >= 100) return { ok: false, reason: 'hour', retry: 3600 };
  if (b.day.length >= 300) return { ok: false, reason: 'day', retry: 86400 };
  b.minute.push(now); b.hour.push(now); b.day.push(now);
  return { ok: true };
}
setInterval(function() {
  var now = Date.now();
  Object.keys(rateBuckets).forEach(function(ip) {
    var b = rateBuckets[ip];
    if (b.day.length === 0 || now - b.day[b.day.length-1] > 24 * 60 * 60 * 1000) delete rateBuckets[ip];
  });
}, 60 * 60 * 1000);

router.post('/chat', async function(req, res) {
  var rate = checkRate(req.ip);
  if (!rate.ok) {
    return res.status(429).json({ reply: 'You are sending messages too quickly. Please wait a moment and try again.', submission: null, rateLimited: true });
  }
  try {
    var messages = req.body.messages || [];
    var agencyRow = get('SELECT value FROM system_config WHERE key = ?', ['agency_name']);
    var agencyName = agencyRow ? agencyRow.value : 'the agency';
    var systemPrompt = SYSTEM_PROMPT.replace('{{AGENCY_NAME}}', agencyName);
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    });
    var fullText = response.content.map(function(b){ return b.type === 'text' ? b.text : ''; }).join('');
    var submission = null;
    var submitMatch = fullText.match(/\[\[SUBMIT_READY\]\]\s*([\s\S]*?)\s*\[\[END_SUBMIT\]\]/);
    if (submitMatch) {
      try { submission = JSON.parse(submitMatch[1]); } catch(e) { console.error('JSON parse failed:', e.message); }
    }
    var visibleText = fullText
      .replace(/\[\[SUBMIT_READY\]\][\s\S]*?\[\[END_SUBMIT\]\]/g, '')
      .replace(/\[\[EMAIL_VERIFY:[^\]]+\]\]/g, '')
      .replace(/\[\[FEE_WAIVER_INFO:[^\]]+\]\]/g, '')
      .replace(/\[\[SEARCH_QUERY:[^\]]+\]\]/g, '')
      .replace(/\[\[NON_TRAD_ITEMS:[^\]]+\]\]/g, '')
      .trim();
    res.json({ reply: visibleText, submission: submission });
  } catch(e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: 'Chat unavailable', details: e.message });
  }
});

router.post('/submit', function(req, res) {
  var b = req.body || {};
  if (!b.requestorName || !b.requestorEmail || !b.description) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  var year = new Date().getFullYear();
  var countRow = get('SELECT COUNT(*) as n FROM requests WHERE request_number LIKE ?', [year + '-%']);
  var nextNum = (countRow ? countRow.n : 0) + 1;
  var requestNumber = year + '-' + String(nextNum).padStart(4, '0');
  var deadlineDays = { simple: 5, standard: 10, complex: 20, redaction_required: 30 };
  var classification = b.classification || 'standard';
  var days = deadlineDays[classification] || 10;
  var deadline = new Date(); deadline.setDate(deadline.getDate() + days);
  var deadlineStr = deadline.toISOString().split('T')[0];
  var id = uuidv4();
  run('INSERT INTO requests (id, request_number, requestor_name, requestor_email, requestor_phone, requestor_type, delivery_method, description, classification, department_id, fee_waiver_requested, is_mrr, submission_channel, stage, status, deadline_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime(\'now\'))',
    [id, requestNumber, b.requestorName, b.requestorEmail, b.requestorPhone || '', 'individual', b.deliveryMethod || 'email', b.description, classification, null, b.feeWaiverRequested ? 1 : 0, b.isMrr ? 1 : 0, 'chat_agent', 'intake', 'active', deadlineStr]);
  run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
    [uuidv4(), id, 'public', 'Public Portal (Chat Agent)', 'CREATED', 'Submitted via AI chat agent']);
  res.status(201).json({ success: true, requestNumber: requestNumber, requestId: id });
});

module.exports = router;
