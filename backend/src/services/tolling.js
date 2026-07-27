'use strict';
// Statutory clock + tolling engine. Config-driven: the rules now come from the ACTIVE JURISDICTION
// (jurisdiction_rules, domain 'deadline'), falling back to the legacy global system_config key and then
// to DEFAULT_RULES. Due dates are DERIVED from (start, duration, basis, holidays, toll ledger) - never
// store-and-mutate. See docs/DEADLINE_TOLLING_DESIGN.md and SPEC_parent_child_lifecycle.md §10.
var db = require('../db');
var all = db.all, get = db.get, run = db.run;
var calc = require('./deadlineCalc');
var JR = require('./jurisdictionRules');
var CM = require('./clockMatrix');
var uuidv4 = require('uuid').v4;

// Resolve a request id to its PARENT inline, in ONE bound parameter. The statutory clock is a parent object
// (SPEC_parent_child_lifecycle.md §2/§4.2), so every clock lookup must ask the parent — whoever is asking.
var RESOLVE_SQL = '(SELECT COALESCE(master_request_id, id) FROM requests WHERE id = ?)';

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function cid() { return 'clk-' + uuidv4().slice(0, 8); }
function tid() { return 'tl-' + uuidv4().slice(0, 8); }

var DEFAULT_RULES = {
  version: 0, weekend: [0, 6], holidays: [],
  clocks: { respond: { label: 'Respond / produce', basis: 'calendar_days', durationByClassification: { simple: 5, standard: 10, complex: 20, redaction_required: 30 }, default: 10, startOn: 'intake', primary: true, tollReasons: ['clarification_pending', 'payment_pending', 'ag_ruling_pending', 'extension'] } }
};

// Rules for the active jurisdiction. A config with no clocks is not usable — fall through to the
// defaults rather than silently running every request on a zero-clock config.
async function loadRules() {
  try {
    var cfg = await JR.readActive('deadline');
    if (cfg && cfg.clocks && Object.keys(cfg.clocks).length) return cfg;
  } catch (e) {}
  return DEFAULT_RULES;
}

// UNION of toll intervals — never the sum. Two reasons can hold the clock at the same time (an AG hold
// landing while a clarification is open), and summing them double-counts the overlap: A tolls Jan 1-10 and
// B tolls Jan 5-15 sums to 20 days when only 15 were actually suspended, pushing the due date PAST what the
// law allows while the dashboard still reports compliant. Merge overlapping/adjacent spans, then count.
// See SPEC_parent_child_lifecycle.md §4.2.1.
function unionDays(intervals, basis, H, W) {
  if (!intervals.length) return 0;
  var s = intervals.slice().sort(function (a, b) { return a.from < b.from ? -1 : (a.from > b.from ? 1 : 0); });
  var merged = [], cur = { from: s[0].from, until: s[0].until };
  for (var i = 1; i < s.length; i++) {
    if (s[i].from <= cur.until) { if (s[i].until > cur.until) cur.until = s[i].until; } // overlap/adjacent -> extend
    else { merged.push(cur); cur = { from: s[i].from, until: s[i].until }; }           // disjoint -> new span
  }
  merged.push(cur);
  var total = 0;
  merged.forEach(function (m) { total += calc.basisDaysBetween(m.from, m.until, basis, H, W); });
  return total;
}

