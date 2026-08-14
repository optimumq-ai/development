'use strict';
// BW9b — THE RULE-CONTENT EDITORS (Draft 10, all five §5 questions decided 2026-08-11).
// What this harness asserts:
//
//   A. THE CONTENT READS ARE TRUTH. The deadlines section assembles the Frame C named-timer table
//      from the deadline + clock_matrix domains together — humanized labels, the four-kind use-case
//      taxonomy (an operational target can never masquerade as statutory), plain-language
//      descriptions with the run-out consequence, citations on statutory rows. Fee renders its
//      cited schedule concepts; clarification renders labeled fields with per-field provenance;
//      exemption renders the redaction_rules + legal_sources store with HONEST wiring (active =
//      the engine applies it; a draft is content-only). The research drill-down serves the full
//      record — verbatim statute language — and answers absence in words, never a 500.
//
//   B. THE COMPOSER REFUSES WHAT THE ENGINE WOULD REFUSE, BEFORE ANYTHING IS WRITTEN. No citation
//      → refused (editing statute-derived content asserts what the law provides). No note →
//      refused. A 46-business-day response clock → the reconciler band's own wording, and NO
//      proposal row exists afterward. An unknown config key → the __probe refusal. A guessed enum
//      on a policed domain → refused naming the legal values. A Supervisor cannot propose; Senior
//      Legal cannot propose outside the Legal Rules domains.
//
//   C. EVERY CONTENT EDIT IS A PROPOSAL, AND THE OWNERSHIP LINE HOLDS. A Director's edit on a
//      Legal domain files as source_ref='editor' and is NEVER self-applied — apply-now answers a
//      worded refusal and the row stays pending; Senior Legal applies it through the ordinary
//      review flow, the jurisdiction_rules row changes, and the ATTESTED section DRIFTS
//      (drift-warn, decided: the engine keeps running, the section demands re-attestation). On a
//      non-Legal domain the Director owner applies in the same act. Apply revalidates: an
//      editedConfig smuggling a 46-day clock is refused at the second door too.
//
//   D. THE EXISTING REVIEW FLOW CARRIES EDITOR PROPOSALS: they list in the queue; Senior Legal
//      acts on Legal-domain proposals and is scoped off the rest in words.
//
// Snapshot/restore as verify_bw9_golive: later harnesses read this config.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var JR = require('/opt/optimumq/backend/src/services/jurisdictionRules');
var JP = require('/opt/optimumq/backend/src/services/jurisdictionProfile');
var STI = require('/opt/optimumq/backend/src/services/stateTemplateImport');

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'BW9B-' + Date.now();
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
          var json = null; try { json = JSON.parse(text); } catch (e) {}
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
    await db.run('INSERT INTO user_function_roles (user_id, function_role_id) VALUES (?,?)', [id, roleIds[i]]);
  }
  return await db.get('SELECT * FROM users WHERE id = ?', [id]);
}

