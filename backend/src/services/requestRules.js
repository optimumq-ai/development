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
//                        also MATERIALIZES the five clarification choices as city_config knobs — in
//                        their OWN domain, `clarification_screen` (idempotent), so the existing
//                        policy-settings/confirm plumbing (goLive.confirm) records each decision with a
//                        name and date. They deliberately do NOT live inside the `clarification` policy
//                        domain: configIntegrity polices that domain's schema (enabled + provenance +
//                        the 7 fields) and the BW9b editors render it as exactly those fields — an
//                        extra key there reads as corruption. goLive.settings folds the screen domain
//                        into the clarification SECTION so the hub counts the choices all the same.
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

// Where the clarification tab's choices live (NOT the policy domain — see the header note).
const CHOICES_DOMAIN = 'clarification_screen';

// concept-domain prefixes each tab shows as "what the law says"
const TAB_CONCEPTS = {
  clarification: ['clarification'],
  exemptions: ['appeal', 'denial'],
  eligibility: ['eligibility'],
  // D1 (Kevin 2026-08-29): the deadlines tab — production.completion_window carries the produce/certify
  // rules, response.catastrophe_suspension the § 552.233 suspension. Exactly TX_RULES_READABLE §3's list.
  deadlines: ['production', 'response'],
  // I1 (Kevin 2026-08-29, "Request Intake"): intake.written_request_required + the designated-address
  // rule under custody.records_officer_designation. Exactly TX_RULES_READABLE §10's two rules.
  intake: ['intake', 'custody']
};

// The Request Intake tab's three choices (I1). Master.g1/g4 live in the intake domain; Master.p3 is the
// estimate-capture knob whose STORE stays in the fee domain (the engine reads it there) — this tab is its
// single confirmable home, the write-through pattern the waiver decider set.
const INTAKE_CHOICES = [
  { key: 'Master.g1', domain: 'intake', kind: 'channels', label: 'Which ways in the city operates',
    options: [
      { value: 'portal', label: 'Online portal' }, { value: 'email', label: 'E-mail' },
      { value: 'mail', label: 'U.S. mail' }, { value: 'hand_delivery', label: 'Hand delivery' },
      { value: 'fax', label: 'Fax' }],
    suggested: ['portal', 'email', 'mail', 'hand_delivery'],
    note: 'Which channels the city actually operates. A channel the statute names stays legally open regardless — unchecking it only hides it from the portal\'s how-to-request page.' },
  { key: 'Master.g4', domain: 'intake', kind: 'choice', label: 'The acknowledgment, and when it goes out',
    options: [
      { value: 'same_business_day', label: 'Same business day' },
      { value: 'next_business_day', label: 'Next business day' },
      { value: 'no_auto', label: 'No automatic acknowledgment' }],
    suggested: 'same_business_day',
    note: 'When the automatic acknowledgment (with the request number) goes out. Every city sends the standard wording for now — editable wording comes with the letter templates.' },
  { key: 'Master.p3', domain: 'fee', kind: 'capture', label: 'What intake captures for the estimate',
    options: [
      { value: 'page_count', label: 'Expected page count' },
      { value: 'media', label: 'Media / format' },
      { value: 'labor_class', label: 'Labor class' }],
    suggested: ['page_count', 'media', 'labor_class'],
    note: 'The data points intake asks for so the estimate can price the request. Recorded here — written through to the fee store the estimate engine reads.' }
];
const INTAKE_BY_KEY = {}; INTAKE_CHOICES.forEach(function (c) { INTAKE_BY_KEY[c.key] = c; });