// Derived status for one clock given its toll ledger.
function computeStatus(clock, tolls, rules) {
  var def = (rules && rules.clocks && rules.clocks[clock.clock_type]) || null;
  var basis = clock.basis, dur = Number(clock.duration), start = clock.started_at;
  var W = rules.weekend || [0, 6], H = rules.holidays || [];
  var now = nowStr();
  var elapsed = calc.basisDaysBetween(start, now, basis, H, W);
  var currentlyTolled = false, intervals = [];
  (tolls || []).forEach(function (t) {
    var until = t.tolled_until || now;
    if (!t.tolled_until) currentlyTolled = true;
    // Clamp the toll interval to the clock's current epoch: toll time before started_at (e.g. tolls
    // left over from before a restart()) does not count. Normal tolls occur after start, so this is a
    // no-op except after a clock restart, where started_at is reset to the reply moment.
    var from = t.tolled_from;
    if (from < start) from = start;
    if (until < from) until = from;
    intervals.push({ from: from, until: until });
  });
  var tolled = unionDays(intervals, basis, H, W);
  var consumed = Math.max(0, elapsed - tolled);
  var remaining = dur - consumed;
  var baseDue = calc.addBasisDays(start, dur, basis, H, W);
  var dueDate = calc.addBasisDays(baseDue, tolled, basis, H, W);
  var satisfied = clock.status === 'satisfied';
  var isOverdue = !satisfied && !currentlyTolled && remaining < 0;
  var state = satisfied ? 'satisfied' : (currentlyTolled ? 'tolled' : (isOverdue ? 'expired' : 'running'));
  // WS3 — WHAT KIND OF DATE IS THIS? Every caller that renders a due date needs to know, and until now
  // none of them could: a city service target, a requestor's collection window and a statutory response
  // deadline all came back as the same shape. `legalDeadline: false` is the one field a UI must consult
  // before writing the words "the law requires" next to a date. `exposures` are the deemed-denial /
  // deemed-disclosure consequences hanging off this duty — WARNINGS, never countdowns of their own.
  var kind = CM.kindOf(def);
  return {
    clockId: clock.id, requestId: clock.request_id, type: clock.clock_type, label: clock.label,
    basis: basis, duration: dur, startedAt: start, dueDate: dueDate, remainingDays: remaining,
    consumedDays: consumed, tolledDays: tolled, currentlyTolled: currentlyTolled, isOverdue: isOverdue,
    state: state, isPrimary: !!clock.is_primary, satisfiedAt: clock.satisfied_at || null,
    kind: kind,
    operationalTarget: CM.isOperationalTarget(def),
    legalDeadline: def ? CM.isLegalDeadline(def) : true,
    timer: (def && def.timer) || null,
    citation: (def && def.citation) || null,
    exposures: (def && def.exposures) || [],
    // The overdue banner for a service target must not read as a compliance failure. It is the city
    // missing its own target, which is worth knowing and is not a breach of anything.
    overdueMeaning: !isOverdue ? null
      : (kind === 'operational_target' ? 'past the CITY SERVICE TARGET — not a legal deadline'
        : kind === 'requestor_window' ? 'the requestor\'s window has lapsed — act on the lapse (withdrawal / closure)'
        : 'past a STATUTORY deadline')
  };
}

function durationFor(def, classification) {
  if (def.durationByClassification && def.durationByClassification[classification] != null) return def.durationByClassification[classification];
  if (def.default != null) return def.default;
  return def.duration != null ? def.duration : 10;
}

// PHASE 7 / WS3 — does this clock definition carry a length at all?
//
// The `|| 10` fallback in durationFor() above is a reasonable last resort for a malformed config, but it
// is a DISASTER for a soft-standard state. Ohio's response duty is "within a reasonable period of time"
// and Texas's production duty is "promptly": the reconciler writes those as operational targets with
// `duration: null` precisely because there is no lawful number to write, and letting durationFor() answer
// 10 would put a fabricated ten-day deadline on every request in a state whose legislature declined to set
// one. So a clock with no agreed length is never STARTED; the city sets its service target first.
function hasUsableDuration(def) {
  if (!def) return false;
  if (def.durationByClassification && Object.keys(def.durationByClassification).some(function (k) { return def.durationByClassification[k] != null; })) return true;
  return def.default != null || def.duration != null;
}

async function writebackDeadline(requestId, rules) {
  rules = rules || await loadRules();
  var clk = await get("SELECT * FROM request_clocks WHERE request_id = ? AND is_primary = 1 ORDER BY created_at LIMIT 1", [requestId]);
  if (!clk) return null;
  var tolls = await all("SELECT * FROM clock_tolls WHERE clock_id = ?", [clk.id]);
  var st = computeStatus(clk, tolls, rules);
  // Write the parent AND cascade to its children. There is still exactly ONE statutory deadline — the parent's
  // — but `deadline_date` on a child is a true, derived copy of it, not a second deadline: every child of a
  // request shares that request's legal due date. The cascade matters because the queue, the stall sweep and
  // every work list are LEAF-scoped (§7) and read the CHILD's row; without it the deadline would silently
  // disappear from every screen that shows work. The clock itself (`request_clocks`) remains parent-only —
  // that is the thing that must never be duplicated.
  await run("UPDATE requests SET deadline_date = ? WHERE id = ? OR master_request_id = ?", [st.dueDate, requestId, requestId]);
  return st.dueDate;
}

