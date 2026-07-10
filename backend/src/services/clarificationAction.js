'use strict';
// Clarification TRIGGER (slice 2 of the clarification/vague-request policy).
// Wires the record-search task screen's "Contact requestor" action to the tolling engine, honoring the
// jurisdiction's `clarification_clock_effect` (the 6-value crux from CLARIFICATION_POLICY_SURVEY.md §2.1).
// This is the first caller of the declared-but-unused `clarification_pending` toll reason.
//
// SAFETY GATE (AUTO_CONFIG): the response clock is touched ONLY when the clarification policy is
// enabled AND its jurisdiction-profile section is attested (clarificationPolicy.automationActive).
// Otherwise the action is purely a manual effort-trail entry — no clock change. The effort-trail event
// is ALWAYS written (spec §5b: its immediate value is the effort trail, independent of tolling).
//
// OUTREACH MECHANICS (§5b, BUILT 2026-07-09): send() now also performs the templated outreach —
// branches on channel (default email; postal on staff opt-in). email → clarificationNotice body wrapped
// by emailTemplate + email.js send. mail → printable letter HTML (no digital send), requires a mailing
// address captured inline at send time (no intake address column yet; that fix is flagged portal-side).
// The clock effect + effort-trail logging are unchanged and independent of the outreach outcome.
var db = require('../db');
var get = db.get, run = db.run;
var uuidv4 = require('uuid').v4;
var T = require('./tolling');
var CP = require('./clarificationPolicy');
var JP = require('./jurisdictionProfile');
var email = require('./email');
var emailTemplate = require('./emailTemplate');
var CN = require('./clarificationNotice');

var TOLL_REASON = 'clarification_pending'; // the declared toll reason on the default respond clock

// Map the 6 clock effects onto engine actions for the two moments (clarification sent / requestor replies).
// statutory=false flags a non-statutory hold (operational_hold) or a no-clock jurisdiction — recorded for
// the trail but engine behavior is the same family as its statutory sibling.
function effectPlan(effect) {
  switch (effect) {
    case 'toll_pause_resume': return { onSend: 'toll', onReply: 'resume',  statutory: true };
    case 'operational_hold':  return { onSend: 'toll', onReply: 'resume',  statutory: false };
    case 'toll_and_restart':  return { onSend: 'toll', onReply: 'restart', statutory: true };
    case 'start_gate':        return { onSend: 'toll', onReply: 'restart', statutory: true };
    case 'runs_no_stop':      return { onSend: 'none', onReply: 'none',    statutory: true };
    case 'no_fixed_clock':    return { onSend: 'none', onReply: 'none',    statutory: false };
    default:                  return { onSend: 'none', onReply: 'none',    statutory: false };
  }
}

// Resolve the active jurisdiction, its policy, attestation, and whether automation may act.
async function automationState() {
  var jrow = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  var jid = (jrow && jrow.value) || null;
  var policy = await CP.read(jid);
  var attested = false;
  try { var sec = await JP.sectionState(jid, 'clarification'); attested = !!(sec && sec.attested); } catch (e) {}
  return { jid: jid, policy: policy, attested: attested, active: CP.automationActive(policy, attested) };
}

async function findRequest(idOrNumber) {
  return await get("SELECT id, request_number, delivery_method, stage, requestor_name, requestor_email, description, mailing_street1, mailing_street2, mailing_city, mailing_state, mailing_zip FROM requests WHERE id = ? OR request_number = ?", [idOrNumber, idOrNumber]);
}

// Resolve the postal mailing address for a clarification letter. Precedence (spec §5b build recipe):
// an inline address the caller supplied (staff correction) → the structured address stored on the
// request at intake (split-canvas slice 1: mailing_* columns) → none (caller throws ADDRESS_REQUIRED).
// Closes the postal gap: postal-delivery requests now carry an address, so staff aren't re-prompted.
function resolveMailingAddress(reqRow, opts) {
  var inline = (opts && opts.mailingAddress && String(opts.mailingAddress).trim()) || '';
  if (inline) return inline;
  reqRow = reqRow || {};
  var s1 = String(reqRow.mailing_street1 || '').trim();
  var city = String(reqRow.mailing_city || '').trim();
  if (!s1 && !city) return '';
  var s2 = String(reqRow.mailing_street2 || '').trim();
  var stateZip = [String(reqRow.mailing_state || '').trim().toUpperCase(), String(reqRow.mailing_zip || '').trim()].filter(Boolean).join(' ');
  var cityLine = [city, stateZip].filter(Boolean).join(', ');
  return [s1, s2, cityLine].filter(function (l) { return l; }).join('\n');
}

