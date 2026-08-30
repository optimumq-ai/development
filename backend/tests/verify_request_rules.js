'use strict';
// REQUEST RULES — the three-tab screen behind the clarification / exemptions / eligibility hub rows
// (services/requestRules.js, routes/requestRules.js; WORKING_hub_linked_screens §2f, built 2026-08-27).
//
//   A. The screen's read: three tabs of law rules walked out of the state template (TX: 4/10/4, the
//      readable doc's exact lists), the statutory 61-day reply window, choices with confirmed state,
//      the standard-letter preview, and per-tab edit gates.
//   B. THE MASTER SWITCH: the import files clarification enabled:false; switching it ON materializes
//      the five choices as confirmable settings, fills the statutory policy fields (61 days,
//      withdrawal closure), moves the hub row off Not started — and is idempotent: recorded
//      decisions survive a re-enable AND a knobs-free policy write.
//   C. Recording clarification decisions: value + confirmed + who/when; the reply-window and
//      closing-notice choices write through to the policy fields the engine reads.
//   D. Exemption choices ride the EXISTING policy-settings/confirm endpoint (Legal Rules scope).
//   E. Eligibility posture: one act sets gated + confirmed; the new hub row and the three doors.
//
// BREAKS THIS SHOULD CATCH: a policy write erasing recorded decisions (B5) · the switch not
// materializing choices (B1) · confirm inventing settings or accepting junk (C2) · staff editing
// without the permission groups (A4/C5) · the hub doors drifting off the screen (E5).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var ut = require('/opt/optimumq/backend/src/services/userTypes');

var pass = 0, fail = 0;
function ok(l, c, extra) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (c || !extra ? '' : '  -> ' + extra)); }
var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'rr' + Date.now().toString().slice(-6);
async function mk(key, teamId) {
  var id = 'u-' + TAG + '-' + key;
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [id, id + '@test.optimumq.ai', 'RR ' + key, 'Test ' + TAG]);
  if (key !== 'none') await ut.grant(id, key, teamId || null, 'harness');
  return id;
}
async function callAs(id, method, path, body) {
  var t = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [id]));
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function domain(d) {
  var r = await db.get("SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx' AND domain = ?", [d]);
  return r ? JSON.parse(r.config_json) : null;
}
async function writeDomain(d, cfg) {
  await db.run("UPDATE jurisdiction_rules SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE jurisdiction_id = 'jur-tx' AND domain = ?", [JSON.stringify(cfg), d]);
}
function hubItem(page, key) {
  var found = null;
  (page.lanes || []).forEach(function (l) { l.items.forEach(function (x) { if (x.key === key) found = x; }); });
  return found;
}
function tabChoices(scr, tab) { var m = {}; ((scr.tabs[tab] || {}).choices || []).forEach(function (c) { m[c.key] = c; }); return m; }

