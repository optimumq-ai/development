'use strict';
// MASS-REDACTION HAND-OFF — the recorded item-14 follow-on: an approved discovery proposal flagged
// consistent-layout must LAND somewhere a redaction supervisor works, not evaporate into prose.
//
// The design (Kevin approved from mockup 2026-08-13): the flag is stored machine-readable on the
// variant (record_types.mass_redaction_candidate + discovery_meta), and the Mass Redaction page
// lists the variant as "waiting for a template" until an ACTIVE layout_profile names it. The card
// is query-driven — no state to go stale: saving a linked template clears it, deleting that
// template brings it honestly back, "Not needed" clears the flag by hand (elevated only).
//
// WHAT THIS PREVENTS: the flag surviving only as description text (unreadable by machines), a
// suggestion lingering after its template exists, a suggestion silently GONE while the pile is
// still uncovered, counts dressed as facts when only a sample share is known, and non-supervisors
// dismissing suggestions.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');

var pass = 0, fail = 0, TOKEN = null, PLAIN_TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'MH' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function call(token, method, path, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
function api(method, path, body) { return call(TOKEN, method, path, body); }

(async function () {
  await db.initDb();
  TOKEN = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  var plain = await db.get(
    "SELECT u.* FROM users u WHERE u.status = 'active' AND NOT EXISTS (" +
    " SELECT 1 FROM user_user_types r WHERE r.user_id = u.id" +
    " AND r.user_type_id IN ('ut-oro_sysadmin','ut-oro_director','ut-oro_supervisor','ut-team_supervisor','ut-team_manager')) LIMIT 1");
  PLAIN_TOKEN = plain ? await auth.signAccessToken(plain) : null;
  var cat = await db.get('SELECT id FROM categories ORDER BY sort_order LIMIT 1');

  console.log('\n=== A. THE FLAG LANDS MACHINE-READABLE, NOT JUST AS PROSE ===');
  var bucket = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'MH Bucket ' + TAG, code: 'mhb-' + TAG })).body;
  var flagged = (await api('POST', '/taxonomy/record-types/' + bucket.id + '/variants', {
    name: 'MH Permit ' + TAG, code: 'mh-permit-' + TAG, estimated_count: 1204, sample_share: 0.62,
    layout: 'uniform', mass_redaction_candidate: true,
    example_files: ['permit_a.pdf', 'permit_b.pdf'], repos: ['City Filestore'] })).body;
  var row = await db.get('SELECT mass_redaction_candidate, discovery_meta FROM record_types WHERE id = ?', [flagged.id]);
  var meta = {}; try { meta = JSON.parse(row.discovery_meta || '{}'); } catch (e) {}
  ok('A1 the approved flagged proposal stores mass_redaction_candidate = 1', Number(row.mass_redaction_candidate) === 1);
  ok('A2 discovery_meta carries the card\'s evidence (count, layout, examples, source, found date)',
    meta.estimated_count === 1204 && meta.layout === 'uniform' &&
    (meta.example_files || [])[0] === 'permit_a.pdf' && (meta.repos || [])[0] === 'City Filestore' &&
    /^\d{4}-\d{2}-\d{2}$/.test(meta.found_at || ''));
  var unflagged = (await api('POST', '/taxonomy/record-types/' + bucket.id + '/variants', {
    name: 'MH Varied ' + TAG, code: 'mh-varied-' + TAG, sample_share: 0.2, layout: 'varied' })).body;
  var row2 = await db.get('SELECT mass_redaction_candidate, discovery_meta FROM record_types WHERE id = ?', [unflagged.id]);
  ok('A3 an unflagged proposal stores neither flag nor meta', Number(row2.mass_redaction_candidate) === 0 && row2.discovery_meta == null);

  console.log('\n=== B. THE SUGGESTION APPEARS WHERE THE WORK HAPPENS ===');
  function opps() { return api('GET', '/redaction-templates/opportunities'); }
  var list = (await opps()).body.opportunities || [];
  var card = list.find(function (o) { return o.record_type_id === flagged.id; });
  ok('B1 the flagged variant is listed as waiting for a template', !!card);
  ok('B2 the card is honest: real count, layout, source, parent named',
    card && card.estimated_count === 1204 && card.layout === 'uniform' &&
    (card.repos || [])[0] === 'City Filestore' && card.parent_name === 'MH Bucket ' + TAG);
  ok('B3 the unflagged variant is NOT listed', !list.some(function (o) { return o.record_type_id === unflagged.id; }));
  var shareOnly = (await api('POST', '/taxonomy/record-types/' + bucket.id + '/variants', {
    name: 'MH ShareOnly ' + TAG, code: 'mh-share-' + TAG, sample_share: 0.34, layout: 'few_layouts', mass_redaction_candidate: true })).body;
  var card2 = ((await opps()).body.opportunities || []).find(function (o) { return o.record_type_id === shareOnly.id; });
  ok('B4 with no real total the card exposes the sample share, never a fabricated count',
    card2 && card2.estimated_count == null && card2.sample_share === 0.34);

  console.log('\n=== C. QUERY-DRIVEN LIFECYCLE — the card follows the template, no bookkeeping ===');
  var tpl = (await api('POST', '/redaction-templates', {
    name: 'MH Template ' + TAG, record_type_id: flagged.id,
    zones: [{ page_no: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05, rule_id: null }] })).body;
  ok('C1 saving a template LINKED to the variant clears its suggestion',
    tpl && tpl.success && !((await opps()).body.opportunities || []).some(function (o) { return o.record_type_id === flagged.id; }));
  await api('DELETE', '/redaction-templates/' + tpl.template.id);
  ok('C2 deleting that template brings the suggestion honestly back (the pile is uncovered again)',
    ((await opps()).body.opportunities || []).some(function (o) { return o.record_type_id === flagged.id; }));

  console.log('\n=== D. "NOT NEEDED" — a human act, gated like every template act ===');
  if (PLAIN_TOKEN) {
    var forbidden = await call(PLAIN_TOKEN, 'POST', '/redaction-templates/opportunities/' + flagged.id + '/dismiss');
    ok('D1 a non-supervisor cannot dismiss a suggestion (403)', forbidden.status === 403);
  } else { ok('D1 SKIPPED — no plain active user in fixture (counts as fail to force a look)', false); }
  var dis = await api('POST', '/redaction-templates/opportunities/' + flagged.id + '/dismiss');
  ok('D2 a supervisor dismisses it and it leaves the list',
    dis.status === 200 && !((await opps()).body.opportunities || []).some(function (o) { return o.record_type_id === flagged.id; }));
  var again = await api('POST', '/redaction-templates/opportunities/' + flagged.id + '/dismiss');
  ok('D3 dismissing an already-dismissed suggestion is a 404, not a silent success', again.status === 404);
  var flagRow = await db.get('SELECT mass_redaction_candidate FROM record_types WHERE id = ?', [flagged.id]);
  ok('D4 dismissal clears only the flag — the variant itself survives', Number(flagRow.mass_redaction_candidate) === 0 && !!flagged.id);

  console.log('\n=== E. LEAVE THE WORLD AS FOUND ===');
  await db.run("DELETE FROM layout_profiles WHERE name LIKE '%' || ?", [TAG]);
  for (var idd of [shareOnly.id, unflagged.id, flagged.id, bucket.id]) { await api('DELETE', '/taxonomy/record-types/' + idd); }
  var leftRt = await db.get("SELECT count(*)::int AS n FROM record_types WHERE code LIKE '%' || ?", [TAG]);
  var leftLp = await db.get("SELECT count(*)::int AS n FROM layout_profiles WHERE name LIKE '%' || ?", [TAG]);
  ok('E1 all fixture record types and templates are gone', Number(leftRt.n) === 0 && Number(leftLp.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
