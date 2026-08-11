'use strict';
// PHASE 7 / BW8 — THE POWER-MODE PACKAGE (Draft 9 Frame B; SPEC_processing_ui.md §5, DECIDED 2026-08-11).
//
// One read that puts THE SUBSTANCE ON THE SURFACE: the released set, the withholding log with its
// citations, the notice exactly as the requestor will receive it, and the item's flags. Draft 9's
// guardrail is that speed must never equal blindness — a reviewer in power mode sees everything the
// slow path would show, without a click. So this module assembles it all, and the screen adds nothing.
//
// TWO RULES THIS FILE IS SHAPED BY:
//
//   * ONE GATE, TWO READERS. The pipeline state comes from autoRelease.evaluate — the same function the
//     approve route re-evaluates before firing — so the panel's words and the 409's words cannot drift.
//   * THE NOTICE PREVIEW IS THE REAL BUILDER. closureNotice.build with the SAME ctx the release event
//     passes — never a re-implementation. A preview that drifts from the letter is worse than no
//     preview, because the reviewer approved something the citizen never got.
var db = require('../db');
var get = db.get, all = db.all;
var AR = require('./autoRelease');
var CN = require('./closureNotice');

// The parent-owned clock, resolved the way the intake queue resolves it (rule a: kind + citation +
// overdueMeaning from tolling.computeStatus; a request with no clock answers kind:'none' with a null
// date — the honest Ohio state — and nothing here invents a date).
async function clockFor(requestId) {
  try {
    var rules = await require('./tolling').loadRules();
    if (!rules) return null;
    var pr = await get('SELECT master_request_id FROM requests WHERE id = ?', [requestId]);
    var clockOwner = (pr && pr.master_request_id) || requestId; // clocks are PARENT objects (§4.2)
    var clocks = await all("SELECT * FROM request_clocks WHERE request_id = ? AND status <> 'satisfied' ORDER BY is_primary DESC, created_at", [clockOwner]);
    if (!clocks.length) return null;
    var tolls = await all('SELECT * FROM clock_tolls WHERE clock_id = ? ORDER BY created_at', [clocks[0].id]);
    var st = require('./tolling').computeStatus(clocks[0], tolls, rules);
    return { kind: st.kind, label: st.label, dueDate: st.dueDate, citation: st.citation,
             legalDeadline: st.legalDeadline, operationalTarget: st.operationalTarget,
             isOverdue: st.isOverdue, overdueMeaning: st.overdueMeaning,
             remainingDays: st.remainingDays, state: st.state, more: clocks.length - 1 };
  } catch (e) { console.error('[releaseReviewPackage clock]', requestId, e && e.message); return null; }
}

