'use strict';
// BW9b — THE RULE-CONTENT EDITORS' DATA LAYER (Draft 10, all five §5 questions decided 2026-08-11).
//
// Three jobs:
//
//   content(jid, section)  — the section screen's Content + Provenance + Proposals zones, assembled
//                            server-side (the BW8 package pattern). Each section renders its REAL
//                            stored content: the deadlines section builds the named-timer table from
//                            the deadline + clock_matrix domains together (Frame C, with Kevin's
//                            humanized "use case" labels and plain-language consequences); fee
//                            renders its statute-derived schedule concepts; the policed policy
//                            domains render their labeled fields with provenance; exemption/
//                            redaction render the redaction_rules + legal_sources store. Empty is
//                            honest — a domain the state never imported says so, never alarms.
//
//   propose(...)           — THE ONE AUDIT PATH FOR CONTENT EDITS. Editing statute-derived content
//                            asserts the law says otherwise: citation + note REQUIRED, the WS1–WS3
//                            police rules run at COMPOSE time (configIntegrity.validateDomainConfig —
//                            the same code, the same wording the engine uses), and the edit ALWAYS
//                            lands as a config_proposals row (source_ref 'editor') in the existing
//                            review/apply flow. Nothing edits silently.
//
//   applyEditorProposal()  — the apply path for editor proposals. The adapters apply to their OWN
//                            live stores (fee_profiles, jurisdiction_profiles…) and clock_matrix has
//                            no adapter at all — but what these editors legitimately edit is the
//                            jurisdiction_rules row itself (Draft 10 §6), so an editor proposal
//                            applies via jurisdictionRules.write + profile re-sync. The sync is what
//                            recomputes content_hash: an attested section DRIFTS and demands
//                            re-attestation (drift-warn, decided — never a silent write, never an
//                            outage).
//
// OWNERSHIP (decided 2026-08-11): applying an EDITOR proposal on a Legal Rules domain requires
// Senior Legal (ATTORNEY_REVIEWER) — a Director's edit there routes to Senior Legal and is never
// self-applied. Non-Legal domains apply at Director level. Template/extraction proposals keep their
// existing Director-level apply (that flow predates this decision and was not re-opened).
var { get, all, run } = require('../db');
var JR = require('./jurisdictionRules');
var JP = require('./jurisdictionProfile');
var GL = require('./goLive');
var CI = require('./configIntegrity');
var CM = require('./clockMatrix');
var RR = require('./rulesResearch');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function uid(p) { return (p || 'prop') + '-' + require('uuid').v4().slice(0, 8); }

// Legal Rules domains (Draft 10 ownership, ratified): the statutory-content domains Senior Legal owns.
var LEGAL_DOMAINS = { exemption: 1, redaction: 1, deadline: 1, clock_matrix: 1 };

// Which jurisdiction_rules domains a SECTION's content zone reads. The deadlines section is the one
// two-domain screen: the timer table joins deadline.clocks to clock_matrix.timers.
function domainsFor(section) {
  if (section === 'deadlines') return ['deadline', 'clock_matrix'];
  var d = GL.SECTION_DOMAIN[section];
  return d ? [d] : [];
}

