'use strict';
// Requestor-facing clarification outreach — the OUTREACH MECHANICS half of the record-search
// "Contact requestor" action (SPEC_record_search_task_screen.md §5b). Deterministic, plain-language;
// staff review/edit the draft before it is sent. Deliberately free of internal labels or clock jargon.
//
// Two channels, same body:
//   email → buildNotice() text is wrapped by emailTemplate and sent via email.js.
//   mail  → renderLetterHtml() produces a print-friendly letter (no digital send); staff print + mail it.
// The clock effect and effort-trail logging live in clarificationAction.js; this module only renders.
var db = require('../db');
var get = db.get;
var esc = require('./emailTemplate').esc;

async function cfg(key, fallback) {
  var row = await get('SELECT value FROM system_config WHERE key = ?', [key]);
  return (row && row.value) ? row.value : (fallback || '');
}

// Response-window sentence, only when the jurisdiction set a grace period. Plain language, no legalese.
function windowSentence(graceDays) {
  var n = parseInt(graceDays, 10);
  if (!(n > 0)) return null;
  return 'Please reply within ' + n + ' day' + (n === 1 ? '' : 's') + '. If we do not hear from you, '
    + 'we may be unable to continue processing your request.';
}

// Build the shared plain-language clarification body. opts: { agencyName, contactEmail, contactPhone,
// graceDays, requestNumber (override), extra (staff note to append) }.
function buildNotice(reqRow, opts) {
  reqRow = reqRow || {};
  opts = opts || {};
  var name = (reqRow.requestor_name || '').trim();
  var reqNo = opts.requestNumber || reqRow.request_number || '';
  var agency = opts.agencyName || 'the Office of Open Records';
  var desc = (reqRow.description || '').trim();

  var lines = [];
  lines.push('Dear ' + (name || 'Requestor') + ',');
  lines.push('');
  lines.push('Thank you for your public records request' + (reqNo ? ' (' + reqNo + ')' : '') + '. '
    + 'Before we can continue, we need a little more information to be sure we locate the right records.');
  if (desc) {
    lines.push('');
    lines.push('Here is what we have on file for your request:');
    lines.push('');
    lines.push('"' + desc + '"');
  }
  lines.push('');
  lines.push('To help us proceed, please reply with any additional detail you can provide — for example, '
    + 'the specific records, names, dates, or time period you are interested in, and the department or '
    + 'topic they relate to. The more specific you can be, the faster we can respond.');
  var ws = windowSentence(opts.graceDays);
  if (ws) { lines.push(''); lines.push(ws); }
  if (opts.extra && String(opts.extra).trim()) { lines.push(''); lines.push(String(opts.extra).trim()); }
  lines.push('');
  lines.push('Please keep your request number (' + (reqNo || 'on file') + ') with any reply so we can match '
    + 'your response to the correct request.');
  var contact = [];
  if (opts.contactEmail) contact.push(opts.contactEmail);
  if (opts.contactPhone) contact.push(opts.contactPhone);
  if (contact.length) { lines.push(''); lines.push('Questions? Contact us at ' + contact.join(' or ') + '.'); }
  lines.push('');
  lines.push('Sincerely,');
  lines.push(agency);

  return {
    subject: 'We need a little more information about your records request'
      + (reqNo ? ' (' + reqNo + ')' : ''),
    text: lines.join('\n')
  };
}

// Print-friendly postal letter. Self-contained HTML the caller returns for the browser to print
// (Ctrl+P). No digital send. `body` is the already-reviewed plain-text notice body (buildNotice.text
// or a staff edit); it is escaped and paragraph-split here. `mailingAddress` is a newline-separated
// address block resolved by clarificationAction.resolveMailingAddress — the structured intake address
// (mailing_* columns, split-canvas slice 1) when on file, else an inline address supplied at send time.
function renderLetterHtml(reqRow, opts, body) {
  reqRow = reqRow || {};
  opts = opts || {};
  var agency = esc(opts.agencyName || 'Office of Open Records');
  var sub = esc(opts.headerSub || 'Public Information');
  var dateStr = esc(opts.dateStr || '');
  var reqNo = esc(opts.requestNumber || reqRow.request_number || '');
  var name = esc((reqRow.requestor_name || '').trim());
  var addr = String(opts.mailingAddress || '').split('\n').map(function (l) { return esc(l.trim()); })
    .filter(function (l) { return l.length; });
  var addrBlock = (name ? '<div>' + name + '</div>' : '')
    + addr.map(function (l) { return '<div>' + l + '</div>'; }).join('');
  var bodyHtml = String(body || '').split('\n\n').map(function (p) {
    return '<p style="margin:0 0 12px;">' + esc(p).replace(/\n/g, '<br>') + '</p>';
  }).join('');

  return '<!doctype html><html><head><meta charset="utf-8"><title>Clarification letter '
    + reqNo + '</title>'
    + '<style>@media print{.no-print{display:none}}'
    + 'body{font-family:Georgia,"Times New Roman",serif;color:#111;max-width:660px;margin:40px auto;'
    + 'padding:0 32px;line-height:1.55;font-size:14px}'
    + '.lh{border-bottom:2px solid #1F4E79;padding-bottom:10px;margin-bottom:28px}'
    + '.lh .name{font-size:20px;font-weight:700;color:#1F4E79}'
    + '.lh .sub{font-size:12px;color:#555;margin-top:2px}'
    + '.meta{margin-bottom:24px}.addr{margin-bottom:24px}'
    + '.no-print{margin:24px 0;text-align:center}'
    + 'button{font:inherit;padding:8px 18px;background:#1F4E79;color:#fff;border:none;border-radius:6px;cursor:pointer}'
    + '</style></head><body>'
    + '<div class="no-print"><button onclick="window.print()">Print this letter</button></div>'
    + '<div class="lh"><div class="name">' + agency + '</div><div class="sub">' + sub + '</div></div>'
    + (dateStr ? '<div class="meta">' + dateStr + '</div>' : '')
    + (addrBlock ? '<div class="addr">' + addrBlock + '</div>' : '')
    + (reqNo ? '<div class="meta"><strong>Re: Public Records Request ' + reqNo + '</strong></div>' : '')
    + bodyHtml
    + '</body></html>';
}

// Assemble the render-time context (agency letterhead + contact + grace period) shared by both channels.
async function noticeContext(policy) {
  return {
    agencyName: await cfg('agency_name', 'Office of Open Records'),
    contactEmail: await cfg('contact_email', ''),
    contactPhone: await cfg('contact_phone', ''),
    graceDays: policy ? policy.clarification_grace_days : null
  };
}

module.exports = {
  buildNotice: buildNotice,
  renderLetterHtml: renderLetterHtml,
  noticeContext: noticeContext,
  windowSentence: windowSentence
};
