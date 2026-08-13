'use strict';
// MRR ITEM-BY-ITEM INTAKE — the wizard agent's PROMPT CONTRACT (D1 §6, item 12).
//
// The parent/child spec (§13) decides the intake behavior: "AI proposes, a human decides"
// (detect-and-propose -> validate-each -> "anything else?"). The wizard structurally enforces
// validate-each (the search/select loop) and anything-else (Submit-or-Continue); detect-and-propose
// lives in the AGENT PROMPT — a plain string nothing else in the suite reads. This harness locks the
// contract's load-bearing clauses so a prompt edit that silently drops one goes red instead of
// shipping. It asserts on the prompt, not on live model output (the live behavior was probed
// manually against the real agent — see the handoff — because model output is nondeterministic
// and a suite must not depend on Anthropic API availability or spend).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

(function () {
  var P = require('/opt/optimumq/backend/src/routes/publicChat').WIZARD_PROMPT;
  ok('A1 the wizard prompt is exported and non-trivial', typeof P === 'string' && P.length > 2000);

  console.log('\n=== A. THE MRR INTAKE CONTRACT (spec §13: AI proposes, a human decides) ===');
  ok('A2 one record per description, worked fully before the next', /ONE RECORD AT A TIME/.test(P));
  ok('A3 detect-and-propose exists for multi-type descriptions', /DETECT AND PROPOSE/.test(P));
  ok('A4 the split is PROPOSED, never silent — the citizen decides',
    /do not split it silently/.test(P) && /You propose, the citizen decides/.test(P));
  ok('A5 the proposal is validated back via quick replies',
    /\[\[QUICK_REPLIES: Yes, work through them one at a time \| No, I meant one record\]\]/.test(P));
  ok('A6 the queue is worked in order (next item named, not the generic ask)', /name the NEXT proposed item/.test(P));
  ok('A7 details of one item are not split into items (date/location/person)',
    /not a separate item/.test(P));
  ok('A8 combined-vs-separate stays retired — one request, one parent fee',
    /do NOT ask "combined or separate."/.test(P) && /one number, one parent-level fee/.test(P));

  console.log('\n=== B. THE SURROUNDING CONTRACT STAYS INTACT ===');
  ok('B1 the agent is description-only (form owns identity/fees/delivery)', /NEVER ask for contact information/.test(P));
  ok('B2 the RECORD_ADDED tracking marker survives', /\[\[RECORD_ADDED:/.test(P));
  ok('B3 the agent never emits submit/form markers', /NEVER emit \[\[CONTACT_FORM\]\]/.test(P) && /\[\[SUBMIT_READY\]\]/.test(P));
  ok('B4 the security preamble is first', P.indexOf('SECURITY') >= 0 && P.indexOf('SECURITY') < 50);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
