'use strict';
// REQUEST RULES — the one screen behind THREE hub rows (WORKING_hub_linked_screens §2f, canvas approved
// by Kevin 2026-08-27): Vague requests and clarification · Exemptions and appeals · Requestor eligibility.
// Each tab = what the state's law says (the template's rules, citations opening the research record) ·
// the city's few choices (confirmable local policy settings) · attest.
//
// What this service owns:
//   screen(jid)        — the three tabs' law rules (walked out of the state template by concept domain),
//                        each tab's choices with value/confirmed state, and the letter previews.
//   setEnabled(...)    — the clarification master switch. The state load files the domain enabled:false;
//                        switching it ON is the act that lets the hub row leave "Not started". Enabling
//                        also MATERIALIZES the five clarification choices as city_config knobs in the
//                        clarification domain (idempotent), so the existing policy-settings/confirm
//                        plumbing (goLive.confirm) records each decision with a name and date.
//   confirmChoice(...) — clarification-tab confirms: goLive.confirm plus the policy-field side effects
//                        (reply window days → clarification_grace_days; closing notice → closure_notice_
//                        required). Exemption-tab choices go through the EXISTING policy-settings/confirm
//                        endpoint unchanged (Legal Rules scoping lives there).
//   setPosture(...)    — the eligibility tab's one decision: refuse incarcerated requesters (gated) or
//                        accept them (not gated), confirmed in the same act.
//
// Law display source: the state template file (rules library on disk, same read as feeLaw). Rules are
// collected by walking the template for concept-keyed rule arrays; a tab owns the concept domains listed
// in TAB_CONCEPTS. Letters stay STANDARD WORDING in this slice (Kevin 2026-08-27) — the editable
// template store with per-state required-content checks is its own later slice.
const { get } = require('../db');
const STI = require('./stateTemplateImport');
const JR = require('./jurisdictionRules');
const CP = require('./clarificationPolicy');
const CN = require('./clarificationNotice');
const GL = require('./goLive');
const JP = require('./jurisdictionProfile');

// concept-domain prefixes each tab shows as "what the law says"
const TAB_CONCEPTS = {
  clarification: ['clarification'],
  exemptions: ['appeal', 'denial'],
  eligibility: ['eligibility']
};

// The clarification tab's five choices (state-generic; TX_RULES_READABLE §4). `key` is the template
// knob the choice materializes as; kind drives the control the screen renders.
const CLAR_CHOICES = [
  { key: 'Master.bv', kind: 'text', label: 'When is a request too vague?',
    note: 'The wording intake staff see when they mark a request as too vague. The legal test itself comes from the statute.',
    suggested: 'The request does not reasonably describe the records to search for — for example, no subject, date range, or department.' },
  { key: 'Clarification.n2', kind: 'letter', label: 'The clarification letter',
    note: 'Every city sends the standard letter for now. Letter wording a city can edit comes later, as its own piece of work.',
    suggested: 'standard_wording' },
  { key: 'Clarification.n3', kind: 'days', label: 'How long may the requestor take to reply?',
    note: 'How many days the requestor has to reply before the request may be closed.', suggested: 30 },
  { key: 'Clarification.close', kind: 'bool', label: 'Send a closing notice when the reply window passes',
    note: 'Whether the requestor gets a short written notice when their request closes for lack of a reply. The closing itself follows the policy above; the notice is the city\'s own choice.',
    suggested: 'yes' },
  { key: 'Clarification.d4', kind: 'choice', label: 'If the reply asks for something different',
    note: 'A reply that only narrows or explains the original request always continues it. This choice is only about a reply that changes what is being asked for.',
    options: [
      { value: 'new_request', label: 'Treat it as a new request, with a new deadline' },
      { value: 'continue', label: 'Continue the original request and its deadline' }
    ],
    suggested: 'new_request' }
];
const CLAR_BY_KEY = {}; CLAR_CHOICES.forEach(function (c) { CLAR_BY_KEY[c.key] = c; });

// The exemption tab's four choices — these knobs ALREADY exist in the exemption domain (the importer
// writes them); this catalog only adds the control kind and screen wording. Confirms go through the
// existing policy-settings/confirm endpoint (Legal Rules scope).
const EX_CHOICES = [
  { key: 'Denial.nreason', kind: 'library_ack', label: 'Where denial reasons come from',
    ackValue: 'redaction_rules_library',
    note: 'Every denial cites a reason from the Redaction rules library, keyed to the statute it relies on. That library is its own setup row: documents go in, rules come out as drafts, legal approves them.' },
  { key: 'Denial.dlegal', kind: 'group', label: 'Who may approve a denial',
    note: 'The law does not say who must approve — this is the city\'s own routing. A denial cannot go out without this group\'s approval.', suggested: 'legal_rules' },
  { key: 'Denial.ncomm', kind: 'letter', label: 'The denial letter',
    ackValue: 'standard_wording',
    note: 'Must name the reason relied on and carry the notices the state requires. Every city sends the standard structure for now — letter wording a city can edit comes later, as its own piece of work.' },
  { key: 'Denial.ddl', kind: 'days', label: 'How quickly the denial letter must go out',
    note: 'The state puts no deadline on this letter itself. This is the city\'s own service target, in days after the decision.' }
];
const EX_BY_KEY = {}; EX_CHOICES.forEach(function (c) { EX_BY_KEY[c.key] = c; });

