'use strict';
// R9 — search-completeness intent + the refine loop.  DESIGN_split_canvas_intake.md §R9 + §4b.
//
// THE ONE INSERT SITE for intake search provenance (ARCHITECTURE item 5, in spirit): request_search_intents,
// request_selected_records, request_intake_results are written HERE and nowhere else.
//
// WHAT THE PORTAL SENDS. A description is no longer one-shot -- the requestor may search, select, re-describe,
// search again, and select more, all under ONE description. Only Proceed closes it out. So the portal posts one
// entry per DESCRIBED RECORD:
//
//   { seq, description, intent, queriesTried: [...], selected: [rec], notSelected: [rec + shownInQuery] }
//
// TWO ACCUMULATING SETS, and the asymmetry between them is the whole point:
//   selected     -> the requestor SEES these (the right-hand column) and they carry with the request.
//   notSelected  -> the requestor NEVER sees these again. They exist ONLY so the searcher does not
//                   re-surface a record the requestor already looked at and passed over.
var { run, get, all } = require('../db');
var { v4: uuidv4 } = require('uuid');

var INTENTS = ['complete', 'search_more', 'no_match_search', 'not_searchable'];

function isIntent(v) { return INTENTS.indexOf(v) >= 0; }

// The portal is a PUBLIC, unauthenticated surface. Everything off it is hostile until proven otherwise:
// a bad intent string would otherwise sit in the DB and be read by the searcher as if it meant something.
function normalize(entries) {
  if (!Array.isArray(entries)) return [];
  var out = [];
  entries.forEach(function (e, i) {
    if (!e || typeof e !== 'object') return;
    var desc = String(e.description == null ? '' : e.description).trim();
    if (!desc) return;                        // a description IS the row; without one there is nothing to record
    var intent = isIntent(e.intent) ? e.intent : 'no_match_search';  // safest default: "the team must search"
    var queries = Array.isArray(e.queriesTried)
      ? e.queriesTried.filter(function (q) { return typeof q === 'string' && q.trim(); }).map(function (q) { return q.trim(); })
      : [];
    out.push({
      seq: Number.isInteger(e.seq) ? e.seq : i,
      description: desc,
      intent: intent,
      queriesTried: queries,
      selected: recs(e.selected),
      notSelected: recs(e.notSelected)
    });
  });
  return out;
}

function recs(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(function (r) { return r && (r.id || r.recordId); }).map(function (r) {
    return {
      recordId: String(r.id || r.recordId),
      title: String(r.title || ''),
      sourceSystem: String(r.sourceSystem || ''),
      publicAvailability: String(r.publicAvailability || ''),
      shownInQuery: String(r.shownInQuery || '')
    };
  });
}

// Persist one request's intake search provenance.
//
// SELECTION WINS, and it wins ACROSS the whole request, not just within one description. A record the
// requestor passed over while refining description 1 and then SELECTED under description 3 is SELECTED --
// full stop. If it also landed in the not-selected pile, the searcher would read "the requestor declined
// this" about a record the requestor actually asked for. That is the exact failure this table exists to
// prevent, so the dedup runs over the union before a single row is written.
async function persist(requestId, rawEntries) {
  var entries = normalize(rawEntries);
  if (!entries.length) return { intents: 0, selected: 0, notSelected: 0 };

  var selectedIds = new Set();
  entries.forEach(function (e) { e.selected.forEach(function (r) { selectedIds.add(r.recordId); }); });

  var counts = { intents: 0, selected: 0, notSelected: 0 };
  var seenNotSelected = new Set();   // dedup the not-selected pile against ITSELF too: the same record can be
                                     // shown by several queries under several descriptions and is still one row.

  for (var e of entries) {
    var intentId = uuidv4();
    await run(
      'INSERT INTO request_search_intents (id, request_id, seq, description, intent, queries_tried) VALUES (?,?,?,?,?,?)',
      [intentId, requestId, e.seq, e.description, e.intent, JSON.stringify(e.queriesTried)]
    );
    counts.intents++;

    for (var s of e.selected) {
      await run(
        'INSERT INTO request_selected_records (id, request_id, record_id, title, source_system, public_availability, intent_id) VALUES (?,?,?,?,?,?,?)',
        [uuidv4(), requestId, s.recordId, s.title, s.sourceSystem, s.publicAvailability, intentId]
      );
      counts.selected++;
    }

    for (var n of e.notSelected) {
      if (selectedIds.has(n.recordId)) continue;     // selection wins
      if (seenNotSelected.has(n.recordId)) continue; // already recorded under another query/description
      seenNotSelected.add(n.recordId);
      await run(
        'INSERT INTO request_intake_results (id, request_id, intent_id, record_id, title, source_system, public_availability, shown_in_query) VALUES (?,?,?,?,?,?,?,?)',
        [uuidv4(), requestId, intentId, n.recordId, n.title, n.sourceSystem, n.publicAvailability, n.shownInQuery]
      );
      counts.notSelected++;
    }
  }
  return counts;
}

// What the searcher reads. Grouped by description, because a flat pile is what R9 exists to kill.
async function forRequest(requestId) {
  var intents = await all(
    'SELECT * FROM request_search_intents WHERE request_id = ? ORDER BY seq ASC', [requestId]);
  var selected = await all(
    'SELECT * FROM request_selected_records WHERE request_id = ? ORDER BY created_at ASC', [requestId]);
  var notSelected = await all(
    'SELECT * FROM request_intake_results WHERE request_id = ? ORDER BY created_at ASC', [requestId]);

  var groups = intents.map(function (i) {
    var q = [];
    try { q = JSON.parse(i.queries_tried || '[]'); } catch (err) { q = []; }
    return {
      id: i.id, seq: i.seq, description: i.description, intent: i.intent, queriesTried: q,
      selected: selected.filter(function (s) { return s.intent_id === i.id; }),
      notSelected: notSelected.filter(function (n) { return n.intent_id === i.id; })
    };
  });

  // Pre-R9 requests have selections with a NULL intent_id. They are not wrong -- they simply predate the
  // per-description row. Surface them rather than dropping them on the floor.
  var ungrouped = selected.filter(function (s) { return !s.intent_id; });

  return {
    groups: groups,
    ungroupedSelected: ungrouped,
    totals: {
      selected: selected.length,
      notSelected: notSelected.length,
      // What the bar on the record-search screen shows: "the portal showed them N; they took M."
      shown: selected.length + notSelected.length
    }
  };
}

module.exports = { persist, forRequest, normalize, INTENTS };
