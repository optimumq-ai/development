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
// This slice does NOT send the email / generate the postal letter — that outreach mechanics is a
// separate §5b concern. Here we apply the clock effect and record the event.
var db = require('../db');
var get = db.get, run = db.run;
var uuidv4 = require('uuid').v4;
var T = require('./tolling');
var CP = require('./clarificationPolicy');
var JP = require('./jurisdictionProfile');

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
  return await get("SELECT id, request_number, delivery_method, stage FROM requests WHERE id = ? OR request_number = ?", [idOrNumber, idOrNumber]);
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

  var notes = 'Clarification requested via ' + deliveryMethod
    + '; clock effect: ' + effect + (st.active ? '' : ' (manual — automation off)')
    + (clock.action === 'toll' && clock.tolled ? '; response clock tolled' : '')
    + (opts.vague ? '; flagged vague' : '')
    + (opts.note ? '. ' + opts.note : '');
  await logHistory(reqRow.id, opts, 'CLARIFICATION_REQUESTED', notes);

  return { requestId: reqRow.id, requestNumber: reqRow.request_number, deliveryMethod: deliveryMethod,
    automationActive: st.active, effect: effect, vague: !!opts.vague, clock: clock };
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

module.exports = { send: send, resolve: resolve, effectPlan: effectPlan, automationState: automationState };
