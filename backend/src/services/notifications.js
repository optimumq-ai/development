// NOTIFICATION MODEL (Tasks spec §1-2; TASK_AND_NOTIFICATION_MODEL §2.2).
//
// A notification is an ad-hoc item that appears for a user — a description + a hyperlink to a screen, with NO
// completion UI and NO lifecycle. It is for heads-ups and passive "monitor/observe" prompts (e.g. "an import
// source has files with no redaction template — set one up"). It MUST NOT depend on a request_id: notifications
// are the request-independent counterpart to tasks, and they are what replaced the SYS-IMPORT pseudo-request.
//
// `context_type`/`context_id` are OPTIONAL and only used for grouping/dedupe (so a nightly import run does not
// stack an identical heads-up every time) — a notification never REQUIRES them to render or route.
'use strict';
const { all, get, run } = require('../db');
const { v4: uuidv4 } = require('uuid');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

// Create a notification for a user. If dedupe is on (default when context_id is given), an existing
// undismissed notification with the same (user_id, kind, context_id) is UPDATED in place instead of stacking a
// duplicate — the body/link refresh and it returns to unread. Returns the notification row.
async function emit(opts) {
  opts = opts || {};
  if (!opts.userId || !opts.title) throw new Error('notifications.emit requires userId and title');
  if (opts.kind && !require('./alertCatalog').known(opts.kind)) console.warn('[notifications] alert kind not in the catalogue (services/alertCatalog.js): ' + opts.kind + ' — add a plain-words entry so the Staff Alerts screen lists it');
  const dedupe = opts.dedupe !== false && opts.contextId != null;
  if (dedupe) {
    const existing = await get(
      "SELECT id FROM notifications WHERE user_id = ? AND kind IS NOT DISTINCT FROM ? AND context_id = ? AND dismissed_at IS NULL",
      [opts.userId, opts.kind || null, opts.contextId]);
    if (existing) {
      await run("UPDATE notifications SET title = ?, body = ?, link = ?, read_at = NULL, created_at = ? WHERE id = ?",
        [opts.title, opts.body || null, opts.link || null, nowStr(), existing.id]);
      return await get("SELECT * FROM notifications WHERE id = ?", [existing.id]);
    }
  }
  const id = 'ntf-' + uuidv4().slice(0, 12);
  await run(
    "INSERT INTO notifications (id, user_id, kind, title, body, link, context_type, context_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, opts.userId, opts.kind || null, opts.title, opts.body || null, opts.link || null, opts.contextType || null, opts.contextId != null ? String(opts.contextId) : null, opts.createdBy || 'system', nowStr()]);
  return await get("SELECT * FROM notifications WHERE id = ?", [id]);
}

// A user's notifications, newest first. Dismissed are hidden unless includeDismissed; read are included by
// default (the bell shows recent history) but can be filtered to unread only.
async function list(userId, o) {
  o = o || {};
  let sql = "SELECT * FROM notifications WHERE user_id = ?";
  if (!o.includeDismissed) sql += " AND dismissed_at IS NULL";
  if (o.unreadOnly) sql += " AND read_at IS NULL";
  sql += " ORDER BY created_at DESC LIMIT " + (Number(o.limit) > 0 ? Number(o.limit) : 100);
  return await all(sql, [userId]);
}

async function unreadCount(userId) {
  const r = await get("SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL", [userId]);
  return r ? Number(r.c) : 0;
}

// Ownership-scoped so a user can only touch their own. Returns the updated row, or null if not theirs.
async function markRead(id, userId) {
  await run("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?", [nowStr(), id, userId]);
  return await get("SELECT * FROM notifications WHERE id = ? AND user_id = ?", [id, userId]);
}
async function markAllRead(userId) {
  await run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL", [nowStr(), userId]);
  return await unreadCount(userId);
}
async function dismiss(id, userId) {
  await run("UPDATE notifications SET dismissed_at = ? WHERE id = ? AND user_id = ? AND dismissed_at IS NULL", [nowStr(), id, userId]);
  return await get("SELECT * FROM notifications WHERE id = ? AND user_id = ?", [id, userId]);
}

// The system withdraws a heads-up it sent, for EVERY recipient: the thing it asked for has happened (a setup
// item was approved) or the ask is void (the item went back to red). Without this the notice lingers in every
// owner's bell until each one clicks Dismiss, and — because emit() dedupes against undismissed rows — a stale
// notice silently swallows the next real one for the same item. Returns the number of rows resolved.
async function resolveContext(opts) {
  opts = opts || {};
  if (opts.contextId == null || !(opts.kinds && opts.kinds.length)) throw new Error('notifications.resolveContext requires contextId and kinds');
  var ph = opts.kinds.map(function () { return '?'; }).join(',');
  var params = [nowStr()].concat(opts.kinds).concat([String(opts.contextId)]);
  var sql = "UPDATE notifications SET dismissed_at = ? WHERE kind IN (" + ph + ") AND context_id = ? AND dismissed_at IS NULL";
  if (opts.contextType) { sql += " AND context_type = ?"; params.push(opts.contextType); }
  var r = await run(sql, params);
  return r && typeof r.changes === 'number' ? r.changes : 0;
}

module.exports = { emit, list, unreadCount, markRead, markAllRead, dismiss, resolveContext };
