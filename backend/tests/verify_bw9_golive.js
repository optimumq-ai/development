'use strict';
// BW9a — THE GO-LIVE CHECKLIST'S PLUMBING (Draft 6; residuals + Draft 10 §5 decided 2026-08-11).
// This harness IMPORTS the TX template into the fixture (the same move the e2e harnesses make) and
// then WALKS THE GO-LIVE JOURNEY the checklist exists for. What it asserts:
//
//   A. THE ENUMERATION IS TRUTH, INCLUDING WHAT NO ROW SWEEP CAN SEE. /policy-settings groups every
//      local policy setting by profile section — and the two CODE-DEFINED knob domains (de-minimis,
//      the release-pipeline pair) appear even though NO ROW EXISTS for them, because rule (d)
//      writes a row only when a city answers. A build that swept stored rows would silently drop
//      exactly the decisions go-live exists to surface.
//   B. CONFIRM IS THE MISSING PLUMBING, AND IT RECORDS A PERSON. attest() reads `confirmed`, the
//      importer writes it false, and before BW9a nothing set it true. Confirming records name +
//      date ON the setting; it refuses an unknown path in words (a setting is born from the
//      template, never from this endpoint), refuses a confirmation with no value, and refuses a
//      value the knob cannot hold — all BEFORE anything is written.
//   C. THE GATE BITES, AND THE WHOLE-TEMPLATE GATE NOW COVERS THE CODE-DEFINED DOMAINS. An
//      unconfirmed setting holds its section at not_configured and attest() refuses it; the
//      template_import roll-up NAMES the pre-send-review decision while it is nobody's — the
//      manifest-sweep gap this wave closed.
//   D. SENIOR LEGAL ATTESTS THE LEGAL SECTIONS, AND ONLY THOSE (Kevin 2026-08-11). Function role
//      ATTORNEY_REVIEWER attests exemption/redaction/deadlines; on any other section the refusal
//      is worded, not a bare 403. The same ownership line scopes confirm by DOMAIN.
//   E. THE WALK DRAINS THE BOARD, AND THE SUMMARY IS COMPUTED, NEVER ASSERTED. Confirming every
//      setting the enumeration lists (driving the API with the API's own output) takes unconfirmed
//      and active-branch-unconfirmed to ZERO; sections the state never configured stay HONESTLY
//      not_configured (never fabricated into readiness); the enforcement flip stays SADMIN-only.
//
// Everything this harness mutates in jurisdiction_rules / jurisdiction_profile_sections /
// config_proposals / system_config.dev_mode is snapshotted first and restored afterward — later
// harnesses (e2e TX/OH) run against the same test DB and read this config.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var UT = require(__dirname + '/userTypeHelpers');
var auth = require('/opt/optimumq/backend/src/services/auth');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var JP = require('/opt/optimumq/backend/src/services/jurisdictionProfile');
var STI = require('/opt/optimumq/backend/src/services/stateTemplateImport');
var GLS = require('/opt/optimumq/backend/src/services/goLive');

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'BW9-' + Date.now();
var JID = 'jur-tx';
var pass = 0, fail = 0;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

function req(method, p, body, token) {
  return new Promise(function (res, rej) {
    var payload = body ? JSON.stringify(body) : null;
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' },
        payload ? { 'Content-Length': Buffer.byteLength(payload) } : {},
        token ? { Authorization: 'Bearer ' + token } : {}) },
      function (resp) {
        var chunks = [];
        resp.on('data', function (c) { chunks.push(c); });
        resp.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var json = null; try { json = JSON.parse(text); } catch (e) { /* non-JSON */ }
          res({ status: resp.statusCode, json: json, text: text });
        });
      });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}

async function makeUser(suffix, name, roleIds) {
  var id = 'u-' + TAG + '-' + suffix;
  await db.run("INSERT INTO users (id, email, display_name, status) VALUES (?,?,?,'active')",
    [id, id + '@harness.local', name]);
  for (var i = 0; i < roleIds.length; i++) {
    await UT.grantLegacy(id, roleIds[i]);   // v3: legacy role id -> user type; claims derive from the type
  }
  return await db.get('SELECT * FROM users WHERE id = ?', [id]);
}

function sectionByKey(payload, key) {
  return (payload.sections || []).filter(function (s) { return s.section === key; })[0];
}
function settingAt(sec, domain, path) {
  return ((sec && sec.settings) || []).filter(function (s) { return s.domain === domain && s.path === path; })[0];
}
function isOpen(s) { return s.kind === 'dimension' ? (s.gated && !s.confirmed) : !s.confirmed; }