// Resolve the outreach channel: explicit opts.channel wins; otherwise default to email even when the
// request's delivery_method is 'mail' (§5b: this screen defaults clarification to email because email is
// always verified at intake and no mailing address is captured — postal is a deliberate staff opt-in).
function resolveChannel(reqRow, opts) {
  var c = (opts && opts.channel && String(opts.channel).toLowerCase()) || '';
  if (c === 'mail' || c === 'email') return c;
  return 'email';
}

// Build the draft the record-search "Contact requestor" UI reviews before sending. Read-only.
async function preview(idOrNumber, opts) {
  opts = opts || {};
  var reqRow = await findRequest(idOrNumber);
  if (!reqRow) throw new Error('Request not found');
  var st = await automationState();
  var ctx = await CN.noticeContext(st.policy);
  var notice = CN.buildNotice(reqRow, ctx);
  var channel = resolveChannel(reqRow, opts);
  var storedAddr = resolveMailingAddress(reqRow, {}); // address on file (intake), if any
  return {
    requestId: reqRow.id, requestNumber: reqRow.request_number,
    requestorName: reqRow.requestor_name || null, deliveryMethod: reqRow.delivery_method || 'email',
    channel: channel, to: reqRow.requestor_email || null,
    // Only prompt for an address when mailing AND none is on file — postal requests carry it from intake.
    addressRequired: channel === 'mail' && !storedAddr, mailingAddress: storedAddr || null,
    subject: notice.subject, text: notice.text
  };
}

// Perform the channel outreach. Returns a plain result object; never throws for a delivery failure
// (the effort trail is recorded regardless) — EXCEPT a postal letter with no mailing address, which is
// a caller error (the address gap) surfaced so the UI can prompt for one.
async function doOutreach(reqRow, channel, ctx, subject, text, opts) {
  if (channel === 'mail') {
    var addr = resolveMailingAddress(reqRow, opts); // inline override → stored intake address → none
    if (!addr) { var err = new Error('Mailing address required for a postal clarification letter'); err.code = 'ADDRESS_REQUIRED'; throw err; }
    var letterHtml = CN.renderLetterHtml(reqRow, Object.assign({}, ctx, {
      requestNumber: reqRow.request_number, mailingAddress: addr, dateStr: opts.dateStr || null
    }), text);
    return { channel: 'mail', status: 'to_be_mailed', mailingAddress: addr, subject: subject, letterHtml: letterHtml };
  }
  // email
  var to = (opts && opts.to && String(opts.to).trim()) || reqRow.requestor_email || '';
  if (!to) return { channel: 'email', sent: false, reason: 'no_email' };
  var html = emailTemplate.wrap({ agencyName: ctx.agencyName, contentHtml: emailTemplate.textToHtml(text) });
  var r = await email.send({ to: to, subject: subject, text: text, html: html });
  return { channel: 'email', sent: !!(r && r.sent), to: to, provider: r && r.provider, reason: r && r.reason };
}

async function activePrimaryClock(requestId) {
  return await get("SELECT id, status FROM request_clocks WHERE request_id = ? AND is_primary = 1 AND status != 'satisfied' ORDER BY created_at DESC LIMIT 1", [requestId]);
}

async function logHistory(requestId, opts, action, notes) {
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
    [uuidv4(), requestId, (opts && opts.actorId) || 'system', (opts && opts.actorName) || 'Staff', action, notes]);
}