// THE STATUTORY CLOCK IS A PARENT OBJECT — always. Resolve whatever row a caller hands us to its parent
// (SPEC_parent_child_lifecycle.md §2/§4.2).
//
// This is enforced HERE, in the engine, and not at the call sites, because there are five of them and only one
// invariant. `workflowEngine.onIntake` runs against the CHILD (routing is decided from the description, which
// is the child's) and called this with the child's id — so every wrapped request came out with TWO respond
// clocks, one of them on a child. Caught on live, not by the suite (the harness had created its fixture with
// kickIntake:false, so the intake path never ran).
//
// A per-child statutory clock is the exact failure §2 exists to prevent: the citizen filed ONE request and the
// law gives it ONE deadline. N children with N legal clocks is N deadlines for one request — which is what
// breaks Illinois (5 ILCS 140/3(d): one request-level answer date, no installment safe harbor). A child's clock
// is its BUDGET clock (§5.4) — a different column and a different idea.
//
// Today `master_request_id` is NULL on the unwrapped LIBRARY/SYS-* containers, so COALESCE returns the row
// itself and this is a no-op for them.
async function parentOf(requestId) {
  var r = await get("SELECT COALESCE(master_request_id, id) AS pid FROM requests WHERE id = ?", [requestId]);
  return r ? r.pid : requestId;
}