// The US federal (observed) holiday set 2026–2027 — the same list the fixture seeds
// (src/db/seed_fixture.sql deadline_rules) and the per-state imports inherited. Loaded onto the
// deadlines tab in one act when the live calendar is empty; anything beyond it is a proposal.
const US_FEDERAL_HOLIDAYS = ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03',
  '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18', '2027-07-05',
  '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25', '2027-11-26', '2027-12-24'];

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
// Enabling fills the statutory policy fields the template settles (TX: 61-day window, withdrawal
// closure) in the POLICY domain, and materializes the five choices as city_config knobs in the SCREEN
// domain (idempotent — an existing knob and its confirmation survive). Disabling only flips `enabled`
// — decisions already recorded are kept.
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
    var scr = (await JR.read(prof.id, CHOICES_DOMAIN)) || {};
    scr.knobs = scr.knobs || {};
    var tplKnobs = (meta.tpl && meta.tpl.knobs) || {};
    CLAR_CHOICES.forEach(function (c) {
      if (scr.knobs[c.key] && ccOf(scr.knobs[c.key])) return;   // already materialized — keep it
      var tk = tplKnobs[c.key] || {};
      var suggested = c.suggested;
      if (c.key === 'Clarification.n3' && stat && stat.days) suggested = stat.days;
      scr.knobs[c.key] = {
        label: c.label,
        template_label: tk.label || null,
        statutory_days: (c.key === 'Clarification.n3' && stat) ? stat.days : undefined,
        city_config: { note: c.note, value: null, confirmed: false, suggested_default: suggested }
      };
      if (scr.knobs[c.key].statutory_days === undefined) delete scr.knobs[c.key].statutory_days;
    });
    await JR.write(prof.id, CHOICES_DOMAIN, scr, actor);
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

  await GL.confirm(prof.id, CHOICES_DOMAIN, 'knobs/' + key, value, actor);

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

  // clarification — policy from its domain, the screen's choices from theirs
  var policy = CP.normalize((await JR.read(prof.id, 'clarification')) || {});
  var scrRaw = (await JR.read(prof.id, CHOICES_DOMAIN)) || {};
  var clarChoices = CLAR_CHOICES.map(function (c) { return choiceRow(c, (scrRaw.knobs || {})[c.key]); });
  var letterCtx = await CN.noticeContext(policy);
  var letter = CN.buildNotice({ requestor_name: '', request_number: '', description: '' }, letterCtx);

  // exemptions
  var exRaw = (await JR.read(prof.id, 'exemption')) || {};
  var exChoices = EX_CHOICES.map(function (c) { return choiceRow(c, (exRaw.knobs || {})[c.key]); });
  var redactionRules = await get("SELECT COUNT(*) n FROM redaction_rules WHERE approval_status = 'approved' AND is_active = 1");

  // deadlines (D1): the clock table the BW9b section renders, re-served for the tab. Statutory clocks
  // read as law (changes are proposals); operational targets are the city's own numbers.
  var dlRaw = (await JR.read(prof.id, 'deadline')) || {};
  var cmRaw = (await JR.read(prof.id, 'clock_matrix')) || {};
  var tt = require('./ruleEditors').timerTable(dlRaw, cmRaw);
  var holidays = Array.isArray(dlRaw.holidays) ? dlRaw.holidays : [];

  // intake (I1): choices from the intake domain (g1, g4) and the fee domain (p3, write-through home);
  // the designated addresses read from the agency configuration — no second place to type them.
  var inRaw = (await JR.read(prof.id, 'intake')) || {};
  var feeRaw = (await JR.read(prof.id, 'fee')) || {};
  var inChoices = INTAKE_CHOICES.map(function (c) {
    var store = c.domain === 'fee' ? feeRaw : inRaw;
    return choiceRow(c, (store.knobs || {})[c.key]);
  });
  var agencyEmail = await get("SELECT value FROM system_config WHERE key = 'contact_email'");
  var addr = {};
  for (var ak of ['address_line1', 'address_city', 'address_state', 'address_zip']) {
    var arow = await get('SELECT value FROM system_config WHERE key = ?', [ak]);
    addr[ak] = arow ? arow.value : null;
  }

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
      },
      deadlines: {
        section: secOut('deadlines'),
        rules: rulesForTab(byDomain, 'deadlines'),
        clocks: tt.rows,
        unlanded: tt.unlandedTimers,
        calendar: { weekend: dlRaw.weekend || [0, 6], holidayCount: holidays.length,
          holidayFirst: holidays[0] || null, holidayLast: holidays[holidays.length - 1] || null },
        unsetTargets: tt.rows.filter(function (r) { return r.kind === 'operational_target' && r.unset; }).length
      },
      intake: {
        section: secOut('intake'),
        rules: rulesForTab(byDomain, 'intake'),
        choices: inChoices,
        unconfirmed: inChoices.filter(function (c) { return !c.confirmed; }).length,
        addresses: { email: agencyEmail ? agencyEmail.value : null,
          mailing: [addr.address_line1, addr.address_city, addr.address_state, addr.address_zip].filter(Boolean).join(', ') || null }
      }
    },
    letters: {
      clarification: { subject: letter.subject, text: letter.text, graceDays: letterCtx.graceDays }
    }
  };
}

