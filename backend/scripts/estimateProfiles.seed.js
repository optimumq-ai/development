// EXPERT SEEDS for the top ~10 record types (BUILD_PRIORITY_SUMMARY Tier 1 #3).
//
// WHAT A PROFILE IS. Per FEE_ESTIMATE_KNOWLEDGE §7d/§7e: a human expert seeds the record-type PROFILE ONCE
// -- not an estimate per request. Every future request of that type auto-estimates from the seed. Profiles
// store QUANTITIES (search hours, review hours, pages), never dollars, so the same seed stays correct when a
// city changes its rates and is portable to a city with different ones. The city's fee config prices them.
//
// A profile is a DEFAULT, not a verdict. Safeguards (§7f): it is overridable per request for known atypicals,
// it is reconciled against actuals at delivery, and `recordActuals` folds every completed request back in --
// so these numbers self-correct as the city does real work. `assess()` still routes anything over $200 to a
// human regardless of confidence.
//
// ⚠ PROVENANCE — READ THIS BEFORE TRUSTING THE NUMBERS.
// `seedProfile` stamps source='human-expert'. THE EXPERT HERE WAS NOT A RECORDS CLERK. These are provisional
// defaults derived from the record types' own definitions and § 7d's worked example, and they are stamped as
// such in each profile's `notes`. They are calibrated to be PLAUSIBLE, not authoritative. A city's actual
// clerk should confirm them -- which is cheap, because it is ten numbers reviewed once, and because the
// historical write-back corrects them over time either way.
//
// Idempotent: re-running overwrites the seed (PUT), which is the point -- edit a number here and re-run.
require('dotenv').config();
var db = require('../src/db');
var auth = require('../src/services/auth');
var http = require('http');

var PORT = Number(process.env.PORT) || 3001;

// One TYPICAL record of each type. Ordered by real-world request frequency: the police block first (it is
// the bulk of what any city fields), then the high-volume clerk/permit types.
var SEEDS = [
  { id: 'rt-incident-reports', q: { searchHours: 0.25, reviewHours: 0.5, bwPages: 8 },
    note: 'Typical single offense/incident report: a short records-system lookup, a redaction pass for victim/witness PII, ~8 pages.' },

  { id: 'rt-crash-reports', q: { searchHours: 0.1, reviewHours: 0.1, bwPages: 3 },
    note: 'TX CR-3 crash report: a standard form pulled by date/location. Little discretion, minimal redaction.' },

  { id: 'rt-arrest-booking', q: { searchHours: 0.25, reviewHours: 0.5, bwPages: 6 },
    note: 'Arrest/booking packet. Review is the real cost: criminal-history and juvenile material must be screened.' },

  { id: 'rt-citations', q: { searchHours: 0.1, reviewHours: 0.1, bwPages: 2 },
    note: 'A single citation. The cheapest thing a city produces; near-pure lookup.' },

  { id: 'rt-cad-logs', q: { searchHours: 0.25, reviewHours: 0.25, bwPages: 5 },
    note: 'CAD/dispatch log for one call. Redaction is light but caller PII must be screened.' },

  { id: 'rt-911-recordings', q: { searchHours: 0.25, reviewHours: 1.0, bwPages: 0 },
    note: 'One 911 audio call. No pages — the cost is REVIEW: audio redaction is done listening in real time.' },

  { id: 'rt-police-video', q: { searchHours: 0.5, reviewHours: 4.0, bwPages: 0 },
    note: 'One body-worn-camera recording. Review dominates: video redaction runs slower than real time (faces, bystanders, minors). The single most expensive routine record a city holds.' },

  { id: 'rt-building-permits', q: { searchHours: 1.0, reviewHours: 0.5, bwPages: 3, oversizedPages: 20 },
    note: "Kevin's own worked example (FEE_ESTIMATE_KNOWLEDGE §7d): ~1 search hour, ~20 oversized blueprint pages, ~3 standard permit pages." },

  { id: 'rt-council-minutes', q: { searchHours: 0.25, reviewHours: 0, bwPages: 12 },
    note: 'Minutes for one meeting. ZERO review hours on purpose: this is already-public material, so there is nothing to redact.' },

  { id: 'rt-official-email', q: { searchHours: 2.0, reviewHours: 6.0, bwPages: 150 },
    note: 'THE LEAST RELIABLE SEED OF THE TEN, and deliberately so. Email volume is wildly request-dependent; §7 names it the type that wants a SCOPING SEARCH (hit count x avg pages), not a fixed seed. Treat this as a placeholder that a per-request override or the scoping search should displace.' }
];

function put(path, body, token) {
  return new Promise(function (res, rej) {
    var b = JSON.stringify(body);
    var r = http.request({ host: 'localhost', port: PORT, path: path, method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), Authorization: 'Bearer ' + token } },
      function (resp) { var d = ''; resp.on('data', function (c) { d += c; });
        resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j }); }); });
    r.on('error', rej); r.write(b); r.end();
  });
}

(async function () {
  await db.initDb();

  // Seed through the REAL write path (PUT /api/estimate-profiles/:id -> estimateProfile.seedProfile), not a
  // direct INSERT. Same rule as request seeding: never manufacture a row a real actor could not have made.
  var u = await db.get(
    "SELECT u.* FROM users u JOIN user_function_roles ufr ON ufr.user_id = u.id " +
    "JOIN function_roles fr ON fr.id = ufr.function_role_id " +
    "WHERE fr.name IN ('SYSTEM_ADMIN','DIRECTOR','SUPERVISOR') LIMIT 1");
  if (!u) throw new Error('No SYSTEM_ADMIN/DIRECTOR/SUPERVISOR user — the seed route requires one.');
  var token = await auth.signAccessToken(u);   // ASYNC. Forget the await and you store [object Promise].
  console.log('Seeding as: ' + u.display_name + '\n');

  var ep = require('../src/services/estimateProfile');
  var missing = [], done = 0;

  for (var s of SEEDS) {
    var rt = await db.get('SELECT id, name FROM record_types WHERE id = ?', [s.id]);
    if (!rt) { missing.push(s.id); continue; }

    var r = await put('/api/estimate-profiles/' + s.id, {
      quantities: s.q,
      notes: 'PROVISIONAL — seeded by assistant 2026-07-14, NOT confirmed by a records clerk. ' + s.note
    }, token);
    if (r.status !== 200) { console.log('  FAILED ' + s.id + ' -> HTTP ' + r.status + ' ' + JSON.stringify(r.body)); continue; }
    done++;

    var a = await ep.assess(s.id);
    var q = Object.keys(s.q).filter(function (k) { return s.q[k]; }).map(function (k) { return k + '=' + s.q[k]; }).join(' ');
    console.log('  ' + rt.name.padEnd(30).slice(0, 30) +
      (a.decision === 'automated' ? 'AUTOMATED' : 'manual   ') +
      '  $' + (a.estimatedTotal == null ? '—' : Number(a.estimatedTotal).toFixed(2)).padStart(7) +
      (Number(a.depositDue) > 0 ? '  deposit $' + Number(a.depositDue).toFixed(2) : '') +
      '\n      ' + q);
  }

  console.log('\n' + done + ' profile(s) seeded.');
  if (missing.length) console.log('MISSING record types (not seeded): ' + missing.join(', '));
  process.exit(missing.length ? 1 : 0);
})().catch(function (e) { console.error('ERROR', e.message); process.exit(1); });
