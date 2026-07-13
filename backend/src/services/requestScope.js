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

module.exports = { parent: parent, leaf: leaf, andParent: andParent, andLeaf: andLeaf };
