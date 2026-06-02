const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { run, get } = require('../db');
const { v4: uuidv4 } = require('uuid');
const emailService = require('../services/email');
const recordSearch = require('../services/recordSearch');
const crypto = require('crypto');
const { all } = require('../db');

const SYSTEM_PROMPT = [
  'You are the AI Records Request Agent for {{AGENCY_NAME}}. You guide citizens through submitting an open records request via natural conversation.',
  '',
  'You follow a structured multi-phase flow. You are warm, professional, and concise. You never give legal advice. If asked legal questions, point users to the relevant statute (Texas Government Code Chapter 552) without interpreting it.',
  '',
  'PHASES:',
  '',
  'Phase 1 - Identity: Collect the requestor full name first. Then ask for their email address. When they provide it, read it back and ask: "You entered <email> as your email address. Would you like me to send a verification email to confirm it works? (You can also skip this if you prefer.)"',
  '',
  'If they say yes to verification, emit on its own line: [[VERIFY_EMAIL:address@example.com]] then say "I just sent a verification email to <email>. Please check your inbox and click the link. I will wait here." Then stop and wait.',
  '',
  'If they say no or skip, emit on its own line: [[VERIFY_SKIPPED:address@example.com]] and continue: acknowledge their choice neutrally and proceed to ask for their delivery preference (email or postal mail) and optional phone number.',
  '',
  'When the system tells you the verification is complete via a system message like "VERIFIED_OK: <email>", confirm warmly and proceed to delivery preference and phone. When the system tells you "VERIFIED_TIMEOUT: <email>", say the verification did not complete in time and that you can continue without it, then proceed to delivery preference and phone.',
  '',
  'Phase 2 - Description: Ask what records they are seeking. Ask clarifying questions one at a time: date range, departments involved, specific people or events, format preference. Confirm scope back to them in plain language.',
  '',
  'Phase 2.5 - Search: Once you have a clear description, BEFORE moving to fee waiver, search the agency records to see if any matching documents are already available. Emit on its own line: [[SEARCH_QUERY:short search query summarizing what they want]]',
  '',
  'When the system returns results via a message like "SEARCH_RESULTS_PROVIDED", acknowledge briefly that you found N matches and that the citizen can review them in the cards below. Then ask if any of those match what they need: if so, they can self-serve those documents (they will be marked Available); if not, you will continue with a formal request. Wait for their answer before continuing.',
  '',
  'If the system returns "SEARCH_NO_RESULTS", say you did not find any directly matching public documents but that you will submit a formal request to staff. Continue to Phase 4.',
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
    var rawMessages = req.body.messages || [];
    // Sanitize messages: the Anthropic API only accepts role + content per message.
    // The frontend may attach UI-only fields like searchResults; strip them here.
    var messages = rawMessages.map(function(m){ return { role: m.role, content: m.content }; });
    var agencyRow = get('SELECT value FROM system_config WHERE key = ?', ['agency_name']);
    var agencyName = agencyRow ? agencyRow.value : 'the agency';
    var todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    var systemPrompt = SYSTEM_PROMPT.replace('{{AGENCY_NAME}}', agencyName) +
      '\n\nIMPORTANT: Today\'s date is ' + todayStr + '. When the citizen mentions a date or month/year, treat their statement as accurate. Do not assume an earlier year or correct their date unless they themselves seem uncertain. Past dates are normal — citizens often request records from past months or years.';
    // Append any active admin-configured behavior rules
    try {
      var activeRules = all('SELECT rule_text FROM agent_rules WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC');
      if (activeRules && activeRules.length > 0) {
        systemPrompt += '\n\nADMIN-CONFIGURED BEHAVIOR RULES (follow these in addition to the above):';
        activeRules.forEach(function(r, i){ systemPrompt += '\n' + (i+1) + '. ' + r.rule_text; });
      }
    } catch(e) { console.error('[publicChat] failed to load agent rules:', e.message); }

    // Inject awareness of records the citizen has already selected from search results.
    // The citizen sees these as chips in the UI; the agent needs to know about them too.
    try {
      var sel = Array.isArray(req.body.selectedRecords) ? req.body.selectedRecords : [];
      if (sel.length > 0) {
        systemPrompt += '\n\nRECORDS THE CITIZEN HAS ALREADY SELECTED (' + sel.length + '):';
        sel.forEach(function(sr, i){
          var line = (i+1) + '. ' + (sr.title || sr.id || 'untitled');
          if (sr.sourceSystem) line += ' (from ' + sr.sourceSystem + ')';
          if (sr.publicAvailability === 'restricted') line += ' [redaction review required]';
          systemPrompt += '\n' + line;
        });
        systemPrompt += '\n\nIMPORTANT: These records are already included in the request. You do NOT need to search for them again. When the citizen says they are done selecting ("submit", "done", "that\'s all", "continue", "proceed", "I have enough", "ready to submit", or similar), DO NOT run another search. Acknowledge what they\'ve selected and move the conversation forward — confirm any remaining required information (fee waiver, delivery method, etc.) and then finalize the request with the SUBMIT_READY marker.';
      }
    } catch(e) { console.error('[publicChat] failed to inject selectedRecords:', e.message); }
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
    var verifyEmail = null;
    var verifyEmailMatch = fullText.match(/\[\[VERIFY_EMAIL:([^\]]+)\]\]/);
    if (verifyEmailMatch) verifyEmail = verifyEmailMatch[1].trim();
    var searchQuery = null;
    var searchResults = null;
    var searchQueryMatch = fullText.match(/\[\[SEARCH_QUERY:([^\]]+)\]\]/);
    if (searchQueryMatch) {
      searchQuery = searchQueryMatch[1].trim();
      try {
        searchResults = await recordSearch.searchAll(searchQuery);
      } catch(e) { console.error('search failed:', e.message); searchResults = []; }
    }
    var visibleText = fullText
      .replace(/\[\[SUBMIT_READY\]\][\s\S]*?\[\[END_SUBMIT\]\]/g, '')
      .replace(/\[\[EMAIL_VERIFY:[^\]]+\]\]/g, '').replace(/\[\[VERIFY_EMAIL:[^\]]+\]\]/g, '').replace(/\[\[VERIFY_SKIPPED:[^\]]+\]\]/g, '').replace(/\[\[SEARCH_QUERY:[^\]]+\]\]/g, '').replace(/\[\[SEARCH_RESULTS[\s\S]*?\]\]/g, '')
      .replace(/\[\[FEE_WAIVER_INFO:[^\]]+\]\]/g, '')
      .replace(/\[\[SEARCH_QUERY:[^\]]+\]\]/g, '')
      .replace(/\[\[NON_TRAD_ITEMS:[^\]]+\]\]/g, '')
      .trim();
    res.json({ reply: visibleText, submission: submission, verifyEmail: verifyEmail, searchQuery: searchQuery, searchResults: searchResults });
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
  var requestNumber = year + '-' + String(nextNum).padStart(Math.max(4, String(nextNum).length), '0');
  var deadlineDays = { simple: 5, standard: 10, complex: 20, redaction_required: 30 };
  var classification = b.classification || 'standard';
  var days = deadlineDays[classification] || 10;
  var deadline = new Date(); deadline.setDate(deadline.getDate() + days);
  var deadlineStr = deadline.toISOString().split('T')[0];
  var id = uuidv4();
  run('INSERT INTO requests (id, request_number, requestor_name, requestor_email, requestor_phone, requestor_type, delivery_method, description, classification, department_id, fee_waiver_requested, is_mrr, submission_channel, stage, status, deadline_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime(\'now\'))',
    [id, requestNumber, b.requestorName, b.requestorEmail, b.requestorPhone || '', 'individual', b.deliveryMethod || 'email', b.description, classification, null, b.feeWaiverRequested ? 1 : 0, b.isMrr ? 1 : 0, b.submissionChannel || 'chat_agent', 'intake', 'active', deadlineStr]);
  run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
    [uuidv4(), id, 'public', b.submissionChannel === 'manual_form' ? 'Public Portal (Form)' : 'Public Portal (Chat Agent)', 'CREATED', b.submissionChannel === 'manual_form' ? 'Submitted via public portal form' : 'Submitted via AI chat agent']);

  // Persist any records the citizen selected from search results
  if (Array.isArray(b.selectedRecords) && b.selectedRecords.length > 0) {
    b.selectedRecords.forEach(function(sr) {
      run('INSERT INTO request_selected_records (id, request_id, record_id, title, source_system, public_availability) VALUES (?,?,?,?,?,?)',
        [uuidv4(), id, sr.id || '', sr.title || '', sr.sourceSystem || '', sr.publicAvailability || '']);
    });
    run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
      [uuidv4(), id, 'public', 'Public Portal', 'RECORDS_SELECTED', 'Requestor selected ' + b.selectedRecords.length + ' record(s) from search results']);
  }
  var newReq = get('SELECT * FROM requests WHERE id = ?', [id]);
  if (newReq) {
    emailService.sendSubmissionConfirmation(newReq).catch(function(e){ console.error('confirmation email failed:', e.message); });
    emailService.sendNewRequestAlert(newReq).catch(function(e){ console.error('alert email failed:', e.message); });
  }
  res.status(201).json({ success: true, requestNumber: requestNumber, requestId: id });
});