// ── FRAME C VOCABULARY (Kevin 2026-08-11: humanized labels, plain-language descriptions with the
// run-out consequence; snake_case keys stay in request_clocks.clock_type and the templates) ────────
var KIND_LABELS = {
  response: 'Response — statutory',
  agency_action: 'Agency action',
  requestor_window: 'Requestor window',
  operational_target: 'Operational target — NOT a legal deadline'
};
var USE_CASES = {
  acknowledge: 'Confirm to the requestor that their request arrived. Missing it reads as silence and, in some states, starts appeal rights running.',
  respond: 'The legal deadline for the city’s first response to the request. Missing it is a statutory violation — in some states the request is treated as denied.',
  complete: 'The deadline or window for finishing production of the records.',
  certify_delay: 'The deadline to certify in writing why more time is needed and when the records will come.',
  deny: 'The deadline to issue a denial. Running out does not deny the request — it leaves the city out of compliance.',
  ag_ruling: 'The deadline to ask the state Attorney General for permission to withhold records. Missing it usually means the records are presumed public.',
  ag_submission: 'The deadline to send the Attorney General the city’s reasons. Missing it weakens or forfeits the withholding argument.',
  clarification_window: 'How long the requestor has to answer the city’s request to clarify what they want. No answer in time = the request is treated as withdrawn.',
  nonpayment_window: 'How long the requestor has to pay what is due. Unpaid past this window = the request may be closed for nonpayment.',
  special_window: 'A state-specific duty that does not fit the standard timers — its citation says what it is.'
};
var TIMER_LABELS = {
  acknowledgment: 'Acknowledgment', initial_decision: 'Initial decision', completion: 'Completion',
  denial_deadline: 'Denial deadline', ag_referral: 'AG referral', clarification_response: 'Clarification response',
  nonpayment_close: 'Nonpayment close', special_windows: 'Special windows', extension: 'Extension', suspension: 'Suspension'
};
function slotLabel(clockKey) {
  var names = Object.keys(CM.TIMERS);
  for (var i = 0; i < names.length; i++) {
    var slots = CM.TIMERS[names[i]].slots || [];
    for (var j = 0; j < slots.length; j++) if (slots[j].key === clockKey) return slots[j].label;
  }
  return null;
}
function durationText(def) {
  var basis = def.basis === 'business_days' ? 'business days' : def.basis === 'calendar_days' ? 'calendar days' : (def.basis || 'days');
  if (def.durationByClassification) {
    return Object.keys(def.durationByClassification).map(function (k) {
      return k + ' ' + def.durationByClassification[k];
    }).join(' · ') + ' ' + basis;
  }
  var n = def.duration != null ? def.duration : def.default;
  if (n == null) return null; // honest absence — an unset target paces nothing
  return n + ' ' + basis;
}

// The Frame C named-timer table: deadline.clocks joined to clock_matrix.timers.
function timerTable(deadlineCfg, matrixCfg) {
  var rows = [];
  var clocks = (deadlineCfg && deadlineCfg.clocks) || {};
  var timers = (matrixCfg && matrixCfg.timers) || {};
  Object.keys(clocks).forEach(function (key) {
    var def = clocks[key] || {};
    var kind = CM.kindOf(def);
    var timer = def.timer && timers[def.timer] ? timers[def.timer] : null;
    var drill = [].concat(def.source_rule_ids || [], (timer && timer.source_rule_ids) || []);
    rows.push({
      clockType: key,                                        // the wire key — display uses the labels
      label: def.label || slotLabel(key) || key,
      kind: kind, kindLabel: KIND_LABELS[kind] || kind,
      useCase: USE_CASES[key] || def.note || (timer && timer.note) || null,
      duration: durationText(def),
      durationRaw: def.duration != null ? def.duration : (def.default != null ? def.default : null),
      unset: durationText(def) == null,
      basis: def.basis || null, primary: def.primary === true,
      citation: def.citation || null,
      timer: def.timer || null,
      timerLabel: def.timer ? (TIMER_LABELS[def.timer] || def.timer) : null,
      startOn: def.startOn || null, tollReasons: def.tollReasons || [],
      sourceRuleIds: drill.filter(function (v, i) { return drill.indexOf(v) === i; }),
      exposures: def.exposures || []
    });
  });
  // Statutory first (the reader's priority), targets last; primary leads its kind.
  var order = { response: 0, agency_action: 1, requestor_window: 2, operational_target: 3 };
  rows.sort(function (a, b) {
    var d = (order[a.kind] || 0) - (order[b.kind] || 0);
    return d !== 0 ? d : (b.primary === true) - (a.primary === true);
  });
  // Present timers that resolved to NO clock — shown as absence, never invented.
  var landed = {}; rows.forEach(function (r) { if (r.timer) landed[r.timer] = 1; });
  var unlanded = Object.keys(timers).filter(function (t) {
    return timers[t] && timers[t].present === true && !landed[t];
  }).map(function (t) { return { timer: t, timerLabel: TIMER_LABELS[t] || t, sourceRuleIds: timers[t].source_rule_ids || [] }; });
  var statutory = rows.some(function (r) { return r.kind === 'response' || r.kind === 'agency_action'; });
  return { rows: rows, unlandedTimers: unlanded, noStatutoryDeadlines: !statutory };
}

// fee_schedule concepts → fact rows (Frame A: statute-derived, cited).
function feeFacts(feeCfg) {
  var out = [];
  var sched = (feeCfg && feeCfg.fee_schedule) || {};
  Object.keys(sched).forEach(function (concept) {
    (sched[concept] || []).forEach(function (item) {
      out.push({ concept: concept, ruleId: item.rule_id || null, citation: item.authority || null, summary: item.summary || null });
    });
  });
  return out;
}

