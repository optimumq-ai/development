'use strict';
// DATA-SYSTEM CENSUS — inventory build slice 5 (2026-09-15). Design: HANDOFF 2026-09-04 round 3 ("a data record is not
// read, it is RENDERED"; census = kind enumeration; embed tiers; field-redacted renderings), the DataSystem artboard.
//
// WHAT THIS PREVENTS: a data system pretending to be a folder; counts invented where the connector reports none; a
// rendered record that leaks a value the field redaction template withholds; embed tiers that would vector ids and dates;
// a kind losing its id or its hand-made association on a refresh; the documents path breaking for data sources.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce();
var fs = require('fs');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var SC = require('/opt/optimumq/backend/src/services/sourceCensus');

var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }
var TAG = 'KC' + Date.now();
var PORT = Number(process.env.API_PORT) || 3101;
async function api(method, path, body) {
  var r = await fetch('http://localhost:' + PORT + '/api' + path, { method: method, headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  var j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function censusDone(repoId) { for (var k = 0; k < 120; k++) { var st = (await api('GET', '/repositories/' + repoId + '/census')).body; if (!st.current) return st; await sleep(300); } return null; }

(async function () {
  await db.initDb();
  TOKEN = await auth.signAccessToken(await db.get("SELECT * FROM users WHERE id = 'u-kruss'"));
  var cat = await db.get('SELECT id FROM categories ORDER BY sort_order LIMIT 1');
  var def = '/tmp/kc-system-' + TAG + '.json';
  var kindName = 'kc_vendor_invoices_' + TAG.toLowerCase();
  fs.writeFileSync(def, JSON.stringify({ system: 'KC Finance System ' + TAG, tables: [
    { name: kindName, desc: 'Invoices received from vendors', columns: ['invoice_id', 'vendor_name', 'vendor_tax_id', 'amount', 'invoice_date', 'status'], sample: { invoice_id: 'INV-004512', vendor_name: 'Halff Associates', vendor_tax_id: '74-1234567', amount: 12400, invoice_date: '2025-03-14', status: 'paid' }, row_count: 3821, date_range: { from: '2019-01', to: '2026-08' } },
    { name: 'inspection_notes_' + TAG.toLowerCase(), desc: 'Free-text inspector narratives', columns: ['note_id', 'inspector', 'visit_date', 'narrative'], sample: { note_id: 77, inspector: 'J. Ortiz', visit_date: '2026-02-11', narrative: 'Walked the site with the contractor; two egress doors blocked by stored material, corrected on the spot; re-inspection not required.' } },
    { name: 'meter_reads_' + TAG.toLowerCase(), desc: 'Hourly meter readings', columns: ['meter_id', 'read_at', 'kwh'], sample: { meter_id: 501, read_at: '2026-08-01T00:00:00', kwh: 12.4 }, row_count: 1200000 }
  ] }));
  var repoId = 'repo-kc-' + TAG;
  await db.run("INSERT INTO record_repositories (id, name, connector_type, status, config) VALUES (?,?,?,?,?)", [repoId, 'KC System ' + TAG, 'structured', 'active', JSON.stringify({ path: def })]);
  var repo = await db.get('SELECT * FROM record_repositories WHERE id = ?', [repoId]);
  var rtVendor = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'KC Vendor Invoices ' + TAG, code: 'kc-vi-' + TAG })).body;
  var rtOther = (await api('POST', '/taxonomy/record-types', { category_id: cat.id, name: 'KC Meter Data ' + TAG, code: 'kc-md-' + TAG })).body;

  console.log('\n=== A. A DATA SYSTEM IS CENSUSABLE — as kinds, not files ===');
  var av = SC.availability(repo);
  ok('A1 the structured source is censusable and says so as a data system', av.available === true && av.kind === 'kinds');
  var st0 = (await api('GET', '/repositories/' + repoId + '/census')).body;
  ok('A2 status carries kind=kinds, no drift concept, no run yet', st0.kind === 'kinds' && st0.drift === null && st0.last === null);
  var start = await api('POST', '/repositories/' + repoId + '/census');
  var st = await censusDone(repoId);
  ok('A3 the census ran and finished: 3 kinds enumerated, 3 new', start.status === 202 && st && st.last && st.last.status === 'done' && st.last.total_files === 3 && st.last.new_files === 3 && st.last.groupings_count === 3);

  console.log('\n=== B. THE INVENTORY — kinds, fields, honest counts, tiers, rendering ===');
  var inv = (await api('GET', '/repositories/' + repoId + '/inventory')).body;
  ok('B1 inventory is in data mode with 3 kinds and 13 fields', inv.mode === 'data' && inv.totals.kinds === 3 && inv.totals.fields === 13);
  var vendor = inv.kinds.find(function (k) { return k.key === kindName; }), notes = inv.kinds.find(function (k) { return /inspection_notes/.test(k.key); }), meters = inv.kinds.find(function (k) { return /meter_reads/.test(k.key); });
  ok('B2 counts and date ranges come from the connector when it reports them (3,821 · 2019-01→2026-08) and are NULL when it does not', vendor.row_count === 3821 && vendor.date_range && vendor.date_range.from === '2019-01' && notes.row_count === null && notes.date_range === null);
  ok('B3 totals.rows sums only what is known (3,821 + 1,200,000)', inv.totals.rows === 1203821);
  ok('B4 fields are typed: invoice_id→id, amount→number, invoice_date→date, vendor_name→text, narrative→prose',
    vendor.fields.find(function (f) { return f.name === 'invoice_id'; }).type === 'id' && vendor.fields.find(function (f) { return f.name === 'amount'; }).type === 'number' && vendor.fields.find(function (f) { return f.name === 'invoice_date'; }).type === 'date' && vendor.fields.find(function (f) { return f.name === 'vendor_name'; }).type === 'text' && notes.fields.find(function (f) { return f.name === 'narrative'; }).type === 'prose');
  ok('B5 embed tiers: vendor invoices → 1 (kind description only) · inspection notes → 2 (prose, opt-in) · meter reads → 3 (never: ids, dates, numbers)', vendor.embed_tier === 1 && notes.embed_tier === 2 && notes.prose_fields.indexOf('narrative') !== -1 && meters.embed_tier === 3);
  ok('B6 the vendor kind matched its record type BY NAME at census time; the others are unassociated', vendor.record_type && vendor.record_type.id === rtVendor.id && vendor.match_basis === 'by_name' && !notes.record_type && !meters.record_type);
  ok('B7 without a field redaction template the rendered record shows the non-id values in one sentence — and never renders ids (invoice id, tax id) at all', vendor.redaction === 'no_field_template' && /^kc vendor invoices/i.test(vendor.rendered.text) && vendor.rendered.text.indexOf('Halff Associates') !== -1 && vendor.rendered.text.indexOf('12400') !== -1 && vendor.rendered.text.indexOf('INV-004512') === -1 && vendor.rendered.text.indexOf('74-1234567') === -1);

  console.log('\n=== C. A FIELD REDACTION TEMPLATE withholds values BEFORE the render ===');
  var tpl = await api('POST', '/redaction-templates', { name: 'KC vendor name ' + TAG, kind: 'fields', record_type_id: rtVendor.id, field_map: [{ field: 'vendor_name' }] });
  ok('C1 a field redaction template (kind fields) is created for the vendor type', tpl.status === 200 || tpl.status === 201);
  inv = (await api('GET', '/repositories/' + repoId + '/inventory')).body; vendor = inv.kinds.find(function (k) { return k.key === kindName; });
  ok('C2 the kind now reports the template ready and names the withheld field', vendor.redaction === 'field_template_ready' && vendor.field_template && vendor.field_template.withheld.indexOf('vendor_name') !== -1 && inv.totals.field_templates === 1);
  ok('C3 the rendered record blacks out the withheld value and keeps the rest', vendor.rendered.text.indexOf('Halff Associates') === -1 && vendor.rendered.text.indexOf('████') !== -1 && vendor.rendered.text.indexOf('12400') !== -1 && vendor.rendered.parts.some(function (p) { return p.withheld && p.value === null; }));

  console.log('\n=== D. ASSOCIATION BY HAND, AND A REFRESH THAT KEEPS IT ===');
  var as1 = await api('POST', '/repositories/' + repoId + '/kinds/' + meters.id + '/associate', { record_type_id: rtOther.id });
  var link = await db.get('SELECT 1 AS ok FROM record_type_repositories WHERE record_type_id = ? AND repository_id = ?', [rtOther.id, repoId]);
  inv = (await api('GET', '/repositories/' + repoId + '/inventory')).body; meters = inv.kinds.find(function (k) { return /meter_reads/.test(k.key); });
  ok('D1 associating a kind by hand records by_hand and links the type to this source', as1.status === 200 && meters.record_type && meters.record_type.id === rtOther.id && meters.match_basis === 'by_hand' && !!link);
  var bad = await api('POST', '/repositories/' + repoId + '/kinds/' + meters.id + '/associate', { record_type_id: 'rt-nope' });
  ok('D2 an unknown type is refused (422)', bad.status === 422);
  var vendorId = vendor.id, metersId = meters.id;
  await api('POST', '/repositories/' + repoId + '/census'); await censusDone(repoId);
  inv = (await api('GET', '/repositories/' + repoId + '/inventory')).body; vendor = inv.kinds.find(function (k) { return k.key === kindName; }); meters = inv.kinds.find(function (k) { return /meter_reads/.test(k.key); });
  ok('D3 a refresh keeps kind ids and the hand-made association; 3 kept, 0 new', vendor.id === vendorId && meters.id === metersId && meters.record_type.id === rtOther.id && inv.census.last.kept_files === 3 && inv.census.last.new_files === 0);
  var un = await api('DELETE', '/repositories/' + repoId + '/kinds/' + metersId + '/associate');
  inv = (await api('GET', '/repositories/' + repoId + '/inventory')).body; meters = inv.kinds.find(function (k) { return /meter_reads/.test(k.key); });
  ok('D4 undo leaves the kind unassociated', un.status === 200 && !meters.record_type);

  console.log('\n=== E. THE SOURCES LIST and a search-only system ===');
  var list = (await api('GET', '/repositories')).body.repositories;
  var card = list.find(function (r) { return r.id === repoId; });
  ok('E1 the card carries kind=kinds and the last run (3 kinds)', card && card.census && card.census.kind === 'kinds' && card.census.last && card.census.last.groupings_count === 3);
  var lf = await db.get("SELECT * FROM record_repositories WHERE connector_type = 'laserfiche' LIMIT 1");
  ok('E2 a search-only connector is still honestly not censusable', !lf || SC.availability(lf).available === false);

  console.log('\n=== F. LEAVE THE WORLD AS FOUND ===');
  if (tpl.body && tpl.body.template) await db.run('DELETE FROM layout_profiles WHERE id = ?', [tpl.body.template.id]); else await db.run("DELETE FROM layout_profiles WHERE name = ?", ['KC vendor name ' + TAG]);
  await db.run('DELETE FROM census_kinds WHERE repository_id = ?', [repoId]);
  await db.run('DELETE FROM source_census_runs WHERE repository_id = ?', [repoId]);
  await db.run('DELETE FROM record_type_repositories WHERE repository_id = ?', [repoId]);
  await db.run('DELETE FROM record_repositories WHERE id = ?', [repoId]);
  for (var idd of [rtVendor.id, rtOther.id]) { await api('DELETE', '/taxonomy/record-types/' + idd); }
  fs.unlinkSync(def);
  var l1 = await db.get("SELECT count(*)::int AS n FROM record_types WHERE code LIKE '%' || ?", [TAG]);
  var l2 = await db.get('SELECT count(*)::int AS n FROM census_kinds WHERE repository_id = ?', [repoId]);
  ok('F1 all fixture rows and files are gone', Number(l1.n) === 0 && Number(l2.n) === 0);

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