// Idempotent: create the clocks whose rule.startOn == 'intake'. started_at = request.created_at.
async function startClocksForRequest(requestId) {
  var rules = await loadRules();
  requestId = await parentOf(requestId); // the statutory clock belongs to the parent, whoever asked
  var req = await get("SELECT id, classification, created_at FROM requests WHERE id = ?", [requestId]);
  if (!req) return { created: 0 };
  var created = 0;
  var types = Object.keys(rules.clocks || {});
  for (var i = 0; i < types.length; i++) {
    var type = types[i], def = rules.clocks[type];
    if (def.startOn !== 'intake') continue;
    if (!hasUsableDuration(def)) continue; // an unset service target has no length to count down — see above
    var existing = await get("SELECT id FROM request_clocks WHERE request_id = ? AND clock_type = ?", [requestId, type]);
    if (existing) continue;
    var dur = durationFor(def, req.classification || 'standard');
    // Only a statutory response clock is PRIMARY. A service target that claimed the primary slot would
    // become `requests.deadline_date` — the city's own pacing number, rendered to a requestor as the date
    // the law requires. See services/clockMatrix.js on pattern S-002.
    var primary = (def.primary && !CM.isOperationalTarget(def)) ? 1 : 0;
    await run("INSERT INTO request_clocks (id, request_id, clock_type, label, basis, duration, started_at, status, is_primary, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [cid(), requestId, type, def.label || type, def.basis || 'calendar_days', dur, req.created_at || nowStr(), 'running', primary, nowStr(), nowStr()]);
    created++;
  }
  await writebackDeadline(requestId, rules);
  return { created: created };
}

// Create a specific clock on demand (e.g. ag_ruling when a withholding decision is made).
async function startClock(requestId, type, opts) {
  opts = opts || {};
  var rules = await loadRules();
  requestId = await parentOf(requestId); // same invariant: statutory clocks (incl. ag_ruling) live on the parent
  var def = (rules.clocks && rules.clocks[type]) || { label: type, basis: 'calendar_days', duration: 10 };
  var req = await get("SELECT classification FROM requests WHERE id = ?", [requestId]);
  var dur = opts.duration != null ? opts.duration : durationFor(def, req ? req.classification : 'standard');
  var id = cid();
  await run("INSERT INTO request_clocks (id, request_id, clock_type, label, basis, duration, started_at, status, is_primary, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [id, requestId, type, opts.label || def.label || type, opts.basis || def.basis || 'calendar_days', dur, opts.startedAt || nowStr(), 'running', def.primary ? 1 : 0, nowStr(), nowStr()]);
  if (def.primary) await writebackDeadline(requestId, rules);
  return id;
}

// The clock's rule definition, or null if the config does not describe this clock type.
async function defFor(clock, rules) {
  rules = rules || await loadRules();
  return (rules.clocks && rules.clocks[clock.clock_type]) || null;
}

async function toll(clockId, reason, note) {
  var clk = await get("SELECT * FROM request_clocks WHERE id = ?", [clockId]);
  if (!clk) throw new Error('Clock not found');
  // `tollReasons` has been declared per clock in config since day one and NEVER read — toll() accepted any
  // string, so a typo silently became a new toll reason and no jurisdiction could constrain what may stop
  // its clock. It is load-bearing now: a reason the jurisdiction has not declared is rejected.
  var def = await defFor(clk);
  if (def && Array.isArray(def.tollReasons) && def.tollReasons.length && def.tollReasons.indexOf(reason) < 0) {
    throw new Error('"' + reason + '" is not a toll reason this jurisdiction allows for the ' + clk.clock_type +
      ' clock. Allowed: ' + def.tollReasons.join(', ') + '.');
  }
  // CONCURRENCY: idempotency is PER REASON, not per clock. This guard used to be per-clock, so a second
  // trigger was SILENTLY DROPPED — a record going to the AG while a clarification was open never registered,
  // and the next resume() then ran the clock while the request was still legally suspended. Different reasons
  // may hold the clock simultaneously; the same reason twice is still a no-op. SPEC §4.2.1.
  var r = reason || 'other';
  var open = await get("SELECT id FROM clock_tolls WHERE clock_id = ? AND reason = ? AND tolled_until IS NULL", [clockId, r]);
  if (open) return { alreadyTolled: true, reason: r };
  await run("INSERT INTO clock_tolls (id, clock_id, reason, tolled_from, note, created_at) VALUES (?,?,?,?,?,?)", [tid(), clockId, r, nowStr(), note || null, nowStr()]);
  await run("UPDATE request_clocks SET status = 'tolled', updated_at = ? WHERE id = ?", [nowStr(), clockId]);
  await writebackDeadline(clk.request_id);
  var oc = await get("SELECT COUNT(*) AS n FROM clock_tolls WHERE clock_id = ? AND tolled_until IS NULL", [clockId]);
  return { tolled: true, reason: r, openTolls: Number(oc.n) };
}

// Close ONE reason's toll. The clock starts running again only when the LAST open toll closes — a refcount,
// not a flag. Passing no reason closes every open toll (the manual/admin override on the route).
// `resumed` means THE CLOCK IS RUNNING AGAIN, not "this reason was closed" — a caller must not report a
// resumed clock while a sibling hold is still open.
async function resume(clockId, reason) {
  var clk = await get("SELECT * FROM request_clocks WHERE id = ?", [clockId]);
  if (!clk) throw new Error('Clock not found');
  if (reason) await run("UPDATE clock_tolls SET tolled_until = ? WHERE clock_id = ? AND reason = ? AND tolled_until IS NULL", [nowStr(), clockId, reason]);
  else await run("UPDATE clock_tolls SET tolled_until = ? WHERE clock_id = ? AND tolled_until IS NULL", [nowStr(), clockId]);
  var oc = await get("SELECT COUNT(*) AS n FROM clock_tolls WHERE clock_id = ? AND tolled_until IS NULL", [clockId]);
  var remaining = Number(oc.n);
  if (remaining === 0) await run("UPDATE request_clocks SET status = 'running', updated_at = ? WHERE id = ?", [nowStr(), clockId]);
  await writebackDeadline(clk.request_id);
  return { resumed: remaining === 0, stillTolled: remaining > 0, openTolls: remaining };
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

// Reads resolve to the parent too. Asking "what is this CHILD's statutory deadline" is a legitimate question
// with a parent-shaped answer: the child shares its request's one legal deadline. Resolving here means no
// caller has to know whether it is holding a parent id or a child id.
async function statusForRequest(requestId) {
  var rules = await loadRules();
  requestId = await parentOf(requestId);
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

// EXTEND — the third clock primitive, and the only one that can express a STATUTORY extension.
//
// A toll suspends the clock and pushes the due date out by ELAPSED WALL TIME. That is the wrong shape for
// "the agency may take 5 more business days for an unduly voluminous request" (5 ILCS 140/3(e)) or "one
// extension, not more than 14 days" (Cal. Gov't Code § 7922.535(b)) — those add a FIXED number of days
// regardless of how long anyone waited. extend() lengthens the clock's duration; computeStatus() then
// derives everything else, so no due date is stored and mutated.
//
// Statutes CAP extensions, so the ledger is the enforcement. Config (per clock, in the jurisdiction's
// deadline rules):
//   extension: { maxDays: 5, maxCount: 1, grounds: ['voluminous', ...] }
// A clock with no `extension` config is uncapped — a deliberate staff action with a reason, which is what
// a jurisdiction that has no statutory extension (e.g. TX) would still want recorded if it ever happens.
async function extend(clockId, days, reason, opts) {
  opts = opts || {};
  var n = Math.floor(Number(days));
  if (!isFinite(n) || n <= 0) throw new Error('An extension must be a positive number of days.');
  if (!reason || !String(reason).trim()) throw new Error('An extension needs a reason — it is the statutory ground for the extra time.');
  var clk = await get("SELECT * FROM request_clocks WHERE id = ?", [clockId]);
  if (!clk) throw new Error('Clock not found');
  if (clk.status === 'satisfied') throw new Error('This clock is already satisfied; it cannot be extended.');

  var rules = await loadRules();
  var def = await defFor(clk, rules);
  var ext = (def && def.extension) || {};

  if (Array.isArray(ext.grounds) && ext.grounds.length && ext.grounds.indexOf(reason) < 0) {
    throw new Error('"' + reason + '" is not a ground this jurisdiction allows for extending the ' +
      clk.clock_type + ' clock. Allowed: ' + ext.grounds.join(', ') + '.');
  }
  var prior = await all("SELECT days FROM clock_extensions WHERE clock_id = ?", [clockId]);
  if (ext.maxCount != null && prior.length >= Number(ext.maxCount)) {
    throw new Error('This jurisdiction allows ' + ext.maxCount + ' extension' + (Number(ext.maxCount) === 1 ? '' : 's') +
      ' on the ' + clk.clock_type + ' clock; ' + prior.length + ' already recorded.');
  }
  if (ext.maxDays != null) {
    var already = prior.reduce(function (s, r) { return s + Number(r.days); }, 0);
    // maxDays caps the TOTAL extension across the clock's life, not each grant — otherwise "one extension
    // of not more than 14 days" could be evaded by granting 14 days twice.
    if (already + n > Number(ext.maxDays)) {
      throw new Error('This jurisdiction allows at most ' + ext.maxDays + ' extension days on the ' + clk.clock_type +
        ' clock (' + already + ' already used; ' + n + ' more requested).');
    }
  }

  await run("INSERT INTO clock_extensions (id, clock_id, days, reason, note, actor, created_at) VALUES (?,?,?,?,?,?,?)",
    ['ext-' + uuidv4().slice(0, 8), clockId, n, reason, opts.note || null, opts.actor || 'system', nowStr()]);
  await run("UPDATE request_clocks SET duration = duration + ?, updated_at = ? WHERE id = ?", [n, nowStr(), clockId]);
  await writebackDeadline(clk.request_id, rules);

  var after = await get("SELECT duration FROM request_clocks WHERE id = ?", [clockId]);
  return { extended: true, clockId: clockId, days: n, reason: reason, duration: Number(after.duration),
    extensionCount: prior.length + 1 };
}

// The extension ledger for a clock (audit / display).
async function extensionsFor(clockId) {
  return await all("SELECT * FROM clock_extensions WHERE clock_id = ? ORDER BY created_at", [clockId]);
}

// Re-derive a request's clock durations from its (newly determined) classification, using the JURISDICTION's
// duration table. Called after the AI classifier lands at intake.
//
// This replaces the hardcoded `deadline_date = today + cls.deadlineDays` write that the intake paths used to
// do: a flat calendar-day add that ignored the jurisdiction entirely (wrong in IL, which counts BUSINESS
// days, and in CA, whose clock is a determination deadline). Classification now selects a duration from the
// jurisdiction's own durationByClassification table, and the due date is derived as it is everywhere else.
//
// SAFETY: a clock that has been EXTENDED is left alone. `duration` carries base + granted extension days, so
// recomputing the base would silently erase a statutory extension. Classification lands seconds after intake,
// long before any extension exists, so this costs nothing in practice and protects the ledger.
async function applyClassification(requestId) {
  var rules = await loadRules();
  var req = await get("SELECT classification FROM requests WHERE id = ?", [requestId]);
  if (!req) return { updated: 0 };
  // The classification is read from the row the caller named (a child reclassifies itself), but the clock it
  // retunes is the PARENT's — there is only one statutory clock.
  var clocks = await all("SELECT * FROM request_clocks WHERE request_id = " + RESOLVE_SQL, [requestId]);
  var updated = 0;
  for (var i = 0; i < clocks.length; i++) {
    var clk = clocks[i];
    var def = (rules.clocks && rules.clocks[clk.clock_type]) || null;
    if (!def || !def.durationByClassification) continue;
    var ext = await get("SELECT COUNT(*) AS n FROM clock_extensions WHERE clock_id = ?", [clk.id]);
    if (Number(ext.n) > 0) continue; // never clobber a granted extension
    var dur = durationFor(def, req.classification || 'standard');
    if (Number(dur) === Number(clk.duration)) continue;
    await run("UPDATE request_clocks SET duration = ?, updated_at = ? WHERE id = ?", [dur, nowStr(), clk.id]);
    updated++;
  }
  if (updated) await writebackDeadline(requestId, rules);
  return { updated: updated };
}

module.exports = {
  loadRules: loadRules, computeStatus: computeStatus, startClocksForRequest: startClocksForRequest,
  startClock: startClock, toll: toll, resume: resume, restart: restart, satisfy: satisfy,
  extend: extend, extensionsFor: extensionsFor, applyClassification: applyClassification,
  statusForRequest: statusForRequest, writebackDeadline: writebackDeadline, overdue: overdue
};
