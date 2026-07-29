'use strict';
// PHASE 7 / BW5 — THE CLOSURE NOTICE. Every close owes one.
//
// ══ WHY THIS IS A SERVICE AND NOT A LINE IN EACH CLOSE PATH ══
//
// Rule 1 of the five compliance rules is "every close owes a notice", and before this module the codebase
// had four different closing paths with four different answers: the record-search no-records close sent
// NOTHING, `clarificationTimeout` FLAGGED that a notice was owed in a history note and then did not send
// it, `feeNonpayment` sent a dunning letter but no closure letter, and `depositAction` closed silently.
// A duty spelled four ways is a duty nobody owns.
//
// So: ONE builder, ONE sender, ONE history row per closure — and the closure act calls it in the same
// breath as the disposition write (Draft 8 rev 2: "close = one act"). A close that could not notify is
// still RECORDED as owing the notice, with the reason, because the alternative — a close that quietly
// forgets — is precisely the failure the rule exists to prevent.
//
// ══ RULE (e): ANONYMOUS IS "DOES NOT APPLY", NEVER "HIDDEN" ══
//
// A requester with no address on file is not a delivery failure and must not render as one. The notice
// outcome for that case is `not_applicable` with the words spelled out, exactly as the ledger's anonymous
// treatment does. An address that exists and bounces IS a failure, and reads as one (`send_failed`).
//
// ══ WHAT THE NOTICE MAY SAY ══
//
// Notice content invariants (SPEC §15.4, unchanged): state the outcome in the vocabulary of the ending,
// give the basis the record actually holds, and never assert law the config did not record. The sweep
// endings carry a NUMERIC basis (days elapsed, window) because that is what closed them — the mockup's
// "Sweep · per attested config" badge is only honest if the number travels with it.
var db = require('../db');
var email = require('./email');
var uuidv4 = require('uuid').v4;

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

async function agencyName() {
  try {
    var r = await db.get("SELECT value FROM system_config WHERE key = 'agency_name'");
    return (r && r.value) || 'the City';
  } catch (e) { return 'the City'; }
}

// The outcome sentence per ending. Deliberately plain: this is a letter a citizen reads, and the words
// beside a closure are the city's public account of what it did.
//   ctx: { note, custodianName, custodianContact, effortCount, basisText, priorRequestNumber,
//          priorRequestDate, pageCount, deliveredAt, installmentNo }
function bodyFor(ending, request, ctx) {
  ctx = ctx || {};
  var desc = request && request.description ? request.description : '';
  var lines = [];
  switch (ending) {
    case 'no_records':
      lines.push('We searched for the records you requested and located none.');
      if (ctx.effortCount) lines.push('Our search is documented on this request by ' + ctx.effortCount + ' logged action(s).');
      if (ctx.note) lines.push(ctx.note);
      lines.push('"No responsive records" is a common and lawful outcome; it is not a denial, and nothing has been withheld from you.');
      break;
    case 'not_in_custody':
      lines.push('The records you requested are not in this office’s custody or control.');
      if (ctx.custodianName) lines.push('The custodian we believe holds them is: ' + ctx.custodianName +
        (ctx.custodianContact ? ' (' + ctx.custodianContact + ')' : '') + '.');
      lines.push('We are referring you there. This is a referral, not a denial — nothing has been withheld.');
      if (ctx.note) lines.push(ctx.note);
      break;
    case 'denial':
      lines.push('Your request has been decided and this item is closed as denied.');
      lines.push('The determination letter, with the exemption(s) asserted and their citations, accompanies this notice.');
      if (ctx.note) lines.push(ctx.note);
      break;
    case 'fulfilled':
      lines.push('The records you requested have been released to you' +
        (ctx.pageCount ? ' (' + ctx.pageCount + ' page(s))' : '') + '.');
      if (ctx.installmentNo && Number(ctx.installmentNo) > 1) lines.push('This is installment ' + ctx.installmentNo + '.');
      if (ctx.note) lines.push(ctx.note);
      lines.push('Where material was redacted, the withholding log accompanying the release identifies each redaction and its authority.');
      break;
    case 'withdrawn':
      lines.push('At your request, this item has been withdrawn and closed.');
      if (ctx.note) lines.push(ctx.note);
      lines.push('If you did not ask us to withdraw it, please contact us — we will reopen it.');
      break;
    case 'previously_furnished':
      lines.push('The records you requested were previously furnished to you' +
        (ctx.priorRequestNumber ? ' in response to request ' + ctx.priorRequestNumber : '') +
        (ctx.priorRequestDate ? ' on ' + ctx.priorRequestDate : '') + '.');
      lines.push('This is a certification that the same records were already provided. It is an ending, not a denial — ' +
        'no record has been withheld from you.');
      if (ctx.note) lines.push(ctx.note);
      break;
    case 'no_clarification':
      lines.push('We asked you to clarify this request and did not receive a reply, so the request is now closed.');
      if (ctx.basisText) lines.push(ctx.basisText);
      lines.push('You may submit a new request at any time.');
      break;
    case 'nonpayment':
    case 'deposit_unpaid':
      lines.push('This request is closed because the amount due for it was not paid.');
      if (ctx.basisText) lines.push(ctx.basisText);
      lines.push('You may submit a new request at any time.');
      break;
    case 'estimate_lapsed':
      lines.push('We sent you a cost estimate for this request and did not receive your acceptance, so the request is now closed.');
      if (ctx.basisText) lines.push(ctx.basisText);
      lines.push('You may submit a new request at any time.');
      break;
    case 'abandoned':
      lines.push('This request is closed after a period with no response from you.');
      if (ctx.basisText) lines.push(ctx.basisText);
      lines.push('You may submit a new request at any time.');
      break;
    default:
      lines.push('This request is now closed.');
      if (ctx.note) lines.push(ctx.note);
  }
  if (desc) lines.unshift('Your request: “' + desc + '”');
  return lines;
}

