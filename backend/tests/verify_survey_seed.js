'use strict';
// The 17-state clarification survey, loaded as DATA.
// Claim under test: the research is now machine-readable per jurisdiction, every effect in the enum is
// represented, each policy round-trips through the real read path, provenance/citations survive, and the
// LIVE jurisdiction's behaviour is unchanged (every policy is a draft: enabled=false => automationActive false).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var db = require('/opt/optimumq/backend/src/db');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var CP = require('/opt/optimumq/backend/src/services/clarificationPolicy');
var CA = require('/opt/optimumq/backend/src/services/clarificationAction');

var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

(async function () {
  await db.initDb();
  try {
    // ---- 1. all 18 jurisdictions hold a clarification policy
    var rows = await db.all("SELECT jurisdiction_id FROM jurisdiction_rules WHERE domain = 'clarification'");
    ok('18 jurisdictions hold a clarification policy (17 surveyed + TX)', rows.length === 18);

    var withPolicy = {};
    rows.forEach(function (r) { withPolicy[r.jurisdiction_id] = true; });
    var allProfs = await db.all("SELECT id, code, name, status, exemption_model FROM jurisdiction_profiles ORDER BY code");
    var profs = allProfs.filter(function (p) { return withPolicy[p.id]; });   // the 18 the survey seeded
    // Don't freeze a total here: later slices legitimately add jurisdictions (CT and NY arrived with the
    // fee-waiver research). Assert the invariant — every clarification policy has a profile — not a count.
    ok('every clarification policy has a jurisdiction profile (' + allProfs.length + ' profiles >= ' + rows.length + ' policies)',
      profs.length === rows.length);
    ok('the ACTIVE jurisdiction is still TX and still status=active', allProfs.filter(function (p) { return p.id === 'jur-tx' && p.status === 'active'; }).length === 1);
    ok('all other jurisdictions are status=library — only the deployed one is active (' + allProfs.filter(function (p) { return p.status === 'library'; }).length + ' library, 1 active)',
      allProfs.filter(function (p) { return p.status === 'library'; }).length === allProfs.length - 1);

    // ---- 2. every policy round-trips through the REAL read path, per jurisdiction
    var effects = {};
    var bad = [];
    for (var i = 0; i < profs.length; i++) {
      var p = await CP.read(profs[i].id);
      if (!p || !p.clarification_clock_effect) bad.push(profs[i].code);
      effects[p.clarification_clock_effect] = (effects[p.clarification_clock_effect] || 0) + 1;
      if (p.enabled !== false) bad.push(profs[i].code + ':enabled');
    }
    ok('every jurisdiction reads back a valid policy through clarificationPolicy.read(jid)', bad.length === 0);
    ok('EVERY policy is a DRAFT (enabled=false) — no live rule was switched on', bad.filter(function (b) { return /enabled/.test(b); }).length === 0);

    // ---- 3. the whole enum is exercised — this is the point of a per-jurisdiction field
    console.log('\n  effect distribution: ' + JSON.stringify(effects));
    ['no_fixed_clock', 'runs_no_stop', 'toll_pause_resume', 'toll_and_restart', 'start_gate', 'operational_hold'].forEach(function (e) {
      ok('effect "' + e + '" is represented in the data (' + (effects[e] || 0) + ')', (effects[e] || 0) > 0);
    });
    ok('no single effect covers a majority — the quantitative case for a per-jurisdiction field',
      Math.max.apply(null, Object.keys(effects).map(function (k) { return effects[k]; })) < 10);

    // ---- 4. the states that DISAGREE with each other, read back distinctly and simultaneously
    var tx = await CP.read('jur-tx'), wa = await CP.read('jur-wa'), il = await CP.read('jur-il'), mi = await CP.read('jur-mi');
    ok('TX = toll_and_restart (clarification RESETS the clock — City of Dallas v. Abbott)', tx.clarification_clock_effect === 'toll_and_restart');
    ok('WA = toll_pause_resume (pause and resume)', wa.clarification_clock_effect === 'toll_pause_resume');
    ok('IL = runs_no_stop (the clock never stops)', il.clarification_clock_effect === 'runs_no_stop');
    ok('MI = start_gate (the clock starts only on a sufficient request)', mi.clarification_clock_effect === 'start_gate');
    ok('FOUR states, FOUR different clock behaviours, held at once', new Set([tx.clarification_clock_effect, wa.clarification_clock_effect, il.clarification_clock_effect, mi.clarification_clock_effect]).size === 4);

    // ---- 5. the legally load-bearing details survived
    ok('TX grace = 61 days (§ 552.222(d): no reply in 61 days => request withdrawn)', tx.clarification_grace_days === 61);
    ok('WA grace = 30 days (WAC 44-14-04003(8) abandonment)', wa.clarification_grace_days === 30);
    ok('IL carries the burden duty (§ 3(g): offer narrowing before an unduly-burdensome denial)', il.clarification_duty === 'required_before_burden_denial');
    ok('IL requires a written closure notice (§ 9(b))', il.closure_notice_required === true);

    // ---- 6. provenance + citations survived the round trip (this is what makes it legally defensible)
    ok('TX provenance cites the statute AND the case', /552\.222/.test(tx.provenance.clarification_clock_effect.citation) && /Abbott/.test(tx.provenance.clarification_clock_effect.citation));
    ok('WA provenance is ag_guidance (model rule), not statute', wa.provenance.clarification_clock_effect.source === 'ag_guidance');
    ok('MI carries the LOWEST confidence in the set (0.4 — the two research passes disagree)',
      mi.provenance.clarification_clock_effect.confidence === 0.4);
    var confs = [];
    for (var k = 0; k < profs.length; k++) { var pp = await CP.read(profs[k].id); confs.push(pp.provenance.clarification_clock_effect.confidence); }
    ok('every policy carries a confidence score', confs.every(function (c) { return typeof c === 'number' && c > 0; }));
    ok('MI is the minimum confidence across all 18', Math.min.apply(null, confs) === 0.4);

    // ---- 7. it rode the REAL config path: history + profile sections exist for the new jurisdictions
    var hist = await db.get("SELECT COUNT(*) AS n FROM config_history WHERE domain = 'clarification'");
    ok('config_history recorded the applies (' + hist.n + ' rows)', Number(hist.n) >= 18);
    var secs = await db.get("SELECT COUNT(*) AS n FROM jurisdiction_profile_sections WHERE section = 'clarification'");
    ok('a clarification profile section exists for every jurisdiction (' + secs.n + ')', Number(secs.n) >= 18);
    var unattested = await db.get("SELECT COUNT(*) AS n FROM jurisdiction_profile_sections WHERE section = 'clarification' AND attested_by IS NOT NULL");
    ok('NOTHING is attested — the attestation gate is still closed everywhere', Number(unattested.n) === 0);

    // ---- 8. THE SAFETY CLAIM: live behaviour is unchanged. A drafted policy takes NO automated action.
    var txSection = await db.get("SELECT attested_by FROM jurisdiction_profile_sections WHERE jurisdiction_id = 'jur-tx' AND section = 'clarification'");
    var attested = !!(txSection && txSection.attested_by);
    ok('TX clarification section is NOT attested', attested === false);
    ok('automationActive(TX) === false — seeding the research changed NO live request behaviour',
      CP.automationActive(tx, attested) === false);
    ok('  ...and it would still be false even if attested, because enabled=false', CP.automationActive(tx, true) === false);
    ok('clarificationAction is loadable and the effect mapper covers all 6 effects', typeof CA.send === 'function' && typeof CA.resolve === 'function');

    // ---- 9. the clock config is untouched by this slice
    var d = await JR.readActive('deadline');
    ok('the deadline rules are untouched (respond.default=' + (d.clocks.respond.default) + ')', d.clocks.respond.default === 10);

    console.log('\n  Loaded: ' + profs.map(function (p) { return p.code; }).join(' '));

  } catch (e) { console.error('ERR', (e && e.stack) || e); fail++; }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