// Request a verification email - creates a token, sends the link
router.post('/request-verification', async function(req, res) {
  var rate = checkRate(req.ip);
  if (!rate.ok) return res.status(429).json({ error: 'Too many requests' });
  var email = (req.body && req.body.email) || '';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  var token = crypto.randomBytes(32).toString('hex');
  var expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  run('INSERT INTO email_verifications (token, email, expires_at) VALUES (?, ?, ?)', [token, email, expiresAt]);
  var host = req.get('host');
  var protocol = req.protocol;
  var verifyUrl = protocol + '://' + host + '/api/public/verify/' + token;
  var agencyName = (get('SELECT value FROM system_config WHERE key = ?', ['agency_name']) || {}).value || 'Public Records';
  var body = '<h2 style="margin:0 0 10px;color:#1F4E79;font-size:18px">Verify your email address</h2>' +
    '<p style="font-size:14px;color:#374151;line-height:1.5">You are submitting a public records request. Click the button below to verify this email address and continue.</p>' +
    '<div style="text-align:center;margin:24px 0"><a href="' + verifyUrl + '" style="display:inline-block;background:#1F4E79;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Verify Email Address</a></div>' +
    '<p style="font-size:12px;color:#6B7280">If the button does not work, copy and paste this link into your browser:<br/><span style="color:#1F4E79;word-break:break-all">' + verifyUrl + '</span></p>' +
    '<p style="font-size:12px;color:#9CA3AF;margin-top:18px">This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>';
  var template = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">' +
    '<div style="background:#1F4E79;color:white;padding:18px 22px;border-radius:10px 10px 0 0;font-size:18px;font-weight:700">' + agencyName + '</div>' +
    '<div style="background:#F9FAFB;padding:24px 22px;border-radius:0 0 10px 10px;border:1px solid #E5E7EB;border-top:none">' + body + '</div></div>';
  try {
    var result = await emailService.send({
      to: email,
      subject: 'Verify your email for your records request',
      text: 'Verify your email by clicking this link: ' + verifyUrl + ' (expires in 30 minutes)',
      html: template
    });
    res.json({ success: true, token: token, sent: result.sent, reason: result.reason });
  } catch(e) {
    res.status(500).json({ error: 'Could not send verification email', details: e.message });
  }
});

