'use strict';
// EXTERNAL-CONTRIBUTOR SECURE LINKS (2026-08-01) — the substrate BW6 refused to fake.
//
// The MRR hub lets a Request Manager hand an activity (search / estimate data / redaction) to someone
// OUTSIDE the system — a records custodian at another agency, an outside counsel — by email address.
// BW6 stored the address and rendered a labelled placeholder, because inventing a link state without a
// token substrate would have been a lie on the bar. This is the substrate.
//
// ══ THE SECURITY SHAPE ══
//
//   * The RAW TOKEN exists in exactly two places: the emailed URL, and (once, at issue) the response to
//     the staff screen so the RM can copy it when the city has no mail provider configured. The database
//     holds a sha256 HASH — a database read cannot mint a working link.
//   * "Single-use" (standing design, Draft 5 §2) is read as SINGLE-ASSIGNMENT, not single-click: exactly
//     one ACTIVE link per (item, activity); re-issuing supersedes the old one; reassigning the activity
//     to a person revokes it; completing closes it. The link itself is multi-visit until then, because
//     the contributor's page authenticates its own uploads and notes with the token — a literally
//     once-consumed token would strand the page mid-upload. Every open is counted and timestamped.
//   * The PAYLOAD is scoped to the assignment: the item's verbatim description, the activity asked, the
//     request number, the agency, and the Request Manager's name. No requestor identity, no money, no
//     other items. One-voice (Draft 5): the contributor is given the RM's mailbox, never the requestor's.
//   * Refusals do not narrate: an unknown token is 404; expired/revoked is 410 with a sentence that says
//     to contact the person who sent it. A completed link keeps answering 200 with a thanks page —
//     "your part is done" is not an error.
//
// ══ WHAT COMPLETION DOES ══
//
// mrrHub.completeActivity with basis 'external' — the same one-way door the assignee path uses, which
// means the design's core rule holds for free: an external completion updates the hub and ADVANCES NO
// STAGE. The RM orchestrates; the contributor contributes.
var crypto = require('crypto');
var db = require('../db');
var get = db.get, all = db.all, run = db.run;
var uuidv4 = require('uuid').v4;

