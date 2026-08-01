'use strict';
// IDENTITY ANCHORS (2026-08-01) — the producers the ledger was waiting for.
//
// WS5 shipped class A of the requestor ledger and then proved it INERT on live: the product wrote none
// of the three identity anchors. The portal's "verified" buttons are requester self-assertions, the
// wizard's 'link' claim was an unprovable string in a public POST body, and identity_confirmed was a
// column that did not exist. This harness pins the two producers that now exist, and — just as
// important — that every UNTRUSTED path still anchors NOTHING:
//   1. Server-derived email trust: requestCreate consults email_verifications for the CLICK; the client
//      claim is never believed. 'link_clicked' cannot arrive from a client.
//   2. The staff-confirmed act is PERSISTED with an author, at create time and as a later act over HTTP,
//      and re-resolution reads the persisted fact (the old in-memory-only pass lost it).
//   3. Anonymous stays anonymous: no token, an unclicked token, someone else's token, or a bare claim
//      all leave the request unanchored — "no affirmative identity anchor" recorded, nothing gated.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
require(__dirname + '/testEnv').enforce(); // refuses to run against a non-test DB
var http = require('http');
var crypto = require('crypto');
var db = require('/opt/optimumq/backend/src/db');
var RL = require('/opt/optimumq/backend/src/services/requestorLedger');
var RC = require('/opt/optimumq/backend/src/services/requestCreate');
var auth = require('/opt/optimumq/backend/src/services/auth');
var uuidv4 = require('uuid').v4;

var PORT = Number(process.env.API_PORT) || 3101;
var TAG = 'ANCHOR-' + Date.now();
var MAIL = '@anchor-harness.example.com';
var pass = 0, fail = 0, TOKEN = null;
function ok(l, c) { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l); }

function req(method, p, body, token) {
  return new Promise(function (res, rej) {
    var payload = body ? JSON.stringify(body) : null;
    var r = http.request({ host: 'localhost', port: PORT, path: p, method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || TOKEN) } }, function (resp) {
      var d = ''; resp.on('data', function (c) { d += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} res({ status: resp.statusCode, body: j, raw: d }); });
    });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}

var tokens = [];
// A verification row in a chosen state — the states the PUBLIC routes produce, minted directly so this
// harness tests the TRUST decision, not the mail transport.
async function mkToken(email, opts) {
  opts = opts || {};
  var t = crypto.randomBytes(16).toString('hex');
  var exp = new Date(Date.now() + (opts.expired ? -60000 : 30 * 60000)).toISOString();
  await db.run('INSERT INTO email_verifications (token, email, expires_at) VALUES (?,?,?)', [t, email, exp]);
  if (opts.clicked) await db.run("UPDATE email_verifications SET verified_at = datetime('now') WHERE token = ?", [t]);
  tokens.push(t);
  return t;
}

var created = [], profiles = [];
async function make(fields, opts) {
  var made = await RC.createRequest(Object.assign({
    requestorName: 'Anchor Harness', description: 'anchor harness ' + TAG
  }, fields), Object.assign({ actorName: 'City Clerk', kickIntake: false, startClocks: false }, opts || {}));
  created.push(made.parentId, made.childId);
  return made;
}
async function linkOf(id) { return await db.get('SELECT profile_id, identity_basis, reason FROM requestor_request_links WHERE request_id = ?', [id]); }
async function reqRow(id) { return await db.get('SELECT email_verification_method, identity_confirmed, identity_confirmed_by, identity_confirmed_at FROM requests WHERE id = ?', [id]); }
async function historyOf(id, action) { return await db.all('SELECT * FROM request_history WHERE request_id = ? AND action = ?', [id, action]); }
function noteProfile(link) { if (link && link.profile_id && profiles.indexOf(link.profile_id) < 0) profiles.push(link.profile_id); }

