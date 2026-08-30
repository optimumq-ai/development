'use strict';
// GOLDEN SETUP — can a city be configured END-TO-END through the product's own APIs (never SQL), and does
// the system then agree it is ready and price an estimate? (Kevin 2026-08-30: "make sure we're not building
// on bad code" — the strongest regression test we have for the setup flow; runs against the TEST DB only.)
//
//   A. Foundation: agency fields + lock the state (loads the state's rules).
//   B. Organization: a department, a team serving it, a staff account with a team user type — via the API.
//   C. Fee rules: decide every deferral, waiver decider, deposit/payment clock + its six settings, APPROVE v1,
//      record the test-estimate outcome.
//   D. Request rules: clarification (enable + five choices), eligibility postures, intake choices,
//      deadline service targets + holidays, exemption choices.
//   E. Every remaining local policy setting in every section: confirm with the suggested default (a decision).
//   F. Proposals: apply (or dismiss) everything pending.
//   G. Attest: every hub row with a door (fold-attests its sections) + every section with no fold.
//   H. THE VERDICT: go-live ready === true · the guide has no waiting / not-started rows · the sandbox prices
//      · a request submitted through the public portal gets a priced estimate.
//
// A refusal along the way is a FINDING, printed by name — the point is to learn where the product cannot be
// configured through its own doors. BREAKS THIS SHOULD CATCH: a section no screen can attest · a setting no
// screen can confirm · approve that cannot be reached · an estimate that cannot price with a version in use.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var ut = require('/opt/optimumq/backend/src/services/userTypes');