// ---- intake tab confirms (I1) ---------------------------------------------------------------------
// Each confirm rides goLive.confirm against the knob's HOME domain — intake for channels and the
// acknowledgment, fee for the estimate-capture knob (write-through: this tab is its single confirmable
// home; the store stays where the engine reads it).
async function confirmIntake(jid, path, value, user) {
  var m = String(path).match(/^knobs\/(.+)$/);
  var entry = m && INTAKE_BY_KEY[m[1]];
  if (!entry) throw Object.assign(new Error('Not one of the Request Intake choices.'), { status: 404 });
  if (entry.kind === 'channels' || entry.kind === 'capture') {
    if (!Array.isArray(value) || !value.length) throw Object.assign(new Error(entry.label + ' takes a list with at least one item.'), { status: 422 });
    var allowed = entry.options.map(function (o) { return o.value; });
    var bad = value.filter(function (v) { return allowed.indexOf(v) < 0; });
    if (bad.length) throw Object.assign(new Error('Unknown option(s): ' + bad.join(', ') + '. Allowed: ' + allowed.join(', ') + '.'), { status: 422 });
  } else {
    if (entry.options.map(function (o) { return o.value; }).indexOf(value) < 0) {
      throw Object.assign(new Error(entry.label + ' takes one of: ' + entry.options.map(function (o) { return o.value; }).join(', ') + '.'), { status: 422 });
    }
  }
  var who = user.name || user.email || user.sub;
  return await GL.confirm(jid, entry.domain, path, value, who);
}

// ---- deadlines tab writes (D1) --------------------------------------------------------------------
// A SERVICE TARGET is the city's own pacing number on an operational-target clock — never a statutory
// figure (kindOf polices the line; a statutory clock changes only by proposal with a citation). Writes
// go straight into the deadline domain, whose configIntegrity checks then band the value.
async function setServiceTarget(jid, clockKey, days, user) {
  var CM = require('./clockMatrix');
  var dl = (await JR.read(jid, 'deadline')) || {};
  var def = dl.clocks && dl.clocks[clockKey];
  if (!def) throw Object.assign(new Error('No clock named "' + clockKey + '" — the state load defines them.'), { status: 404 });
  if (CM.kindOf(def) !== 'operational_target') {
    throw Object.assign(new Error('"' + (def.label || clockKey) + '" is a statutory clock — its figure changes through a proposal with a citation, never here.'), { status: 422 });
  }
  if (days === null || days === undefined || days === '') { delete def.duration; }
  else {
    var n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw Object.assign(new Error('A service target is whole days, 1 to 365 — or blank for no target.'), { status: 422 });
    def.duration = n;
  }
  await JR.write(jid, 'deadline', dl, user.name || user.email || user.sub);
  return { clock: clockKey, duration: def.duration != null ? def.duration : null };
}

// One act for the empty-calendar case: load the US federal (observed) set the imports were meant to
// carry. A calendar that already holds days is edited by proposal, never overwritten here.
async function loadHolidaySet(jid, user) {
  var dl = (await JR.read(jid, 'deadline')) || {};
  if (Array.isArray(dl.holidays) && dl.holidays.length) {
    throw Object.assign(new Error('The holiday calendar already holds ' + dl.holidays.length + ' day(s) — changing a loaded calendar goes through a proposal.'), { status: 409 });
  }
  dl.holidays = US_FEDERAL_HOLIDAYS.slice();
  await JR.write(jid, 'deadline', dl, user.name || user.email || user.sub);
  return { loaded: dl.holidays.length };
}

module.exports = { TAB_CONCEPTS: TAB_CONCEPTS, CHOICES_DOMAIN: CHOICES_DOMAIN, CLAR_CHOICES: CLAR_CHOICES, EX_CHOICES: EX_CHOICES,
  INTAKE_CHOICES: INTAKE_CHOICES, confirmIntake: confirmIntake,
  US_FEDERAL_HOLIDAYS: US_FEDERAL_HOLIDAYS, setServiceTarget: setServiceTarget, loadHolidaySet: loadHolidaySet,
  APPROVAL_GROUPS: APPROVAL_GROUPS, collectRules: collectRules, rulesForTab: rulesForTab,
  statutoryGraceDays: statutoryGraceDays, screen: screen, setEnabled: setEnabled,
  confirmChoice: confirmChoice, setPosture: setPosture };