(async function () {
  await db.initDb();

  // ── snapshot everything this harness may touch; restored in the finally ────────────────────────
  var snapRules = await db.all('SELECT * FROM jurisdiction_rules WHERE jurisdiction_id = ?', [JID]);
  var snapSections = await db.all('SELECT * FROM jurisdiction_profile_sections WHERE jurisdiction_id = ?', [JID]);
  var snapProposals = await db.all('SELECT * FROM config_proposals WHERE jurisdiction_id = ?', [JID]);
  var snapDevMode = await db.get("SELECT value FROM system_config WHERE key = 'dev_mode'");
  async function restore() {
    await db.run('DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ?', [JID]);
    for (var i = 0; i < snapRules.length; i++) {
      var r = snapRules[i];
      await db.run('INSERT INTO jurisdiction_rules (id, jurisdiction_id, domain, config_json, updated_by, updated_at) VALUES (?,?,?,?,?,?)',
        [r.id, r.jurisdiction_id, r.domain, r.config_json, r.updated_by, r.updated_at]);
    }
    await db.run('DELETE FROM jurisdiction_profile_sections WHERE jurisdiction_id = ?', [JID]);
    for (var j = 0; j < snapSections.length; j++) {
      var s = snapSections[j];
      await db.run('INSERT INTO jurisdiction_profile_sections (id, jurisdiction_id, section, label, content_hash, version, status, source, last_changed_at, last_changed_by, attested_by, attested_at, attested_version, attested_hash, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [s.id, s.jurisdiction_id, s.section, s.label, s.content_hash, s.version, s.status, s.source, s.last_changed_at, s.last_changed_by, s.attested_by, s.attested_at, s.attested_version, s.attested_hash, s.notes, s.created_at, s.updated_at]);
    }
    await db.run('DELETE FROM config_proposals WHERE jurisdiction_id = ?', [JID]);
    for (var k = 0; k < snapProposals.length; k++) {
      var p = snapProposals[k];
      await db.run('INSERT INTO config_proposals (id, jurisdiction_id, domain, status, summary, proposed_json, source_ref, created_by, created_at, reviewed_by, reviewed_at, snapshot_id, current_json, applied_json, attested_by, attested_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [p.id, p.jurisdiction_id, p.domain, p.status, p.summary, p.proposed_json, p.source_ref, p.created_by, p.created_at, p.reviewed_by, p.reviewed_at, p.snapshot_id, p.current_json, p.applied_json, p.attested_by, p.attested_at]);
    }
    if (snapDevMode) await db.run("UPDATE system_config SET value = ? WHERE key = 'dev_mode'", [snapDevMode.value]);
  }

  try {
    var director = await makeUser('dir', 'BW9 Director', ['fr-director']);
    var attorney = await makeUser('att', 'BW9 Senior Legal', ['fr-attorney']);
    var supervisor = await makeUser('sup', 'BW9 Supervisor', ['fr-supervisor']);
    var sysadmin = await makeUser('sa', 'BW9 SysAdmin', ['fr-sysadmin']);
    var TDIR = await auth.signAccessToken(director);
    var TATT = await auth.signAccessToken(attorney);
    var TSUP = await auth.signAccessToken(supervisor);
    var TSA = await auth.signAccessToken(sysadmin);

    // The same move the e2e harnesses make: arrive as a fresh city.
    var imp = await STI.importState('TX', { actor: 'bw9-harness' });
    ok('setup: TX template imports', imp.code === 'TX');
    // Fresh-city posture for the code-defined knob domains too: earlier harnesses (bw4/bw5) write
    // these rows mid-suite. They are in the snapshot and come back in restore(); removing them here
    // is what makes the rule-(d) invisibility assertion (A2/A3) mean something in ANY suite order.
    await db.run("DELETE FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain IN ('fee_de_minimis','release_pipeline')", [JID]);

    // ==============================================================================================
    console.log('\n=== A. ENUMERATION — every setting by section, code-defined knobs included ===');
    var noRow = await db.get("SELECT id FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain IN ('fee_de_minimis','release_pipeline') LIMIT 1", [JID]);
    ok('A0 precondition holds: the code-defined knob domains have NO stored row', !noRow);
    var ps = await req('GET', '/api/jurisdiction-profile/policy-settings', null, TDIR);
    ok('A1 the read answers 200 with the full section list', ps.status === 200 && (ps.json.sections || []).length >= 15);
    var fees = sectionByKey(ps.json, 'fees'), dispo = sectionByKey(ps.json, 'disposition');
    var dm = settingAt(fees, 'fee_de_minimis', 'knobs/de_minimis_threshold');
    ok('A2 de-minimis appears under FEES with no row behind it (rule d: the reader is asked, not the table)',
      !!dm && dm.kind === 'code' && dm.confirmed === false && dm.suggestedDefault === 25);
    var presend = settingAt(dispo, 'release_pipeline', 'knobs/pre_send_review');
    var autorel = settingAt(dispo, 'release_pipeline', 'knobs/auto_release');
    ok('A3 the release-pipeline pair rides DISPOSITION, unconfirmed, rows absent',
      !!presend && !!autorel && presend.confirmed === false && autorel.confirmed === false);
    var intakeSec = sectionByKey(ps.json, 'intake');
    var firstTmpl = (intakeSec.settings || []).filter(function (s) { return s.kind === 'template'; })[0];
    ok('A4 a freshly imported template setting carries its note, confirmed:false, and NO who/when yet',
      !!firstTmpl && firstTmpl.confirmed === false && !!firstTmpl.note && !firstTmpl.confirmedBy);
    ok('A5 owner labels ride every section as display metadata (Legal Rules owns deadlines — Draft 10 §5 q1)',
      sectionByKey(ps.json, 'deadlines').owner.group === 'Legal Rules' &&
      sectionByKey(ps.json, 'fees').owner.group === 'Fee Configuration' &&
      sectionByKey(ps.json, 'template_import').owner.group === 'System Administration');
    ok('A6 oversight read: a Supervisor may GET the checklist',
      (await req('GET', '/api/jurisdiction-profile/policy-settings', null, TSUP)).status === 200);
    ok('A7 Senior Legal may GET the checklist too — nobody attests what they cannot see',
      (await req('GET', '/api/jurisdiction-profile/policy-settings', null, TATT)).status === 200 &&
      (await req('GET', '/api/jurisdiction-profile/go-live', null, TATT)).status === 200);

    // ==============================================================================================
    console.log('\n=== C1. THE WHOLE-TEMPLATE GATE covers the code-defined domains (the closed gap) ===');
    var tmplSec = sectionByKey(ps.json, 'template_import');
    ok('C1a template_import sits at not_configured while the pre-send decision is nobody\'s',
      tmplSec.status === 'not_configured');
    var att1 = await req('POST', '/api/jurisdiction-profile/attest', { section: 'template_import' }, TDIR);
    ok('C1b attest refuses it in words',
      att1.status === 400 && /nothing to sign off on/i.test((att1.json || {}).error || ''));
    var sig = await JP.signature(JID, 'template_import');
    ok('C1c the roll-up NAMES all three code-defined settings among the open ones',
      sig.pending.indexOf('fee_de_minimis/knobs/de_minimis_threshold') >= 0 &&
      sig.pending.indexOf('release_pipeline/knobs/pre_send_review') >= 0 &&
      sig.pending.indexOf('release_pipeline/knobs/auto_release') >= 0);

    // ==============================================================================================
    console.log('\n=== B. CONFIRM — refusals first (worded, nothing written), then the real thing ===');
    var b1 = await req('POST', '/api/jurisdiction-profile/policy-settings/confirm',
      { domain: 'intake', path: 'knobs/NOT_A_SETTING', value: 'x' }, TDIR);
    ok('B1 an unknown path is REFUSED in words — this endpoint never creates a setting',
      b1.status === 400 && /never creates one/i.test((b1.json || {}).error || ''));
    var b2 = await req('POST', '/api/jurisdiction-profile/policy-settings/confirm',
      { domain: firstTmpl.domain, path: firstTmpl.path }, TDIR);
    ok('B2 a confirm with NO value is refused — an empty confirm is not a decision',
      b2.status === 400 && /send the value/i.test((b2.json || {}).error || ''));
    var b3 = await req('POST', '/api/jurisdiction-profile/policy-settings/confirm',
      { domain: 'release_pipeline', path: 'knobs/pre_send_review', value: 'maybe' }, TDIR);
    var b3row = await db.get("SELECT id FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = 'release_pipeline'", [JID]);
    ok('B3 a value the knob cannot hold is refused BEFORE anything is written (no half-filled confirm)',
      b3.status === 400 && /on.*off/i.test((b3.json || {}).error || '') && !b3row);
    var b4 = await req('POST', '/api/jurisdiction-profile/policy-settings/confirm',
      { domain: firstTmpl.domain, path: firstTmpl.path, value: 'harness-confirmed' }, TSUP);
    ok('B4 a Supervisor may look but not confirm', b4.status === 403);
    var b5 = await req('POST', '/api/jurisdiction-profile/policy-settings/confirm',
      { domain: 'fee', path: 'knobs/x', value: 'x' }, TATT);
    ok('B5 Senior Legal confirming a FEE setting is refused in words (ownership line, by domain)',
      b5.status === 403 && /Legal Rules/i.test((b5.json || {}).error || ''));
    var b6 = await req('POST', '/api/jurisdiction-profile/policy-settings/confirm',
      { domain: firstTmpl.domain, path: firstTmpl.path, value: 'harness-confirmed' }, TDIR);
    ok('B6 the Director confirms a template setting', b6.status === 200);
    var b6cfg = await JR.read(JID, firstTmpl.domain);
    var b6cc = b6cfg.knobs[firstTmpl.path.split('/')[1]].city_config;
    ok('B7 the setting now carries value + WHO + WHEN — a recorded decision, not a flag flip',
      b6cc.confirmed === true && b6cc.value === 'harness-confirmed' &&
      b6cc.confirmed_by === 'BW9 Director' && !!b6cc.confirmed_at);
    var b8 = await req('POST', '/api/jurisdiction-profile/policy-settings/confirm',
      { domain: 'exemption', path: (function () {
          var ex = sectionByKey(ps.json, 'exemption').settings.filter(isOpen)[0];
          return ex ? ex.path : 'knobs/none';
        })(), value: 'confirmed by senior legal' }, TATT);
    ok('B8 Senior Legal CAN confirm on a Legal Rules domain', b8.status === 200);

    // ==============================================================================================
    console.log('\n=== E1. THE WALK — drive the checklist with the checklist\'s own output ===');
    var before = await req('GET', '/api/jurisdiction-profile/go-live', null, TDIR);
    if (!(before.json.ready === false && before.json.unconfirmedSettings > 0 && before.json.proposalsPending > 0 && before.json.activeBranchUnconfirmed.length > 0)) {
      console.log('        E1a diagnostics: ' + JSON.stringify({ ready: before.json.ready, unconfirmedSettings: before.json.unconfirmedSettings, proposalsPending: before.json.proposalsPending, activeBranchUnconfirmed: before.json.activeBranchUnconfirmed, imported: { written: imp.written, proposed: imp.proposed.map(function (p) { return p.domain; }), unchanged: imp.unchanged } }));
    }
    ok('E1a a fresh import is honestly NOT ready: unconfirmed settings, pending proposals, an active branch on an unconfirmed parameter',
      before.json.ready === false && before.json.unconfirmedSettings > 0 &&
      before.json.proposalsPending > 0 && before.json.activeBranchUnconfirmed.length > 0);
    // Confirm EVERY open setting the enumeration lists, with the owner the ownership line demands.
    var current = (await req('GET', '/api/jurisdiction-profile/policy-settings', null, TDIR)).json;
    var confirmed = 0, refused = 0;
    for (var si = 0; si < current.sections.length; si++) {
      var sec = current.sections[si];
      for (var ki = 0; ki < sec.settings.length; ki++) {
        var st = sec.settings[ki];
        if (!isOpen(st)) continue;
        var val = st.value != null ? st.value : (st.suggestedDefault != null ? st.suggestedDefault : 'confirmed as imported (bw9 walk)');
        var r1 = await req('POST', '/api/jurisdiction-profile/policy-settings/confirm',
          { domain: st.domain, path: st.path, value: val }, TDIR);
        if (r1.status === 200) confirmed++; else refused++;
      }
    }
    ok('E1b every open setting confirms through the one endpoint (' + confirmed + ' confirmed, ' + refused + ' refused)',
      confirmed > 0 && refused === 0);
    // The import's proposals are part of go-live; clear them through their own table (their review
    // flow is built and tested elsewhere — this walk only needs the queue drained).
    await db.run("UPDATE config_proposals SET status = 'dismissed', reviewed_by = ?, reviewed_at = ? WHERE jurisdiction_id = ? AND status = 'pending'",
      ['bw9-harness', new Date().toISOString().slice(0, 19).replace('T', ' '), JID]);
    var after = await req('GET', '/api/jurisdiction-profile/go-live', null, TDIR);
    ok('E1c the board drains: unconfirmed 0 · proposals 0 · no active branch on an unconfirmed parameter',
      after.json.unconfirmedSettings === 0 && after.json.proposalsPending === 0 &&
      after.json.activeBranchUnconfirmed.length === 0);
    ok('E1d sections the state never configured stay HONESTLY not_configured — drained ≠ fabricated readiness',
      after.json.notConfigured > 0 && after.json.ready === false);

    // ==============================================================================================
    console.log('\n=== C2. THE SECTION GATE — unconfirmed blocked attest; confirmed heals it ===');
    var intakeState = await JP.sectionState(JID, 'intake');
    ok('C2a with its settings confirmed the intake section reaches configured', intakeState.status === 'configured');
    var att2 = await req('POST', '/api/jurisdiction-profile/attest', { section: 'intake' }, TDIR);
    ok('C2b and attest succeeds as the Director\'s recorded act',
      att2.status === 200 && (await JP.sectionState(JID, 'intake')).attestedBy === 'BW9 Director');
    ok('C2c the whole-template gate reaches configured once every setting everywhere is confirmed',
      (await JP.sectionState(JID, 'template_import')).status === 'configured');

    // ==============================================================================================
    console.log('\n=== D. SENIOR LEGAL attests the Legal sections, and only those (Kevin 2026-08-11) ===');
    var d1 = await req('POST', '/api/jurisdiction-profile/attest', { section: 'redaction' }, TATT);
    ok('D1 ATTORNEY_REVIEWER attests redaction (Legal Rules)', d1.status === 200);
    ok('D2 the attestation is recorded under the attorney\'s name',
      (await JP.sectionState(JID, 'redaction')).attestedBy === 'BW9 Senior Legal');
    var d3 = await req('POST', '/api/jurisdiction-profile/attest', { section: 'deadlines' }, TATT);
    ok('D3 deadlines is a Legal section too (statutory timing — Draft 10 §5 q1)', d3.status === 200);
    var d4 = await req('POST', '/api/jurisdiction-profile/attest', { section: 'fees' }, TATT);
    ok('D4 fees is refused IN WORDS — owner ≠ attester, and the line is drawn per section',
      d4.status === 403 && /Legal Rules sections/i.test((d4.json || {}).error || ''));
    var d5 = await req('POST', '/api/jurisdiction-profile/unattest', { section: 'redaction' }, TDIR);
    ok('D5 the Director may still act on a Legal section (Senior Legal is ADDED, nothing is taken away)', d5.status === 200);
    var d6 = await req('POST', '/api/jurisdiction-profile/unattest', { section: 'fees' }, TATT);
    ok('D6 un-attest draws the same line', d6.status === 403);

    // ==============================================================================================
    console.log('\n=== E2. ENFORCEMENT — the flip is the go_live AUTHORITY (SysAdmin OR Director, Kevin 2026-08-24), and the summary reports it ===');
    // v3 (S2): SPEC_user_type_model §4 — go_live is held by oro_sysadmin AND oro_director; a supervisor holds it not.
    var f0 = await req('POST', '/api/jurisdiction-profile/enforcement', { devMode: false }, TSUP);
    var f1 = await req('POST', '/api/jurisdiction-profile/enforcement', { devMode: false }, TDIR);
    ok('E2a the Supervisor cannot flip enforcement (no go_live authority); the Director CAN (spec §4)',
      f0.status === 403 && f1.status === 200);
    var f2 = await req('POST', '/api/jurisdiction-profile/enforcement', { devMode: false }, TSA);
    var s4 = await req('GET', '/api/jurisdiction-profile/go-live', null, TDIR);
    ok('E2b the SysAdmin flip lands and the summary reports live', f2.status === 200 && s4.json.devMode === false && s4.json.live === true);

  } catch (e) {
    console.error('HARNESS ERROR:', e && e.stack);
    fail++;
  } finally {
    try { await restore(); await JP.sync(JID, { source: 'bw9-restore' }); } catch (e) { console.error('RESTORE FAILED:', e && e.message); }
  }
  console.log('\nSUMMARY: ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