var SUBJECTS = {
  no_records: 'No responsive records — request',
  not_in_custody: 'Referred to another custodian — request',
  denial: 'Determination on your request',
  fulfilled: 'Your records have been released — request',
  withdrawn: 'Request withdrawn —',
  previously_furnished: 'Records previously furnished — request',
  no_clarification: 'Request closed — no clarification received —',
  nonpayment: 'Request closed — payment not received —',
  deposit_unpaid: 'Request closed — deposit not received —',
  estimate_lapsed: 'Request closed — estimate not accepted —',
  abandoned: 'Request closed —'
};

async function build(ending, request, ctx) {
  var agency = await agencyName();
  var num = (request && request.request_number) || (request && request.id) || '';
  var subject = (SUBJECTS[ending] || 'Request closed —') + ' ' + num;
  var body = bodyFor(ending, request, ctx);
  var text = 'Dear ' + ((request && request.requestor_name) || 'Requester') + ',\n\n' +
    body.join('\n\n') + '\n\n' +
    'If you have questions about this response, reply to this message.\n\n' + agency + '\n' +
    'Reference: ' + num;
  return { subject: subject, text: text, ending: ending };
}

// SEND, AND RECORD THE SENDING. Returns { outcome, subject, to, reason } where outcome is one of:
//   sent           the letter went out
//   not_applicable no address on file — an anonymous / walk-in requester (rule (e): does not apply)
//   send_failed    an address exists and the transport refused it — a real failure, recorded as one
//
// NEVER THROWS. The disposition write and the notice are one act, and an SMTP outage must not be able to
// leave a request half-closed. What it must not do is pretend: a failure is written to the history as a
// failure, so the owed notice is visible to a human instead of evaporating.
async function send(requestId, ending, ctx, actor) {
  ctx = ctx || {}; actor = actor || {};
  var out = { outcome: 'send_failed', subject: null, to: null, reason: null };
  try {
    var request = await db.get('SELECT * FROM requests WHERE id = ?', [requestId]);
    if (!request) { out.reason = 'request not found'; return out; }
    var notice = await build(ending, request, ctx);
    out.subject = notice.subject;
    var to = (request.requestor_email || '').trim();
    if (!to) {
      out.outcome = 'not_applicable';
      out.reason = 'No address is on file for this requester, so a mailed/emailed closure notice does not apply. ' +
        'The closure and its basis are recorded on the request.';
    } else {
      out.to = to;
      try {
        await email.send({ to: to, subject: notice.subject, text: notice.text });
        out.outcome = 'sent';
      } catch (e) {
        out.outcome = 'send_failed';
        out.reason = e && e.message ? e.message : 'the message could not be delivered';
      }
    }
    var noteText = out.outcome === 'sent'
      ? 'Closure notice sent to ' + to + ' — “' + notice.subject + '”.'
      : (out.outcome === 'not_applicable'
        ? 'Closure notice does not apply: ' + out.reason
        : 'Closure notice COULD NOT BE SENT to ' + to + ' — ' + out.reason + '. The notice is still owed.');
    await db.run(
      'INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), requestId, actor.actorId || null, actor.actorName || 'System',
       out.outcome === 'sent' ? 'CLOSURE_NOTICE_SENT' : (out.outcome === 'not_applicable' ? 'CLOSURE_NOTICE_NA' : 'CLOSURE_NOTICE_FAILED'),
       noteText, nowStr()]);
  } catch (e) {
    console.error('[closureNotice send]', requestId, e && e.message);
    out.reason = e && e.message;
  }
  return out;
}

module.exports = { build: build, send: send, SUBJECTS: SUBJECTS };