// Permission groups a denial approval can be routed to (MASTER_task_types_permission_groups Part B).
const APPROVAL_GROUPS = [
  { value: 'legal_rules', label: 'Legal Rules — the Senior Legal attorney' },
  { value: 'compliance_policy', label: 'Workflow & Taxonomy — the Director' },
  { value: 'operations_config', label: 'Operations — the Open Records Office' }
];

// ---- law rules: walk the template for concept-keyed rule arrays -----------------------------------
// Concept maps look like { 'clarification.toll_on_clarification': [{rule_id, authority, summary}, …] }
// and hang off knob.statutory, branch.activated_by/context, and clock_matrix.*.statutory.
function collectRules(tpl) {
  var byDomain = {};
  var seen = {};
  var visit = function (o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(visit); return; }
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (Array.isArray(v) && k.indexOf('.') > 0 && v.length && v[0] && typeof v[0] === 'object' && v[0].rule_id) {
        var dom = k.slice(0, k.indexOf('.'));
        v.forEach(function (r) {
          if (!r || !r.rule_id || seen[dom + '|' + r.rule_id]) return;
          seen[dom + '|' + r.rule_id] = 1;
          (byDomain[dom] = byDomain[dom] || []).push({
            id: r.rule_id, authority: r.authority || '', summary: r.summary || '', concept: k
          });
        });
      } else visit(v);
    });
  };
  visit(tpl);
  return byDomain;
}
// TX-0001 < TX-0012 < TX-S01: numbered rules first, supplemental (S) rules after.
function ruleSort(a, b) {
  var pa = parse(a.id), pb = parse(b.id);
  return pa - pb;
  function parse(id) {
    var m = String(id).match(/-(S?)(\d+)$/i);
    if (!m) return 1e9;
    return (m[1] ? 100000 : 0) + Number(m[2]);
  }
}
function rulesForTab(byDomain, tab) {
  var out = [];
  var have = {};
  (TAB_CONCEPTS[tab] || []).forEach(function (dom) {
    (byDomain[dom] || []).forEach(function (r) {
      if (have[r.id]) return;
      have[r.id] = 1;
      out.push(r);
    });
  });
  return out.sort(ruleSort);
}

// The statutory reply window, if this state sets one: the template's nonresponse_withdrawal concept
// carries a clock_spec ("61 days from …" in TX). Null = the statute is silent and the city chooses.
function statutoryGraceDays(tpl) {
  var found = null;
  var visit = function (o) {
    if (!o || typeof o !== 'object' || found != null) return;
    if (Array.isArray(o)) { o.forEach(visit); return; }
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (found != null) return;
      if (/\.nonresponse_withdrawal$/.test(k) && Array.isArray(v)) {
        for (var i = 0; i < v.length; i++) {
          var m = String((v[i] && v[i].clock_spec) || '').match(/(\d+)\s*(?:calendar\s*)?days?/i);
          if (m) { found = { days: Number(m[1]), citation: v[i].authority || '' }; return; }
        }
      } else visit(v);
    });
  };
  visit(tpl);
  return found;
}

async function activeJurisdiction(jid) {
  if (!jid) jid = await JR.activeJid();
  if (!jid) return null;
  return await get('SELECT id, code, name FROM jurisdiction_profiles WHERE id = ?', [jid]);
}

function ccOf(node) { return (node && node.city_config && typeof node.city_config === 'object') ? node.city_config : null; }