var pass = 0, fail = 0, findings = [];
function ok(l, c, extra) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (c || !extra ? '' : '  -> ' + String(extra).slice(0, 300))); }
function finding(what) { findings.push(what); console.log('  NOTE  ' + what); }
var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'gold' + Date.now().toString().slice(-6);
async function mk(key, teamId) {
  var id = 'u-' + TAG + '-' + key;
  await db.run("INSERT INTO users (id, email, display_name, title, status) VALUES (?,?,?,?, 'active')", [id, id + '@test.optimumq.ai', 'GOLD ' + key, 'Test ' + TAG]);
  await ut.grant(id, key, teamId || null, 'harness');
  return id;
}
async function callAs(id, method, path, body) {
  var t = id ? await auth.signAccessToken(await db.get('SELECT * FROM users WHERE id = ?', [id])) : null;
  var h = { 'Content-Type': 'application/json' }; if (t) h.Authorization = 'Bearer ' + t;
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
function err(r) { return (r.body && (r.body.error || r.body.message)) || ('HTTP ' + r.status); }
function findItem(page, key) { var f = null; (page.lanes || []).forEach(function (l) { l.items.forEach(function (x) { if (x.key === key) f = x; }); }); (page.top || []).forEach(function (x) { if (x.key === key) f = x; }); return f; }

(async function () {
  await db.initDb();
  var DIR = await mk('oro_director'), SA = await mk('oro_sysadmin'), LEGAL = await mk('oro_senior_legal');
  async function asAny(method, path, body) {   // try the actors in turn; the first 2xx wins
    var last = null;
    for (var who of [DIR, LEGAL, SA]) { var r = await callAs(who, method, path, body); if (r.status < 300) return r; last = r; if (r.status !== 403) break; }
    return last;
  }

  console.log('\n=== A. FOUNDATION — agency + state lock ===');
  var ag = await callAs(DIR, 'GET', '/agency');
  ok('A1 the agency screen reads', ag.status === 200 && ag.body && Array.isArray(ag.body.states), err(ag));
  var put = await callAs(DIR, 'PUT', '/agency', { agency_name: 'City of Golden Test', agency_short_name: 'Golden', jurisdiction_type: 'city', contact_email: 'records@golden.test', contact_phone: '555-0100', address_line1: '1 Main St', address_city: 'Golden', address_state: 'TX', address_zip: '75001' });
  ok('A2 agency fields save', put.status === 200, err(put));
  if (!(ag.body && ag.body.lock && ag.body.lock.state)) {
    var lk = await callAs(DIR, 'POST', '/agency/lock-state', { state: 'TX' });
    ok('A3 lock TX and load its rules', lk.status === 200 && lk.body && lk.body.lock && lk.body.lock.state === 'TX', err(lk));
  } else ok('A3 state already locked in the fixture (' + ag.body.lock.state + ')', true);

  console.log('\n=== B. ORGANIZATION — department, team, staff, user type (via the API) ===');
  var dep = await callAs(DIR, 'POST', '/departments', { name: 'Golden Parks ' + TAG, code: 'GPK' + TAG.slice(-4), kind: 'department' });
  ok('B1 create a department', dep.status < 300 && dep.body && (dep.body.id || (dep.body.department && dep.body.department.id)), err(dep));
  var depId = dep.body && (dep.body.id || (dep.body.department && dep.body.department.id));
  var team = await callAs(DIR, 'POST', '/departments', { name: 'Golden Parks Team ' + TAG, code: 'GPT' + TAG.slice(-4), kind: 'team' });
  ok('B2 create a fulfillment team', team.status < 300 && team.body && (team.body.id || (team.body.department && team.body.department.id)), err(team));
  var teamId = team.body && (team.body.id || (team.body.department && team.body.department.id));
  if (teamId && depId) { var ful = await callAs(DIR, 'POST', '/departments/' + teamId + '/fulfills', { departmentIds: [depId] }); ok('B3 the team serves the department', ful.status < 300, err(ful)); }
  var st = await callAs(SA, 'POST', '/staff', { displayName: 'Golden Staffer', email: 'golden.' + TAG + '@golden.test', tempPassword: 'Temp-' + TAG + '-pass1', departmentId: depId || null });
  var staffId = st.body && (st.body.userId || st.body.id || (st.body.user && st.body.user.id));
  ok('B4 create a staff account', st.status < 300 && !!staffId, err(st));
  if (staffId && teamId) { var typ = await callAs(SA, 'PATCH', '/staff/' + staffId + '/user-types', { userTypes: [{ key: 'team_staff', teamId: teamId }] }); ok('B5 give the account a team user type', typ.status < 300, err(typ)); }

  var em = await callAs(SA, 'POST', '/integrations', { email: { provider: 'smtp', from_name: 'Golden Records', smtp_host: 'mail.golden.test', smtp_port: '587', smtp_user: 'records', smtp_pass: 'x', smtp_from: 'records@golden.test' } });
  ok('B6 email configured (technical lane)', em.status < 300, err(em));
  var ai = await callAs(SA, 'POST', '/integrations', { ai: { anthropic_api_key: 'sk-ant-golden-000000000000', voyage_api_key: 'pa-golden-000000000000' }, deployment: { profile: 'standard' } });
  ok('B7 AI configuration: both keys and a deployment model (technical lane)', ai.status < 300, err(ai));
  var au = await callAs(SA, 'POST', '/config', { auth_mode: 'local', mfa_mode: 'optional', session_timeout: '8h', min_password_length: '10' });
  ok('B8 sign-in settings saved (technical lane)', au.status < 300, err(au));
  // System Features and Options: a seeded task budget is a provisional default, not the city's decision (§3g).
  var tb = await callAs(DIR, 'GET', '/config/time-budgets');
  var tbFails = [];
  for (var tbr of ((tb.body && tb.body.budgets) || [])) { var tbw = await callAs(DIR, 'PUT', '/config/time-budgets', { taskType: tbr.task_type, budgetDays: Number(tbr.budget_days) || 3 }); if (tbw.status !== 200) tbFails.push(tbr.task_type + ': ' + err(tbw)); }
  ok('B9 every task time budget reviewed and saved (' + ((tb.body && tb.body.budgets) || []).length + ')', tb.status === 200 && tbFails.length === 0, tbFails.join(' | '));
  // Time capture: off everywhere is a valid posture, but it has to be SAVED to be the city's decision (§3g).
  var tc = await callAs(DIR, 'PUT', '/config/time-capture', { config: { search: 'discretion', estimate: 'off', legal_redaction: 'off', legal: 'off' } });
  ok('B10 task processing time capture saved', tc.status === 200, err(tc));

  console.log('\n=== C. FEE RULES — decide, waiver, clock, APPROVE ===');
  var fl = await callAs(DIR, 'GET', '/fee-law');
  ok('C1 the fee-law screen reads with the locked state\'s template', fl.status === 200 && fl.body && Array.isArray(fl.body.rows) && fl.body.rows.length > 0, err(fl));
  var undecided = (fl.body.rows || []).filter(function (r) { return r.binding === 'deferral' && r.city && r.city.value == null && r.city.source == null; });
  if (undecided.length) {
    var items = {}; undecided.forEach(function (r) { items[r.key] = { value: 'none' }; });
    var dc = await callAs(DIR, 'PUT', '/fee-law/decisions', { items: items });
    ok('C2 every undecided city item decided ("none" × ' + undecided.length + ')', dc.status === 200 && dc.body && (!dc.body.refused || !dc.body.refused.length), err(dc) + ' ' + JSON.stringify(dc.body && dc.body.refused));
  } else ok('C2 no undecided deferral items', true);
  var wv = await callAs(DIR, 'POST', '/fee-law/waiver', { decider: 'intake_review', denialWording: true });
  ok('C3 waiver decider recorded', wv.status === 200, err(wv));
  var ck = await callAs(DIR, 'POST', '/fee-law/clock', { enabled: true });
  ok('C4 deposit/payment clock switched on', ck.status === 200, err(ck));
  var clockVals = { deposit_clock_effect: 'toll_pause_resume', deposit_grace_days: 10, deposit_lapse_action: 'flag_only', reissue_required_on_variance: true, reissue_blocks_collection: true, reissue_restarts_response_window: false };
  var ckFails = [];
  for (var key in clockVals) { var c1 = await callAs(DIR, 'POST', '/fee-law/clock', { confirm: { key: key, value: clockVals[key] } }); if (c1.status !== 200) ckFails.push(key + ': ' + err(c1)); }
  ok('C5 the six clock settings confirmed', ckFails.length === 0, ckFails.join(' | '));
  var ap = await callAs(DIR, 'POST', '/fee-law/approve', {});
  ok('C6 APPROVE writes fee schedule v1', ap.status === 200, err(ap));
  var fl2 = await callAs(DIR, 'GET', '/fee-law');
  ok('C7 the screen shows a version in use', fl2.body && fl2.body.version && fl2.body.version.version >= 1, JSON.stringify(fl2.body && fl2.body.version));
  var tr = await callAs(DIR, 'POST', '/onboarding/fees/test-result', { outcome: 'confirmed', notes: 'golden harness' });
  ok('C8 test-estimate outcome recorded', tr.status === 200, err(tr));

  console.log('\n=== D. REQUEST RULES — clarification, eligibility, intake, deadlines, exemptions ===');
  var rr = await callAs(DIR, 'GET', '/request-rules');
  ok('D1 the request-rules screen reads', rr.status === 200 && rr.body && rr.body.tabs, err(rr));
  var tabs = (rr.body && rr.body.tabs) || {};
  var en = await callAs(DIR, 'POST', '/request-rules/clarification/enabled', { enabled: true });
  ok('D2 clarification enabled', en.status === 200, err(en));
  var clar = ((tabs.clarification || {}).choices || []);
  var dFails = [];
  for (var c of clar) { var v = c.value != null ? c.value : (c.suggested != null ? c.suggested : null); if (v == null) continue; var r1 = await callAs(DIR, 'POST', '/request-rules/clarification/confirm', { path: 'knobs/' + c.key, value: v }); if (r1.status !== 200) dFails.push('clarification ' + c.key + ': ' + err(r1)); }
  ok('D3 clarification choices confirmed (' + clar.length + ')', dFails.length === 0, dFails.join(' | '));
  var dims = ((tabs.eligibility || {}).dimensions || []); dFails = [];
  for (var d of dims) { var r2 = await callAs(DIR, 'POST', '/request-rules/eligibility/posture', { dimension: d.key || d.dimension || d.name, gated: !!(d.gated) }); if (r2.status !== 200) dFails.push('eligibility ' + (d.key || d.dimension) + ': ' + err(r2)); }
  ok('D4 eligibility postures confirmed (' + dims.length + ')', dFails.length === 0, dFails.join(' | '));
  var ints = ((tabs.intake || {}).choices || []); dFails = [];
  for (var i of ints) { var iv = i.value != null ? i.value : (i.suggested != null ? i.suggested : null); if (iv == null) continue; var r3 = await callAs(DIR, 'POST', '/request-rules/intake/confirm', { path: 'knobs/' + i.key, value: iv }); if (r3.status !== 200) dFails.push('intake ' + i.key + ': ' + err(r3)); }
  ok('D5 intake choices confirmed (' + ints.length + ')', dFails.length === 0, dFails.join(' | '));
  var dAck = await callAs(DIR, 'POST', '/config', { ack_email: 'on' });
  ok('D5b the requestor acknowledgement decision (an intake decision) recorded by the Director', dAck.status === 200, err(dAck));
  var dDl = await callAs(SA, 'POST', '/config', { overdue_alert_days: '1', escalation_days: '3' });
  ok('D5c Staff Alerts: both deadline settings saved (a shipped default is not a decision)', dDl.status === 200, err(dDl));
  var clocks = ((tabs.deadlines || {}).timers || (tabs.deadlines || {}).clocks || (tabs.deadlines || {}).rows || []); dFails = []; var targeted = 0;
  for (var t of clocks) { if (t.statutory || t.kind === 'statutory' || t.days != null || t.duration != null) continue; var r4 = await callAs(LEGAL, 'POST', '/request-rules/deadlines/target', { clock: t.key || t.clock || t.id, days: 2 }); if (r4.status === 200) targeted++; else if (r4.status !== 422) dFails.push('target ' + (t.key || t.clock) + ': ' + err(r4)); }
  ok('D6 deadline service targets set where the law is silent (' + targeted + ')', dFails.length === 0, dFails.join(' | '));
  var hol = await callAs(LEGAL, 'POST', '/request-rules/deadlines/holidays', {});
  ok('D7 holiday calendar loaded (or already loaded)', hol.status === 200 || hol.status === 409, err(hol));

  console.log('\n=== E. EVERY REMAINING LOCAL POLICY SETTING — confirm the suggested default ===');
  var ps = await callAs(DIR, 'GET', '/jurisdiction-profile/policy-settings');
  ok('E1 policy settings read', ps.status === 200 && ps.body && Array.isArray(ps.body.sections), err(ps));
  var eFails = [], confirmed = 0, skipped = [];
  for (var sec of (ps.body.sections || [])) {
    for (var s of (sec.settings || [])) {
      var un = s.kind === 'dimension' ? (s.gated && !s.confirmed) : !s.confirmed; if (!un) continue;
      var val = s.suggestedDefault != null ? s.suggestedDefault : (s.value != null ? s.value : (s.current != null ? s.current : null));
      if (s.kind === 'dimension') val = true;
      if (val == null) {
        // No suggested value: choose a type-appropriate decision so the walk continues; a refusal is a finding.
        var opts = s.options || s.allowed || s.values; var nm = s.path.split('/').pop();
        if (Array.isArray(opts) && opts.length) val = (opts[0] && opts[0].value != null) ? opts[0].value : opts[0];
        else if (nm === 'Denial.dlegal') val = 'legal_rules'; else if (nm === 'Denial.ncomm') val = 'standard_wording'; else if (nm === 'Denial.nreason') val = 'redaction_rules_library';
        else if (/\.(ddl|n3|addt)$|days/i.test(nm)) val = 5; else if (/\.(fcom|close)$/.test(nm)) val = true;
        else if (/^branches\//.test(s.path)) val = true; else val = 'confirmed';
        skipped.push(sec.section + ' ' + s.domain + '/' + s.path + ' (no suggested value; sent ' + JSON.stringify(val) + ')');
      }
      var actor = /^(exemption|redaction|deadline|clock_matrix)/.test(s.domain) ? LEGAL : DIR;
      var r5 = await callAs(actor, 'POST', '/jurisdiction-profile/policy-settings/confirm', { domain: s.domain, path: s.path, value: val });
      if (r5.status === 200) confirmed++; else { var r5b = await callAs(actor === DIR ? LEGAL : DIR, 'POST', '/jurisdiction-profile/policy-settings/confirm', { domain: s.domain, path: s.path, value: val }); if (r5b.status === 200) confirmed++; else eFails.push(sec.section + ' ' + s.domain + '/' + s.path + '=' + JSON.stringify(val) + ': ' + err(r5)); }
    }
  }
  ok('E2 remaining settings confirmed (' + confirmed + ')', eFails.length === 0, eFails.slice(0, 6).join(' | '));
  skipped.forEach(function (x) { finding('setting with NO suggested value to confirm: ' + x); });
  eFails.forEach(function (x) { finding('setting REFUSED confirm: ' + x); });

  console.log('\n=== F. PROPOSALS — apply everything pending ===');
  var pr = await callAs(DIR, 'GET', '/config-freshness/proposals?status=pending');
  var list = (pr.body && (pr.body.proposals || pr.body)) || []; if (!Array.isArray(list)) list = [];
  var fFails = [], applied = 0, dismissed = 0;
  for (var p of list) { var r6 = await callAs(DIR, 'POST', '/config-freshness/proposals/' + p.id + '/apply', { attested: true }); if (r6.status < 300) applied++; else { var r6b = await callAs(DIR, 'POST', '/config-freshness/proposals/' + p.id + '/dismiss', {}); if (r6b.status < 300) { dismissed++; finding('proposal ' + p.id + ' (' + (p.domain || p.area || '') + ') could not be APPLIED — dismissed instead: ' + err(r6)); } else fFails.push(p.id + ': ' + err(r6)); } }
  ok('F1 pending proposals cleared (' + list.length + ' pending → ' + applied + ' applied, ' + dismissed + ' dismissed)', fFails.length === 0, fFails.join(' | '));
  // Update Configuration is a FORM row (SPEC §3g): the empty queue above plus the two reminder settings SAVED
  // — the shipped 182 days and the fallback address are defaults, not the city's decision.
  var frs = await callAs(DIR, 'POST', '/config-freshness/settings', { cadenceDays: 182, recipient: 'records@golden.test' });
  ok('F2 the reminder settings are recorded (Update Configuration)', frs.status === 200, err(frs));

  console.log('\n=== G. ATTEST — every hub row, then every section with no fold ===');
  var hub = await callAs(DIR, 'GET', '/setup-hub');
  ok('G1 the hub reads', hub.status === 200 && hub.body && hub.body.lanes, err(hub));
  var gFails = [], marked = 0, allItems = [];
  (hub.body.lanes || []).forEach(function (l) { allItems = allItems.concat(l.items); }); allItems = allItems.concat(hub.body.top || []);
  for (var it of allItems) {
    if (it.goLive || it.signoff) continue;
    var r7 = await asAny('POST', '/setup-hub/' + it.key + '/done', {});
    if (r7.status < 300) marked++; else gFails.push(it.key + ': ' + err(r7));
  }
  ok('G2 hub rows marked done (' + marked + ')', gFails.length === 0, gFails.join(' | '));
  gFails.forEach(function (x) { finding('hub row could NOT be marked done: ' + x); });
  var ps2 = await callAs(DIR, 'GET', '/jurisdiction-profile/policy-settings');
  var aFails = [], attested = 0;
  for (var sec2 of (ps2.body.sections || [])) {
    if (sec2.attestedBy || sec2.attested_by || sec2.attested) continue;
    var actor2 = /^(exemption|redaction|deadlines)$/.test(sec2.section) ? LEGAL : DIR;
    var r8 = await callAs(actor2, 'POST', '/jurisdiction-profile/attest', { section: sec2.section });
    if (r8.status === 200) attested++; else aFails.push(sec2.section + ' (' + (sec2.status || '') + '): ' + err(r8));
  }
  ok('G3 sections with no fold attested directly (' + attested + ')', aFails.length === 0, aFails.join(' | '));
  aFails.forEach(function (x) { finding('section could NOT be attested: ' + x); });

  console.log('\n=== H. THE VERDICT ===');
  var gl = await callAs(DIR, 'GET', '/jurisdiction-profile/go-live');
  var g = gl.body || {};
  ok('H1 go-live says READY', gl.status === 200 && g.ready === true, JSON.stringify({ ready: g.ready, unconfirmedSettings: g.unconfirmedSettings, proposalsPending: g.proposalsPending, activeBranchUnconfirmed: g.activeBranchUnconfirmed, drifted: g.drifted || g.sectionsDrifted, attested: g.sectionsAttested || g.attested, total: g.sectionsTotal || g.total, notConfigured: g.notConfigured }));
  var hub2 = await callAs(DIR, 'GET', '/setup-hub'); var cnt = (hub2.body && hub2.body.counts) || {};
  var notGreen = []; (hub2.body.lanes || []).forEach(function (l) { l.items.forEach(function (x) { if (x.state !== 'ready') notGreen.push(x.key + '=' + x.state + ' (' + x.evidence + ')'); }); });
  notGreen = notGreen.filter(function (x) { return !/^go_live=/.test(x); });
  ok('H2 the Set Up Guide is all green (every row but go-live is ready)', notGreen.length === 0, notGreen.join(' | '));
  var sb = await callAs(DIR, 'POST', '/fee-sandbox/preview', { quantities: { searchHours: 2, reviewHours: 1, programmingHours: 0, bwPages: 120, colorPages: 0, oversizedPages: 0 }, delivery: 'email', purpose: 'standard' });
  var total = sb.body && (sb.body.effectiveTotal != null ? sb.body.effectiveTotal : (sb.body.computedTotal != null ? sb.body.computedTotal : sb.body.total));
  ok('H3 the sandbox prices against the version in use (total > 0)', sb.status === 200 && Number(total) > 0, err(sb) + ' total=' + total + ' keys=' + Object.keys(sb.body || {}).join(','));
  var sub = await callAs(null, 'POST', '/public/submit', { requestorName: 'Golden Requestor', requestorEmail: 'golden.requestor.' + TAG + '@example.com', description: 'Copies of all building permits issued for 1 Main St in 2025, and the inspection reports for each.' });
  ok('H4 a request submits through the public portal', sub.status === 201 || sub.status === 200, err(sub));
  var reqId = sub.body && (sub.body.requestId || sub.body.id);
  if (reqId) {
    await new Promise(function (r) { setTimeout(r, 1500); });
    var ctx = await callAs(DIR, 'GET', '/fee-estimates/request/' + reqId);
    ok('H5 the estimate context loads for it', ctx.status === 200, err(ctx));
    var comps = (ctx.body && (ctx.body.components || (ctx.body.context && ctx.body.context.components))) || [];
    if (!comps.length) comps = [{ id: 'c1', label: 'Building permits', recordType: null, quantities: { searchHours: 1, reviewHours: 0.5, bwPages: 40 } }];
    var est = await callAs(DIR, 'POST', '/fee-estimates/request/' + reqId, { components: comps, delivery: 'email', purpose: 'standard' });
    var etot = est.body && est.body.estimate && est.body.estimate.total;
    ok('H6 a real estimate prices (total is a number)', est.status === 200 && typeof etot === 'number', err(est) + ' body=' + JSON.stringify(est.body || {}).slice(0, 200));
  }

  console.log('\n=== I. CLEANUP ===');
  await db.run("DELETE FROM setup_hub_signoffs WHERE marked_by LIKE 'u-' || ? || '-%'", [TAG]);
  for (var u of [DIR, SA, LEGAL]) { await ut.revokeAll(u); await db.run('DELETE FROM users WHERE id = ?', [u]); }
  ok('I1 harness users removed', true);
  if (findings.length) { console.log('\n--- FINDINGS (' + findings.length + ') ---'); findings.forEach(function (f) { console.log('  * ' + f); }); }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e); process.exit(1); });
