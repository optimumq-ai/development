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
  try {
    await require('./taskRouting').applyStageTransition(requestId, stage, {
      actorId: 'workflow', actorName: 'Workflow Engine', action: 'STAGE_ADVANCED', notes: reasoning, createdBy: 'workflow'
    });
  } catch (e) { console.error('[workflowEngine] stage transition failed:', e && e.message); }

  // Auto path: a confident match routed to an owning team -> spawn the ESTIMATE task and route it
  // (Smart Routing to a specialist, else into the team's claim pool). Estimate precedes record search.
  if (hit && hit.rule && hit.rule.id === 'wfr-confident' && teamId) {
    try {
      var tr = require('./taskRouting');
      var existing = await db.get("SELECT id FROM tasks WHERE request_id = ? AND type = 'estimate' AND status IN ('open','assigned','in_progress')", [requestId]);
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

  // Statutory clocks: create the jurisdiction intake clocks (idempotent) + sync primary clock -> deadline_date.
  try { await require('./tolling').startClocksForRequest(requestId); } catch (e) { console.error('[workflowEngine] clock start failed:', e && e.message); }

  return { stage:stage, teamId:teamId, teamName: teamRow?teamRow.name:null, rule: hit?hit.rule.name:null, signals:signals };
}

function bg(promise, label){ Promise.resolve(promise).catch(function(e){ console.error('[workflowEngine] '+(label||'task')+' failed:', e && e.message); }); }

module.exports = { onIntake:onIntake, evaluate:evaluate, buildSignals:buildSignals, resolveTeam:resolveTeam, matches:matches, cmp:cmp, bg:bg };