// ---- the clarification master switch ---------------------------------------------------------------
// Enabling materializes the five choices as city_config knobs (idempotent — an existing knob and its
// confirmation survive) and fills the statutory policy fields the template settles (TX: 61-day window,
// withdrawal closure). Disabling only flips `enabled` — decisions already recorded are kept.
async function setEnabled(jid, enabled, user) {
  var prof = await activeJurisdiction(jid);
  if (!prof) throw Object.assign(new Error('No jurisdiction is locked yet — lock the state on the agency screen first.'), { status: 409 });
  var raw = (await JR.read(prof.id, 'clarification')) || {};
  var actor = (user && (user.name || user.email || user.sub)) || 'staff';
  raw.enabled = enabled === true;

  if (raw.enabled) {
    var meta = STI.loadTemplate(prof.code);
    var stat = statutoryGraceDays(meta.tpl);
    if (stat && stat.days) {
      raw.clarification_grace_days = stat.days;
      raw.abandonment_closure = 'allowed';
      raw.provenance = raw.provenance || {};
      if (!raw.provenance.clarification_grace_days || !raw.provenance.clarification_grace_days.citation) {
        raw.provenance.clarification_grace_days = { source: 'statute', citation: stat.citation, confidence: 1 };
      }
    }
    raw.knobs = raw.knobs || {};
    var tplKnobs = (meta.tpl && meta.tpl.knobs) || {};
    CLAR_CHOICES.forEach(function (c) {
      if (raw.knobs[c.key] && ccOf(raw.knobs[c.key])) return;   // already materialized — keep it
      var tk = tplKnobs[c.key] || {};
      var suggested = c.suggested;
      if (c.key === 'Clarification.n3' && stat && stat.days) suggested = stat.days;
      raw.knobs[c.key] = {
        label: c.label,
        template_label: tk.label || null,
        statutory_days: (c.key === 'Clarification.n3' && stat) ? stat.days : undefined,
        city_config: { note: c.note, value: null, confirmed: false, suggested_default: suggested }
      };
      if (raw.knobs[c.key].statutory_days === undefined) delete raw.knobs[c.key].statutory_days;
    });
  }
  await CP.write(prof.id, raw, actor);
  try { await JP.sync(prof.id, { source: 'request-rules', actor: actor }); } catch (e) {}
  return { enabled: raw.enabled };
}

// ---- clarification confirms (value + confirmed + the policy-field side effects) --------------------
async function confirmChoice(jid, path, value, user) {
  var prof = await activeJurisdiction(jid);
  if (!prof) throw Object.assign(new Error('No jurisdiction is locked yet.'), { status: 409 });
  var key = path.indexOf('/') >= 0 ? path.slice(path.indexOf('/') + 1) : path;
  var c = CLAR_BY_KEY[key];
  if (!c) throw Object.assign(new Error('Not a clarification choice: ' + path), { status: 404 });
  var actor = (user && (user.name || user.email || user.sub)) || 'staff';

  if (c.kind === 'days') {
    var n = Number(value);
    if (!isFinite(n) || n < 1 || n !== Math.floor(n)) throw Object.assign(new Error('The reply window is a whole number of days.'), { status: 422 });
    value = n;
  }
  if (c.kind === 'bool') {
    value = (value === true || value === 'yes' || value === '1' || value === 1) ? 'yes' : 'no';
  }
  if (c.kind === 'choice' && !c.options.some(function (o) { return o.value === value; })) {
    throw Object.assign(new Error('Not one of the offered answers: ' + value), { status: 422 });
  }

  await GL.confirm(prof.id, 'clarification', 'knobs/' + key, value, actor);

  // the two choices that ARE policy fields write through to them, so the engine reads what was decided
  if (key === 'Clarification.n3' || key === 'Clarification.close') {
    var raw = (await JR.read(prof.id, 'clarification')) || {};
    if (key === 'Clarification.n3') raw.clarification_grace_days = Number(value);
    if (key === 'Clarification.close') raw.closure_notice_required = value === 'yes';
    await CP.write(prof.id, raw, actor);
    try { await JP.sync(prof.id, { source: 'request-rules', actor: actor }); } catch (e) {}
  }
  return { path: 'knobs/' + key, value: value, confirmed: true };
}

// ---- the eligibility posture ----------------------------------------------------------------------
// One decision, one act: set whether the engine may act on the dimension (gated) AND record that the
// city decided (confirmed, by name and date). Never creates a dimension the template did not import.
async function setPosture(jid, dimension, gated, user) {
  var prof = await activeJurisdiction(jid);
  if (!prof) throw Object.assign(new Error('No jurisdiction is locked yet.'), { status: 409 });
  var cfg = await JR.read(prof.id, 'eligibility');
  var dim = cfg && cfg.dimensions && cfg.dimensions[dimension];
  if (!dim || typeof dim !== 'object' || !('confirmed' in dim)) {
    throw Object.assign(new Error('No such eligibility dimension: ' + dimension + '. The state load defines the dimensions; this screen only decides their posture.'), { status: 404 });
  }
  var actor = (user && (user.name || user.email || user.sub)) || 'staff';
  dim.gated = gated === true;
  dim.confirmed = true;
  dim.confirmed_by = actor;
  dim.confirmed_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await JR.write(prof.id, 'eligibility', cfg, actor);
  try { await JP.sync(prof.id, { source: 'request-rules', actor: actor }); } catch (e) {}
  return { dimension: dimension, gated: dim.gated, confirmed: true };
}

