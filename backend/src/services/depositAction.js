'use strict';
// Deposit TRIGGER — the first caller of the declared-but-unused `payment_pending` toll reason.
//
// THE BUG THIS FIXES: `payment_pending` has been declared in tolling.js since the clock engine was built
// and had ZERO callers. feeNonpayment / paymentTiming / paymentStatus / tickler never even imported the
// tolling engine. So a request parked in `awaiting_payment` on an unpaid deposit kept burning its statutory
// clock, and the city reported FALSE LATENESS for the requestor's own inaction.
//
// Three moments, honouring the jurisdiction's `deposit_clock_effect`:
//   onDepositDue    — the estimate is accepted and a deposit is owed  -> toll
//   onDepositPaid   — the deposit lands                               -> resume | RESTART
//   onDepositLapsed — the grace window passes unpaid                  -> flag | withdraw
//
// TEXAS is the reason `restart` exists here: Gov't Code § 552.263(e) — "a request for a copy of public
// information is considered to have been received ... on the date the governmental body receives the
// deposit or bond." That is a RE-RECEIPT, not a pause: the clock starts over from the payment date.
// § 552.263(f) then withdraws the request if the deposit is not paid within 10 business days.
//
// SAFETY GATE (AUTO_CONFIG, same as clarificationAction): the clock is touched ONLY when the payment
// policy is enabled AND its jurisdiction-profile section is attested. Otherwise this is a pure effort-trail
// entry and NOTHING changes — which is exactly today's behaviour, so shipping this is a no-op until a city
// deliberately switches it on.
var db = require('../db');
var get = db.get, run = db.run;
var uuidv4 = require('uuid').v4;
var T = require('./tolling');
var PCP = require('./paymentClockPolicy');
var JP = require('./jurisdictionProfile');

var TOLL_REASON = 'payment_pending'; // declared on the respond clock since day one; finally has a caller.

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

// Map the clock effects onto engine actions at the two clock moments. Mirrors clarificationAction.effectPlan
// deliberately — "waiting on the requestor" is one concept, whether the wait is for words or for money.
function effectPlan(effect) {
  switch (effect) {
    case 'toll_pause_resume': return { onDue: 'toll', onPaid: 'resume',  statutory: true };
    case 'toll_and_restart':  return { onDue: 'toll', onPaid: 'restart', statutory: true };  // TX § 552.263(e)
    case 'operational_hold':  return { onDue: 'toll', onPaid: 'resume',  statutory: false };
    case 'runs_no_stop':      return { onDue: 'none', onPaid: 'none',    statutory: true };
    default:                  return { onDue: 'none', onPaid: 'none',    statutory: false };
  }
}

async function automationState() {
  var jrow = await get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  var jid = (jrow && jrow.value) || null;
  var policy = await PCP.read(jid);
  var attested = false;
  try { var sec = await JP.sectionState(jid, PCP.DOMAIN); attested = !!(sec && sec.attested); } catch (e) {}
  return { jid: jid, policy: policy, attested: attested, active: PCP.automationActive(policy, attested) };
}

async function activePrimaryClock(requestId) {
  return await get("SELECT * FROM request_clocks WHERE request_id = (SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?) AND is_primary = 1 AND status <> 'satisfied' ORDER BY created_at DESC LIMIT 1", [requestId]);
}

async function logHistory(requestId, opts, action, notes) {
  opts = opts || {};
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
    [uuidv4(), requestId, opts.actorId || null, opts.actorName || 'system', action, notes]);
}