(async function () {
  await db.initDb();
  try {
    var users = await db.all("SELECT * FROM users WHERE status = 'active' ORDER BY id LIMIT 1");
    TOKEN = await auth.signAccessToken(users[0]);

    // ================================================================================================
    console.log('\n=== A. THE TRUSTED SET — what counts as verified, and what never can ===');
    ok('A1 VERIFIED_EMAIL_METHODS is exactly {staff_verified, link_clicked}',
      RL.VERIFIED_EMAIL_METHODS.length === 2 &&
      RL.VERIFIED_EMAIL_METHODS.indexOf('staff_verified') >= 0 && RL.VERIFIED_EMAIL_METHODS.indexOf('link_clicked') >= 0);
    ok('A2 link_clicked anchors as verified_email',
      (RL.anchorFor({ requestor_email: 'a' + MAIL, email_verification_method: 'link_clicked' }) || {}).basis === 'verified_email');
    ok('A3 the client-claimable strings are all worthless: link, attested, visual',
      ['link', 'attested', 'visual'].every(function (m) {
        return RL.anchorFor({ requestor_email: 'a' + MAIL, email_verification_method: m }) === null;
      }));

    // ================================================================================================
    console.log('\n=== B. SERVER-DERIVED TRUST AT CREATE — the token is consulted, the claim is not ===');
    var em1 = 'clicked' + MAIL;
    var t1 = await mkToken(em1, { clicked: true });
    var b1 = await make({ requestorEmail: em1, emailVerificationToken: t1 });
    var r1 = await reqRow(b1.childId), r1p = await reqRow(b1.parentId);
    ok('B1 a clicked token whose email matches stores link_clicked — on child AND parent',
      r1.email_verification_method === 'link_clicked' && r1p.email_verification_method === 'link_clicked');
    var l1 = await linkOf(b1.childId); noteProfile(l1);
    ok('B1b ...and the request is ANCHORED as verified_email, with a profile minted',
      !!l1 && !!l1.profile_id && l1.identity_basis === 'verified_email');
    ok('B1c ...with the EMAIL_VERIFIED history row at the citizen level (the parent)',
      (await historyOf(b1.parentId, 'EMAIL_VERIFIED')).length === 1);

    var b2 = await make({ requestorEmail: 'claimant' + MAIL, emailVerificationMethod: 'link_clicked' });
    var r2 = await reqRow(b2.childId);
    var l2 = await linkOf(b2.childId); noteProfile(l2);
    ok('B2 CLAIMING link_clicked without a token stores NOTHING — the value cannot arrive from a client',
      r2.email_verification_method === null && !!l2 && l2.profile_id === null);
    ok('B2b ...and the anonymity is recorded as the reason', /no affirmative identity anchor/.test(l2.reason || ''));

    var em3 = 'unclicked' + MAIL;
    var t3 = await mkToken(em3, { clicked: false });
    var b3 = await make({ requestorEmail: em3, emailVerificationToken: t3 });
    ok('B3 an UNCLICKED token proves nothing', (await reqRow(b3.childId)).email_verification_method === null);

    var t4 = await mkToken('somebody-else' + MAIL, { clicked: true });
    var b4 = await make({ requestorEmail: 'not-them' + MAIL, emailVerificationToken: t4 });
    var l4 = await linkOf(b4.childId); noteProfile(l4);
    ok('B4 a clicked token for a DIFFERENT address proves nothing about this one',
      (await reqRow(b4.childId)).email_verification_method === null && l4.profile_id === null);

    var b5 = await make({ requestorEmail: 'garbage' + MAIL, emailVerificationToken: 'no-such-token' });
    ok('B5 a token nobody issued is a quiet null, not a crash', (await reqRow(b5.childId)).email_verification_method === null);

    var em6 = 'Mixed.Case' + MAIL;
    var t6 = await mkToken(em6.toUpperCase(), { clicked: true });
    var b6 = await make({ requestorEmail: em6.toLowerCase(), emailVerificationToken: t6 });
    var l6 = await linkOf(b6.childId); noteProfile(l6);
    ok('B6 the email match is case-insensitive (an inbox is)', (await reqRow(b6.childId)).email_verification_method === 'link_clicked');

    var b7 = await make({ requestorEmail: em1, emailVerificationToken: t1 });
    var l7 = await linkOf(b7.childId);
    ok('B7 a second verified request from the same address joins the SAME profile',
      !!l7 && l7.profile_id === l1.profile_id);

    // ================================================================================================
    console.log('\n=== C. THE CLICK ITSELF — the public verify route is the only writer of verified_at ===');
    var em8 = 'clicks-live' + MAIL;
    var t8 = await mkToken(em8, { clicked: false });
    var c1 = await req('GET', '/api/public/verify/' + t8);
    var row8 = await db.get('SELECT verified_at FROM email_verifications WHERE token = ?', [t8]);
    ok('C1 clicking the link records the click', c1.status === 200 && !!row8.verified_at);
    var b8 = await make({ requestorEmail: em8, emailVerificationToken: t8 });
    var l8 = await linkOf(b8.childId); noteProfile(l8);
    ok('C1b ...and the clicked token now anchors a submission', (await reqRow(b8.childId)).email_verification_method === 'link_clicked');

    var t9 = await mkToken('too-late' + MAIL, { clicked: false, expired: true });
    var c2 = await req('GET', '/api/public/verify/' + t9);
    var row9 = await db.get('SELECT verified_at FROM email_verifications WHERE token = ?', [t9]);
    ok('C2 an EXPIRED link refuses the click (410) and records nothing', c2.status === 410 && !row9.verified_at);

    // ================================================================================================
    console.log('\n=== D. STAFF-CONFIRMED — a persisted act with an author, not an in-memory pass ===');
    var d1 = await make({ requestorEmail: 'walkin' + MAIL }, { identityConfirmed: true, actorName: 'Front Desk' });
    var dr = await reqRow(d1.childId), drp = await reqRow(d1.parentId);
    ok('D1 the act is persisted on child AND parent, with the author\'s name',
      dr.identity_confirmed === 1 && drp.identity_confirmed === 1 &&
      dr.identity_confirmed_by === 'Front Desk' && !!dr.identity_confirmed_at);
    var dl = await linkOf(d1.childId); noteProfile(dl);
    ok('D1b ...and anchors as staff_confirmed', !!dl && !!dl.profile_id && dl.identity_basis === 'staff_confirmed');
    ok('D1c ...with the IDENTITY_CONFIRMED history row at the citizen level',
      (await historyOf(d1.parentId, 'IDENTITY_CONFIRMED')).length === 1);

    await db.run('DELETE FROM requestor_request_links WHERE request_id = ?', [d1.childId]);
    var resolved = await RL.profileForRequest(d1.childId);
    ok('D2 re-resolution reads the PERSISTED fact — a lost link row still finds the profile ' +
       '(before this build the fact lived only in memory and this returned null)',
      resolved === dl.profile_id);

    // ================================================================================================
    console.log('\n=== E. THE HTTP SURFACES — create-with-checkbox, the later act, and the read ===');
    var e1 = await req('POST', '/api/requests', {
      requestorName: 'Anchor Harness', requestorEmail: 'counter' + MAIL,
      description: 'anchor harness http ' + TAG, identityConfirmed: true
    });
    ok('E1 staff create with the checkbox returns 201', e1.status === 201 && !!e1.body.requestId);
    if (e1.body && e1.body.requestId) {
      var e1row = await db.get('SELECT id, master_request_id FROM requests WHERE id = ?', [e1.body.requestId]);
      created.push(e1row.id); if (e1row.master_request_id) created.push(e1row.master_request_id);
      var e1l = await linkOf(e1row.id); noteProfile(e1l);
      ok('E1b ...and the request is anchored staff_confirmed under the creating staffer',
        !!e1l && !!e1l.profile_id && e1l.identity_basis === 'staff_confirmed' &&
        (await reqRow(e1row.id)).identity_confirmed_by === users[0].display_name);
    }

    var e2 = await make({ requestorEmail: 'later' + MAIL }); // anonymous at create
    var e2before = await req('GET', '/api/requests/' + e2.childId + '/identity');
    ok('E2 the identity read on an anonymous request says so honestly',
      e2before.status === 200 && e2before.body.identityConfirmed === false && e2before.body.anchor.basis === null);
    var e2act = await req('POST', '/api/requests/' + e2.childId + '/confirm-identity', { note: 'came to pay in person' });
    ok('E3 the later confirm act succeeds and reports its anchor',
      e2act.status === 200 && e2act.body.identityConfirmed === true &&
      !!e2act.body.anchor && e2act.body.anchor.basis === 'staff_confirmed');
    var e2p = await reqRow(e2.parentId);
    ok('E3b ...marking the WHOLE cluster — addressed by child, the parent is marked too',
      e2p.identity_confirmed === 1 && !!e2p.identity_confirmed_by);
    ok('E3c ...with one IDENTITY_CONFIRMED history row on the parent, carrying the note',
      (await historyOf(e2.parentId, 'IDENTITY_CONFIRMED')).some(function (h) { return /came to pay in person/.test(h.notes || ''); }));
    var e2after = await req('GET', '/api/requests/' + e2.childId + '/identity');
    noteProfile(e2after.body && e2after.body.anchor && { profile_id: e2after.body.anchor.profileId });
    ok('E4 the identity read now shows the anchor and its author',
      e2after.body.identityConfirmed === true && e2after.body.anchor.basis === 'staff_confirmed' && !!e2after.body.anchor.profileId);
    var e5 = await req('POST', '/api/requests/no-such-request/confirm-identity', {});
    ok('E5 confirming a request that does not exist is a 404, not an act', e5.status === 404);

  } catch (e) {
    console.error('HARNESS ERROR', e && e.stack);
    fail++;
  } finally {
    try {
      for (var tk = 0; tk < tokens.length; tk++) { try { await db.run('DELETE FROM email_verifications WHERE token = ?', [tokens[tk]]); } catch (e) {} }
      for (var p = 0; p < profiles.length; p++) {
        if (!profiles[p]) continue;
        for (var tb of ['requestor_ledger_events', 'requestor_allowances', 'requestor_counters', 'requestor_flags', 'requestor_request_links']) {
          try { await db.run('DELETE FROM ' + tb + ' WHERE profile_id = ?', [profiles[p]]); } catch (e) {}
        }
        try { await db.run('DELETE FROM requestor_profiles WHERE id = ?', [profiles[p]]); } catch (e) {}
      }
      var tabs = await db.all("SELECT table_name FROM information_schema.columns WHERE column_name='request_id'");
      for (var t2 = 0; t2 < tabs.length; t2++) for (var c = 0; c < created.length; c++) {
        if (!created[c]) continue;
        try { await db.run('DELETE FROM ' + tabs[t2].table_name + ' WHERE request_id=?', [created[c]]); } catch (e) {}
      }
      for (var c2 = 0; c2 < created.length; c2++) { if (created[c2]) { try { await db.run('DELETE FROM requests WHERE id=?', [created[c2]]); } catch (e) {} } }
      var left = await db.get('SELECT COUNT(*)::int AS n FROM requests WHERE requestor_email LIKE ?', ['%' + MAIL]);
      ok('cleanup: 0 harness requests left', Number(left.n) === 0);
      var leftP = await db.get('SELECT COUNT(*)::int AS n FROM requestor_profiles WHERE primary_email LIKE ?', ['%' + MAIL]);
      ok('cleanup: 0 harness profiles left', Number(leftP.n) === 0);
      var leftT = await db.get('SELECT COUNT(*)::int AS n FROM email_verifications WHERE email LIKE ?', ['%' + MAIL]);
      ok('cleanup: 0 harness verification tokens left', Number(leftT.n) === 0);
    } catch (e) { console.error('CLEANUP ERR', e && e.message); fail++; }
  }
  console.log('\n' + pass + '/' + (pass + fail) + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
