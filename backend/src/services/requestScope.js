'use strict';
// PARENT/CHILD SCOPE PREDICATES — the thing that lets the whole codebase become parent/child-aware BEFORE a
// single row is migrated.
//
// THE PROBLEM. After the migration (SPEC_parent_child_lifecycle.md §8) every existing `requests` row becomes
// a CHILD and a new PARENT row is inserted above it. Any query that says `FROM requests` without saying which
// it wants will then see BOTH and double-count — 27 list/count queries would break at once, and three of them
// destructively (duplicate dunning emails to citizens; clarificationTimeout auto-closing a parent; the stall
// sweep flagging every parent forever).
//
// THE TRICK. Pick predicates that are TRUE OF EVERY ROW TODAY and still correct after the migration. Today a
// request is simultaneously its own parent and its own child — so:
//
//   PARENT (the citizen's request: number, requestor, money, clock, deadline)
//     = a ROOT row: it has no parent above it.
//     `master_request_id IS NULL`
//     → today: every row (nothing has a parent).  → after: only the new parent rows.
//
//   CHILD / WORK (the unit of work: description, stage, routing, tasks, files, redaction, search)
//     = a LEAF row: nothing hangs beneath it.
//     `NOT EXISTS (SELECT 1 FROM requests c WHERE c.master_request_id = <row>.id)`
//     → today: every row (no children exist).     → after: only the children.
//
// Both are tautologies against today's data, so adopting them is a PROVABLE NO-OP — the harness asserts every
// list, count and sweep returns byte-identical results. Then the migration flips them automatically, without
// touching a single query again.
//
// Use `parent(alias)` / `leaf(alias)` to build the fragment for whatever alias the query uses.

// The row the CITIZEN thinks of as "my request". Money, clock, deadline, request_number, requestor.
function parent(alias) {
  var a = alias || 'r';
  return a + '.master_request_id IS NULL';
}

// The row STAFF actually work. Description, stage, department, assignee, tasks, files, redaction, search.
function leaf(alias) {
  var a = alias || 'r';
  return 'NOT EXISTS (SELECT 1 FROM requests _c WHERE _c.master_request_id = ' + a + '.id)';
}

// Convenience: ` AND <parent>` / ` AND <leaf>` for appending to an existing WHERE.
function andParent(alias) { return ' AND ' + parent(alias); }
function andLeaf(alias) { return ' AND ' + leaf(alias); }

// ---------------------------------------------------------------------------------------------------
// THE CITIZEN-FACING REQUEST NUMBER.
//
// Tasks, objections, files and worklists all hang off the WORK row (the child). But `request_number` is a
// PARENT field — it is the number the citizen was given and quotes on the phone. After the migration a
// child's own number carries a component suffix (`2026-0045-1`); showing that in a task list would confront
// staff with a number the citizen has never seen.
//
// Same trick as the scope predicates: resolve the number THROUGH the parent.
//   numberJoin('r')  -> LEFT JOIN requests _p ON _p.id = r.master_request_id
//   numberExpr('r')  -> COALESCE(_p.request_number, r.request_number) AS request_number
//
// HISTORY: when this was written the migration had not run, `master_request_id` was NULL on every row, and
// the COALESCE was a provable no-op. **The migration HAS since run (2026-07-16)** — children are real, so
// `_p` now resolves for real and the fallback arm is what serves parents and the legacy unwrapped
// `SYS-`/`LIBRARY` containers. Do not read the "today it's a no-op" reasoning as still current.
function numberJoin(alias) {
  var a = alias || 'r';
  return ' LEFT JOIN requests _p ON _p.id = ' + a + '.master_request_id';
}

// Generalisation of numberExpr to any PARENT-level column. Prefer the parent's value when a parent exists,
// otherwise the row's own.
//
// WHY COALESCE IS RIGHT EVEN FOR `is_mrr`, WHERE THE CHILD'S VALUE IS 0 AND NOT NULL: the coalesce is over
// `_p.<col>` — the JOINED row — not over the child's value. For a child, `_p` exists, so `_p.is_mrr` (1) wins
// and the child's forced 0 never surfaces. For a parent, `_p` is NULL and the row answers for itself. The
// child's 0 is only ever reachable when the row genuinely has no parent, which is exactly when it is correct.
function parentFact(col, alias) {
  var a = alias || 'r';
  return 'COALESCE(_p.' + col + ', ' + a + '.' + col + ')';
}
function numberExpr(alias) { return parentFact('request_number', alias); }

// ---------------------------------------------------------------------------------------------------
// RESOLVE AN ADDRESSED ID TO THE ROW THE WORK BELONGS TO.
//
// Kevin, 2026-07-19, settling the parent/child division for processing:
//
//   "the exemption applies to processing a request that has a description of item requested. it's a child
//    record level issue. the parent should be thought of as who requested the information and did he pay
//    for it, etc."
//
// So: PARENT = who asked, the number they quote, the money, the statutory clock. CHILD = the described item
// and everything about processing it — stage included.
//
// WHY THIS FUNCTION HAS TO EXIST. The predicates above are SQL fragments for SCOPING a query. Nothing gave a
// route a way to say "I was handed an id; give me the row this stage change belongs to." So routes passed
// whatever the caller named straight to applyStageTransition, which moves exactly the row it is given. Name
// a parent and the PARENT takes a work stage while the child that holds the description sits untouched at
// `intake`. Not a race and not intermittent — it moves whatever you address, and the parent id is the
// natural one for a caller to be holding.
//
// AMBIGUITY IS REFUSED, NOT GUESSED. A parent with one child is unambiguous (a single-record request is
// n = 1, not a special case). A parent with several children is a real question — WHICH described item is
// the exemption about? — and picking one would silently attach a legal act to the wrong record. Callers get
// `ambiguous` with the candidates and must name one.
//
// Returns: { row, addressed, ambiguous }
//   row       — the work row, or null when not found / ambiguous
//   addressed — the row actually named (for parent-level facts: money, clock, number)
//   ambiguous — array of candidate children when the caller must choose, else null
async function workRow(idOrNumber) {
  var db = require('../db');
  var addressed = await db.get('SELECT * FROM requests WHERE id = ? OR request_number = ?', [idOrNumber, idOrNumber]);
  if (!addressed) return { row: null, addressed: null, ambiguous: null };
  var kids = await db.all('SELECT * FROM requests WHERE master_request_id = ? ORDER BY component_label, request_number', [addressed.id]);
  if (kids.length === 0) return { row: addressed, addressed: addressed, ambiguous: null }; // already a leaf
  if (kids.length === 1) return { row: kids[0], addressed: addressed, ambiguous: null };
  return { row: null, addressed: addressed, ambiguous: kids };
}

module.exports = {
  parent: parent, leaf: leaf, andParent: andParent, andLeaf: andLeaf,
  numberJoin: numberJoin, numberExpr: numberExpr, parentFact: parentFact,
  workRow: workRow
};
