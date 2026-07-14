'use strict';
// VAGUE vs OVERLY BROAD — two legal defects, and the system used to have one boolean.
// SPEC_record_search_task_screen.md §5b-2.
//
// The trap this guards, in the jurisdiction's own words (CLARIFICATION_POLICY_SURVEY §Illinois):
//
//   Vagueness      -> 5 ILCS 140 §3.3: the Act does NOT compel the body to interpret meaning. Discretionary.
//   Overbreadth    -> the body SHALL offer a conference before invoking the unduly-burdensome exemption, the
//                     clock does NOT stop for it, and "a body that FAILS TO RESPOND ON TIME MAY NOT TREAT THE
//                     REQUEST AS UNDULY BURDENSOME AT ALL."
//
// So marking an overly-broad Illinois request "vague", sending a clarification, and waiting SILENTLY FORFEITS
// THE BURDEN DEFENSE. Nothing errors. Nothing looks wrong. The city simply loses the exemption.
//
// The duty was SEEDED (clarification_duty = 'required_before_burden_denial') and, exactly like the
// clarification toll reason before it, NOTHING EVER READ IT. These tests are its first reader.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var db = require('/opt/optimumq/backend/src/db');
var CA = require('/opt/optimumq/backend/src/services/clarificationAction');
var CP = require('/opt/optimumq/backend/src/services/clarificationPolicy');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

async function activeJid() {
  var r = await db.get("SELECT value FROM system_config WHERE key = 'active_jurisdiction_id'");
  return (r && r.value) || 'jur-tx';
}
async function mkRequest(desc) {
  var made = await RC.createRequest(
    { requestorName: 'Defect Test', requestorEmail: 'defect@example.com', description: desc, deliveryMethod: 'email' },
    { actorId: 'test', actorName: 'Test', historyAction: 'CREATED', kickIntake: false });
  return made.id;
}
async function lastNote(rid) {
  var h = await db.get(
    "SELECT notes FROM request_history WHERE request_id = ? AND action = 'CLARIFICATION_REQUESTED' ORDER BY created_at DESC LIMIT 1", [rid]);
  return (h && h.notes) || '';
}

