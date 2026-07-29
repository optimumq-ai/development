'use strict';
// Deterministic workflow engine.
// The AI classifier supplies the match SIGNALS (record type, confidence, flags, etc.).
// This engine applies a human-authored, deterministic RULEBOOK to those signals,
// decides the routing (stage + team), applies it, and records WHY (decision trail).
// Reproducible and explainable by design - no LLM in the decision path.
var db = require('../db');
var classifier = require('./classifier');
var uuid = require('uuid');

function parseJSON(s, dflt){ try { var v = JSON.parse(s); return v == null ? dflt : v; } catch(e){ return dflt; } }

function cmp(op, a, b){
  switch(op){
    case 'gte': return Number(a) >= Number(b);
    case 'gt':  return Number(a) >  Number(b);
    case 'lte': return Number(a) <= Number(b);
    case 'lt':  return Number(a) <  Number(b);
    case 'eq':  return String(a) === String(b);
    case 'neq': return String(a) !== String(b);
    case 'is_true':  return a === true || a === 1 || a === '1' || a === 'true';
    case 'is_false': return !(a === true || a === 1 || a === '1' || a === 'true');
    case 'in': return Array.isArray(b) && b.map(String).indexOf(String(a)) >= 0;
    case 'contains': return Array.isArray(a) ? a.map(String).indexOf(String(b)) >= 0 : String(a||'').toLowerCase().indexOf(String(b).toLowerCase()) >= 0;
    case 'contains_any': return Array.isArray(b) && Array.isArray(a) && a.some(function(x){ return b.map(String).indexOf(String(x)) >= 0; });
    default: return false;
  }
}

function matches(conditions, signals){
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every(function(c){ return cmp(c.op, signals[c.field], c.value); });
}

async function buildSignals(request, m){
  var rt = null;
  if (m.recordTypeId) rt = await db.get("SELECT rt.code, rt.public_availability, c.name AS category FROM record_types rt LEFT JOIN categories c ON c.id = rt.category_id WHERE rt.id = ?", [m.recordTypeId]);
  return {
    record_type_confidence: typeof m.recordTypeConfidence === 'number' ? m.recordTypeConfidence : 0,
    record_type_code: rt ? rt.code : null,
    record_type_name: m.recordTypeName || null,
    category: rt ? rt.category : null,
    public_availability: rt ? rt.public_availability : null,
    classification: m.classification || 'standard',
    redaction_flag: !!m.redactionFlag,
    mrr_flag: !!m.isMrr,
    origin: (request.submission_channel === 'portal') ? 'portal' : 'manual',
    has_owner_team: !!m.custodianDepartmentId,
    flags: Array.isArray(m.flags) ? m.flags : []
  };
}

async function resolveTeam(ref, m){
  if (!ref || ref === 'matched') return m.departmentId || null;
  if (ref === 'open_records'){ var t = await db.get("SELECT id FROM departments WHERE kind='team' AND is_open_records=1 ORDER BY sort_order LIMIT 1"); return t ? t.id : (m.departmentId || null); }
  return ref;
}

async function evaluate(signals){
  var rules = await db.all("SELECT * FROM workflow_rules WHERE enabled = 1 ORDER BY priority ASC, created_at ASC");
  for (var i=0;i<rules.length;i++){
    if (matches(parseJSON(rules[i].conditions, []), signals)) return { rule: rules[i], actions: parseJSON(rules[i].actions, {}) };
  }
  return null;
}

