'use strict';
// THE STATUTORY BOUNDS GATE. A fee config that contradicts state law must be REFUSED at save time,
// whatever screen (or AI extraction) tried to save it — and the refusal must be the same for a hand
// edit and a machine-proposed value. Data: src/data/state_fee_bounds.json, generated from the
// verified 32-state fee layer (1,120 verified cells, 0 refuted).
//
//   A. The PURE check. feeBounds.check() against known bounds: the live TX profile is lawful and
//      passes clean; an over-ceiling rate is named with its citation; graduated tiers are checked
//      band-by-band (a lawful base rate must not smuggle an unlawful tier past the gate); a
//      statute-set "fixed" figure is an AUTHORIZATION CEILING — a city may charge less, never more;
//      a floor bites from below; unknown states and non-numeric values pass through silently.
//   B. The API GATE. POST and PUT /api/fee-profiles refuse a violating config with 422 AND leave the
//      database untouched — a 422 that still wrote the row would be worse than no gate at all.
//      GET /fee-profiles/bounds serves the display copy of the same data.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var db = require('/opt/optimumq/backend/src/db');
var auth = require('/opt/optimumq/backend/src/services/auth');
var feeBounds = require('/opt/optimumq/backend/src/services/feeBounds');

var PORT = Number(process.env.API_PORT) || 3101;
var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

function req(method, p, body, token) {
  return new Promise(function (res, rej) {
    var payload = body ? JSON.stringify(body) : null;
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || TOKEN) } }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j }); });
    });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}

