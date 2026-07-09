'use strict';
// Statutory clock + tolling engine. Config-driven (system_config 'deadline_rules'; later the Jurisdiction
// Profile). Due dates are DERIVED from (start, duration, basis, holidays, toll ledger) - never store-and-mutate.
// See docs/DEADLINE_TOLLING_DESIGN.md.
var db = require('../db');
var all = db.all, get = db.get, run = db.run;
var calc = require('./deadlineCalc');
var uuidv4 = require('uuid').v4;

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function cid() { return 'clk-' + uuidv4().slice(0, 8); }
function tid() { return 'tl-' + uuidv4().slice(0, 8); }

var DEFAULT_RULES = {
  version: 0, weekend: [0, 6], holidays: [],
  clocks: { respond: { label: 'Respond / produce', basis: 'calendar_days', durationByClassification: { simple: 5, standard: 10, complex: 20, redaction_required: 30 }, default: 10, startOn: 'intake', primary: true, tollReasons: ['clarification_pending', 'payment_pending', 'extension'] } }
};

async function loadRules() {
  try { var row = await get("SELECT value FROM system_config WHERE key = 'deadline_rules'"); if (row && row.value) return JSON.parse(row.value); } catch (e) {}
  return DEFAULT_RULES;
}

// Derived status for one clock given its toll ledger.
function computeStatus(clock, tolls, rules) {
  var basis = clock.basis, dur = Number(clock.duration), start = clock.started_at;
  var W = rules.weekend || [0, 6], H = rules.holidays || [];
  var now = nowStr();
  var elapsed = calc.basisDaysBetween(start, now, basis, H, W);
  var tolled = 0, currentlyTolled = false;
  (tolls || []).forEach(function (t) {
    var until = t.tolled_until || now;
    if (!t.tolled_until) currentlyTolled = true;
    // Clamp the toll interval to the clock's current epoch: toll time before started_at (e.g. tolls
    // left over from before a restart()) does not count. Normal tolls occur after start, so this is a
    // no-op except after a clock restart, where started_at is reset to the reply moment.
    var from = t.tolled_from;
    if (from < start) from = start;
    if (until < from) until = from;
    tolled += calc.basisDaysBetween(from, until, basis, H, W);
  });
  var consumed = Math.max(0, elapsed - tolled);
  var remaining = dur - consumed;
  var baseDue = calc.addBasisDays(start, dur, basis, H, W);
  var dueDate = calc.addBasisDays(baseDue, tolled, basis, H, W);
  var satisfied = clock.status === 'satisfied';
  var isOverdue = !satisfied && !currentlyTolled && remaining < 0;
  var state = satisfied ? 'satisfied' : (currentlyTolled ? 'tolled' : (isOverdue ? 'expired' : 'running'));
  return {
    clockId: clock.id, requestId: clock.request_id, type: clock.clock_type, label: clock.label,
    basis: basis, duration: dur, startedAt: start, dueDate: dueDate, remainingDays: remaining,
    consumedDays: consumed, tolledDays: tolled, currentlyTolled: currentlyTolled, isOverdue: isOverdue,
    state: state, isPrimary: !!clock.is_primary, satisfiedAt: clock.satisfied_at || null
  };
}

function durationFor(def, classification) {
  if (def.durationByClassification && def.durationByClassification[classification] != null) return def.durationByClassification[classification];
  if (def.default != null) return def.default;
  return def.duration != null ? def.duration : 10;
}

async function writebackDeadline(requestId, rules) {
  rules = rules || await loadRules();
  var clk = await get("SELECT * FROM request_clocks WHERE request_id = ? AND is_primary = 1 ORDER BY created_at LIMIT 1", [requestId]);
  if (!clk) return null;
  var tolls = await all("SELECT * FROM clock_tolls WHERE clock_id = ?", [clk.id]);
  var st = computeStatus(clk, tolls, rules);
  await run("UPDATE requests SET deadline_date = ? WHERE id = ?", [st.dueDate, requestId]);
  return st.dueDate;
}