// Main entry: decide + apply + record. Designed to be called fire-and-forget after a request is created.
async function onIntake(requestId, matcherResult){
  var request = await db.get("SELECT * FROM requests WHERE id = ?", [requestId]);
  if (!request) return null;
  var m = matcherResult;
  if (!m){
    try { m = await classifier.classifyAndRoute(request.description); }
    catch(e){ m = { classification:'standard', recordTypeConfidence:0, flags:[], departmentId:null, custodianDepartmentId:null, reasoning:'Automatic classification was unavailable.' }; }
  }
  var signals = await buildSignals(request, m);
  var hit = await evaluate(signals);
  var actions = hit ? hit.actions : { stage:'intake', team:'open_records', note:'No rulebook match.' };
  var teamId = await resolveTeam(actions.team, m);
  if (m && m.routingBasis === 'unassigned') teamId = null; // Unassigned classification stays Unassigned (triage), not auto-stamped to Open Records
  var teamRow = teamId ? await db.get("SELECT name FROM departments WHERE id = ?", [teamId]) : null;
  var stage = actions.stage || request.stage || 'intake';

  // A request CLOSED between /public/submit and this (background) intake landing must NOT be re-routed:
  // routing it would silently revive a terminal request and leave claimable tasks on it. The top-of-function
  // read is stale by now (the classifier call above can take seconds), so re-read the CURRENT status and bail
  // if it went closed. This was the verify_stage_bypass flake: a slow classifier let intake land after a
  // nonpayment close / tickler withdrawal and revert stage=closed. applyStageTransition has no from-closed
  // guard, so the guard belongs here at the one background router.
  var live = await db.get("SELECT status, stage FROM requests WHERE id = ?", [requestId]);
  if (live && live.status === 'closed') return { routed: false, skippedClosed: true };

  // ...AND THE SAME STALENESS APPLIES TO THE STAGE, WHICH IS WHERE THIS GUARD USED TO STOP.
  //
  // The guard above re-reads because the classifier call takes seconds — then checked only `status`, so a
  // request that MOVED in that window was still routed, and `stage` below comes from the STALE top-of-
  // function read. Anything a person did while the classifier ran was silently overwritten by the rulebook's
  // decided stage (usually `intake`).
  //
  // Observed 2026-07-19 on a real child request:
  //     EXEMPTION_ASSERTED  intake -> exemption_review     (a legal act, by a person)
  //     STAGE_ADVANCED      exemption_review -> intake     ("Automatic classification was unavailable.")
  //
  // The asserted exemption was undone and its legal_review task cancelled with the stage it belonged to
  // (§3.2) — so the request looked untouched and the reviewer's work was gone. It is NOT specific to
  // exemptions or to a failing classifier: any staff action landing inside the classifier window loses, and
  // a SUCCESSFUL classification races exactly the same way.
  //
  // Intake routing is an OPENING move, so the guard is stated as a POSITION, not as a race.
  //
  // The first cut of this compared the stale read against `live` — a lost-update check. It caught the race
  // only when onIntake STARTED before the move, and missed the case where the whole call lands afterwards
  // (both reads then agree on the new stage and it overwrites anyway). The harness caught that.
  //
  // The real invariant does not mention timing at all: the engine may set the opening stage only while the
  // request is still AT its opening position — `intake`, or null for a parent that carries no stage. Once
  // anything has moved it, the opening move is over and is not the engine's to make. That covers the race,
  // the late landing, and any future caller, without needing to reason about who read what when.
  //
  // Routing metadata (record type, owning team) is still applied either way: it is the classifier's answer
  // to "what is this?", which stays correct and useful no matter where the request has got to.
  var atOpeningPosition = !!live && (live.stage === null || live.stage === 'intake');
  var movedUnderUs = !!live && !atOpeningPosition;

  // Pin the classifier-matched record type + owning team onto the request (ROUTING columns only — the
  // stage is applied below through the central stage-transition function, never a direct UPDATE here).
  // This feeds the estimate profile lookup (Create vs Review auto-fill) and the record-type name on task screens.
  var rtid = (m.recordTypeId && (signals.record_type_confidence || 0) >= 70) ? m.recordTypeId : null;
  await db.run("UPDATE requests SET department_id = ?, record_type_id = COALESCE(?, record_type_id), updated_at = datetime('now') WHERE id = ?", [teamId, rtid, requestId]);

  var reasoning = [m.reasoning, actions.note].filter(Boolean).join(' ');
  await db.run("INSERT INTO workflow_decisions (id, request_id, record_type_id, record_type_name, confidence, classification, rule_id, rule_name, decided_stage, decided_team_id, decided_team_name, reasoning, flags, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))",
    [uuid.v4(), requestId, m.recordTypeId || null, signals.record_type_name, Math.round(signals.record_type_confidence||0), signals.classification, hit?hit.rule.id:null, hit?hit.rule.name:'(no match)', stage, teamId, teamRow?teamRow.name:null, reasoning, JSON.stringify(signals.flags)]);

  // Apply the decided stage through the ONE central stage-transition function (Architecture item 6):
  // it writes the request_history advance row (stage_from -> stage_to) AND spawns/updates the stage's task.
  // Replaces the former direct `UPDATE requests SET stage` above, whose unlogged jump + missing stage task
  // was the root cause of the reconciler's stranded requests (reproduced on 2026-0039). department_id is
  // set just above so spawnForStage stamps the task onto the owning team. A no-op when stage is unchanged.
  if (movedUnderUs) {
    // Recorded, not silent. The whole reason this was hard to see is that the overwrite left no trace of a
    // decision having been declined — only the clobbered stage. The workflow_decisions row above still
    // captures WHAT the engine decided; this says it was not applied, and why.
    await db.run(
      "INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes, stage_from, stage_to, created_at) " +
      "VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
      [uuid.v4(), requestId, 'workflow', 'Workflow Engine', 'ROUTING_DEFERRED',
        'Intake routing decided ' + stage + ', but the request had already moved to ' + live.stage +
        ' while classification was running — the stage was left as it was found. ' + reasoning,
        live.stage, live.stage]);
  } else {
    try {
      await require('./taskRouting').applyStageTransition(requestId, stage, {
        actorId: 'workflow', actorName: 'Workflow Engine', action: 'STAGE_ADVANCED', notes: reasoning, createdBy: 'workflow'
      });
    } catch (e) { console.error('[workflowEngine] stage transition failed:', e && e.message); }
  }

  // Auto path: a confident match routed to an owning team -> spawn the ESTIMATE task and route it
  // (Smart Routing to a specialist, else into the team's claim pool). Estimate precedes record search.
  // Skipped when the request moved under us: this task belongs to the opening move the engine just declined
  // to make, and pooling an estimate onto a request now sitting in legal review is the same overwrite in
  // task form — it would put claimable work on a stage that never asked for it.
  if (hit && hit.rule && hit.rule.id === 'wfr-confident' && teamId && !movedUnderUs) {
    try {
      var tr = require('./taskRouting');
      var existing = await db.get("SELECT id FROM tasks WHERE request_id = ? AND type = 'estimate' AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [requestId]);
      if (!existing) {
        var etitle = 'Create estimate';
        try {
          if (m.recordTypeId) {
            var a = await require('./estimateProfile').assess(m.recordTypeId);
            if (a && a.decision === 'automated') etitle = 'Review auto-generated estimate';
          }
        } catch (e2) {}
        var task = await tr.createTask({ requestId: requestId, type: 'estimate', title: etitle, teamId: teamId, createdBy: 'workflow' });
        await tr.autoRouteOrPool(task.id, request.description, {});
      }
    } catch (e) { console.error('[workflowEngine] estimate task spawn failed:', e && e.message); }
  }

  // Fee-waiver approval: a requested waiver needs a decision before any amount is invoiced. Independent
  // of the record-type routing above; the estimate still proceeds (a granted waiver zeroes fees at notice
  // time). Idempotent, and skipped once a decision has been recorded. Resolved by /fee-waiver-decision,
  // or by the estimate notice, which cannot be SENT while the decision is outstanding.
  //
  // The module config is read ONCE and shared by both approval modules below: intake runs on every
  // request, so a second identical read is pure latency on the front door.
  var amConfig = null;
  if (request.fee_waiver_requested && !request.fee_waiver_status) {
    try {
      // PHASE 7 / WS4 — the fee-waiver APPROVAL MODULE decides what happens here, not a hardcoded spawn.
      // See services/approvalModules.js (DESIGN_fee_waiver_commercial.md, decided). Three outcomes:
      //   auto_granted   a statutorily MANDATORY category matched verified evidence (CT indigency, MI's
      //                  first $20, an AZ crime victim...). It is granted on the spot — no task, no
      //                  judgment call, and it fires whether or not the discretionary program is on.
      //   needs_decision routed_task -> spawn the configured task to the configured role;
      //                  intake_review -> spawn NOTHING, because the intake reviewer decides inline.
      //                  That is the whole point of the mode: no extra hop.
      //   not_offered    this state (or this city) has no discretionary waiver. Nothing stops — the
      //                  requester is told in the estimate notice.
      var AM = require('./approvalModules');
      var trw = require('./taskRouting');
      amConfig = amConfig || await AM.config(null);
      var wv = await AM.evaluateWaiver(null, request, { config: amConfig });
      if (wv.outcome === 'auto_granted') {
        await db.run("UPDATE requests SET fee_waiver_status = 'granted', fee_waiver_reason = ?, fee_waiver_decided_by = ?, fee_waiver_decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
          [wv.reason, 'statute', requestId]);
        await db.run("INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)",
          [require('uuid').v4(), requestId, null, 'Statutory Waiver', 'FEE_WAIVER_GRANTED', wv.reason]);
      } else if (wv.outcome === 'needs_decision' && wv.route && wv.route.mode === 'intake_review') {
        // BW2, trigger (iii) `approval_pending`. `intake_review` mode means "the intake reviewer decides
        // inline, no extra hop" — which presupposes there IS an intake review. Until this task type
        // existed there was none, so a city on this mode had its waiver decision dropped on the floor:
        // nothing spawned, and the estimate-communication gate then blocked the estimate behind a
        // decision nobody had been asked to make. Raising the stop is what the mode always meant.
        await require('./intakeReview').spawn(requestId, ['approval_pending'], {
          createdBy: 'workflow', requestText: request.description, awaitRouting: true
        });
      } else if (wv.outcome === 'needs_decision' && wv.route && wv.route.mode === 'routed_task') {
        var existingW = await db.get("SELECT id FROM tasks WHERE request_id = ? AND type = 'fee_waiver' AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [requestId]);
        if (!existingW) {
          var wtask = await trw.createTask({ requestId: requestId, type: 'fee_waiver', title: wv.route.task_name,
            teamId: null, roleRequired: wv.route.assignee_role, createdBy: 'workflow' });
          await trw.autoRouteOrPool(wtask.id, request.description, {});
        }
      }
    } catch (e) { console.error('[workflowEngine] fee-waiver module failed:', e && e.message); }
  }

  // COMMERCIAL-RATE CLASSIFICATION, at intake and nowhere else. New Jersey gives a commercial request a
  // 14-business-day window and Illinois a separate track, so the classification changes the DEADLINE —
  // decide it before anything quotes one. v1 records what the requester declared and, in routed_task
  // mode, raises the decision; it never reclassifies on its own, because overriding a self-declaration
  // changes the invoice and must be a human act that gets communicated.
  try {
    var AMc = require('./approvalModules');
    amConfig = amConfig || await AMc.config(null);
    var cm = await AMc.evaluateCommercial(null, request, { config: amConfig });
    if (cm.enabled && cm.outcome === 'needs_decision' && cm.route && cm.route.mode === 'intake_review') {
      // Same reasoning as the waiver branch above (BW2, trigger `approval_pending`): inline-decide mode
      // needs a stop to decide it at. If the waiver already raised one, this ADDS its key rather than
      // stacking a second task.
      await require('./intakeReview').spawn(requestId, ['approval_pending'], {
        createdBy: 'workflow', requestText: request.description, awaitRouting: true
      });
    } else if (cm.enabled && cm.outcome === 'needs_decision' && cm.route && cm.route.mode === 'routed_task') {
      var trc = require('./taskRouting');
      var existingC = await db.get("SELECT id FROM tasks WHERE request_id = ? AND type = 'fee_waiver' AND title = ? AND status IN ('open','assigned','in_progress','returned','awaiting_review')", [requestId, cm.route.task_name]);
      if (!existingC) {
        var ctask = await trc.createTask({ requestId: requestId, type: 'fee_waiver', title: cm.route.task_name,
          teamId: null, roleRequired: cm.route.assignee_role, createdBy: 'workflow' });
        await trc.autoRouteOrPool(ctask.id, request.description, {});
      }
    }
  } catch (e) { console.error('[workflowEngine] commercial-rate module failed:', e && e.message); }

  // Unroutable at intake: the classifier could not determine a fulfillment team (teamId null). Rather than
  // leaving the request silently Unassigned — or dumping it on the Open Records fulfillment team — spawn a
  // team-agnostic task so an ORO Associate reviews it and corrects the routing. Closed automatically when
  // the request is re-routed (PATCH /requests/:id/route). Idempotent.
  //
  // BW2 (2026-07-29): this is now trigger (i) `unroutable` of INTAKE REVIEW rather than a `routing_review`
  // task of its own (DRAFT_processing_ui_intake_review §0.5). Same condition, same role, same auto-close —
  // one stop instead of two overlapping ones. services/intakeReview.js owns the spawn and never throws.
  if (!teamId) {
    await require('./intakeReview').spawn(requestId, ['unroutable'], {
      createdBy: 'workflow', requestText: request.description, awaitRouting: true
    });
  }

  // Statutory clocks: create the jurisdiction intake clocks (idempotent) + sync primary clock -> deadline_date.
  try { await require('./tolling').startClocksForRequest(requestId); } catch (e) { console.error('[workflowEngine] clock start failed:', e && e.message); }

  return { stage:stage, teamId:teamId, teamName: teamRow?teamRow.name:null, rule: hit?hit.rule.name:null, signals:signals };
}

function bg(promise, label){ Promise.resolve(promise).catch(function(e){ console.error('[workflowEngine] '+(label||'task')+' failed:', e && e.message); }); }

module.exports = { onIntake:onIntake, evaluate:evaluate, buildSignals:buildSignals, resolveTeam:resolveTeam, matches:matches, cmp:cmp, bg:bg };