// The estimate was accepted and a deposit is owed → the wait on the requestor begins.
async function onDepositDue(requestId, opts) {
  opts = opts || {};
  var st = await automationState();
  var effect = st.policy.deposit_clock_effect;
  var plan = effectPlan(effect);
  var clock = { action: 'none', effect: effect };

  if (st.active && plan.onDue === 'toll') {
    try { await T.startClocksForRequest(requestId); } catch (e) {} // idempotent — ensure a clock exists
    var primary = await activePrimaryClock(requestId);
    if (primary) {
      var r = await T.toll(primary.id, TOLL_REASON, 'Deposit due (' + effect + (plan.statutory ? '' : ', operational') + ')');
      clock = { action: 'toll', clockId: primary.id, effect: effect, tolled: !!r.tolled, alreadyTolled: !!r.alreadyTolled };
    } else {
      clock = { action: 'none', effect: effect, reason: 'no_primary_clock' };
    }
  } else if (st.active) {
    clock = { action: 'none', effect: effect, reason: 'clock_effect_no_pause' }; // runs_no_stop
  } else {
    clock = { action: 'none', effect: effect, reason: 'automation_inactive_manual' };
  }

  await logHistory(requestId, opts, 'DEPOSIT_DUE',
    'Deposit due' + (opts.amount != null ? ' ($' + Number(opts.amount).toFixed(2) + ')' : '')
    + '; clock effect: ' + effect + (st.active ? '' : ' (manual — automation off)')
    + (clock.action === 'toll' && clock.tolled ? '; response clock tolled' : ''));

  return { requestId: requestId, automationActive: st.active, effect: effect, clock: clock };
}

// The deposit landed → resume, or (TX) RE-RECEIVE the request and restart the clock from the payment date.
async function onDepositPaid(requestId, opts) {
  opts = opts || {};
  var st = await automationState();
  var effect = st.policy.deposit_clock_effect;
  var plan = effectPlan(effect);
  var clock = { action: 'none', effect: effect };

  if (st.active && (plan.onPaid === 'resume' || plan.onPaid === 'restart')) {
    var primary = await activePrimaryClock(requestId);
    if (primary) {
      if (plan.onPaid === 'resume') {
        var rr = await T.resume(primary.id, TOLL_REASON); // ONLY our own hold — a sibling AG/clarification hold must survive this
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

  await logHistory(requestId, opts, 'DEPOSIT_PAID',
    'Deposit received' + (opts.amount != null ? ' ($' + Number(opts.amount).toFixed(2) + ')' : '')
    + (clock.action === 'resume' ? '; response clock resumed' : '')
    + (clock.action === 'restart' ? '; request RE-RECEIVED — response clock restarted from the payment date (a fresh full window)' : ''));

  return { requestId: requestId, automationActive: st.active, effect: effect, clock: clock };
}

// The grace window passed with the deposit unpaid. flag_only = today's behaviour (the tickler flag is raised
// by the caller). withdraw = the request is considered withdrawn — routed through the CENTRAL stage
// transition (ARCHITECTURE item 6), never a raw UPDATE, so history is written and the stage task closes.
async function onDepositLapsed(requestId, opts) {
  opts = opts || {};
  var st = await automationState();
  var action = st.policy.deposit_lapse_action;

  // Withdrawal is a real, irreversible consequence — it requires the SAME double gate as a clock change.
  if (!st.active || action !== 'withdraw') {
    return { requestId: requestId, automationActive: st.active, action: 'flag_only', withdrawn: false };
  }

  var taskRouting = require('./taskRouting');
  await taskRouting.applyStageTransition(requestId, 'closed', {
    actorId: opts.actorId || null,
    actorName: opts.actorName || 'system',
    action: 'REQUEST_WITHDRAWN',
    notes: 'Deposit not paid within the grace window (' + (opts.windowDesc || 'the deposit window') + ') — the request is considered withdrawn.'
  });
  await run("UPDATE requests SET closure_reason = 'deposit_unpaid' WHERE id = ?", [requestId]);

  return { requestId: requestId, automationActive: true, action: 'withdraw', withdrawn: true };
}

module.exports = {
  TOLL_REASON: TOLL_REASON, effectPlan: effectPlan, automationState: automationState,
  onDepositDue: onDepositDue, onDepositPaid: onDepositPaid, onDepositLapsed: onDepositLapsed
};