// A policed policy module's labeled fields with provenance — statute-derived where cited, city
// policy where not. Used for clarification (full renderer) and reused by payment/fee_waiver.
function policyFields(mod, cfg) {
  cfg = cfg || {};
  var prov = cfg.provenance || {};
  return { enabled: cfg.enabled === true, fields: (mod.FIELDS || []).map(function (f) {
    var p = prov[f.key];
    return {
      key: f.key, label: f.label || f.key, help: f.help || null, type: f.type || null,
      values: f.values || null, value: cfg[f.key] != null ? cfg[f.key] : null,
      citation: p && p.citation ? p.citation : null,
      sourceRuleIds: (p && p.source_rule_ids) || [],
      statuteDerived: !!(p && p.citation)
    };
  }) };
}

// Exemption/redaction content: the redaction_rules + legal_sources store — what actually exists.
// `wired` is honest: an ACTIVE approved rule is applied by the redaction engine; a draft is
// content-only (nothing consumes it yet) — the branch-profile vocabulary applied to content.
async function exemptionList(jid) {
  var rows = await all(
    'SELECT r.id, r.title, r.description, r.category, r.approval_status, r.is_active, r.source ' +
    'FROM redaction_rules r WHERE r.jurisdiction_id = ? ORDER BY r.sort_order, r.title', [jid]);
  var cites = await all(
    'SELECT rls.rule_id, ls.citation, ls.name FROM rule_legal_sources rls JOIN legal_sources ls ON ls.id = rls.legal_source_id', []);
  var byRule = {};
  cites.forEach(function (c) { (byRule[c.rule_id] = byRule[c.rule_id] || []).push({ citation: c.citation, name: c.name }); });
  return rows.map(function (r) {
    var active = r.is_active == 1 && r.approval_status === 'approved';
    return {
      id: r.id, title: r.title, description: r.description, category: r.category,
      status: r.approval_status, active: active,
      wired: active, wiredLabel: active ? 'wired' : 'content-only',
      wiredWhy: active ? 'The redaction engine applies this rule.' : 'A correct, queryable fact — no active redaction applies it yet.',
      citations: byRule[r.id] || [], source: r.source || null
    };
  });
}

// ── THE CONTENT READ — one payload per section screen ────────────────────────────────────────────
async function content(jid, section) {
  var state = await JP.sectionState(jid, section);
  if (!state) throw new Error('Unknown section: ' + section);
  var domains = domainsFor(section);
  var cfgs = {};
  for (var i = 0; i < domains.length; i++) cfgs[domains[i]] = await JR.read(jid, domains[i]);

  var body;
  if (section === 'deadlines') {
    body = Object.assign({ kind: 'timerTable' }, timerTable(cfgs.deadline, cfgs.clock_matrix));
  } else if (section === 'fees') {
    body = { kind: 'facts', facts: feeFacts(cfgs.fee) };
  } else if (section === 'clarification' || section === 'payment' || section === 'fee_waiver') {
    var mod = section === 'clarification' ? require('./clarificationPolicy')
            : section === 'payment' ? require('./paymentClockPolicy') : require('./feeWaiverPolicy');
    body = Object.assign({ kind: 'fields' }, policyFields(mod, cfgs[domains[0]]));
  } else if (section === 'exemption' || section === 'redaction') {
    var jur = await get('SELECT exemption_model FROM jurisdiction_profiles WHERE id = ?', [jid]);
    body = { kind: 'exemptionList', exemptions: await exemptionList(jid),
      exemptionModel: (jur && jur.exemption_model) || null,
      areaEditor: '/admin?tab=redaction',
      areaEditorNote: 'Rule rows are authored and approved in the Redaction Rules area — its draft → legal-approval flow is the audit path for row-level changes. The domain configuration below edits as a proposal here.' };
  } else {
    body = { kind: 'raw', config: cfgs[domains[0]] || null };
  }

  // Provenance zone: what the import wrote, and every research id the content references.
  var sourceIds = [];
  domains.forEach(function (d) {
    var c = cfgs[d];
    if (c && Array.isArray(c.source_rule_ids)) sourceIds = sourceIds.concat(c.source_rule_ids);
  });
  if (body.rows) body.rows.forEach(function (r) { sourceIds = sourceIds.concat(r.sourceRuleIds || []); });
  if (body.facts) body.facts.forEach(function (f) { if (f.ruleId) sourceIds.push(f.ruleId); });
  if (body.fields) body.fields.forEach(function (f) { sourceIds = sourceIds.concat(f.sourceRuleIds || []); });
  sourceIds = sourceIds.filter(function (v, i) { return v && sourceIds.indexOf(v) === i; });

  var proposals = domains.length ? await all(
    "SELECT id, domain, status, summary, source_ref, created_by, created_at FROM config_proposals " +
    "WHERE jurisdiction_id = ? AND domain IN (" + domains.map(function () { return '?'; }).join(',') + ") " +
    "AND status = 'pending' ORDER BY created_at DESC",
    [jid].concat(domains)) : [];

  return {
    section: section, label: state.label, state: state,
    owner: GL.OWNERS[section] || { group: null, label: null },
    legal: domains.some(function (d) { return LEGAL_DOMAINS[d]; }),
    domains: domains, editable: domains.filter(function (d) { return d !== 'template_import'; }),
    configs: cfgs,   // the raw stored configs — what the composer edits (proposed_json is the FULL config)
    content: body,
    provenance: {
      imported: domains.map(function (d) {
        var c = cfgs[d];
        return { domain: d, imported: !!(c && c._import), importInfo: (c && c._import) || null };
      }),
      sourceRuleIds: sourceIds
    },
    proposals: proposals
  };
}