// Idempotent: create the clocks whose rule.startOn == 'intake'. started_at = request.created_at.
async function startClocksForRequest(requestId) {
  var rules = await loadRules();
  var req = await get("SELECT id, classification, created_at FROM requests WHERE id = ?", [requestId]);
  if (!req) return { created: 0 };
  var created = 0;
  var types = Object.keys(rules.clocks || {});
  for (var i = 0; i < types.length; i++) {
    var type = types[i], def = rules.clocks[type];
    if (def.startOn !== 'intake') continue;
    var existing = await get("SELECT id FROM request_clocks WHERE request_id = ? AND clock_type = ?", [requestId, type]);
    if (existing) continue;
    var dur = durationFor(def, req.classification || 'standard');
    await run("INSERT INTO request_clocks (id, request_id, clock_type, label, basis, duration, started_at, status, is_primary, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [cid(), requestId, type, def.label || type, def.basis || 'calendar_days', dur, req.created_at || nowStr(), 'running', def.primary ? 1 : 0, nowStr(), nowStr()]);
    created++;
  }
  await writebackDeadline(requestId, rules);
  return { created: created };
}

// Create a specific clock on demand (e.g. ag_ruling when a withholding decision is made).
async function startClock(requestId, type, opts) {
  opts = opts || {};
  var rules = await loadRules();
  var def = (rules.clocks && rules.clocks[type]) || { label: type, basis: 'calendar_days', duration: 10 };
  var req = await get("SELECT classification FROM requests WHERE id = ?", [requestId]);
  var dur = opts.duration != null ? opts.duration : durationFor(def, req ? req.classification : 'standard');
  var id = cid();
  await run("INSERT INTO request_clocks (id, request_id, clock_type, label, basis, duration, started_at, status, is_primary, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [id, requestId, type, opts.label || def.label || type, opts.basis || def.basis || 'calendar_days', dur, opts.startedAt || nowStr(), 'running', def.primary ? 1 : 0, nowStr(), nowStr()]);
  if (def.primary) await writebackDeadline(requestId, rules);
  return id;
}

async function toll(clockId, reason, note) {
  var clk = await get("SELECT * FROM request_clocks WHERE id = ?", [clockId]);
  if (!clk) throw new Error('Clock not found');
  var open = await get("SELECT id FROM clock_tolls WHERE clock_id = ? AND tolled_until IS NULL", [clockId]);
  if (open) return { alreadyTolled: true };
  await run("INSERT INTO clock_tolls (id, clock_id, reason, tolled_from, note, created_at) VALUES (?,?,?,?,?,?)", [tid(), clockId, reason || 'other', nowStr(), note || null, nowStr()]);
  await run("UPDATE request_clocks SET status = 'tolled', updated_at = ? WHERE id = ?", [nowStr(), clockId]);
  await writebackDeadline(clk.request_id);
  return { tolled: true };
}

async function resume(clockId) {
  var clk = await get("SELECT * FROM request_clocks WHERE id = ?", [clockId]);
  if (!clk) throw new Error('Clock not found');
  await run("UPDATE clock_tolls SET tolled_until = ? WHERE clock_id = ? AND tolled_until IS NULL", [nowStr(), clockId]);
  await run("UPDATE request_clocks SET status = 'running', updated_at = ? WHERE id = ?", [nowStr(), clockId]);
  await writebackDeadline(clk.request_id);
  return { resumed: true };
}

// Restart the clock's epoch: close any open toll and reset started_at to now, so the clock gets a
// clean FULL duration from this moment. Prior toll rows are kept as audit but no longer count
// (computeStatus clamps toll intervals to >= started_at). Used for the clarification clock effects
// 'toll_and_restart' and 'start_gate' when the requestor replies.
async function restart(clockId) {
  var clk = await get("SELECT * FROM request_clocks WHERE id = ?", [clockId]);
  if (!clk) throw new Error('Clock not found');
  await run("UPDATE clock_tolls SET tolled_until = ? WHERE clock_id = ? AND tolled_until IS NULL", [nowStr(), clockId]);
  await run("UPDATE request_clocks SET started_at = ?, status = 'running', updated_at = ? WHERE id = ?", [nowStr(), nowStr(), clockId]);
  await writebackDeadline(clk.request_id);
  return { restarted: true };
}

async function satisfy(clockId) {
  await run("UPDATE request_clocks SET status = 'satisfied', satisfied_at = ?, updated_at = ? WHERE id = ?", [nowStr(), nowStr(), clockId]);
  return { satisfied: true };
}

async function statusForRequest(requestId) {
  var rules = await loadRules();
  var clocks = await all("SELECT * FROM request_clocks WHERE request_id = ? ORDER BY is_primary DESC, created_at", [requestId]);
  var out = [];
  for (var i = 0; i < clocks.length; i++) {
    var tolls = await all("SELECT * FROM clock_tolls WHERE clock_id = ? ORDER BY created_at", [clocks[i].id]);
    var st = computeStatus(clocks[i], tolls, rules);
    st.tolls = tolls;
    out.push(st);
  }
  await writebackDeadline(requestId, rules);
  return out;
}

async function overdue() {
  var rules = await loadRules();
  var clocks = await all("SELECT * FROM request_clocks WHERE status NOT IN ('satisfied')");
  var out = [];
  for (var i = 0; i < clocks.length; i++) {
    var tolls = await all("SELECT * FROM clock_tolls WHERE clock_id = ?", [clocks[i].id]);
    var st = computeStatus(clocks[i], tolls, rules);
    if (st.isOverdue) out.push(st);
  }
  return out;
}

module.exports = {
  loadRules: loadRules, computeStatus: computeStatus, startClocksForRequest: startClocksForRequest,
  startClock: startClock, toll: toll, resume: resume, restart: restart, satisfy: satisfy,
  statusForRequest: statusForRequest, writebackDeadline: writebackDeadline, overdue: overdue
};
