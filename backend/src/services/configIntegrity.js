'use strict';
// CONFIG INTEGRITY — does the live jurisdiction config look like something a human configured, or like
// something a test left behind?
//
// WHY THIS EXISTS. On 2026-07-14 the live TX deadline config was found holding `standard = 77` days (real
// requests were being given a 77-day statutory clock) and a leftover `__probe` marker, and the live TX
// clarification policy was found `enabled: true` with no provenance — a policy switched ON in production by
// a crashed test. Both had persisted silently, and both were *cemented* by the harness's own restore logic,
// which snapshotted whatever it read at start and wrote it back.
//
// Nothing in the system could see it. The attestation-drift check compares `content_hash` against
// `attested_hash` — but nothing is attested yet, so it had nothing to compare against. This module fills
// that hole with INVARIANTS that hold regardless of attestation:
//
//   1. No live rule may be stamped by a test.        (updated_by ~ harness|probe|test)
//   2. No config may carry keys its schema does not define.  (catches `__probe` and typo'd fields)
//   3. A policy that is ENABLED must carry provenance.       (an enabled rule with no citation is not a
//                                                             decision a city made — it is a test write)
//   4. Clock base durations must be plausible.               (1..45 days — tight enough to catch a 77)
//   5. The active jurisdiction must have a usable primary clock.
//
// Run it any time: GET /api/config-integrity, or node src/db/check_config_integrity.js
var db = require('../db');

var TEST_STAMP = /harness|probe|^test$|debug/i;
// The longest BASE response deadline in any researched statute is 30 days (TX redaction_required).
var MAX_BASE_DURATION_DAYS = 45;
// WS3 bands for the kinds that are NOT the response deadline. An AG referral / briefing / certification
// duty runs in weeks (TX 10-15 business days; the outer researched case is under three months). A window
// belonging to the REQUESTOR runs in months by design — MO gives 90 days to pay, 150 above $1,000 — and a
// service target is whatever the city chooses. Neither band is an invitation to relax the response band
// above: they exist so that nobody has to.
var MAX_AGENCY_ACTION_DAYS = 90;
var MAX_LONG_WINDOW_DAYS = 365;

// The known schema for each domain, so an unexpected key is detectable.
function schemaKeys(domain) {
  if (domain === 'clarification') return keysOf(require('./clarificationPolicy'));
  if (domain === 'payment') return keysOf(require('./paymentClockPolicy'));
  if (domain === 'fee_waiver') return keysOf(require('./feeWaiverPolicy'));
  if (domain === 'deadline') return ['version', 'note', 'weekend', 'holidays', 'clocks'];
  return null; // unknown domain — do not police it
}
function keysOf(mod) {
  return ['enabled', 'provenance'].concat(mod.FIELDS.map(function (f) { return f.key; }));
}

// The enum/config fields a policy must cite if it is switched on.
function citableKeys(domain) {
  var k = schemaKeys(domain);
  if (!k || domain === 'deadline') return [];
  return k.filter(function (x) { return x !== 'enabled' && x !== 'provenance'; });
}