// ── POLICED ENUMS: a guessed value never gets in — refused in words at compose time ──────────────
var POLICED_MODULES = {
  clarification: function () { return require('./clarificationPolicy'); },
  payment: function () { return require('./paymentClockPolicy'); },
  fee_waiver: function () { return require('./feeWaiverPolicy'); }
};
function policedEnumErrors(domain, cfg) {
  var getMod = POLICED_MODULES[domain];
  if (!getMod) return [];
  var errs = [];
  (getMod().FIELDS || []).forEach(function (f) {
    if (f.type !== 'enum' || cfg[f.key] == null) return;
    if ((f.values || []).indexOf(cfg[f.key]) < 0) {
      errs.push('"' + cfg[f.key] + '" is not a value ' + domain + '.' + f.key + ' can hold — this is a policed domain and never accepts a guessed value. One of: ' + (f.values || []).join(', ') + '.');
    }
  });
  return errs;
}

// Compose-time validation: the SAME invariants the engine polices, plus the policed enums.
function validate(domain, cfg) {
  var errs = [];
  var findings = domain === 'clock_matrix' ? CI.validateClockMatrix(cfg) : CI.validateDomainConfig(domain, cfg);
  findings.forEach(function (f) { if (f.severity === 'error') errs.push(f.issue); });
  return errs.concat(policedEnumErrors(domain, cfg || {}));
}

function mayApplyEditor(roles, domain) {
  roles = roles || [];
  if (roles.indexOf('SYSTEM_ADMIN') !== -1) return null;
  if (LEGAL_DOMAINS[domain]) {
    if (roles.indexOf('ATTORNEY_REVIEWER') !== -1) return null;
    return 'Senior Legal applies content changes on the Legal Rules domains (' + domain + '). Your proposal is filed for their review — it was not lost, and it was not applied.';
  }
  if (roles.indexOf('DIRECTOR') !== -1) return null;
  return 'The ' + domain + ' domain’s owner (the Director) applies content changes. Your proposal is filed for review.';
}