(async function () {
  await db.initDb();
  var U = { dir: await mk('oro_director'), legal: await mk('oro_senior_legal'), staff: await mk('team_staff', 'team-police') };

  // Snapshot EVERYTHING this harness (or its precondition import) can touch, for a wholesale restore at
  // the end — the config-integrity harness asserts a clean fixture baseline and must find no residue.
  var SNAP = {};
  SNAP.rules = await db.all("SELECT id, domain, config_json, updated_by, updated_at FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx'");
  SNAP.sections = await db.all("SELECT * FROM jurisdiction_profile_sections WHERE jurisdiction_id = 'jur-tx'");
  SNAP.proposalIds = (await db.all("SELECT id FROM config_proposals WHERE jurisdiction_id = 'jur-tx'")).map(function (r) { return r.id; });
  SNAP.profile = await db.get("SELECT * FROM jurisdiction_profiles WHERE id = 'jur-tx'");
  SNAP.signoffs = await db.all("SELECT item_key, marked_by, marked_by_name, marked_at FROM setup_hub_signoffs WHERE item_key IN ('clarification','exemptions','eligibility','deadlines','intake')");

  // Precondition: the fixture ships without the imported template domains (they arrive when a harness or
  // the agency lock imports TX). Import here so this harness holds in any run order.
  if (!(await domain('eligibility'))) {
    await require('/opt/optimumq/backend/src/services/stateTemplateImport').importState('TX', { actor: 'rr-harness-precondition' });
  }

  // Baseline: the importer's state (test DB only — testEnv refuses live).
  // Clarification switched off; no screen domain; exemption knobs unconfirmed; incarceration gated, unconfirmed.
  var clar = await domain('clarification') || {};
  clar.enabled = false; clar.clarification_grace_days = null; clar.abandonment_closure = 'unspecified'; clar.closure_notice_required = false;
  await writeDomain('clarification', clar);
  await db.run("DELETE FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx' AND domain = 'clarification_screen'");
  var ex = await domain('exemption');
  Object.keys((ex && ex.knobs) || {}).forEach(function (k) { var cc = ex.knobs[k].city_config; if (cc) { cc.confirmed = false; cc.value = null; delete cc.confirmed_by; delete cc.confirmed_at; } });
  await writeDomain('exemption', ex);
  var el = await domain('eligibility');
  el.dimensions.incarceration.gated = true; el.dimensions.incarceration.confirmed = false;
  delete el.dimensions.incarceration.confirmed_by; delete el.dimensions.incarceration.confirmed_at;
  await writeDomain('eligibility', el);
  // I1 baseline: no bv stowaway (the fixture may still ship it), g1/g4/p3 unconfirmed.
  var inb = await domain('intake');
  if (inb) {
    if (inb.knobs) delete inb.knobs['Master.bv'];
    ['Master.g1', 'Master.g4'].forEach(function (k) { var cc = inb.knobs && inb.knobs[k] && inb.knobs[k].city_config; if (cc) { cc.confirmed = false; cc.value = null; delete cc.confirmed_by; delete cc.confirmed_at; } });
    await writeDomain('intake', inb);
  }
  var feeb = await domain('fee');
  if (feeb && feeb.knobs && feeb.knobs['Master.p3'] && feeb.knobs['Master.p3'].city_config) {
    var p3cc = feeb.knobs['Master.p3'].city_config;
    p3cc.confirmed = false; p3cc.value = null; delete p3cc.confirmed_by; delete p3cc.confirmed_at;
    await writeDomain('fee', feeb);
  }
  for (var k of ['clarification', 'exemptions', 'eligibility']) await db.run('DELETE FROM setup_hub_signoffs WHERE item_key = ?', [k]);
  await db.run("UPDATE jurisdiction_profile_sections SET attested_by = NULL, attested_at = NULL, attested_version = NULL, attested_hash = NULL WHERE jurisdiction_id = 'jur-tx' AND section IN ('clarification','eligibility')");

  console.log('\n=== A. THE SCREEN\'S READ ===');
  var g = await callAs(U.dir, 'GET', '/request-rules');
  var T = g.body && g.body.tabs;
  ok('A1 GET /request-rules: TX, three tabs, the readable doc\'s exact rule lists (4 / 10 / 4)',
    g.status === 200 && g.body.jurisdiction.code === 'TX' &&
    T.clarification.rules.map(function (r) { return r.id; }).join(',') === 'TX-0012,TX-0013,TX-0014,TX-0015' &&
    T.exemptions.rules.length === 10 && T.exemptions.rules[0].id === 'TX-0016' && T.exemptions.rules[9].id === 'TX-S03' &&
    T.eligibility.rules.map(function (r) { return r.id; }).join(',') === 'TX-0001,TX-0002,TX-0003,TX-0004',
    JSON.stringify(g.body).slice(0, 300));
  ok('A2 clarification off: enabled false, statutory 61-day window seen, choices not yet materialized',
    T.clarification.enabled === false && T.clarification.statutory && T.clarification.statutory.days === 61 &&
    T.clarification.choices.length === 5 && T.clarification.choices.every(function (c) { return c.materialized === false; }));
  ok('A3 exemptions: 4 unconfirmed choices + the reasons library count; eligibility: 6 dimensions, incarceration gated',
    T.exemptions.choices.length === 4 && T.exemptions.unconfirmed === 4 && typeof T.exemptions.redactionLibrary.approvedRules === 'number' &&
    T.eligibility.dimensions.length === 6 && T.eligibility.dimensions.filter(function (d) { return d.key === 'incarceration'; })[0].gated === true &&
    T.eligibility.unconfirmed === 1);
  ok('A4 the letter preview is the standard wording; staff may read but not edit',
    /public records request/i.test(g.body.letters.clarification.text) && (await (async function () {
      var s = await callAs(U.staff, 'GET', '/request-rules');
      return s.status === 200 && s.body.canEdit.clarification === false && s.body.canEdit.exemptions === false && s.body.canEdit.eligibility === false;
    })()));
  var s403 = await callAs(U.staff, 'POST', '/request-rules/clarification/enabled', { enabled: true });
  ok('A5 staff cannot flip the switch', s403.status === 403, JSON.stringify(s403.body));

  console.log('\n=== B. THE MASTER SWITCH ===');
  var en = await callAs(U.dir, 'POST', '/request-rules/clarification/enabled', { enabled: true });
  var enT = en.body && en.body.screen && en.body.screen.tabs.clarification;
  ok('B1 switching on materializes the five choices, the reply window fixed at the statute\'s 61 days',
    en.status === 200 && enT.enabled === true && enT.choices.length === 5 && enT.choices.every(function (c) { return c.materialized; }) &&
    enT.choices.filter(function (c) { return c.key === 'Clarification.n3'; })[0].statutoryDays === 61,
    JSON.stringify(en.body).slice(0, 300));
  var clarNow = await domain('clarification');
  ok('B2 the statutory policy fields are filled: 61-day grace, withdrawal closure, provenance kept',
    clarNow.enabled === true && clarNow.clarification_grace_days === 61 && clarNow.abandonment_closure === 'allowed' &&
    clarNow.provenance && clarNow.provenance.clarification_grace_days && /552\.222/.test(clarNow.provenance.clarification_grace_days.citation || ''));
  var hub1 = await callAs(U.dir, 'GET', '/setup-hub');
  var clarRow = hubItem(hub1.body, 'clarification');
  ok('B3 the hub row leaves Not started: in_progress with the choices counted',
    clarRow && clarRow.state === 'in_progress' && /0 of 5|not yet confirmed/.test(clarRow.evidence), clarRow && (clarRow.state + ' · ' + clarRow.evidence));

  // record one decision, then prove it survives a re-enable AND a knobs-free policy write
  await callAs(U.dir, 'POST', '/request-rules/clarification/confirm', { path: 'knobs/Master.bv', value: 'Too vague to search.' });
  await callAs(U.dir, 'POST', '/request-rules/clarification/enabled', { enabled: true });
  var afterRe = await domain('clarification_screen');
  ok('B4 re-enabling keeps a recorded decision (idempotent materialization)',
    afterRe.knobs['Master.bv'].city_config.confirmed === true && afterRe.knobs['Master.bv'].city_config.value === 'Too vague to search.');
  var CP = require('/opt/optimumq/backend/src/services/clarificationPolicy');
  await CP.write('jur-tx', { enabled: true, clarification_grace_days: 61, abandonment_closure: 'allowed' }, 'harness-policy-edit');
  var afterPol = await domain('clarification');
  ok('B5 a policy write touches only the policy domain: no stray keys there, decisions intact next door',
    !afterPol.knobs && (await domain('clarification_screen')).knobs['Master.bv'].city_config.confirmed === true);

  console.log('\n=== C. RECORDING CLARIFICATION DECISIONS ===');
  var c1 = await callAs(U.dir, 'POST', '/request-rules/clarification/confirm', { path: 'knobs/Clarification.n3', value: 61 });
  var n3 = tabChoices(c1.body.screen, 'clarification')['Clarification.n3'];
  ok('C1 confirming the reply window records who and when, and the policy field matches',
    c1.status === 200 && n3.confirmed === true && n3.confirmedBy === 'RR oro_director' && (await domain('clarification')).clarification_grace_days === 61,
    JSON.stringify(c1.body).slice(0, 200));
  var cBad = await callAs(U.dir, 'POST', '/request-rules/clarification/confirm', { path: 'knobs/Clarification.n3', value: 'soon' });
  ok('C2 junk is refused in words: the reply window is a whole number of days', cBad.status === 422 && /whole number/.test(cBad.body.error));
  var cUnknown = await callAs(U.dir, 'POST', '/request-rules/clarification/confirm', { path: 'knobs/Denial.dlegal', value: 'x' });
  ok('C3 a non-clarification setting is refused — this endpoint never invents settings', cUnknown.status === 404);
  await callAs(U.dir, 'POST', '/request-rules/clarification/confirm', { path: 'knobs/Clarification.close', value: 'yes' });
  ok('C4 the closing-notice choice writes through to closure_notice_required', (await domain('clarification')).closure_notice_required === true);
  await callAs(U.dir, 'POST', '/request-rules/clarification/confirm', { path: 'knobs/Clarification.n2', value: 'standard_wording' });
  var c5 = await callAs(U.dir, 'POST', '/request-rules/clarification/confirm', { path: 'knobs/Clarification.d4', value: 'new_request' });
  ok('C5 all five recorded → the tab reports nothing unconfirmed', c5.status === 200 && c5.body.screen.tabs.clarification.unconfirmed === 0);
  var cStaff = await callAs(U.staff, 'POST', '/request-rules/clarification/confirm', { path: 'knobs/Master.bv', value: 'x' });
  ok('C6 staff cannot record a decision', cStaff.status === 403);
  var d4bad = await callAs(U.dir, 'POST', '/request-rules/clarification/confirm', { path: 'knobs/Clarification.d4', value: 'maybe' });
  ok('C7 an answer outside the offered choices is refused', d4bad.status === 422);

  console.log('\n=== D. EXEMPTION CHOICES (the existing Legal Rules endpoint) ===');
  var d1 = await callAs(U.legal, 'POST', '/jurisdiction-profile/policy-settings/confirm', { domain: 'exemption', path: 'knobs/Denial.dlegal', value: 'legal_rules' });
  ok('D1 Senior Legal confirms who approves a denial', d1.status === 200, JSON.stringify(d1.body).slice(0, 200));
  var d2 = await callAs(U.dir, 'GET', '/request-rules');
  var dlegal = tabChoices(d2.body, 'exemptions')['Denial.dlegal'];
  ok('D2 the screen reads it back: value, confirmed, who', dlegal.confirmed === true && dlegal.value === 'legal_rules' && dlegal.confirmedBy === 'RR oro_senior_legal');
  ok('D3 the screen offers the approval groups with Legal Rules suggested',
    d2.body.tabs.exemptions.approvalGroups.some(function (g2) { return g2.value === 'legal_rules'; }) && dlegal.suggested === 'legal_rules');

  console.log('\n=== E. ELIGIBILITY POSTURE + THE HUB ROWS ===');
  var e1 = await callAs(U.dir, 'POST', '/request-rules/eligibility/posture', { dimension: 'incarceration', gated: true });
  var inc = e1.body.screen.tabs.eligibility.dimensions.filter(function (d) { return d.key === 'incarceration'; })[0];
  ok('E1 refuse-as-allowed: gated stays on, confirmed with who/when, nothing left unconfirmed',
    e1.status === 200 && inc.gated === true && inc.confirmed === true && inc.confirmedBy === 'RR oro_director' && e1.body.screen.tabs.eligibility.unconfirmed === 0,
    JSON.stringify(e1.body).slice(0, 200));
  var e2 = await callAs(U.dir, 'POST', '/request-rules/eligibility/posture', { dimension: 'incarceration', gated: false });
  var elNow = await domain('eligibility');
  ok('E2 accept-anyway: the engine gate is off and the decision is still on the record',
    e2.status === 200 && elNow.dimensions.incarceration.gated === false && elNow.dimensions.incarceration.confirmed === true);
  var e3 = await callAs(U.dir, 'POST', '/request-rules/eligibility/posture', { dimension: 'made_up', gated: true });
  ok('E3 an unknown dimension is refused — the state load defines them', e3.status === 404);
  var hub2 = await callAs(U.dir, 'GET', '/setup-hub');
  var elRow = hubItem(hub2.body, 'eligibility'), exRow = hubItem(hub2.body, 'exemptions'), clRow = hubItem(hub2.body, 'clarification');
  ok('E4 the new hub row exists: Requestor eligibility, compliance lane, its own door',
    elRow && elRow.name === 'Requestor eligibility' && elRow.door === '/setup/request-rules?tab=eligibility', JSON.stringify(elRow));
  ok('E5 all three doors open the one screen on the matching tab (Kevin 2026-08-27)',
    clRow.door === '/setup/request-rules?tab=clarification' && exRow.door === '/setup/request-rules?tab=exemptions');
  var mark = await callAs(U.dir, 'POST', '/setup-hub/eligibility/done');
  var hub3 = await callAs(U.dir, 'GET', '/setup-hub');
  ok('E6 the row can be attested once the decision is recorded', mark.status === 200 && hubItem(hub3.body, 'eligibility').state === 'ready');
  // Attestation fold (Kevin 2026-08-29): the done-mark IS the section sign-off — one act, one home.
  var elAtt = await db.get("SELECT attested_by FROM jurisdiction_profile_sections WHERE jurisdiction_id = 'jur-tx' AND section = 'eligibility'");
  ok('E6a the fold: marking the row done attests the eligibility profile section in the same act',
    mark.body.attested && mark.body.attested.indexOf('eligibility') >= 0 && elAtt && elAtt.attested_by === 'RR oro_director', JSON.stringify(mark.body));
  var unmark = await callAs(U.dir, 'DELETE', '/setup-hub/eligibility/done');
  var elAtt2 = await db.get("SELECT attested_by FROM jurisdiction_profile_sections WHERE jurisdiction_id = 'jur-tx' AND section = 'eligibility'");
  ok('E6b undoing the mark un-attests the folded section', unmark.status === 200 && (!elAtt2 || elAtt2.attested_by == null), JSON.stringify(unmark.body));

  console.log('\n=== DL. THE DEADLINES TAB (D1, Kevin 2026-08-29) ===');
  // FIXTURE/ORDER-PROOF: force the deadline domain to a known shape for this section — an empty holiday
  // calendar and both service targets unset. The wholesale SNAP restore in F puts the fixture row back.
  var dlSetup = await domain('deadline');
  dlSetup.holidays = [];
  if (dlSetup.clocks && dlSetup.clocks.acknowledge) delete dlSetup.clocks.acknowledge.duration;
  if (dlSetup.clocks && dlSetup.clocks.complete) delete dlSetup.clocks.complete.duration;
  await writeDomain('deadline', dlSetup);
  var gD = await callAs(U.dir, 'GET', '/request-rules');
  var D = gD.body.tabs.deadlines;
  ok('DL1 the tab reads: the §3 rules exactly, 7 clocks (5 statutory · 2 targets), the suspension shown as unlanded, calendar empty',
    D.rules.map(function (r) { return r.id; }).join(',') === 'TX-0008,TX-0009,TX-0010,TX-S04' &&
    D.clocks.length === 7 && D.clocks.filter(function (c) { return c.kind !== 'operational_target'; }).length === 5 &&
    D.clocks[0].primary === true && D.unlanded.length === 1 && D.unlanded[0].timer === 'suspension' &&
    D.calendar.holidayCount === 0 && D.unsetTargets === 2 && gD.body.canEdit.deadlines === true,
    JSON.stringify([D.rules.map(function (r) { return r.id; }), D.clocks.length, D.calendar]));
  var dlRow = hubItem((await callAs(U.dir, 'GET', '/setup-hub')).body, 'deadlines');
  ok('DL2 the hub row stays and its door opens the tab', dlRow && dlRow.door === '/setup/request-rules?tab=deadlines' && dlRow.legal === true, JSON.stringify(dlRow));
  var tStat = await callAs(U.dir, 'POST', '/request-rules/deadlines/target', { clock: 'respond', days: 5 });
  ok('DL3 a statutory clock refuses a target in words — its figure changes by proposal', tStat.status === 422 && /statutory clock/.test(tStat.body.error), JSON.stringify(tStat.body));
  var tSet = await callAs(U.dir, 'POST', '/request-rules/deadlines/target', { clock: 'acknowledge', days: 2 });
  ok('DL4 a service target records and reads back (1 of 2 still unset)', tSet.status === 200 && tSet.body.duration === 2 && tSet.body.screen.tabs.deadlines.unsetTargets === 1, JSON.stringify(tSet.body).slice(0, 120));
  var tClear = await callAs(U.dir, 'POST', '/request-rules/deadlines/target', { clock: 'acknowledge', days: null });
  ok('DL5 blank clears it — no target is a valid posture', tClear.status === 200 && tClear.body.duration === null);
  var hl1 = await callAs(U.dir, 'POST', '/request-rules/deadlines/holidays', {});
  ok('DL6 the empty calendar loads the US federal set in one act (24 days)', hl1.status === 200 && hl1.body.loaded === 24 && hl1.body.screen.tabs.deadlines.calendar.holidayCount === 24, JSON.stringify(hl1.body).slice(0, 120));
  var hl2 = await callAs(U.dir, 'POST', '/request-rules/deadlines/holidays', {});
  ok('DL7 a loaded calendar refuses the one-act load — changing it goes through a proposal', hl2.status === 409 && /proposal/.test(hl2.body.error), JSON.stringify(hl2.body));
  var tStaff = await callAs(U.staff, 'POST', '/request-rules/deadlines/target', { clock: 'complete', days: 3 });
  ok('DL8 staff cannot touch the deadlines tab (a legal section — legal_rules only)', tStaff.status === 403 && /legal_rules/.test(tStaff.body.error), JSON.stringify(tStaff.body));
  var dlMark = await callAs(U.legal, 'POST', '/setup-hub/deadlines/done');
  var dlAtt = await db.get("SELECT attested_by FROM jurisdiction_profile_sections WHERE jurisdiction_id = 'jur-tx' AND section = 'deadlines'");
  ok('DL9 the A1 fold covers the tab: Senior Legal\'s done-mark attests the deadlines section in the same act',
    dlMark.status === 200 && dlMark.body.attested && dlMark.body.attested.indexOf('deadlines') >= 0 && dlAtt && dlAtt.attested_by === 'RR oro_senior_legal', JSON.stringify(dlMark.body));
  await callAs(U.legal, 'DELETE', '/setup-hub/deadlines/done');

  console.log('\n=== IN. THE REQUEST INTAKE TAB (I1, Kevin 2026-08-29) ===');
  var gI = await callAs(U.dir, 'GET', '/request-rules');
  var IN = gI.body.tabs.intake;
  var STIm = require('/opt/optimumq/backend/src/services/stateTemplateImport');
  ok('IN1 the tab reads: the §10 rules exactly, three choices (channels · acknowledgment · estimate capture), none confirmed; the bv stowaway is gone (screen and importer both)',
    IN.rules.map(function (r) { return r.id; }).join(',') === 'TX-0005,TX-0006' &&
    IN.choices.map(function (c) { return c.key; }).join(',') === 'Master.g1,Master.g4,Master.p3' &&
    IN.unconfirmed === 3 && IN.addresses && typeof IN.addresses === 'object' &&
    STIm.KNOB_DOMAIN['Master.bv'] === undefined && gI.body.canEdit.intake === true,
    JSON.stringify([IN.rules.map(function (r) { return r.id; }), IN.choices.map(function (c) { return c.key; }), IN.unconfirmed]));
  var inRow = hubItem((await callAs(U.dir, 'GET', '/setup-hub')).body, 'intake');
  ok('IN2 the hub: a NEW Request Intake row (compliance, not legal) doors to the tab', inRow && inRow.name === 'Request Intake' && inRow.door === '/setup/request-rules?tab=intake' && inRow.legal === false, JSON.stringify(inRow));
  var iBad = await callAs(U.dir, 'POST', '/request-rules/intake/confirm', { path: 'knobs/Master.g1', value: ['carrier_pigeon'] });
  ok('IN3 an unknown channel is refused in words', iBad.status === 422 && /Unknown option/.test(iBad.body.error), JSON.stringify(iBad.body));
  var i1 = await callAs(U.dir, 'POST', '/request-rules/intake/confirm', { path: 'knobs/Master.g1', value: ['portal', 'email', 'mail', 'hand_delivery'] });
  ok('IN4 confirming the channels records value + who/when; 2 of 3 remain', i1.status === 200 && i1.body.screen.tabs.intake.unconfirmed === 2 &&
    i1.body.screen.tabs.intake.choices[0].confirmed === true && i1.body.screen.tabs.intake.choices[0].confirmedBy === 'RR oro_director', JSON.stringify(i1.body).slice(0, 160));
  var i2 = await callAs(U.dir, 'POST', '/request-rules/intake/confirm', { path: 'knobs/Master.p3', value: ['page_count', 'media', 'labor_class'] });
  var feeAfter = await domain('fee');
  ok('IN5 the estimate-capture confirm WRITES THROUGH to the fee store the engine reads',
    i2.status === 200 && feeAfter.knobs['Master.p3'].city_config.confirmed === true &&
    JSON.stringify(feeAfter.knobs['Master.p3'].city_config.value) === JSON.stringify(['page_count', 'media', 'labor_class']), JSON.stringify(feeAfter.knobs['Master.p3'].city_config).slice(0, 160));
  var i3 = await callAs(U.dir, 'POST', '/request-rules/intake/confirm', { path: 'knobs/Master.g4', value: 'same_business_day' });
  var RCa = require('/opt/optimumq/backend/src/services/requestCreate');
  var ackSame = await RCa.acknowledgementOn();
  var iNo = await callAs(U.dir, 'POST', '/request-rules/intake/confirm', { path: 'knobs/Master.g4', value: 'no_auto' });
  var ackNo = await RCa.acknowledgementOn();
  await callAs(U.dir, 'POST', '/request-rules/intake/confirm', { path: 'knobs/Master.g4', value: 'same_business_day' });
  ok('IN4b the acknowledgment goes out unless the city CONFIRMS "No automatic acknowledgment" here (the old ack_email switch folded into Master.g4)', i3.status === 200 && iNo.status === 200 && ackSame === true && ackNo === false, [ackSame, ackNo].join('/'));
  ok('IN6 all three confirmed', i3.status === 200 && i3.body.screen.tabs.intake.unconfirmed === 0);
  var iStaff = await callAs(U.staff, 'POST', '/request-rules/intake/confirm', { path: 'knobs/Master.g4', value: 'same_business_day' });
  ok('IN7 staff cannot record intake choices', iStaff.status === 403);
  var iMark = await callAs(U.dir, 'POST', '/setup-hub/intake/done');
  var inAtt = await db.get("SELECT attested_by FROM jurisdiction_profile_sections WHERE jurisdiction_id = 'jur-tx' AND section = 'intake'");
  ok('IN8 the A1 fold covers the tab: the done-mark attests the intake section in the same act',
    iMark.status === 200 && iMark.body.attested && iMark.body.attested.indexOf('intake') >= 0 && inAtt && inAtt.attested_by === 'RR oro_director', JSON.stringify(iMark.body));
  await callAs(U.dir, 'DELETE', '/setup-hub/intake/done');

  console.log('\n=== F. CLEANUP — the fixture is left exactly as found ===');
  await db.run("DELETE FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx'");
  for (var rr of SNAP.rules) {
    await db.run('INSERT INTO jurisdiction_rules (id, jurisdiction_id, domain, config_json, updated_by, updated_at) VALUES (?,?,?,?,?,?)',
      [rr.id, 'jur-tx', rr.domain, rr.config_json, rr.updated_by, rr.updated_at]);
  }
  await db.run("DELETE FROM jurisdiction_profile_sections WHERE jurisdiction_id = 'jur-tx'");
  for (var sr of SNAP.sections) {
    var cols = Object.keys(sr);
    await db.run('INSERT INTO jurisdiction_profile_sections (' + cols.join(',') + ') VALUES (' + cols.map(function () { return '?'; }).join(',') + ')',
      cols.map(function (c) { return sr[c]; }));
  }
  if (SNAP.proposalIds.length) await db.run("DELETE FROM config_proposals WHERE jurisdiction_id = 'jur-tx' AND id NOT IN (" + SNAP.proposalIds.map(function () { return '?'; }).join(',') + ')', SNAP.proposalIds);
  else await db.run("DELETE FROM config_proposals WHERE jurisdiction_id = 'jur-tx'");
  if (SNAP.profile) {
    var pcols = Object.keys(SNAP.profile).filter(function (c) { return c !== 'id'; });
    await db.run('UPDATE jurisdiction_profiles SET ' + pcols.map(function (c) { return c + ' = ?'; }).join(', ') + " WHERE id = 'jur-tx'",
      pcols.map(function (c) { return SNAP.profile[c]; }));
  }
  await db.run("DELETE FROM setup_hub_signoffs WHERE item_key IN ('clarification','exemptions','eligibility','deadlines','intake')");
  for (var sg of SNAP.signoffs) {
    await db.run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at) VALUES (?,?,?,?)', [sg.item_key, sg.marked_by, sg.marked_by_name, sg.marked_at]);
  }
  var CI = require('/opt/optimumq/backend/src/services/configIntegrity');
  var ci = await CI.check();
  var ciErr = (ci.findings || []).filter(function (f) { return f.severity === 'error' && !/A harness has leaked into production config/.test(f.issue); });
  ok('F1 cleanup: config integrity clean (' + ciErr.length + ' errors): ' + ciErr.map(function (f) { return f.where; }).join(' '), ciErr.length === 0);
  var rulesNow = await db.get("SELECT COUNT(*) n FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx'");
  ok('F2 cleanup: exactly the fixture\'s jur-tx rule rows again (' + SNAP.rules.length + ')', Number(rulesNow.n) === SNAP.rules.length);

  console.log('\n  SUMMARY  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('  ERR', e); console.log('\n  SUMMARY  ' + pass + '/' + (pass + fail + 1) + ' pass, ' + (fail + 1) + ' fail'); process.exit(1); });
