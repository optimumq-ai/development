'use strict';
// PHASE 7 / WS1 — import a Phase-6 state template into the app's jurisdiction-config machinery.
//
//   cd /opt/optimumq/backend
//   node src/db/import_state_template.js TX OH        # import these states
//   node src/db/import_state_template.js --all        # every gathered template
//   node src/db/import_state_template.js OH --dry-run # report only, touch nothing
//   node src/db/import_state_template.js --list
//
// The importer NEVER overwrites a config that already exists — a domain that differs is staged as a
// pending `config_proposals` row for review. Re-running it against an unchanged template and an
// unchanged database writes nothing. All of the reasoning lives in
// ../services/stateTemplateImport.js; this file is the CLI and the report.
require('dotenv').config();
var db = require('../db');
var STI = require('../services/stateTemplateImport');

function pad(s, n) { s = String(s); return s + new Array(Math.max(1, n - s.length + 1)).join(' '); }

function report(r) {
  console.log('\n' + r.code + '  ' + r.state + '   (' + r.jid + ')   template ' + r.template + ' sha ' + r.sha256.slice(0, 12));
  console.log('  profile:   ' + (r.profileCreated ? 'CREATED (status=library — importing does not switch the city over)' : 'existing, untouched'));
  if (r.written.length) console.log('  written:   ' + r.written.join(' '));
  if (r.unchanged.length) console.log('  unchanged: ' + r.unchanged.join(' '));
  r.proposed.forEach(function (p) {
    console.log('  PROPOSAL:  ' + pad(p.domain, 16) + (p.deduped ? 'already pending (' + p.proposalId + ') — not staged twice' : p.proposalId + ' — merge (live values preserved), review it'));
  });

  var rep = r.report || {};
  if (r.statuteNameMissing) {
    console.log('  ! statute_name is empty. The template carries rule authorities, not the statute\'s NAME —');
    console.log('    a human sets it (e.g. "Ohio Public Records Act"). The citation was derived from the rules.');
  }
  if ((rep.unresolvedTimers || []).length) {
    console.log('  ! named timers left OUT of the deadline config (WS3 / a human resolves these):');
    rep.unresolvedTimers.forEach(function (t) { console.log('      ' + pad(t.timer, 22) + t.why); });
  }
  if (!rep.primaryClock) {
    console.log('  ! NO STATUTORY RESPONSE CLOCK resolved for this state. Any due date shown for the response');
    console.log('    is a CITY SERVICE TARGET — it must never be described to a requestor as the legal deadline.');
  }
  if (r.written.indexOf('deadline') < 0 && r.proposed.every(function (p) { return p.domain !== 'deadline'; }) && !r.unchanged.length) {
    console.log('  ! NO deadline config at all: not one named timer reconciled. jurisdictionRules.read() then');
    console.log('    falls back to the LEGACY GLOBAL deadline_rules key — i.e. this state would inherit');
    console.log('    another state\'s clock. Do not go live on it.');
  }
  if ((rep.targets || []).length) {
    console.log('  ! SERVICE TARGETS — this state sets no number here, so the city must. NOT legal deadlines (S-002):');
    rep.targets.forEach(function (t) {
      console.log('      ' + pad(t.clock, 22) + 'from timer ' + t.timer +
        (t.statutoryDutyPresent ? '  (the statute states the duty but no time limit)' : '  (the statute states no timer at all)'));
    });
  }
  if ((rep.exposures || []).length) {
    console.log('  · deemed-denial / deemed-disclosure exposure — recorded as a WARNING on the duty clock,');
    console.log('    never run as a countdown (the job is to respond in time, not to time the default):');
    rep.exposures.forEach(function (e) {
      console.log('      ' + pad(e.timer, 22) + e.rule_id + '  ' + (e.days != null ? e.days + ' ' + e.basis : '(no number)') + '  ' + (e.authority || ''));
    });
  }
  if (rep.primaryClock) console.log('  · primary (statutory) clock: ' + rep.primaryClock);
  if ((rep.cityKnobs || []).length) {
    console.log('  · ' + rep.cityKnobs.length + ' city-config knob(s) imported UNCONFIRMED — every one must be confirmed');
    console.log('    before its section can be attested: ' + rep.cityKnobs.map(function (c) { return c.node; }).join(' '));
  }
  if ((rep.emptyPoliced || []).length) {
    console.log('  · no statutory evidence mapped onto: ' + rep.emptyPoliced.join(' ') + ' (safe defaults, enabled=false)');
  }
  var sec = (r.sections || []).filter(function (s) { return s.status === 'not_configured'; });
  if (sec.length) console.log('  · not_configured sections: ' + sec.map(function (s) { return s.section; }).join(' '));
  if (r.sectionError) console.log('  ! profile-section sync failed: ' + r.sectionError);
}

(async function () {
  var args = process.argv.slice(2);
  var dryRun = args.indexOf('--dry-run') >= 0;
  var actorArg = args.filter(function (a) { return a.indexOf('--actor=') === 0; })[0];
  var actor = actorArg ? actorArg.split('=')[1] : 'template-import';
  var codes = args.filter(function (a) { return a.indexOf('--') !== 0; }).map(function (a) { return a.toUpperCase(); });

  if (args.indexOf('--list') >= 0) { console.log(STI.listTemplates().join(' ')); process.exit(0); }
  if (args.indexOf('--all') >= 0) codes = STI.listTemplates();
  if (!codes.length) {
    console.error('Usage: node src/db/import_state_template.js <ST> [<ST> ...] | --all [--dry-run] [--actor=name]');
    console.error('Available: ' + STI.listTemplates().join(' '));
    process.exit(2);
  }

  await db.initDb();
  if (dryRun) console.log('\nDRY RUN — nothing will be written.');
  var totals = { written: 0, proposed: 0, unchanged: 0 };
  for (var i = 0; i < codes.length; i++) {
    var r = await STI.importState(codes[i], { actor: actor, dryRun: dryRun });
    report(r);
    totals.written += r.written.length; totals.proposed += r.proposed.length; totals.unchanged += r.unchanged.length;
  }
  console.log('\n' + codes.length + ' state(s): ' + totals.written + ' domain(s) written, ' +
    totals.proposed + ' staged as proposals, ' + totals.unchanged + ' already current.');
  console.log('Next: node src/db/check_config_integrity.js\n');
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