// ── THE COMPOSER: every content edit is a proposal — one audit path, no exceptions ───────────────
async function propose(jid, section, domain, proposedCfg, opts) {
  opts = opts || {};
  if (!jid) throw new Error('No active jurisdiction.');
  if (domainsFor(section).indexOf(domain) < 0) throw new Error('The ' + domain + ' domain does not belong to the ' + section + ' section.');
  if (domain === 'template_import') throw new Error('The template manifest is read-only — it records what the importer did, and nothing edits the record of what happened.');
  if (!opts.citation || !String(opts.citation).trim()) {
    throw new Error('A citation is required — editing statute-derived content asserts what the law provides, and an assertion about the law carries its authority.');
  }
  if (!opts.note || !String(opts.note).trim()) {
    throw new Error('A note is required — the next reader needs to know why this change was made, not just what changed.');
  }
  var errs = validate(domain, proposedCfg);
  if (errs.length) {
    var e = new Error(errs[0] + (errs.length > 1 ? ' (+' + (errs.length - 1) + ' more refusal(s) — fix this one first.)' : ''));
    e.refusals = errs;
    throw e;
  }
  var current = await JR.read(jid, domain);
  if (!current) throw new Error('No ' + domain + ' configuration exists for this jurisdiction — import a state template or add the first rule through its area editor; a proposal edits content that exists.');

  var id = uid('prop');
  await run(
    'INSERT INTO config_proposals (id, jurisdiction_id, domain, status, summary, proposed_json, current_json, source_ref, created_by, created_at) ' +
    "VALUES (?,?,?,?,?,?,?,'editor',?,?)",
    [id, jid, domain, 'pending',
     String(opts.note).trim() + ' — citation: ' + String(opts.citation).trim(),
     JSON.stringify(proposedCfg || {}), JSON.stringify(current), opts.actor || 'staff', nowStr()]);
  var row = await get('SELECT * FROM config_proposals WHERE id = ?', [id]);

  if (opts.applyNow) {
    var refusal = mayApplyEditor(opts.roles, domain);
    if (refusal) return { proposal: row, applied: false, refusal: refusal };
    var applied = await applyEditorProposal(row, opts.actor || 'staff');
    return { proposal: applied.proposal, applied: true, drifted: applied.drifted };
  }
  return { proposal: row, applied: false };
}

// Apply an EDITOR proposal: write the jurisdiction_rules row, mark the proposal, re-sync the
// profile — the sync recomputes content_hash, which is what makes an attested section drift.
async function applyEditorProposal(proposal, actor) {
  if (!proposal || proposal.source_ref !== 'editor') throw new Error('Not an editor proposal.');
  if (proposal.status !== 'pending') throw new Error('This proposal is already ' + proposal.status + '.');
  var cfg = {};
  try { cfg = JSON.parse(proposal.proposed_json || '{}'); } catch (e) { throw new Error('The proposal’s configuration is not valid JSON.'); }
  // Validate AGAIN at apply time — the config may have been edited in review, and the stored
  // invariants must hold no matter which door a write comes through.
  var errs = validate(proposal.domain, cfg);
  if (errs.length) throw new Error(errs[0]);
  var wasAttested = null;
  try { wasAttested = await JP.sectionState(proposal.jurisdiction_id, sectionForDomain(proposal.domain)); } catch (e) {}
  await JR.write(proposal.jurisdiction_id, proposal.domain, cfg, actor || 'staff');
  var now = nowStr();
  await run("UPDATE config_proposals SET status = 'applied', applied_json = ?, reviewed_by = ?, reviewed_at = ?, attested_by = ?, attested_at = ? WHERE id = ?",
    [JSON.stringify(cfg), actor || 'staff', now, actor || 'staff', now, proposal.id]);
  try { await JP.sync(proposal.jurisdiction_id, { source: 'editor-proposal', actor: actor }); } catch (e) {}
  var after = null;
  try { after = await JP.sectionState(proposal.jurisdiction_id, sectionForDomain(proposal.domain)); } catch (e) {}
  return {
    proposal: await get('SELECT * FROM config_proposals WHERE id = ?', [proposal.id]),
    drifted: !!(after && after.drift),
    driftNote: after && after.drift
      ? 'The ' + after.label + ' section was attested and has now DRIFTED — the engine keeps running the new configuration (drift-warn, as decided), and the section demands re-attestation.'
      : null,
    wasAttested: !!(wasAttested && wasAttested.attested)
  };
}

function sectionForDomain(domain) {
  if (domain === 'deadline' || domain === 'clock_matrix') return 'deadlines';
  var keys = Object.keys(GL.SECTION_DOMAIN);
  for (var i = 0; i < keys.length; i++) if (GL.SECTION_DOMAIN[keys[i]] === domain) return keys[i];
  return domain;
}

module.exports = { LEGAL_DOMAINS: LEGAL_DOMAINS, domainsFor: domainsFor, content: content,
  propose: propose, applyEditorProposal: applyEditorProposal, validate: validate,
  mayApplyEditor: mayApplyEditor, sectionForDomain: sectionForDomain,
  USE_CASES: USE_CASES, KIND_LABELS: KIND_LABELS, research: RR };