var EXPIRY_DAYS = 14;
var ACTIVITY_NAME = { search: 'Record Search', estimate: 'Estimate data', redaction: 'Redaction' };

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function hash(token) { return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex'); }
function s(v) { return String(v == null ? '' : v).trim(); }

// Derived, never stored: the stored status only knows what an ACT changed (active/revoked/completed);
// expiry is a fact about the clock and is answered at read time so a row cannot go stale.
function stateOf(row) {
  if (!row) return null;
  if (row.status === 'completed') return 'completed';
  if (row.status === 'revoked') return 'revoked';
  if (row.expires_at && new Date(row.expires_at + 'Z') < new Date()) return 'expired';
  return Number(row.open_count) > 0 ? 'opened' : 'sent';
}

// NEVER FROM A TEST RUN — the coverageGap rule. The test database is a clone shape of live config, and a
// harness that emails a real records custodian about a fabricated item is exactly the leak testEnv cannot
// stop. The DATABASE_URL is the tell.
function mailAllowed() {
  return !/_test(\?|$)|_test\//.test(String(process.env.DATABASE_URL || ''));
}

// Issue (or re-issue) the link for an (item, activity) assignment. Any previously active link is
// SUPERSEDED — one active link per assignment, always.
async function issue(childId, activity, email, opts) {
  opts = opts || {};
  email = s(email).toLowerCase();
  if (!email) { var e = new Error('An external link needs the contributor’s email.'); e.status = 422; throw e; }
  await run("UPDATE mrr_external_links SET status = 'revoked', revoked_at = ?, revoked_by = ? " +
    "WHERE request_id = ? AND activity = ? AND status = 'active'",
    [nowStr(), 'superseded by re-issue', childId, activity]);

  var token = crypto.randomBytes(32).toString('hex');
  var expires = new Date(Date.now() + EXPIRY_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await run('INSERT INTO mrr_external_links (id, request_id, activity, email, token_hash, status, created_by, created_by_name, created_at, expires_at) ' +
    "VALUES (?,?,?,?,?,'active',?,?,?,?)",
    ['xl-' + uuidv4().slice(0, 12), childId, activity, email, hash(token),
     opts.actorId || null, opts.actorName || null, nowStr(), expires]);

  var url = (s(opts.baseUrl) || '') + '/contribute/' + token;
  var mail = { sent: false, reason: 'not_attempted' };
  if (opts.send !== false && mailAllowed()) {
    try {
      var emailSvc = require('./email');
      var child = await get('SELECT description, request_number FROM requests WHERE id = ?', [childId]);
      var agency = (await get("SELECT value FROM system_config WHERE key = 'agency_name'") || {}).value || 'Public Records';
      var body = '<h2 style="margin:0 0 10px;color:#1F4E79;font-size:18px">You have been asked to help with a records request</h2>' +
        '<p style="font-size:14px;color:#374151;line-height:1.5">' + agency + ' asks for your help with <strong>' +
        (ACTIVITY_NAME[activity] || activity) + '</strong> on request <strong>' + (child ? child.request_number : '') + '</strong>.</p>' +
        '<div style="text-align:center;margin:24px 0"><a href="' + url + '" style="display:inline-block;background:#1F4E79;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Open the secure page</a></div>' +
        '<p style="font-size:12px;color:#6B7280">The link works for ' + EXPIRY_DAYS + ' days and is only for you. ' +
        'If the button does not work, copy this address:<br/><span style="color:#1F4E79;word-break:break-all">' + url + '</span></p>';
      mail = await emailSvc.send({ to: email, subject: 'Records request ' + (child ? child.request_number : '') + ' — your help is requested',
        text: 'Open the secure page to help with ' + (ACTIVITY_NAME[activity] || activity) + ': ' + url + ' (valid ' + EXPIRY_DAYS + ' days)',
        html: emailSvc.template ? emailSvc.template(body, agency) : body });
    } catch (e) { mail = { sent: false, reason: 'error', error: e.message }; }
  } else if (!mailAllowed()) {
    mail = { sent: false, reason: 'test_db' };
  }
  return { url: url, email: email, expiresAt: expires, linkState: 'sent', mail: mail };
}

// The link state for an (item, activity), for the bar and the child view. Never the token.
async function stateFor(childId, activity) {
  var row = await get('SELECT * FROM mrr_external_links WHERE request_id = ? AND activity = ? ' +
    'ORDER BY created_at DESC, id DESC LIMIT 1', [childId, activity]);
  if (!row) return null;
  return { email: row.email, linkState: stateOf(row), expiresAt: row.expires_at,
    firstOpenedAt: row.first_opened_at, lastOpenedAt: row.last_opened_at, openCount: Number(row.open_count) || 0,
    completedAt: row.completed_at, revokedAt: row.revoked_at, revokedBy: row.revoked_by };
}

async function revoke(childId, activity, opts) {
  opts = opts || {};
  await run("UPDATE mrr_external_links SET status = 'revoked', revoked_at = ?, revoked_by = ? " +
    "WHERE request_id = ? AND activity = ? AND status = 'active'",
    [nowStr(), opts.actorName || 'staff', childId, activity]);
  return await stateFor(childId, activity);
}

// Resolve a raw token to its row. The caller decides what each state renders; this only answers.
async function resolve(token) {
  if (!token || typeof token !== 'string') return null;
  return await get('SELECT * FROM mrr_external_links WHERE token_hash = ?', [hash(token)]);
}

// The contributor opened the page. Counted on every open — "was the link ever used" is a question the
// RM asks, and the bar answers it from these fields.
async function recordOpen(row) {
  await run('UPDATE mrr_external_links SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = ? WHERE id = ?',
    [nowStr(), nowStr(), row.id]);
}

// The SCOPED payload — the assignment and nothing else. No requestor identity, no money, no siblings.
async function payload(row) {
  var child = await get('SELECT id, request_number, description, master_request_id FROM requests WHERE id = ?', [row.request_id]);
  var agency = (await get("SELECT value FROM system_config WHERE key = 'agency_name'") || {}).value || 'Public Records';
  var rm = null;
  if (child && child.master_request_id) {
    var t = await get("SELECT assigned_to FROM tasks WHERE request_id = ? AND type = 'mrr_management' AND status NOT IN ('done','cancelled') ORDER BY created_at DESC LIMIT 1", [child.master_request_id]);
    if (t && t.assigned_to) {
      var u = await get('SELECT display_name, email FROM users WHERE id = ?', [t.assigned_to]);
      if (u) rm = { name: u.display_name, email: u.email };
    }
  }
  if (!rm && row.created_by_name) rm = { name: row.created_by_name, email: null };
  // Only THEIR OWN uploads — the marker is the uploader identity this substrate writes.
  var files = await all('SELECT id, original_name, size, uploaded_at FROM request_files WHERE request_id = ? AND uploaded_by = ? ORDER BY uploaded_at', [row.request_id, uploader(row)]);
  return {
    agency: agency,
    requestNumber: child ? child.request_number : null,
    activity: row.activity, activityName: ACTIVITY_NAME[row.activity] || row.activity,
    // VERBATIM (§0b). The contributor answers the requestor's own words, not a summary of them.
    description: child ? child.description : null,
    requestManager: rm,
    linkState: stateOf(row), expiresAt: row.expires_at, completedAt: row.completed_at,
    yourUploads: files.map(function (f) { return { id: f.id, name: f.original_name, size: f.size, at: f.uploaded_at }; })
  };
}

function uploader(row) { return 'external: ' + row.email; }

// A note from the contributor: recorded on the item's history, attributed to the external address.
// One voice is preserved — this reaches the RM's screens, never the requestor.
async function addNote(row, note) {
  note = s(note);
  if (!note) { var e = new Error('Write the note first.'); e.status = 422; throw e; }
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, created_at) VALUES (?,?,?,?,?,?,?)',
    [uuidv4(), row.request_id, null, row.email + ' (external)', 'MRR_EXTERNAL_NOTE',
     'Note from the external contributor on ' + (ACTIVITY_NAME[row.activity] || row.activity) + ': ' + note, nowStr()]);
  return { recorded: true };
}

// The contributor says their part is done. Through the SAME door the assignee path uses — the hub
// updates, no stage moves — then the link closes: a completed assignment has nothing left to open.
async function complete(row, note) {
  var MH = require('./mrrHub');
  var acts = await MH.completeActivity(row.request_id, row.activity, {
    actorName: row.email + ' (external)', basis: 'external', note: s(note) || null
  });
  await run("UPDATE mrr_external_links SET status = 'completed', completed_at = ? WHERE id = ?", [nowStr(), row.id]);
  return acts;
}

module.exports = {
  EXPIRY_DAYS: EXPIRY_DAYS,
  issue: issue, stateFor: stateFor, revoke: revoke, resolve: resolve,
  recordOpen: recordOpen, payload: payload, addNote: addNote, complete: complete,
  uploader: uploader, stateOf: stateOf
};
