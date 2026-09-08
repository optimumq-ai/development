'use strict';
// WHAT THE LAW LETS YOU CHARGE — services/feeLaw.js + routes/feeLaw.js (WORKING_hub_linked_screens §2b).
//
//   A. The catalog covers every template item for every state: 35 keys × 32 templates, every value parses,
//      a ceiling row's figure is the MUNICIPAL ceiling (AG rate + 25% in TX), fixed rows read as law.
//   B. Defaults (Kevin 2026-08-25): a ceiling row's city value starts AT the ceiling; deferral rows start
//      undecided; the screen counts both.
//   C. Deciding: the hub gate (403 outside it); a value above a ceiling is refused by name; "none" is a
//      decision; clearing removes it.
//   D. Approving: refused while deferral rows are undecided; then composes ONE fee_profiles row (FR, v1,
//      active) with the state's figures mapped by engine path and the city's decisions; approving again
//      makes v2 and supersedes v1 — never edits in place; config_history carries the decisions.
//   E. The hub reads it: not_started with "no fee schedule version yet" → in_progress with "v1" → attest.
//
// BREAKS THIS SHOULD CATCH: take the AG rate instead of the municipal ceiling (A3) · let a city value exceed
// the ceiling (C2) · approve with undecided rows (D1) · UPDATE the active profile instead of versioning (D3).
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var ut = require('/opt/optimumq/backend/src/services/userTypes');
var FL = require('/opt/optimumq/backend/src/services/feeLaw');
var STI = require('/opt/optimumq/backend/src/services/stateTemplateImport');

var pass = 0, fail = 0;
function ok(l, c, extra) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (c || !extra ? '' : '  -> ' + extra)); }
var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'fl' + Date.now().toString().slice(-6);
async function mk(key, teamId) {
  var id = 'u-' + TAG + '-' + key;
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [id, id + '@test.optimumq.ai', 'FL ' + key, 'Test ' + TAG]);
  if (key !== 'none') await ut.grant(id, key, teamId || null, 'harness');
  return id;
}
async function callAs(id, method, path, body) {
  var t = await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [id]));
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
function rowOf(s, k) { return s.rows.filter(function (r) { return r.key === k; })[0]; }
function hubRow(page) { var f = null; page.lanes.forEach(function (l) { l.items.forEach(function (x) { if (x.key === 'fee_law') f = x; }); }); return f; }