// Send a clarification request → apply the send-side clock effect (pause), always log the effort trail.
async function send(idOrNumber, opts) {
  opts = opts || {};
  var reqRow = await findRequest(idOrNumber);
  if (!reqRow) throw new Error('Request not found');
  var st = await automationState();
  var effect = st.policy.clarification_clock_effect;
  var plan = effectPlan(effect);
  var deliveryMethod = reqRow.delivery_method || 'email'; // spec §5b: default to email (mailing-address gap)
  var clock = { action: 'none', effect: effect };

  // --- Outreach mechanics (§5b): render + send/generate the templated request. A postal letter with no
  // mailing address throws (ADDRESS_REQUIRED) BEFORE any clock/log side effect, so the UI can prompt. ---
  var channel = resolveChannel(reqRow, opts);
  var ctx = await CN.noticeContext(st.policy);
  var draft = CN.buildNotice(reqRow, ctx);
  var subject = (opts.subject && String(opts.subject).trim()) || draft.subject; // staff may override
  var body = (opts.text && String(opts.text).trim()) || draft.text;             // staff may edit
  var outreach = await doOutreach(reqRow, channel, ctx, subject, body, opts);

  if (st.active && plan.onSend === 'toll') {
    try { await T.startClocksForRequest(reqRow.id); } catch (e) {} // idempotent — ensure a clock exists
    var primary = await activePrimaryClock(reqRow.id);
    if (primary) {
      var note = 'Clarification requested (' + effect + (plan.statutory ? '' : ', operational') + ')' + (opts.vague ? ' [vague]' : '');
      var r = await T.toll(primary.id, TOLL_REASON, note);
      clock = { action: 'toll', clockId: primary.id, effect: effect, tolled: !!r.tolled, alreadyTolled: !!r.alreadyTolled };
    } else {
      clock = { action: 'none', effect: effect, reason: 'no_primary_clock' };
    }
  } else if (st.active) {
    clock = { action: 'none', effect: effect, reason: 'clock_effect_no_pause' }; // no_fixed_clock / runs_no_stop
  } else {
    clock = { action: 'none', effect: effect, reason: 'automation_inactive_manual' };
  }

  var outreachNote = outreach.channel === 'mail'
    ? 'postal letter generated (to be mailed to ' + outreach.mailingAddress.replace(/\n+/g, ', ') + ')'
    : (outreach.sent ? 'emailed to ' + outreach.to : 'email not sent (' + (outreach.reason || 'unknown') + ')');
  var notes = 'Clarification requested — ' + outreachNote
    + '; clock effect: ' + effect + (st.active ? '' : ' (manual — automation off)')
    + (clock.action === 'toll' && clock.tolled ? '; response clock tolled' : '')
    + (opts.vague ? '; flagged vague' : '')
    + (opts.note ? '. ' + opts.note : '');
  await logHistory(reqRow.id, opts, 'CLARIFICATION_REQUESTED', notes);

  return { requestId: reqRow.id, requestNumber: reqRow.request_number, deliveryMethod: deliveryMethod,
    automationActive: st.active, effect: effect, vague: !!opts.vague, clock: clock, outreach: outreach };
}

// Requestor replied → apply the reply-side clock effect (resume or restart), always log the trail.
async function resolve(idOrNumber, opts) {
  opts = opts || {};
  var reqRow = await findRequest(idOrNumber);
  if (!reqRow) throw new Error('Request not found');
  var st = await automationState();
  var effect = st.policy.clarification_clock_effect;
  var plan = effectPlan(effect);
  var clock = { action: 'none', effect: effect };

  if (st.active && (plan.onReply === 'resume' || plan.onReply === 'restart')) {
    var primary = await activePrimaryClock(reqRow.id);
    if (primary) {
      if (plan.onReply === 'resume') {
        var rr = await T.resume(primary.id);
        clock = { action: 'resume', clockId: primary.id, effect: effect, resumed: !!rr.resumed };
      } else {
        var rs = await T.restart(primary.id);
        clock = { action: 'restart', clockId: primary.id, effect: effect, restarted: !!rs.restarted };
      }
    } else {
      clock = { action: 'none', effect: effect, reason: 'no_primary_clock' };
    }
  } else if (st.active) {
    clock = { action: 'none', effect: effect, reason: 'clock_effect_no_pause' };
  } else {
    clock = { action: 'none', effect: effect, reason: 'automation_inactive_manual' };
  }

  var notes = 'Clarification received'
    + (clock.action === 'resume' ? '; response clock resumed' : (clock.action === 'restart' ? '; response clock restarted (fresh window)' : ''))
    + (opts.note ? '. ' + opts.note : '');
  await logHistory(reqRow.id, opts, 'CLARIFICATION_RECEIVED', notes);

  return { requestId: reqRow.id, requestNumber: reqRow.request_number,
    automationActive: st.active, effect: effect, clock: clock };
}

module.exports = { send: send, resolve: resolve, preview: preview, effectPlan: effectPlan, automationState: automationState };