(async function () {
  await db.initDb();
  var createdId = null;
  try {
    console.log('\n=== A. THE PURE CHECK ===');

    // A1. The LIVE TX profile is lawful. This is the regression that matters most: if a bounds
    // regeneration ever drifts to where the city's real, in-use config reads as unlawful, the gate
    // would block every save on the fee screen. (Test DB is a clone of live, so the row is here.)
    var live = await db.get("SELECT config_json FROM fee_profiles WHERE id = 'feeprof-tx-fr-v1'");
    ok('A1 the live TX fee profile exists in the clone', !!live);
    var liveViol = live ? feeBounds.check(JSON.parse(live.config_json || '{}'), 'TX') : null;
    ok('A2 …and passes the TX bounds clean', !!liveViol && liveViol.length === 0);

    // A3. Over a ceiling is refused, with the citation carried into the message.
    var v = feeBounds.check({ duplication: { bw: { rate: 0.35 } } }, 'OK');
    ok('A3 OK bw copy rate 0.35 > $0.25 ceiling is a violation',
      v.length === 1 && v[0].path === 'duplication.bw.rate' && v[0].kind === 'ceiling' && v[0].allowed === 0.25 && v[0].entered === 0.35);
    ok('A4 …named in plain language with the statutory citation',
      v.length === 1 && /Above the state limit/.test(v[0].message) && !!v[0].citation);

    // A5. At the ceiling is lawful — the bound is a limit, not a target.
    ok('A5 OK bw rate exactly 0.25 passes', feeBounds.check({ duplication: { bw: { rate: 0.25 } } }, 'OK').length === 0);

    // A6. Graduated tiers: a lawful base rate must not smuggle an unlawful band past the gate.
    var vt = feeBounds.check({ duplication: { bw: { rate: 0.20, tiers: [{ upTo: 50, rate: 0.20 }, { rate: 0.40 }] } } }, 'OK');
    ok('A6 a tier band above the ceiling is caught even when the base rate is lawful',
      vt.length === 1 && vt[0].entered === 0.40 && vt[0].path === 'duplication.bw.rate');

    // A7. "fixed" is an authorization ceiling. TX statute sets overhead at 20% of the labor charge:
    // charging MORE than the statute authorizes is refused; the statutory figure itself, or less, is fine.
    var vf = feeBounds.check({ labor: { overheadPct: 25 } }, 'TX');
    ok('A7 TX overhead 25% > the statute-set 20% is refused (fixed = authorization ceiling)',
      vf.length === 1 && vf[0].kind === 'fixed' && /not authorized/.test(vf[0].message));
    ok('A8 …charging the statutory figure passes', feeBounds.check({ labor: { overheadPct: 20 } }, 'TX').length === 0);
    ok('A9 …charging LESS than the statutory figure passes (a city may under-charge)',
      feeBounds.check({ labor: { overheadPct: 10 } }, 'TX').length === 0);

    // A10. A floor bites from below: TN guarantees at least 1 free labor hour per request.
    var vfl = feeBounds.check({ requestRules: { freeLaborHours: 0.5 } }, 'TN');
    ok('A10 TN free labor hours 0.5 < the 1-hour statutory floor is refused',
      vfl.length === 1 && vfl[0].kind === 'floor' && /Below the state minimum/.test(vfl[0].message));

    // A11. Pass-throughs: unknown state, no config, non-numeric values ("actual" pricing).
    ok('A11 an unknown state code yields no violations (no bounds, no gate)',
      feeBounds.check({ duplication: { bw: { rate: 99 } } }, 'ZZ').length === 0);
    ok('A12 a non-numeric value ("actual") passes through — display-only bound',
      feeBounds.check({ duplication: { bw: { rate: 'actual' } } }, 'OK').length === 0);
    ok('A13 forState() serves TX and refuses to invent ZZ',
      !!feeBounds.forState('TX') && feeBounds.forState('zz') === null && feeBounds.forState(null) === null);

    console.log('\n=== B. THE API GATE (:%d) ===', PORT);
    var user = await db.get("SELECT * FROM users WHERE status = 'active' ORDER BY (CASE WHEN EXISTS (SELECT 1 FROM user_user_types x WHERE x.user_id = users.id AND x.user_type_id IN ('ut-oro_director','ut-oro_sysadmin')) THEN 0 WHEN EXISTS (SELECT 1 FROM user_user_types x WHERE x.user_id = users.id AND x.user_type_id IN ('ut-oro_supervisor','ut-team_manager','ut-team_supervisor')) THEN 1 WHEN EXISTS (SELECT 1 FROM user_user_types x WHERE x.user_id = users.id) THEN 2 ELSE 3 END), id LIMIT 1");   // v3: prefer a TYPED actor (office admin > supervisor > any type) — untyped accounts hold no claims
    TOKEN = await auth.signAccessToken(user);

    // B1/B2. The display endpoint: active jurisdiction by default, explicit jurisdiction on request.
    var rb = await req('GET', '/api/fee-profiles/bounds');
    ok('B1 GET /bounds serves the ACTIVE jurisdiction (TX) with a non-empty bound set',
      rb.status === 200 && rb.body && rb.body.code === 'TX' && rb.body.bounds && Object.keys(rb.body.bounds).length > 0);
    var rb2 = await req('GET', '/api/fee-profiles/bounds?jurisdiction_id=jur-ok');
    ok('B2 GET /bounds?jurisdiction_id=jur-ok serves OK',
      rb2.status === 200 && rb2.body && rb2.body.code === 'OK' && !!rb2.body.bounds);

    // B3. POST with an unlawful config: 422, violations named, AND no row written.
    var before = await db.get("SELECT COUNT(*)::int AS n FROM fee_profiles WHERE jurisdiction_id = 'jur-ok'");
    var rp = await req('POST', '/api/fee-profiles', {
      jurisdiction_id: 'jur-ok', context: 'FR', name: 'bounds harness — must be refused',
      config: { duplication: { bw: { rate: 0.35 } } },
    });
    ok('B3 POST with an over-ceiling rate is refused 422',
      rp.status === 422 && rp.body && Array.isArray(rp.body.violations) && rp.body.violations.length === 1);
    ok('B4 …the refusal names the state in plain language', rp.status === 422 && /contradict OK state law/.test(rp.body.error || ''));
    var after = await db.get("SELECT COUNT(*)::int AS n FROM fee_profiles WHERE jurisdiction_id = 'jur-ok'");
    ok('B5 …and NO row was written', before.n === after.n);

    // B6. A lawful config saves as a draft.
    var rc = await req('POST', '/api/fee-profiles', {
      jurisdiction_id: 'jur-ok', context: 'FR', name: 'bounds harness draft',
      config: { duplication: { bw: { rate: 0.25 } } },
    });
    ok('B6 POST with a lawful config creates a draft',
      rc.status === 200 && rc.body && rc.body.profile && rc.body.profile.status === 'draft');
    createdId = rc.body && rc.body.profile && rc.body.profile.id;

    // B7. PUT that turns the config unlawful is refused, and the stored config is untouched.
    var ru = await req('PUT', '/api/fee-profiles/' + createdId, { config: { duplication: { bw: { rate: 0.35 } } } });
    ok('B7 PUT with an over-ceiling rate is refused 422', ru.status === 422 && Array.isArray(ru.body.violations));
    var stored = await db.get('SELECT config_json FROM fee_profiles WHERE id = ?', [createdId]);
    ok('B8 …and the stored config is untouched', !!stored && JSON.parse(stored.config_json).duplication.bw.rate === 0.25);

    // B9. A lawful PUT still works — the gate refuses violations, not edits.
    var ru2 = await req('PUT', '/api/fee-profiles/' + createdId, { config: { duplication: { bw: { rate: 0.10 } } } });
    ok('B9 a lawful PUT saves', ru2.status === 200 && ru2.body.profile && ru2.body.profile.config.duplication.bw.rate === 0.10);

    // B10. Name/status-only PUT (no config posted) is NOT gated — you can rename a profile whose
    // state bounds later tightened without being forced to fix the config in the same breath.
    var ru3 = await req('PUT', '/api/fee-profiles/' + createdId, { name: 'bounds harness draft (renamed)' });
    ok('B10 a name-only PUT bypasses the gate (no config change to judge)', ru3.status === 200);
  } finally {
    try { if (createdId) await db.run('DELETE FROM fee_profiles WHERE id = ?', [createdId]); } catch (e) { console.error('CLEANUP ERR', e && e.message); }
  }

  console.log('\n  ' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