(async function () {
  await db.initDb();
  var U = { dir: await mk('oro_director'), staff: await mk('team_staff', 'team-police') };

  // A known starting point on the TEST db: TX locked and active, no fee schedule, no decisions.
  await STI.importState('TX', { actor: 'harness' });
  await db.run("UPDATE jurisdiction_profiles SET status = 'active' WHERE id = 'jur-tx'");
  await db.run("INSERT INTO system_config (key, value) VALUES ('jurisdiction_profile', 'jur-tx') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
  await db.run("DELETE FROM fee_profiles WHERE jurisdiction_id = 'jur-tx'");
  await db.run("DELETE FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx' AND domain = ?", [FL.DECISIONS_DOMAIN]);
  await db.run("DELETE FROM setup_hub_signoffs WHERE item_key = 'fee_law'");
  await db.run("DELETE FROM jurisdiction_profile_sections WHERE jurisdiction_id = 'jur-tx' AND section = 'fees'");

  console.log('\n=== A. THE CATALOG ===');
  var codes = STI.listTemplates();
  var keyMismatch = [], parseErr = 0, cells = 0;
  codes.forEach(function (c) {
    var items = FL.templateItems(c).items;
    var keys = Object.keys(items).filter(function (k) { return k !== 'waiver'; }).sort();
    if (keys.join(',') !== FL.CATALOG.map(function (x) { return x.key; }).sort().join(',')) keyMismatch.push(c);
    if (!items['waiver']) keyMismatch.push(c + ':no-waiver-item');
    FL.CATALOG.forEach(function (it) { cells++; try { FL.parseValue(it, (items[it.key] || {}).value); } catch (e) { parseErr++; } });
  });
  ok('A1 the catalog is exactly the template item set less the waiver item (its rows are built per ground), in all ' + codes.length + ' templates', codes.length >= 32 && keyMismatch.length === 0, keyMismatch.join(','));
  ok('A2 every value in every template parses (' + cells + ' cells)', parseErr === 0, parseErr + ' errors');
  var s0 = (await callAs(U.dir, 'GET', '/fee-law')).body;
  var bw = rowOf(s0, 'dup.bw.rate'), prog = rowOf(s0, 'labor.programming.rate'), oh = rowOf(s0, 'labor.overheadPct'), media = rowOf(s0, 'media');
  ok('A3 TX B&W copy: ceiling is the MUNICIPAL figure 0.125 (AG 0.10 + 25%), shown as the law\'s value', bw.binding === 'ceiling' && bw.ceiling === 0.125 && bw.law.ag === 0.1 && /0\.125/.test(bw.law.display), JSON.stringify(bw.law));
  ok('A4 programming labor ceiling 35.625 · overhead FIXED at 20% reads "as law" (not editable) · media parsed cd 1.25 / dvd 3.75 / usb actual', prog.ceiling === 35.625 && oh.binding === 'fixed' && oh.editable === false && oh.city.value === 20 && media.law.parsed.cd === 1.25 && media.law.parsed.dvd === 3.75 && media.law.parsed.usb === 'actual', JSON.stringify([prog.ceiling, oh.city, media.law.parsed]));
  ok('A5 the screen splits 23 mandate / 13 deferral (the two waiver ground rows included); NO ledger gaps since the ledger reads the schedule (2026-09-08)', s0.counts.mandate === 23 && s0.counts.deferral === 13 && s0.counts.gaps === 0 && s0.rows.every(function (r) { return r.bucket === 'computation' || r.bucket === 'estimate_payment' || r.bucket === 'waiver'; }), JSON.stringify(s0.counts));
  // Kevin's Fee-rules markup, 2026-09-08
  var rp = rowOf(s0, 'repeat'), dl = rowOf(s0, 'delivery'), mx = rowOf(s0, 'rules.maxFee');
  ok('A5b a prose rule reads as sentences: no underscores, capital first letter, all four findings kept for the popup, city column "as law"', /^Same day aggregation: all requests/.test(rp.law.display) && rp.law.display.indexOf('_') === -1 && rp.law.segments.length === 4 && /^Prior unpaid > \$100/.test(rp.law.segments[2]) && rp.city.value === 'as law', JSON.stringify([rp.law.display, rp.law.segments, rp.city.value]));
  var pfh = rowOf(s0, 'labor.periodicFreeHours');
  ok('A5c the two cross-request rows carry ENGINE PATHS (no gap flag); the research note rides every row for the popup; the floor row may be declined with None', rp.gap === null && rp.path === 'requestRules.sameDayAggregation' && pfh.path === 'requestRules.personnelTimeAllowance' && pfh.noneOk === true && pfh.law.parsed.hoursPerMonth === 15 && rp.law.notes && /No carry-forward/.test(rp.law.notes) && oh.law.segments.length === 1 && oh.law.segments[0] === '20%', JSON.stringify([rp.gap, rp.path, pfh.path, pfh.law.parsed]));
  ok('A5d delivery offers "Actual postage" as its actual choice; the request cap is labelled as an optional city policy', dl.actualOk && dl.actualLabel === 'Actual postage' && dl.unit === '$ per request' && /optional city policy/.test(mx.label), JSON.stringify([dl.unit, dl.actualLabel, mx.label]));
  var mOver = await callAs(U.dir, 'PUT', '/fee-law/decisions', { items: { media: { value: { cd: '1.00', dvd: '9', usb: 'actual' } } } });
  ok('A5e electronic media is decided per item — a DVD figure above the state ceiling is refused by name', mOver.status === 200 && mOver.body.refused.length === 1 && /DVD above 3.75/.test(mOver.body.refused[0].why), JSON.stringify(mOver.body.refused));
  var mOk = await callAs(U.dir, 'PUT', '/fee-law/decisions', { items: { media: { value: { cd: '$1.00', dvd: '3', usb: 'actual' } } } });
  var mRow = mOk.body && rowOf(mOk.body.screen, 'media');
  ok('A5f …and figures at or under the ceilings are stored as numbers, USB as "actual"', mOk.status === 200 && mOk.body.refused.length === 0 && mRow.city.value.cd === 1 && mRow.city.value.dvd === 3 && mRow.city.value.usb === 'actual' && mRow.city.source === 'hand', JSON.stringify(mRow && mRow.city));
  await callAs(U.dir, 'PUT', '/fee-law/decisions', { items: { media: { value: null } } });
  var mBack = rowOf((await callAs(U.dir, 'GET', '/fee-law')).body, 'media');
  ok('A5g clearing every media field removes the decision (back to the loaded ceilings)', mBack.city.source === 'default' && mBack.city.value.cd === 1.25, JSON.stringify(mBack.city));
  var wpi = rowOf(s0, 'waiver.public_interest'), wcc = rowOf(s0, 'waiver.cost_of_collection');
  ok('A6 TX names both waiver grounds: public interest (fixed, must) and cost of collection (discretionary, may, de-minimis cross-reference); neither is editable',
    wpi && wpi.binding === 'fixed' && /must waive or reduce/i.test(wpi.law.display) && wpi.editable === false && /552\.267/.test(wpi.law.authority) &&
    wcc && wcc.binding === 'discretionary' && /may waive/i.test(wcc.law.display) && wcc.editable === false && /De-minimis/.test(wcc.city.value),
    JSON.stringify([wpi && wpi.law.display, wcc && wcc.city.value]));

  console.log('\n=== B. DEFAULTS ===');
  ok('B1 every ceiling row starts AT the ceiling, source "default"', s0.rows.filter(function (r) { return r.binding === 'ceiling' && r.ceiling != null; }).every(function (r) { return r.city.value === r.ceiling && r.city.source === 'default'; }) && s0.counts.ceilingsDefaulted === s0.counts.ceilings);
  ok('B2 every deferral row starts undecided; 0 of 13 decided; no version', s0.counts.decided === 0 && s0.counts.undecided === 13 && s0.version === null);

  console.log('\n=== C. DECIDING ===');
  var st = await callAs(U.staff, 'PUT', '/fee-law/decisions', { items: { 'rules.freePages': { value: 10 } } });
  ok('C1 team staff may read but not decide (403)', st.status === 403 && (await callAs(U.staff, 'GET', '/fee-law')).body.canEdit === false);
  var over = await callAs(U.dir, 'PUT', '/fee-law/decisions', { items: { 'dup.bw.rate': { value: 0.2 }, 'labor.search.rate': { value: 12 } } });
  var sAfter = over.body.screen;
  ok('C2 a city value above the ceiling is refused BY NAME and not saved; one under it is saved', over.status === 200 && over.body.refused.length === 1 && over.body.refused[0].key === 'dup.bw.rate' && /ceiling of 0\.125/.test(over.body.refused[0].why) && rowOf(sAfter, 'dup.bw.rate').city.value === 0.125 && rowOf(sAfter, 'labor.search.rate').city.value === 12 && rowOf(sAfter, 'labor.search.rate').city.source === 'hand', JSON.stringify(over.body.refused));
  var fx = await callAs(U.dir, 'PUT', '/fee-law/decisions', { items: { 'labor.overheadPct': { value: 5 } } });
  ok('C3 a fixed row cannot be decided ("set by law")', fx.body.refused.length === 1 && /set by law/.test(fx.body.refused[0].why) && rowOf(fx.body.screen, 'labor.overheadPct').city.value === 20);
  var dec = { 'dup.specialty.rate': { value: 'actual' }, 'dup.tiers': { value: 'none' }, 'rules.freePages': { value: 10 }, 'labor.increment': { value: 15 }, 'rules.freeLaborHours': { value: 1 }, 'rules.deMinimis': { value: 5 }, 'rules.minFee': { value: 'none' }, 'delivery': { value: 'actual' }, 'certification': { value: 1 }, 'commercial': { value: 'none' }, 'estimate.validityDays': { value: 30 }, 'rules.deposit.percent': { value: 50 } };
  var d1 = await callAs(U.dir, 'PUT', '/fee-law/decisions', { items: dec });
  ok('C4 twelve decisions saved ("none" and "actual" count as decisions) → 12 of 13, 1 undecided', d1.status === 200 && d1.body.refused.length === 0 && d1.body.screen.counts.decided === 12 && d1.body.screen.counts.undecided === 1, JSON.stringify(d1.body.screen && d1.body.screen.counts));

  var pv = await callAs(U.dir, 'POST', '/fee-law/preview', { against: 'active', quantities: { searchHours: 3, bwPages: 200 } });
  ok('C5 the test calculator prices against the DRAFT before any version exists (200 pages less the 10 free at 0.125 = $23.75; 3 search hrs at the $12 decision, 1 free → $24)', pv.status === 200 && pv.body.against === 'draft' && pv.body.configVersion === 'draft' && Math.abs(pv.body.requestLevel.duplicationSubtotal - 23.75) < 0.01 && Math.abs(pv.body.requestLevel.laborSubtotal - 24) < 0.01, JSON.stringify(pv.body).slice(0, 200));

  console.log('\n=== D. APPROVING ===');
  var a0 = await callAs(U.dir, 'POST', '/fee-law/approve', {});
  ok('D1 approve is refused while a deferral row is undecided (422 UNDECIDED, names it)', a0.status === 422 && a0.body.code === 'UNDECIDED' && a0.body.undecided.length === 1 && a0.body.undecided[0] === 'waiver.forfeiture', JSON.stringify(a0.body));
  await callAs(U.dir, 'PUT', '/fee-law/decisions', { items: { 'waiver.forfeiture': { value: 'none' } } });
  var a1 = await callAs(U.dir, 'POST', '/fee-law/approve', {});
  var cfg = a1.body && a1.body.profile && a1.body.profile.config;
  ok('D2 approve → fee schedule v1, active, one fee_profiles row for jur-tx/FR', a1.status === 200 && a1.body.profile.version === 1 && a1.body.profile.status === 'active' && Number((await db.get("SELECT COUNT(*) n FROM fee_profiles WHERE jurisdiction_id = 'jur-tx' AND context = 'FR'")).n) === 1, JSON.stringify(a1.body).slice(0, 200));
  ok('D2a the composed config carries the state\'s figures by engine path: bw 0.125 · programming 35.625 · overhead 20 · labor only over 50 pages · estimate threshold $40 · response 10 days · revision 20% · deposit above $100 · media cd 1.25 / dvd 3.75 · av 10 + 1/min',
    cfg && cfg.duplication.bw.rate === 0.125 && cfg.labor.programming.rate === 35.625 && cfg.labor.overheadPct === 20 && cfg.labor.search.billableWhen && cfg.labor.search.billableWhen.trigger === 'pages' && cfg.labor.search.billableWhen.threshold === 50 &&
    cfg.requestRules.estimateNotifyThreshold === 40 && cfg.estimatePolicy.requesterResponseDays === 10 && cfg.estimatePolicy.revisionNotifyPercent === 20 && cfg.requestRules.deposit.threshold === 100 && cfg.media.cd === 1.25 && cfg.media.dvd === 3.75 && cfg.av.perRecording === 10 && cfg.av.perMinute === 1, JSON.stringify(cfg).slice(0, 400));
  ok('D2b the composed schedule carries the two cross-request rules the ledger reads: personnel-time allowance 36 h/yr · 15 h/mo (the state floor, defaulted) and same-day aggregation ON', cfg && cfg.requestRules.personnelTimeAllowance && cfg.requestRules.personnelTimeAllowance.hoursPerYear === 36 && cfg.requestRules.personnelTimeAllowance.hoursPerMonth === 15 && cfg.requestRules.sameDayAggregation === true, JSON.stringify(cfg && cfg.requestRules));
  ok('D2b …and the city\'s decisions: search $12 (under the cap) · free pages 10 · increment 15 min → 0.25 h · de-minimis $5 · min fee none → 0 · certification $1 · validity 30 · deposit 50% · specialty actual · no commercial override',
    cfg && cfg.labor.search.rate === 12 && cfg.requestRules.freePageAllowance === 10 && cfg.labor.search.increment === 0.25 && cfg.requestRules.deMinimis === 5 && cfg.requestRules.minFee === 0 && cfg.certification.rate === 1 && cfg.estimatePolicy.estimateValidityDays === 30 && cfg.requestRules.deposit.percent === 50 && cfg.duplication.specialty.rate === 'actual' && !cfg.purposeOverrides, JSON.stringify(cfg).slice(0, 400));
  var pv2 = await callAs(U.dir, 'POST', '/fee-law/preview', { against: 'active', quantities: { searchHours: 0, bwPages: 200 } });
  ok('D2c …and the calculator now prices against the approved v1 when asked', pv2.status === 200 && pv2.body.against === 'active' && pv2.body.configVersion === 'v1' && Math.abs(pv2.body.requestLevel.duplicationSubtotal - 23.75) < 0.01, JSON.stringify(pv2.body).slice(0, 160));
  var v1 = a1.body.profile.id;
  await callAs(U.dir, 'PUT', '/fee-law/decisions', { items: { 'dup.bw.rate': { value: 0.1 } } });
  var a2 = await callAs(U.dir, 'POST', '/fee-law/approve', {});
  var rows = await db.all("SELECT id, version, status, config_json FROM fee_profiles WHERE jurisdiction_id = 'jur-tx' AND context = 'FR' ORDER BY version");
  ok('D3 approving again → v2 active, v1 superseded and unchanged (never edited in place)', a2.body.profile.version === 2 && rows.length === 2 && rows[0].id === v1 && rows[0].status === 'superseded' && JSON.parse(rows[0].config_json).duplication.bw.rate === 0.125 && rows[1].status === 'active' && JSON.parse(rows[1].config_json).duplication.bw.rate === 0.1, JSON.stringify(rows.map(function (r) { return [r.version, r.status]; })));
  var hist = await db.all("SELECT summary, effective_to FROM config_history WHERE jurisdiction_id = 'jur-tx' AND domain = 'fee_schedule' ORDER BY created_at");
  ok('D4 config_history holds both approvals; v1\'s row is closed', hist.length === 2 && /v1 approved by FL oro_director/.test(hist[0].summary) && hist[0].effective_to && !hist[1].effective_to);
  var bounds = require('/opt/optimumq/backend/src/services/feeBounds').check(JSON.parse(rows[1].config_json), 'TX');
  ok('D5 the approved schedule passes the state fee-bounds gate', bounds.length === 0, JSON.stringify(bounds));

  console.log('\n=== E. THE HUB ===');
  await db.run("DELETE FROM fee_profiles WHERE jurisdiction_id = 'jur-tx'");
  var h0 = hubRow((await callAs(U.dir, 'GET', '/setup-hub')).body);
  ok('E1 with decisions but no version the row is in_progress "no fee schedule version yet"; door /setup/fee-law', h0.state === 'in_progress' && /no fee schedule version yet/.test(h0.evidence) && h0.door === '/setup/fee-law', h0.state + ' | ' + h0.evidence);
  await callAs(U.dir, 'POST', '/fee-law/approve', {});
  var h1 = hubRow((await callAs(U.dir, 'GET', '/setup-hub')).body);
  ok('E2 after approval the row says "fee schedule v1" and is in_progress until confirmed', /fee schedule v1/.test(h1.evidence) && h1.state === 'in_progress', h1.state + ' | ' + h1.evidence);
  // APPROVAL MODEL (Kevin 2026-08-31): approval is refused while any city decision is missing — here the two
  // waiver choices. Decide them, approve, and restore the undecided state afterwards for section F.
  var atR = await callAs(U.dir, 'POST', '/setup-hub/fee_law/done');
  ok('E3-pre approval is REFUSED while the waiver choices are undecided (422, naming them)', atR.status === 422 && /Who decides a waiver request/.test((atR.body && atR.body.error) || ''), atR.status + ' ' + JSON.stringify(atR.body).slice(0, 200));
  var amBeforeE = await db.get("SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx' AND domain = 'approval_modules'");
  var decBeforeE = await db.get("SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx' AND domain = 'fee_schedule_decisions'");
  await callAs(U.dir, 'POST', '/fee-law/waiver', { decider: 'intake_review', denialWording: true });
  var at = await callAs(U.dir, 'POST', '/setup-hub/fee_law/done');
  var h2 = hubRow((await callAs(U.dir, 'GET', '/setup-hub')).body);
  ok('E3 attest from the strip marks it ready by name', at.status === 200 && h2.state === 'ready' && /marked done by FL oro_director/.test(h2.evidence), at.status + ' ' + h2.state + ' | ' + h2.evidence);
  // Attestation fold (Kevin 2026-08-29): the done-mark also attests the folded sections — fees always
  // (configured once a schedule exists); payment is SKIPPED while the clock switch is off (off is a
  // valid posture; automation stays unarmed because its enabled+attested double gate never half-arms).
  var feesAtt = await db.get("SELECT attested_by FROM jurisdiction_profile_sections WHERE jurisdiction_id = 'jur-tx' AND section = 'fees'");
  ok('E3a the fold: the done-mark attests the fees section in the same act; the payment section (clock off) is skipped, not refused',
    at.body.attested && at.body.attested.indexOf('fees') >= 0 && at.body.skipped.indexOf('payment') >= 0 &&
    feesAtt && feesAtt.attested_by === 'FL oro_director', JSON.stringify(at.body));
  await callAs(U.dir, 'DELETE', '/setup-hub/fee_law/done');
  var feesAtt2 = await db.get("SELECT attested_by FROM jurisdiction_profile_sections WHERE jurisdiction_id = 'jur-tx' AND section = 'fees'");
  ok('E3b undoing the mark un-attests the folded sections', !feesAtt2 || feesAtt2.attested_by == null, JSON.stringify(feesAtt2));
  // restore the undecided waiver state section F starts from — the routing through the API (the engine caches the
  // approval module), the decisions record straight back to its snapshot
  await callAs(U.dir, 'POST', '/fee-law/waiver', { decider: 'routed_task', denialWording: false });
  if (decBeforeE) await db.run("UPDATE jurisdiction_rules SET config_json = ? WHERE jurisdiction_id = 'jur-tx' AND domain = 'fee_schedule_decisions'", [decBeforeE.config_json]);
  ok('E4 the route and page exist', /path="setup\/fee-law"/.test(fs.readFileSync('/opt/optimumq/frontend/src/App.js', 'utf8')) && fs.existsSync('/opt/optimumq/frontend/src/pages/FeeLawPage.js'));

  console.log('\n=== F. FEE WAIVERS ON THIS SCREEN (Kevin 2026-08-27; the waiver_policy hub row is retired) ===');
  // F4 writes the routing through to the approval_modules domain; snapshot it so verify_approval_modules
  // (which runs AFTER this harness and asserts the shipped default) sees the store exactly as before.
  var amSnap = await db.get("SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx' AND domain = 'approval_modules'");
  var sW = (await callAs(U.dir, 'GET', '/fee-law')).body;
  ok('F1 the screen carries the two waiver choices, undecided, with the engine\'s current routing as the suggested answer',
    sW.waiver && sW.waiver.choices.length === 2 && sW.waiver.decided === 0 &&
    sW.waiver.choices[0].key === 'waiver.decider' && sW.waiver.choices[0].current.mode === 'routed_task' &&
    sW.waiver.sentences.length === 5, JSON.stringify(sW.waiver).slice(0, 250));
  var hW = hubRow((await callAs(U.dir, 'GET', '/setup-hub')).body);
  ok('F2 the hub row is named "Fee rules" and counts the waiver choices; the waiver_policy row is GONE',
    hW.name === 'Fee rules' && /waivers: 0 of 2 decided/.test(hW.evidence) &&
    !JSON.stringify((await callAs(U.dir, 'GET', '/setup-hub')).body.lanes).includes('waiver_policy'), hW.name + ' | ' + hW.evidence);
  var wBad = await callAs(U.dir, 'POST', '/fee-law/waiver', { decider: 'coin_flip' });
  ok('F3 a guessed mode is refused in words', wBad.status === 422 && /intake_review|routed_task/.test(wBad.body.error), JSON.stringify(wBad.body));
  var w1 = await callAs(U.dir, 'POST', '/fee-law/waiver', { decider: 'intake_review', denialWording: true });
  ok('F4 recording both choices: who/when on each, and the routing written through to the store the engine reads',
    w1.status === 200 && w1.body.waiver.decided === 2 &&
    w1.body.waiver.choices[0].by === 'FL oro_director' && w1.body.waiver.choices[1].value === 'standard_wording' &&
    (await (async function () {
      var AM = require('/opt/optimumq/backend/src/services/approvalModules');
      var cfg = await AM.config('jur-tx');
      return cfg.modules.fee_waiver.mode === 'intake_review';
    })()), JSON.stringify(w1.body.waiver).slice(0, 250));
  var wStaff = await callAs(U.staff, 'POST', '/fee-law/waiver', { decider: 'routed_task' });
  ok('F5 staff cannot record waiver choices', wStaff.status === 403);
  var a3 = await callAs(U.dir, 'POST', '/fee-law/approve', {});
  ok('F6 Approve never waits on the waiver choices (they gate Attest, not the schedule)',
    a3.status === 200 && a3.body.profile.version >= 1, JSON.stringify(a3.body).slice(0, 120));
  // restore the approval_modules store to its pre-F state (see the snapshot note above)
  if (amSnap == null) await db.run("DELETE FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx' AND domain = 'approval_modules'");
  else await db.run("UPDATE jurisdiction_rules SET config_json = ? WHERE jurisdiction_id = 'jur-tx' AND domain = 'approval_modules'", [amSnap.config_json]);

  console.log('\n=== G. DEPOSIT & PAYMENT CLOCK ON THIS SCREEN (Kevin 2026-08-29; the deposits hub row is retired) ===');
  // G writes through to the `payment` domain that verify_requestor_ledger and the go-live walk read
  // later in suite order — snapshot config_json AND updated_by (the RESTORE_STAMP lesson: a restore
  // that stamps itself leaves a harness fingerprint configIntegrity rightly flags).
  var pcSnap = await db.get("SELECT config_json, updated_by FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx' AND domain = 'payment'");
  // ORDER-PROOF (the R1 lesson): the fixture ships this domain with the legal-research-seed researched
  // values, and earlier harnesses may leave it in any restored state — G must not assume what it holds.
  // Reset to shipped defaults (provenance kept, so the ride-along assertions still bite) and assert G9
  // against the SNAPSHOT bytes, not against assumed values.
  var PCPmod = require('/opt/optimumq/backend/src/services/paymentClockPolicy');
  if (pcSnap) {
    var pcBase = PCPmod.defaults();
    try { pcBase.provenance = JSON.parse(pcSnap.config_json).provenance || {}; } catch (e) {}
    await db.run("UPDATE jurisdiction_rules SET config_json = ? WHERE jurisdiction_id = 'jur-tx' AND domain = 'payment'", [JSON.stringify(pcBase)]);
  }
  var sC = (await callAs(U.dir, 'GET', '/fee-law')).body;
  ok('G1 the screen carries the clock: off, six settings, every TX answer pre-filled from the template (restart · 10 business days · withdraw · yes ×3)',
    sC.clock && sC.clock.enabled === false && sC.clock.choices.length === 6 && sC.clock.confirmed === 0 &&
    sC.clock.choices[0].prefill.value === 'toll_and_restart' &&
    sC.clock.choices[1].prefill.value === 10 && sC.clock.choices[1].prefill.businessDays === true &&
    sC.clock.choices[2].prefill.value === 'withdraw' &&
    sC.clock.choices.slice(3).every(function (x) { return x.prefill && x.prefill.value === true; }),
    JSON.stringify(sC.clock && sC.clock.choices.map(function (x) { return [x.key, x.prefill && x.prefill.value]; })));
  var hC0 = hubRow((await callAs(U.dir, 'GET', '/setup-hub')).body);
  ok('G2 the hub: the deposits row is GONE (compliance lane 10) and the Fee rules evidence says "payment clock: off"',
    /payment clock: off/.test(hC0.evidence) &&
    !JSON.stringify((await callAs(U.dir, 'GET', '/setup-hub')).body.lanes).includes('"deposits"') &&
    (await callAs(U.dir, 'GET', '/setup-hub')).body.lanes[0].items.length === 10, hC0.evidence);
  var cOff = await callAs(U.dir, 'POST', '/fee-law/clock', { confirm: { key: 'deposit_lapse_action', value: 'withdraw' } });
  ok('G3 confirming while the switch is off is refused in words (off is itself the configured posture)',
    cOff.status === 409 && /Turn the deposit & payment clock on first/.test(cOff.body.error), JSON.stringify(cOff.body));
  var cOn = await callAs(U.dir, 'POST', '/fee-law/clock', { enabled: true });
  var PCP = require('/opt/optimumq/backend/src/services/paymentClockPolicy');
  ok('G4 the switch writes enabled through to the policy store, records who/when, and the hub counts "0 of 6 confirmed"',
    cOn.status === 200 && cOn.body.clock.enabled === true && cOn.body.clock.switchedBy === 'FL oro_director' &&
    (await PCP.read('jur-tx')).enabled === true &&
    /payment clock: 0 of 6 confirmed/.test(hubRow((await callAs(U.dir, 'GET', '/setup-hub')).body).evidence),
    JSON.stringify(cOn.body.clock).slice(0, 200));
  var cBad = await callAs(U.dir, 'POST', '/fee-law/clock', { confirm: { key: 'deposit_clock_effect', value: 'coin_flip' } });
  ok('G5 an invalid setting value is refused in words, nothing written', cBad.status === 422 && /Invalid value/.test(cBad.body.error) &&
    (await PCP.read('jur-tx')).deposit_clock_effect === 'runs_no_stop', JSON.stringify(cBad.body));
  var confirms = [
    ['deposit_clock_effect', 'toll_and_restart'], ['deposit_grace_days', 10], ['deposit_lapse_action', 'withdraw'],
    ['reissue_required_on_variance', true], ['reissue_blocks_collection', true], ['reissue_restarts_response_window', true]];
  var cLast = null;
  for (var ci = 0; ci < confirms.length; ci++) cLast = await callAs(U.dir, 'POST', '/fee-law/clock', { confirm: { key: confirms[ci][0], value: confirms[ci][1] } });
  var polAfter = await PCP.read('jur-tx');
  ok('G6 confirming all six writes the lawful values through to the store the engine reads (restart · 10 · withdraw · true ×3), provenance untouched',
    cLast.status === 200 && cLast.body.clock.confirmed === 6 && cLast.body.clock.choices[0].by === 'FL oro_director' &&
    polAfter.deposit_clock_effect === 'toll_and_restart' && polAfter.deposit_grace_days === 10 && polAfter.deposit_lapse_action === 'withdraw' &&
    polAfter.reissue_required_on_variance === true && polAfter.reissue_blocks_collection === true && polAfter.reissue_restarts_response_window === true &&
    polAfter.provenance.deposit_clock_effect && polAfter.provenance.deposit_clock_effect.source === 'statute',
    JSON.stringify([polAfter.deposit_clock_effect, polAfter.deposit_grace_days, polAfter.deposit_lapse_action]));
  var cStaff = await callAs(U.staff, 'POST', '/fee-law/clock', { enabled: false });
  ok('G7 staff cannot touch the clock settings', cStaff.status === 403);
  var a4 = await callAs(U.dir, 'POST', '/fee-law/approve', {});
  ok('G8 Approve never waits on the clock settings (they gate Attest, not the schedule); deferral count unchanged at 13',
    a4.status === 200 && a4.body.screen.counts.deferral === 13, JSON.stringify(a4.body.screen && a4.body.screen.counts));
  // restore the payment policy store byte-identically, stamp included (residue-free: verify_requestor_ledger
  // and the bw9 go-live walk run later and must see the store exactly as the suite reset left it)
  if (pcSnap == null) await db.run("DELETE FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx' AND domain = 'payment'");
  else await db.run("UPDATE jurisdiction_rules SET config_json = ?, updated_by = ? WHERE jurisdiction_id = 'jur-tx' AND domain = 'payment'", [pcSnap.config_json, pcSnap.updated_by]);
  var pcEnd = await db.get("SELECT config_json, updated_by FROM jurisdiction_rules WHERE jurisdiction_id = 'jur-tx' AND domain = 'payment'");
  var sEnd = (await callAs(U.dir, 'GET', '/fee-law')).body;
  ok('G9 cleanup: the policy store is byte-identical to the pre-G snapshot, stamp included, and the screen still reads',
    ((pcSnap == null && pcEnd == null) || (pcEnd && pcEnd.config_json === pcSnap.config_json && pcEnd.updated_by === pcSnap.updated_by)) &&
    sEnd.clock && sEnd.clock.choices.length === 6,
    JSON.stringify(pcEnd && pcEnd.updated_by));

  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e); process.exit(1); });