async function check() {
  var findings = [];
  var rows = await db.all('SELECT jurisdiction_id, domain, config_json, updated_by, updated_at FROM jurisdiction_rules ORDER BY jurisdiction_id, domain');

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var where = r.jurisdiction_id + '/' + r.domain;
    var cfg;
    try { cfg = JSON.parse(r.config_json); }
    catch (e) {
      findings.push({ severity: 'error', where: where, issue: 'config_json is not valid JSON', fix: 'Re-run the seed for this domain.' });
      continue;
    }

    // 1. A live rule stamped by a test is contamination, full stop.
    if (r.updated_by && TEST_STAMP.test(String(r.updated_by))) {
      findings.push({
        severity: 'error', where: where,
        issue: 'This live rule was last written by a TEST ("' + r.updated_by + '"). A harness has leaked into production config.',
        fix: 'Re-run the seed for this domain, then fix the harness so it does not mutate live config (or so it validates the snapshot it restores).'
      });
    }

    // 2. Keys the schema does not define — this is how `__probe` survived.
    var known = schemaKeys(r.domain);
    if (known) {
      Object.keys(cfg).forEach(function (k) {
        if (known.indexOf(k) < 0) {
          findings.push({
            severity: 'error', where: where,
            issue: 'Unknown config key "' + k + '" — not part of the ' + r.domain + ' schema. This is what a test probe looks like.',
            fix: 'Remove the key and re-run the seed.'
          });
        }
      });
    }

    // 3. An ENABLED policy with no provenance was not configured by a human.
    if (cfg.enabled === true) {
      var cites = citableKeys(r.domain);
      var prov = cfg.provenance || {};
      var missing = cites.filter(function (k) { return !prov[k] || !prov[k].citation; });
      if (cites.length && missing.length === cites.length) {
        findings.push({
          severity: 'error', where: where,
          issue: 'This policy is SWITCHED ON but carries no citation on any field. A rule a city actually adopted has provenance; this looks like a test write.',
          fix: 'Re-run the seed, or have the city re-enter and attest the policy.'
        });
      } else if (missing.length) {
        findings.push({
          severity: 'warn', where: where,
          issue: 'Enabled, but ' + missing.length + ' field(s) carry no citation: ' + missing.join(', ') + '.',
          fix: 'Add provenance before relying on these in a citizen-facing notice.'
        });
      }
    }

    // 4. Clock durations must be sane. 77 was not.
    if (r.domain === 'deadline' && cfg.clocks) {
      var primaries = [];
      Object.keys(cfg.clocks).forEach(function (type) {
        var def = cfg.clocks[type] || {};
        // WS3 — THE BAND DEPENDS ON WHAT KIND OF CLOCK THIS IS, and the default is the strict one.
        //
        // The 1..45 band was written for base RESPONSE deadlines and it must stay exactly that tight
        // there: it exists because a 77-day "standard" clock sat in live config for months looking
        // plausible. But the reconciled matrix also carries duties that are legitimately longer — Texas's
        // 61-day clarification window (§ 552.222(d)), its 60-day unclaimed-records window (§ 552.221(e)),
        // Missouri's 90/150-day fee windows — and rejecting those would either fail the check or, worse,
        // push someone to widen the response band to make it pass.
        //
        // A config with no `kind` is treated as `response`, so every clock written before WS3 is policed
        // exactly as it was. Widening is opt-in and per clock, never global.
        var kind = require('./clockMatrix').kindOf(def);
        var band = kind === 'response' ? MAX_BASE_DURATION_DAYS
                 : kind === 'agency_action' ? MAX_AGENCY_ACTION_DAYS
                 : MAX_LONG_WINDOW_DAYS;
        if (def.kind != null && require('./clockMatrix').KINDS.indexOf(def.kind) < 0) {
          findings.push({ severity: 'error', where: where, issue: 'Clock "' + type + '" has an unknown kind: "' + def.kind + '".',
            fix: 'One of: ' + require('./clockMatrix').KINDS.join(', ') + '.' });
        }
        if (def.primary) primaries.push(type);
        // A SERVICE TARGET MAY NEVER BE PRIMARY. The primary clock becomes requests.deadline_date, which
        // is what a requestor is told. Letting a city's own pacing number occupy that slot presents a
        // target as the date the law requires — pattern S-002's exact failure.
        if (def.primary && kind === 'operational_target') {
          findings.push({ severity: 'error', where: where,
            issue: 'Clock "' + type + '" is an operational TARGET but is marked primary, so the city\'s own service target would be published as the statutory deadline.',
            fix: 'Clear `primary` on the target, or give this state a real statutory response clock.' });
        }
        if (kind === 'operational_target' && def.default == null && def.duration == null && !def.durationByClassification) {
          findings.push({ severity: 'warn', where: where,
            issue: 'Operational target "' + type + '" has no value, so nothing paces this work. (' +
                   'This state sets no statutory time limit here — the city chooses one.)',
            fix: 'Set a service target on the deadlines section, then attest it.' });
        }
        var durs = [];
        if (def.default != null) durs.push(['default', def.default]);
        if (def.duration != null) durs.push(['duration', def.duration]);
        if (def.durationByClassification) {
          Object.keys(def.durationByClassification).forEach(function (c) { durs.push([c, def.durationByClassification[c]]); });
        }
        durs.forEach(function (d) {
          var n = Number(d[1]);
          // BASE durations only — an extension grows `request_clocks.duration`, never the config. So the
          // plausible band is tight: the longest base deadline we have anywhere is TX `redaction_required`
          // at 30 days. 45 leaves headroom for a state we have not seen.
          //
          // ⚠️ The first version of this check used 1..90 — which would have MISSED the 77-day clock it was
          // written to catch. The bound has to be tight enough to catch a plausible-looking wrong number,
          // not just an absurd one.
          if (!isFinite(n) || n < 1 || n > band) {
            findings.push({
              severity: 'error', where: where,
              issue: 'Clock "' + type + '" (' + kind + ') has an implausible duration: ' + d[0] + ' = ' + d[1] + ' day(s), ' +
                     'outside the 1-' + band + ' day band for that kind. ' +
                     (kind === 'response'
                       ? 'No US public-records statute sets a base response deadline outside 1-' + MAX_BASE_DURATION_DAYS + ' days ' +
                         '(the longest we have is 30). Extensions grow the request\'s clock, never this config.'
                       : 'If this duration is real, it belongs to a different kind of clock — check the reconciled ' +
                         'kind before widening anything.'),
              fix: 'Re-run the deadline seed. (A 77-day "standard" clock was found in production on 2026-07-14 — a test probe value that had been cemented by a harness restore.)'
            });
          }
        });
        if (def.basis && ['business_days', 'calendar_days'].indexOf(def.basis) < 0) {
          findings.push({ severity: 'error', where: where, issue: 'Clock "' + type + '" has an invalid basis: "' + def.basis + '".', fix: 'business_days or calendar_days.' });
        }
      });
      // TWO PRIMARY CLOCKS IS TWO LEGAL DEADLINES FOR ONE REQUEST. tolling picks "the" primary with an
      // ORDER BY created_at LIMIT 1, so a second one does not error — it just silently loses, and which
      // one wins depends on insertion order. That is a due date decided by accident.
      if (primaries.length > 1) {
        findings.push({ severity: 'error', where: where,
          issue: primaries.length + ' clocks are marked primary (' + primaries.join(', ') + '). A request has ONE legal due date, and the engine resolves the tie by row age.',
          fix: 'Leave `primary` on the statutory response clock only.' });
      }
    }
  }

  // 6. WS3 — every NAMED TIMER the state's research carries must have landed somewhere. A timer that
  // silently failed to reconcile is a statutory duty the engine cannot see, and the config looks complete
  // from the outside because what is missing is missing.
  var matrixRows = await db.all("SELECT jurisdiction_id, config_json FROM jurisdiction_rules WHERE domain = 'clock_matrix' ORDER BY jurisdiction_id");
  for (var m = 0; m < matrixRows.length; m++) {
    var mr = matrixRows[m], matrix = null;
    try { matrix = JSON.parse(mr.config_json); } catch (e) { continue; }
    var rec;
    try { rec = require('./clockMatrix').reconcile(matrix, {}); } catch (e) {
      findings.push({ severity: 'error', where: mr.jurisdiction_id + '/clock_matrix', issue: 'The clock matrix does not reconcile: ' + e.message, fix: 'Re-import the state template.' });
      continue;
    }
    (rec.unresolved || []).forEach(function (u) {
      findings.push({ severity: 'warn', where: mr.jurisdiction_id + '/clock_matrix',
        issue: 'Named timer "' + u.timer + '" did not resolve to a clock: ' + u.why,
        fix: 'Name the extra duty in clockMatrix.TIMERS (or add a rule-id SLOT_OVERRIDE) — do not let it be guessed.' });
    });
  }

  // 7. WS4 — an approval module routed at a role nobody can hold. The task spawns, pools to an empty
  // eligibility set, and NOTHING surfaces it: the request simply never gets its waiver decision, and the
  // estimate is blocked behind a decision that can never be made. Silent, and indistinguishable from a
  // slow week.
  var amRows = await db.all("SELECT jurisdiction_id, config_json FROM jurisdiction_rules WHERE domain = 'approval_modules' ORDER BY jurisdiction_id");
  for (var a = 0; a < amRows.length; a++) {
    var ar = amRows[a], amc = null;
    try { amc = JSON.parse(ar.config_json); } catch (e) { continue; }
    var AM = require('./approvalModules');
    AM.MODULES.forEach(function (m) {
      var n = AM.normalizeModule(m, amc[m]);
      if (n.unroutableRole) {
        findings.push({ severity: 'error', where: ar.jurisdiction_id + '/approval_modules',
          issue: 'The ' + m + ' module routes its task to "' + n.unroutableRole + '", which no one is eligible for. ' +
                 'The task would pool to nobody and block the estimate behind it.',
          fix: 'Route it to one of: ' + AM.ROUTABLE_ROLES.join(', ') + '.' });
      }
      if (n.mode === 'routed_task' && !n.routed_task.task_name) {
        findings.push({ severity: 'warn', where: ar.jurisdiction_id + '/approval_modules',
          issue: 'The ' + m + ' module spawns a task with no name.', fix: 'Give the task a name staff will recognise.' });
      }
    });
  }

  // 5. The ACTIVE jurisdiction must actually have a usable clock.
  var act = await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  var jid = act && act.value;
  if (!jid) {
    findings.push({ severity: 'error', where: 'system_config', issue: 'No active jurisdiction is set.', fix: "Set system_config['jurisdiction_profile']." });
  } else {
    var dl = await db.get("SELECT config_json FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = 'deadline'", [jid]);
    var ok = false;
    if (dl) { try { var c = JSON.parse(dl.config_json); ok = !!(c.clocks && Object.values(c.clocks).some(function (d) { return d.primary; })); } catch (e) {} }
    if (!ok) {
      findings.push({
        severity: 'warn', where: jid + '/deadline',
        issue: 'The active jurisdiction has no PRIMARY clock configured, so requests fall back to the built-in default rules.',
        fix: 'Seed deadline rules for this jurisdiction.'
      });
    }
  }

  var errors = findings.filter(function (f) { return f.severity === 'error'; });
  return {
    clean: errors.length === 0,
    checked: rows.length,
    activeJurisdiction: jid || null,
    errors: errors.length,
    warnings: findings.length - errors.length,
    findings: findings
  };
}

module.exports = { check: check };