// Poll endpoint - chat client checks this to know when the user clicked the link
router.get('/verify-status/:token', function(req, res) {
  var row = get('SELECT email, verified_at, expires_at FROM email_verifications WHERE token = ?', [req.params.token]);
  if (!row) return res.json({ verified: false, expired: false, notFound: true });
  var expired = new Date(row.expires_at) < new Date();
  res.json({ verified: !!row.verified_at, expired: expired, email: row.email });
});

// User clicks the link in the email - this verifies and shows a confirmation page
router.get('/verify/:token', function(req, res) {
  var row = get('SELECT email, verified_at, expires_at FROM email_verifications WHERE token = ?', [req.params.token]);
  if (!row) {
    return res.status(404).send('<html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px"><h1 style="color:#DC2626">Invalid Link</h1><p>This verification link is not recognized. It may have been already used or is incorrect.</p></body></html>');
  }
  if (new Date(row.expires_at) < new Date()) {
    return res.status(410).send('<html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px"><h1 style="color:#DC2626">Link Expired</h1><p>This verification link has expired. Please return to the records request portal and request a new one.</p></body></html>');
  }
  if (!row.verified_at) {
    run('UPDATE email_verifications SET verified_at = datetime(\'now\') WHERE token = ?', [req.params.token]);
  }
  var agencyName = (get('SELECT value FROM system_config WHERE key = ?', ['agency_name']) || {}).value || 'Public Records';
  res.send('<html><head><title>Email Verified</title></head><body style="font-family:Arial,sans-serif;background:#F9FAFB;margin:0;padding:60px 20px"><div style="max-width:480px;margin:0 auto;background:white;border-radius:12px;padding:40px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)"><div style="font-size:64px;margin-bottom:16px">✅</div><h1 style="color:#1F4E79;font-size:24px;margin:0 0 12px">Email Verified</h1><p style="color:#374151;font-size:15px;line-height:1.5;margin:0 0 8px">Your email address <strong>' + row.email + '</strong> has been verified for ' + agencyName + '.</p><p style="color:#6B7280;font-size:14px;margin-top:24px">You can now return to the records request chat. It will continue automatically.</p></div></body></html>');
});

module.exports = router;