(async function () {
  await db.initDb();

  var snapRules = await db.all('SELECT * FROM jurisdiction_rules WHERE jurisdiction_id = ?', [JID]);
  var snapSections = await db.all('SELECT * FROM jurisdiction_profile_sections WHERE jurisdiction_id = ?', [JID]);
  var snapProposals = await db.all('SELECT * FROM config_proposals WHERE jurisdiction_id = ?', [JID]);
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
      await db.run('INSERT INTO config_proposals (id, jurisdiction_id, domain, status, summary, proposed_json, current_json, source_ref, created_by, created_at, reviewed_by, reviewed_at, snapshot_id, applied_json, attested_by, attested_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [p.id, p.jurisdiction_id, p.domain, p.status, p.summary, p.proposed_json, p.current_json, p.source_ref, p.created_by, p.created_at, p.reviewed_by, p.reviewed_at, p.snapshot_id, p.applied_json, p.attested_by, p.attested_at]);
    }
  }

  try {
    var director = await makeUser('dir', 'BW9B Director', ['fr-director']);
    var attorney = await makeUser('att', 'BW9B Senior Legal', ['fr-attorney']);
    var supervisor = await makeUser('sup', 'BW9B Supervisor', ['fr-supervisor']);
    var TDIR = await auth.signAccessToken(director);
    var TATT = await auth.signAccessToken(attorney);
    var TSUP = await auth.signAccessToken(supervisor);

    var imp = await STI.importState('TX', { actor: 'bw9b-harness' });
    ok('setup: TX template imports', imp.code === 'TX');
    // TX already had a deadline config, so the reconciled WS3 clocks arrive as a PROPOSAL (rule c).
    // Apply it through the ordinary ADAPTER path first — the same act live TX went through — so the
    // stored config carries the reconciled kinds and citations the Frame C table renders. This also
    // regression-guards the pre-BW9b apply path: a template proposal still applies untouched.
    var ws3 = await db.get("SELECT id FROM config_proposals WHERE jurisdiction_id = ? AND domain = 'deadline' AND status = 'pending' ORDER BY created_at DESC LIMIT 1", [JID]);
    if (ws3) {
      var ws3r = await req('POST', '/api/config-freshness/proposals/' + ws3.id + '/apply', { attested: true }, TDIR);
      ok('setup: the WS3 reconciled-deadline proposal applies through the adapter path unchanged', ws3r.status === 200 && ws3r.json.applied === true);
    }

    // ==============================================================================================
    console.log('\n=== A. CONTENT READS — assembled server-side, honest everywhere ===');
    var dl = await req('GET', '/api/jurisdiction-profile/rules/deadlines', null, TDIR);
    ok('A1 the deadlines section joins BOTH domains into the named-timer table',
      dl.status === 200 && dl.json.content.kind === 'timerTable' &&
      dl.json.domains.indexOf('deadline') >= 0 && dl.json.domains.indexOf('clock_matrix') >= 0 &&
      dl.json.content.rows.length > 0);
    var respond = dl.json.content.rows.filter(function (r) { return r.clockType === 'respond'; })[0];
    ok('A2 the primary response clock renders in the statutory grammar with a humanized label',
      !!respond && respond.primary === true && respond.kind === 'response' &&
      /statutory/i.test(respond.kindLabel) && respond.label !== 'respond');
    ok('A3 every use case carries a plain-language description with the run-out consequence (Kevin Frame C)',
      /statutory violation/i.test((respond && respond.useCase) || '') &&
      dl.json.content.rows.every(function (r) { return !!r.useCase; }));
    var target = dl.json.content.rows.filter(function (r) { return r.kind === 'operational_target'; })[0];
    ok('A4 an operational target says NOT A LEGAL DEADLINE and cites nothing',
      !target || (/NOT a legal deadline/i.test(target.kindLabel) && !target.citation));
    var agRow = dl.json.content.rows.filter(function (r) { return r.kind === 'agency_action'; })[0];
    ok('A5 statutory rows carry citations', !!agRow && !!agRow.citation);
    var fees = await req('GET', '/api/jurisdiction-profile/rules/fees', null, TDIR);
    ok('A6 fee renders its statute-derived schedule concepts, cited',
      fees.status === 200 && fees.json.content.kind === 'facts' &&
      fees.json.content.facts.length > 0 && fees.json.content.facts.every(function (f) { return !!f.citation; }));
    var cl = await req('GET', '/api/jurisdiction-profile/rules/clarification', null, TDIR);
    ok('A7 clarification renders labeled fields with per-field provenance',
      cl.status === 200 && cl.json.content.kind === 'fields' &&
      cl.json.content.fields.some(function (f) { return f.statuteDerived && f.citation; }));
    var ex = await req('GET', '/api/jurisdiction-profile/rules/exemption', null, TATT);
    ok('A8 exemption renders the redaction_rules store with honest wiring vocabulary',
      ex.status === 200 && ex.json.content.kind === 'exemptionList' &&
      ex.json.content.exemptions.every(function (x) { return x.wiredLabel === 'wired' || x.wiredLabel === 'content-only'; }));
    var raw = await req('GET', '/api/jurisdiction-profile/rules/branches', null, TDIR);
    ok('A9 an un-rendered section falls back to the honest raw view', raw.status === 200 && raw.json.content.kind === 'raw');
    // Identity + taxonomy live OUTSIDE the rules store (profile row + agency config; record_types).
    // Until 2026-08-14 both fell to `raw: null` and the screen said "No content" over configured,
    // ATTESTED sections — the row and the detail disagreed (found by Kevin). They now render derived
    // read-only fields from the SAME sources the index's configured-ness check reads.
    var idn = await req('GET', '/api/jurisdiction-profile/rules/identity', null, TDIR);
    ok('A9b identity renders the statute (cited), exemption model, and agency — never "No content" over an attested section',
      idn.status === 200 && idn.json.content.kind === 'fields' &&
      idn.json.content.fields.some(function (f) { return f.key === 'statute' && f.value && f.citation; }) &&
      idn.json.content.fields.some(function (f) { return f.key === 'agency' && f.value; }) &&
      /read-only/.test(idn.json.content.areaEditorNote || ''));
    var txn = await req('GET', '/api/jurisdiction-profile/rules/taxonomy', null, TDIR);
    ok('A9c taxonomy renders catalog counts and points at its real authoring surface',
      txn.status === 200 && txn.json.content.kind === 'fields' &&
      txn.json.content.fields.some(function (f) { return f.key === 'types' && /active/.test(String(f.value)); }) &&
      txn.json.content.areaEditor === '/taxonomy');
    var rr1 = await req('GET', '/api/jurisdiction-profile/rules-research/TX-0016', null, TSUP);
    ok('A10 the research drill-down serves the full record incl. the statute\'s own words (Supervisor may read)',
      rr1.status === 200 && !!rr1.json.rule.source_language && !!rr1.json.rule.atomic_rule);
    var rr2 = await req('GET', '/api/jurisdiction-profile/rules-research/TX-9999', null, TDIR);
    ok('A11 an unknown research id answers absence in words, never a 500',
      rr2.status === 404 && /citation and summary/i.test((rr2.json || {}).error || ''));

    // ==============================================================================================
    console.log('\n=== B. THE COMPOSER REFUSES — worded, and BEFORE anything is written ===');
    var dlCfg = dl.json.configs.deadline;
    function withRespond(days) {
      var c = JSON.parse(JSON.stringify(dlCfg));
      var def = c.clocks.respond;
      delete def.durationByClassification; delete def.default;
      def.duration = days; def.basis = 'business_days';
      return c;
    }
    var b1 = await req('POST', '/api/jurisdiction-profile/rules/deadlines/propose',
      { domain: 'deadline', config: withRespond(12), note: 'test' }, TDIR);
    ok('B1 no citation is refused — editing statute-derived content asserts what the law provides',
      b1.status === 400 && /citation is required/i.test(b1.json.error));
    var b2 = await req('POST', '/api/jurisdiction-profile/rules/deadlines/propose',
      { domain: 'deadline', config: withRespond(12), citation: '§ test' }, TDIR);
    ok('B2 no note is refused — the next reader needs why', b2.status === 400 && /note is required/i.test(b2.json.error));
    var before = await db.get("SELECT COUNT(*) n FROM config_proposals WHERE jurisdiction_id = ? AND source_ref = 'editor'", [JID]);
    var b3 = await req('POST', '/api/jurisdiction-profile/rules/deadlines/propose',
      { domain: 'deadline', config: withRespond(46), citation: '§ 552.221', note: 'trying 46' }, TDIR);
    var after46 = await db.get("SELECT COUNT(*) n FROM config_proposals WHERE jurisdiction_id = ? AND source_ref = 'editor'", [JID]);
    ok('B3 a 46-business-day response clock is refused in the reconciler band\'s own words, and NO proposal exists',
      b3.status === 400 && /outside the 1-45 day band/i.test(b3.json.error) && Number(after46.n) === Number(before.n));
    var probeCfg = JSON.parse(JSON.stringify(dlCfg)); probeCfg.__probe = 1;
    var b4 = await req('POST', '/api/jurisdiction-profile/rules/deadlines/propose',
      { domain: 'deadline', config: probeCfg, citation: '§ x', note: 'probe' }, TDIR);
    ok('B4 an unknown config key is refused with the __probe wording',
      b4.status === 400 && /Unknown config key/i.test(b4.json.error));
    var clCfg = JSON.parse(JSON.stringify(cl.json.configs.clarification));
    clCfg.clarification_duty = 'maybe_sometimes';
    var b5 = await req('POST', '/api/jurisdiction-profile/rules/clarification/propose',
      { domain: 'clarification', config: clCfg, citation: '§ x', note: 'guess' }, TDIR);
    ok('B5 a policed domain never accepts a guessed enum — refused naming the legal values',
      b5.status === 400 && /never accepts a guessed value/i.test(b5.json.error) && /required_before_denial/.test(b5.json.error));
    var b6 = await req('POST', '/api/jurisdiction-profile/rules/deadlines/propose',
      { domain: 'deadline', config: withRespond(12), citation: '§ x', note: 'sup' }, TSUP);
    ok('B6 a Supervisor cannot propose (do-the-work vs set-the-rules)', b6.status === 403);
    var b7 = await req('POST', '/api/jurisdiction-profile/rules/fees/propose',
      { domain: 'fee', config: fees.json.configs.fee, citation: '§ x', note: 'att on fee' }, TATT);
    ok('B7 Senior Legal cannot propose outside the Legal Rules domains, in words',
      b7.status === 403 && /Legal Rules/i.test(b7.json.error));

    // ==============================================================================================
    console.log('\n=== C. ONE AUDIT PATH — the proposal, the ownership line, the drift ===');
    // Attest deadlines FIRST (Senior Legal may — BW9a), so the apply can prove drift-warn.
    await JP.sync(JID, { source: 'bw9b-harness' });
    var att = await req('POST', '/api/jurisdiction-profile/attest', { section: 'deadlines' }, TATT);
    ok('C1 Senior Legal attests deadlines before the edit', att.status === 200);
    var c2 = await req('POST', '/api/jurisdiction-profile/rules/deadlines/propose',
      { domain: 'deadline', config: withRespond(12), citation: 'Tex. Gov\'t Code § 552.221(a)', note: 'HB-style change: 12 bd response', applyNow: true }, TDIR);
    ok('C2 the Director\'s apply-now on a LEGAL domain files but does NOT apply — worded, never lost',
      c2.status === 200 && c2.json.applied === false && /Senior Legal applies/i.test(c2.json.refusal) &&
      c2.json.proposal.source_ref === 'editor' && c2.json.proposal.status === 'pending');
    ok('C3 the proposal\'s summary carries the citation (the assertion travels with the change)',
      /citation: Tex\. Gov/i.test(c2.json.proposal.summary));
    var lst = await req('GET', '/api/config-freshness/proposals?status=pending', null, TATT);
    ok('C4 the editor proposal rides the EXISTING review queue',
      lst.status === 200 && (lst.json.proposals || []).some(function (p) { return p.id === c2.json.proposal.id; }));
    var applyDir = await req('POST', '/api/config-freshness/proposals/' + c2.json.proposal.id + '/apply', { attested: true }, TDIR);
    ok('C5 the Director cannot apply it through the review flow either — the line holds at every door',
      applyDir.status === 403 && /Senior Legal applies/i.test(applyDir.json.error));
    var applyAtt = await req('POST', '/api/config-freshness/proposals/' + c2.json.proposal.id + '/apply', { attested: true }, TATT);
    ok('C6 Senior Legal applies it: the jurisdiction_rules row changes',
      applyAtt.status === 200 && applyAtt.json.applied === true && /jurisdiction_rules/.test(applyAtt.json.target));
    var newDl = await JR.read(JID, 'deadline');
    ok('C7 the stored config now carries the 12-business-day response clock',
      newDl.clocks.respond.duration === 12 && newDl.clocks.respond.basis === 'business_days');
    var dlState = await JP.sectionState(JID, 'deadlines');
    ok('C8 DRIFT-WARN (decided): the attested section drifts and demands re-attestation — nothing is blocked',
      applyAtt.json.drifted === true && dlState.drift === true && dlState.readiness === 'needs_reattestation' &&
      /keeps running/i.test(applyAtt.json.driftNote || ''));
    // Non-Legal domain: the owner applies in the same act.
    var feeCfg = JSON.parse(JSON.stringify(fees.json.configs.fee));
    feeCfg.knobs['Master.f2'].label = feeCfg.knobs['Master.f2'].label + ' ';
    var c9 = await req('POST', '/api/jurisdiction-profile/rules/fees/propose',
      { domain: 'fee', config: feeCfg, citation: 'AG cost schedule', note: 'label touch-up', applyNow: true }, TDIR);
    ok('C9 on a NON-Legal domain the Director owner applies in the same act',
      c9.status === 200 && c9.json.applied === true);
    ok('C10 …and the write landed', (await JR.read(JID, 'fee')).knobs['Master.f2'].label.slice(-1) === ' ');
    // Senior Legal owner: same-act apply on a Legal domain.
    var cmCfg = (await req('GET', '/api/jurisdiction-profile/rules/deadlines', null, TATT)).json.configs.clock_matrix;
    var c11 = await req('POST', '/api/jurisdiction-profile/rules/deadlines/propose',
      { domain: 'clock_matrix', config: cmCfg, citation: '§ 552.301', note: 'matrix reviewed as imported', applyNow: true }, TATT);
    ok('C11 Senior Legal (the owner) applies a clock_matrix edit in the same act — and the matrix reconciled at compose',
      c11.status === 200 && c11.json.applied === true);
    // Apply-time revalidation: the second door refuses too.
    var c12p = await req('POST', '/api/jurisdiction-profile/rules/deadlines/propose',
      { domain: 'deadline', config: withRespond(12), citation: '§ x', note: 'valid at compose' }, TATT);
    var c12 = await req('POST', '/api/config-freshness/proposals/' + c12p.json.proposal.id + '/apply',
      { attested: true, editedConfig: withRespond(46) }, TATT);
    ok('C12 an editedConfig smuggling a 46-day clock is refused AT APPLY — the invariants hold at every door',
      c12.status === 400 && /outside the 1-45 day band/i.test(c12.json.error));

    // ==============================================================================================
    console.log('\n=== D. REVIEW-FLOW SCOPING for Senior Legal ===');
    var feeProp = await req('POST', '/api/jurisdiction-profile/rules/fees/propose',
      { domain: 'fee', config: feeCfg, citation: '§ x', note: 'for scoping test' }, TDIR);
    var d1 = await req('POST', '/api/config-freshness/proposals/' + feeProp.json.proposal.id + '/apply', { attested: true }, TATT);
    ok('D1 Senior Legal is scoped OFF non-Legal proposals in the review flow, in words',
      d1.status === 403 && /the Director/i.test(d1.json.error));
    var d2 = await req('POST', '/api/config-freshness/proposals/' + c12p.json.proposal.id + '/dismiss', null, TATT);
    ok('D2 Senior Legal dismisses a Legal-domain proposal', d2.status === 200);
    var d3 = await req('POST', '/api/config-freshness/proposals/' + feeProp.json.proposal.id + '/dismiss', null, TATT);
    ok('D3 …but not a fee proposal', d3.status === 403);

  } catch (e) {
    console.error('HARNESS ERROR:', e && e.stack);
    fail++;
  } finally {
    try { await restore(); await JP.sync(JID, { source: 'bw9b-restore' }); } catch (e) { console.error('RESTORE FAILED:', e && e.message); }
  }
  console.log('\nSUMMARY: ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