async function packageFor(requestId) {
  var request = await get('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!request) return null;
  // Parent facts THROUGH the parent (requestScope semantics; closureNotice.citizenFacts applies the
  // same precedence, so the strip and the letter name the same citizen and the same number).
  var who = await CN.citizenFacts(request);

  var evaluation = await AR.evaluate(requestId);

  // THE RELEASED SET — what actually ships: the responsive files.
  var files = await all(
    'SELECT id, original_name, filename, mimetype, size, uploaded_at FROM request_files ' +
    'WHERE request_id = ? AND responsive = 1 ORDER BY uploaded_at, original_name', [requestId]);

  // THE WITHHOLDING LOG — every redaction on the set with its authority (§5.7). The citation resolves
  // zone → rule → legal source; a zone whose rule carries no citation renders with rule title + note
  // rather than a fabricated authority — absence is shown as absence (no invented citations, rule a's
  // sibling for legal text).
  var zones = await all(
    'SELECT z.id, z.page_no, z.note, z.zone_type, z.review_state, z.created_by, z.created_at, ' +
    '       rr.title AS rule_title, rr.category AS rule_category, ' +
    '       (SELECT ls.citation FROM rule_legal_sources rls JOIN legal_sources ls ON ls.id = rls.legal_source_id ' +
    '        WHERE rls.rule_id = z.rule_id ORDER BY ls.citation LIMIT 1) AS citation ' +
    'FROM redaction_zones z JOIN redaction_jobs j ON j.id = z.job_id ' +
    'LEFT JOIN redaction_rules rr ON rr.id = z.rule_id ' +
    'WHERE j.request_id = ? ORDER BY z.page_no, z.created_at', [requestId]);

  // THE NOTICE, AS THE REQUESTOR RECEIVES IT — the real builder with the release event's own ctx
  // (autoRelease.release passes pageCount + installmentNo; deliveredAt is stamped at firing, so the
  // preview says so instead of inventing a timestamp).
  var installment = (Number(request.installment_no) || 0) + 1;
  var notice = null;
  try {
    notice = await CN.build('fulfilled', request, { pageCount: files.length, installmentNo: installment });
    notice.deliveredAtNote = 'delivered_at is stamped when the release fires — the letter above is otherwise final.';
    notice.willSendTo = who.requestor_email || null;
    // Rule (e): anonymous = "does not apply", never "hidden".
    if (!notice.willSendTo) notice.sendNote = 'No address is on file for this requester — an emailed notice does not apply; the closure and its basis are still recorded.';
  } catch (e) { console.error('[releaseReviewPackage notice]', requestId, e && e.message); }

  // FLAGS — the rail. The ledger's delivery-gate evaluation (advisory, never automatic — its badge
  // vocabulary is the module's own), and the hold/blocked facts straight off the evaluation.
  var ledger = null;
  try {
    var RL = require('./requestorLedger');
    var JR = require('./jurisdictionRules');
    ledger = await RL.evaluateDelivery(await JR.activeJid(), requestId);
  } catch (e) { console.error('[releaseReviewPackage ledger]', requestId, e && e.message); }

  return {
    requestId: requestId,
    strip: {
      requestNumber: who.request_number,
      requestorName: who.requestor_name,
      description: request.description || '',     // verbatim, never paraphrased (§2.1)
      deliveryMethod: request.delivery_method || null,
      clock: await clockFor(requestId),
      // THE REVIEW MUST NOT COUNT ITSELF. evaluate() lists the open release_review among the
      // non-terminal flow tasks (correctly — it IS open), but a reviewer reading "conditions open"
      // on a package whose only open condition is the review in their hands would go looking for
      // work that does not exist. `readyPendingReview` = every block is either the pre-send gate or
      // the review's own task row; the strip says "ready — pending this review".
      pipeline: (function () {
        var blockedElsewhere = (evaluation.blocked || []).filter(function (c) {
          if (c.code === 'PRE_SEND_REVIEW') return false;
          if (c.code === 'TASKS_TERMINAL') {
            return ((c.openTasks || []).filter(function (t) { return t.type !== 'release_review'; }).length) > 0;
          }
          return true;
        });
        return {
          eligible: evaluation.eligible,
          readyPendingReview: blockedElsewhere.length === 0,
          conditions: evaluation.conditions,
          balanceDue: (evaluation.releaseGate && Number(evaluation.releaseGate.balanceDue)) || 0
        };
      })()
    },
    releasedSet: {
      count: files.length,
      redactedZoneCount: zones.length,
      files: files.map(function (f) {
        return { id: f.id, name: f.original_name || f.filename, mimetype: f.mimetype, size: f.size };
      })
    },
    withholdingLog: {
      count: zones.length,
      entries: zones.map(function (z) {
        return { pageNo: z.page_no, ruleTitle: z.rule_title, category: z.rule_category,
                 citation: z.citation, note: z.note, zoneType: z.zone_type,
                 reviewState: z.review_state, createdBy: z.created_by, createdAt: z.created_at };
      })
    },
    notice: notice,
    flags: { ledger: ledger, hold: Number(request.release_hold) === 1 ? (request.release_hold_note || 'recorded hold') : null },
    evaluation: evaluation,
    installmentNo: installment
  };
}

module.exports = { packageFor: packageFor, clockFor: clockFor };