// ---- the screen ------------------------------------------------------------------------------------
function choiceRow(catalogEntry, node) {
  var cc = ccOf(node);
  return {
    path: 'knobs/' + catalogEntry.key,
    key: catalogEntry.key,
    kind: catalogEntry.kind,
    label: catalogEntry.label,
    note: (cc && cc.note) || catalogEntry.note || null,
    options: catalogEntry.options || null,
    ackValue: catalogEntry.ackValue || null,
    suggested: (cc && cc.suggested_default != null) ? cc.suggested_default : (catalogEntry.suggested != null ? catalogEntry.suggested : null),
    statutoryDays: (node && node.statutory_days) || null,
    materialized: !!cc,
    value: cc ? cc.value : null,
    confirmed: !!(cc && cc.confirmed === true),
    confirmedBy: (cc && cc.confirmed_by) || null,
    confirmedAt: (cc && cc.confirmed_at) || null
  };
}

async function screen(jid) {
  var prof = await activeJurisdiction(jid);
  if (!prof) return { jurisdiction: null };
  var meta = STI.loadTemplate(prof.code);
  var byDomain = collectRules(meta.tpl);
  var stat = statutoryGraceDays(meta.tpl);

  var profile = await JP.getProfile(prof.id);
  var secByKey = {}; (profile.sections || []).forEach(function (s) { secByKey[s.section] = s; });
  var secOut = function (key) {
    var s = secByKey[key];
    return s ? { status: s.status, readiness: s.readiness, attested: s.attested, attestedBy: s.attestedBy, attestedAt: s.attestedAt } : null;
  };

  // clarification
  var clarRaw = (await JR.read(prof.id, 'clarification')) || {};
  var policy = CP.normalize(clarRaw);
  var clarChoices = CLAR_CHOICES.map(function (c) { return choiceRow(c, (clarRaw.knobs || {})[c.key]); });
  var letterCtx = await CN.noticeContext(policy);
  var letter = CN.buildNotice({ requestor_name: '', request_number: '', description: '' }, letterCtx);

  // exemptions
  var exRaw = (await JR.read(prof.id, 'exemption')) || {};
  var exChoices = EX_CHOICES.map(function (c) { return choiceRow(c, (exRaw.knobs || {})[c.key]); });
  var redactionRules = await get("SELECT COUNT(*) n FROM redaction_rules WHERE approval_status = 'approved' AND is_active = 1");

  // eligibility
  var elRaw = (await JR.read(prof.id, 'eligibility')) || {};
  var dims = Object.keys(elRaw.dimensions || {}).map(function (k) {
    var d = elRaw.dimensions[k] || {};
    return { key: k, gated: d.gated === true, confirmed: d.confirmed === true, confirmedBy: d.confirmed_by || null, confirmedAt: d.confirmed_at || null };
  });

  return {
    jurisdiction: { id: prof.id, code: prof.code, name: prof.name || meta.tpl.state, stateName: meta.tpl.state },
    tabs: {
      clarification: {
        section: secOut('clarification'),
        enabled: policy.enabled === true,
        statutory: stat,     // { days, citation } | null — the reply window the state law sets, if any
        graceDays: policy.clarification_grace_days,
        rules: rulesForTab(byDomain, 'clarification'),
        choices: clarChoices,
        unconfirmed: clarChoices.filter(function (c) { return !c.confirmed; }).length
      },
      exemptions: {
        section: secOut('exemption'),
        rules: rulesForTab(byDomain, 'exemptions'),
        choices: exChoices,
        unconfirmed: exChoices.filter(function (c) { return !c.confirmed; }).length,
        redactionLibrary: { approvedRules: Number(redactionRules && redactionRules.n) || 0 },
        approvalGroups: APPROVAL_GROUPS
      },
      eligibility: {
        section: secOut('eligibility'),
        rules: rulesForTab(byDomain, 'eligibility'),
        dimensions: dims,
        unconfirmed: dims.filter(function (d) { return d.gated && !d.confirmed; }).length
      }
    },
    letters: {
      clarification: { subject: letter.subject, text: letter.text, graceDays: letterCtx.graceDays }
    }
  };
}

module.exports = { TAB_CONCEPTS: TAB_CONCEPTS, CLAR_CHOICES: CLAR_CHOICES, EX_CHOICES: EX_CHOICES,
  APPROVAL_GROUPS: APPROVAL_GROUPS, collectRules: collectRules, rulesForTab: rulesForTab,
  statutoryGraceDays: statutoryGraceDays, screen: screen, setEnabled: setEnabled,
  confirmChoice: confirmChoice, setPosture: setPosture };