(async function () {
  await db.initDb();
  var jid = await activeJid();
  var original = await CP.read(jid);

  // ---------------------------------------------------------------------------------------------
  // Put the active jurisdiction on ILLINOIS'S ACTUAL RULES: the conference duty is owed, and the
  // clock does NOT stop for it. That combination is the whole point.
  // ---------------------------------------------------------------------------------------------
  await CP.write(jid, Object.assign({}, original, {
    enabled: true,
    clarification_clock_effect: 'runs_no_stop',
    clarification_duty: 'required_before_burden_denial'
  }));
  var pol = await CP.read(jid);
  ok('A1 IL rules in place — duty=required_before_burden_denial', pol.clarification_duty === 'required_before_burden_denial');
  ok('A2 IL rules in place — clock effect=runs_no_stop', pol.clarification_clock_effect === 'runs_no_stop');

  // ---------------------------------------------------------------------------------------------
  // B. OVERLY BROAD -> the conference is OWED, and the trail must say the clock is still running.
  // ---------------------------------------------------------------------------------------------
  var r1 = await mkRequest('Every email any employee sent in 2025.');
  var b = await CA.send(r1, { reason: 'overly_broad', actorId: 'test', actorName: 'Test' });
  ok('B1 reason recorded as overly_broad — NOT collapsed into vague', b.reason === 'overly_broad');
  ok('B2 it does NOT masquerade as a vagueness flag', b.vague === false);
  ok('B3 CONFERENCE REQUIRED — the seeded duty is finally READ', b.conferenceRequired === true);
  ok('B4 the duty is reported back to the caller', b.duty === 'required_before_burden_denial');
  ok('B5 the clock did NOT stop for the conference (IL runs_no_stop)', b.clockStillRunning === true);
  ok('B6 nothing was tolled', b.clock.action === 'none');

  var n1 = await lastNote(r1);
  ok('B7 the effort trail names the defect', /OVERLY BROAD/.test(n1));
  ok('B8 the effort trail says the conference is REQUIRED', /CONFERENCE REQUIRED/.test(n1));
  ok('B9 the effort trail warns the clock is STILL RUNNING', /STILL RUNNING/.test(n1));
  // THE ONE THAT MATTERS. A city reads this trail later, in a dispute.
  ok('B10 the effort trail states the FORFEITURE consequence in plain words',
     /forfeits the burden defense/i.test(n1));

  // ---------------------------------------------------------------------------------------------
  // C. VAGUE -> the SAME jurisdiction, the SAME clock, and NO conference duty. The difference is
  //    entirely in the defect, which is exactly what the old single boolean could not express.
  // ---------------------------------------------------------------------------------------------
  var r2 = await mkRequest('I want the thing about the road.');
  var v = await CA.send(r2, { reason: 'vague', actorId: 'test', actorName: 'Test' });
  ok('C1 reason recorded as vague', v.reason === 'vague');
  ok('C2 NO conference duty is raised for vagueness — IL is silent on it', v.conferenceRequired === false);
  var n2 = await lastNote(r2);
  ok('C3 the vague trail does NOT claim a conference is required', !/CONFERENCE REQUIRED/.test(n2));
  ok('C4 the vague trail does NOT warn about burden forfeiture', !/forfeits the burden defense/i.test(n2));
  ok('C5 same jurisdiction, same clock — the DEFECT is what differs', v.effect === b.effect);

  // ---------------------------------------------------------------------------------------------
  // D. Backward compatibility. The old `vague: true` bool is still a live caller.
  // ---------------------------------------------------------------------------------------------
  var r3 = await mkRequest('Old caller.');
  var o = await CA.send(r3, { vague: true, actorId: 'test', actorName: 'Test' });
  ok('D1 the legacy `vague: true` bool still maps to reason=vague', o.reason === 'vague');
  ok('D2 ...and still reports vague=true to its old caller', o.vague === true);
  ok('D3 ...and raises no conference duty', o.conferenceRequired === false);

  // ---------------------------------------------------------------------------------------------
  // E. Hostile / absent input. A forged reason must never be stored and then read back by a searcher
  //    as if it meant something.
  // ---------------------------------------------------------------------------------------------
  var r4 = await mkRequest('Forged.');
  var f = await CA.send(r4, { reason: 'not_a_defect', actorId: 'test', actorName: 'Test' });
  ok('E1 an unrecognized reason is dropped, not stored', f.reason === null);
  ok('E2 ...and cannot conjure a conference duty', f.conferenceRequired === false);
  var r5 = await mkRequest('No defect at all.');
  var none = await CA.send(r5, { actorId: 'test', actorName: 'Test' });
  ok('E3 a plain clarification (no defect marked) records no reason', none.reason === null);
  var n5 = await lastNote(r5);
  ok('E4 ...and its trail claims neither defect', !/vague/i.test(n5) && !/OVERLY BROAD/.test(n5));

  // ---------------------------------------------------------------------------------------------
  // F. A jurisdiction WITHOUT the duty. Overbreadth is still recorded, but no conference is owed —
  //    the duty must come from the jurisdiction, never from the word "overly_broad".
  // ---------------------------------------------------------------------------------------------
  await CP.write(jid, Object.assign({}, original, {
    enabled: true, clarification_clock_effect: 'runs_no_stop', clarification_duty: 'none'
  }));
  var r6 = await mkRequest('Broad, but in a state with no conference duty.');
  var nb = await CA.send(r6, { reason: 'overly_broad', actorId: 'test', actorName: 'Test' });
  ok('F1 overbreadth is still RECORDED where no duty exists', nb.reason === 'overly_broad');
  ok('F2 but NO conference is owed — the duty comes from the JURISDICTION, not the word',
     nb.conferenceRequired === false);
  var n6 = await lastNote(r6);
  ok('F3 ...and the trail does not invent a forfeiture warning', !/forfeits the burden defense/i.test(n6));

  // restore
  await CP.write(jid, original);
  var back = await CP.read(jid);
  ok('G1 policy restored', back.clarification_duty === original.clarification_duty && back.enabled === original.enabled);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
