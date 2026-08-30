'use strict';
// THE SETUP & CONFIGURATION HUB — SPEC_setup_hub.md (design closed 2026-08-24; inventory in
// WORKING_setup_inventory.md; canvas artboards in docs/mockups/setup_hub/).
//
// One page, six lanes, thirty-four items. Every item is: a plain-language NAME, the DOOR that sets it (an
// existing screen), an OWNER (a permission group — the hub gates on the user-type model, nothing else), an
// EVIDENCE line counted from what is actually configured, and a STATE derived from that evidence:
//
//   ready           everything set, and where a sign-off is asked for, given
//   in_progress     started, part set — the evidence names the gap
//   not_started     nothing set (running on shipped defaults is a real answer and says so)
//   needs_attention was finished and has come undone (drift, pending proposal, failing test)
//   waiting         a prerequisite is not ready — the row stays OPEN (Kevin: open-with-warning, never a lock)
//
// Sign-off is Option A, "Mark it done" (Kevin 2026-08-24): a person in the lane's group records that the
// item is ready; the mark is shown by name and date and is reversible. Kevin reserved the right to make
// Ready conditional on validation item by item later — `signoffRequired` on an item is that hook.
//
// The evidence readers below are DEFENSIVE by design: a reader that throws yields `not_started` with an
// honest "could not read …" line rather than taking the page down. The page must always render.
const { all, get, run } = require('../db');

const LANES = [
  { key: 'compliance', title: 'Compliance and Policies Setup', ownerLabel: 'ORO Director · Senior Legal on the legal sections',
    groups: ['compliance_policy', 'legal_rules'] },
  { key: 'fulfillment_fees', title: 'Request Fulfillment Process Setup — Fees, Estimates and Routing',
    ownerLabel: 'Anyone in the Open Records Office · fulfillment team managers and supervisors', groups: ['operations_config'] },
  { key: 'fulfillment_redaction', title: 'Request Fulfillment Process Setup — Redaction and Release',
    ownerLabel: 'Anyone in the Open Records Office · fulfillment team managers and supervisors', groups: ['operations_config'] },
  { key: 'organization', title: 'Organization Departments, Teams, and Staff Setup',
    ownerLabel: 'Anyone in the Open Records Office · fulfillment team managers and supervisors', groups: ['operations_config'] },
  { key: 'technical', title: 'Technical Setup', ownerLabel: 'System Administrator', groups: ['system_admin'] },
  // C7 cleanup (Kevin 2026-08-29): feature-catalog screens live here rather than as setup-step rows.
  { key: 'features', title: 'System Features and Options',
    ownerLabel: 'Anyone in the Open Records Office · fulfillment team managers and supervisors', groups: ['operations_config'] },
];

// Item catalog. `deps` are item keys; `door` is the screen; `legal` marks a Legal Rules section (attest by
// legal_rules); `signoffRequired` = Ready also needs a person's mark (Option A, per item).
const ITEMS = [
  // ── Start here ──
  // I1 rider (Kevin 2026-08-29, the identity fold): the agency screen is the ONE identity surface — its
  // fields plus the state lock are everything the identity section holds, so Attest here signs it.
  { key: 'agency', lane: 'organization', top: true, name: 'Agency name, address and contact', door: '/setup/agency', deps: [], groups: ['operations_config', 'system_admin'],
    foldSections: ['identity'],
    note: 'Nothing else can be set up until this is filled in.' },
  // ── Lane 1 ──
  // C1 cleanup (Kevin 2026-08-29): the 'jurisdiction' row ("Which state's law this city follows") is
  // DELETED — it doored to the same agency screen the Start-here card does, and the identity fold means
  // the agency card's Attest already signs the identity section. Rows that waited on it wait on `agency`
  // instead, whose readiness is the stronger fact (fields complete AND the state locked).
  // D1 (Kevin 2026-08-29): deadlines migrates onto the request-rules screen as its 4th tab — the row
  // stays (its door moves) and the A1 fold covers it: Attest on the tab signs the deadlines section.
  { key: 'deadlines', lane: 'compliance', name: 'Response deadlines and tolling', door: '/setup/request-rules?tab=deadlines', deps: ['agency'], section: 'deadlines', legal: true, foldSections: ['deadlines'] },
  // 'Fee rules' (Kevin 2026-08-27): the fee-law screen absorbs fee waivers; the separate
  // 'Fee waivers and who approves them' row is retired — its content lives on this screen's tabs.
  // F3 (Kevin 2026-08-29): the fee-law screen also absorbs the deposit & payment clock policy; the
  // separate 'Deposits and payment clock' row is retired — its settings live on the City decisions tab.
  // ATTESTATION FOLD (Kevin 2026-08-29): for a row whose screen ABSORBED profile sections,
  // `foldSections` lists them — "Attest as complete" on that screen (the done-mark) also attests each
  // listed section that is configured (skipping one with nothing configured, e.g. `payment` while the
  // clock switch is off — off stays a valid posture and automation stays unarmed), and undoing the mark
  // un-attests them. One act, one home; jurisdiction-config keeps drift/audit but stops offering a
  // separate Attest for folded sections.
  { key: 'fee_law', lane: 'compliance', name: 'Fee rules', door: '/setup/fee-law', deps: ['agency'], section: 'fees', foldSections: ['fees', 'fee_waiver', 'payment'] },
  { key: 'clarification', lane: 'compliance', name: 'Vague requests and clarification', door: '/setup/request-rules?tab=clarification', deps: ['agency'], section: 'clarification', foldSections: ['clarification'] },
  { key: 'exemptions', lane: 'compliance', name: 'Exemptions and appeals', door: '/setup/request-rules?tab=exemptions', deps: ['agency'], section: 'exemption', legal: true, foldSections: ['exemption'] },
  { key: 'eligibility', lane: 'compliance', name: 'Requestor eligibility', door: '/setup/request-rules?tab=eligibility', deps: ['agency'], section: 'eligibility', foldSections: ['eligibility'] },
  // I1 (Kevin 2026-08-29): intake gets its own row and lives as the request-rules screen's 5th tab.
  { key: 'intake', lane: 'compliance', name: 'Request Intake', door: '/setup/request-rules?tab=intake', deps: ['agency'], section: 'intake', foldSections: ['intake'] },
  // C16 (Kevin 2026-08-30): the admin Redaction Rules and Update Configuration tabs become dedicated screens.
  { key: 'redaction_rules', lane: 'compliance', name: 'Redaction rules library', door: '/setup/redaction-rules', deps: ['agency'], section: 'redaction', legal: true },
  { key: 'city_choices', lane: 'compliance', name: 'Choices the statute left to the city', door: '/jurisdiction-config', deps: ['agency'] },
  { key: 'law_updates', lane: 'compliance', name: 'Update Configuration', door: '/setup/update-configuration', deps: ['agency'] },
  { key: 'go_live', lane: 'compliance', name: 'Turn the rules on for real', door: '/jurisdiction-config', deps: [], goLive: true },
  // ── Lane 2a ──
  // C8 (Kevin 2026-08-30): the 'fee_rates' ("What this city actually charges", the pre-migration name for
  // the v1 rate table) and 'fee_test' ("Try a test estimate") rows are DELETED — both are the Fee rules row's
  // content now (the fee schedule + its "Test an estimate" tab). The test-estimate status reader survives as
  // `testEstimateStatus` for the Fee rules screen's tab badge.
  // C7 (Kevin 2026-08-29): 'Record types and categories' becomes 'Taxonomy' under System Features and
  // Options — same key, so the calibration dependency and the counted evidence carry over unchanged.
  { key: 'taxonomy', lane: 'features', name: 'Taxonomy', door: '/setup/taxonomy', deps: ['sources'], softDeps: true },
  { key: 'time_budgets', lane: 'features', name: 'How many days a task should take', door: '/setup/time-budgets', deps: [] },
  { key: 'time_tracking', lane: 'features', name: 'Task Processing Time Capture', door: '/setup/time-capture', deps: [] },
  { key: 'notifications', lane: 'features', name: 'System Notifications', door: '/setup/notifications', deps: ['email'] },
  // The agent-rules API is system-authority (routes/agentRules.js) — the row's gate says so too, or a Director
  // sees live controls that 403 (spec/architecture audit 2026-08-31).
  { key: 'agent_rules', lane: 'features', name: 'Portal Agent Rules', door: '/setup/agent-rules', deps: [], groups: ['system_admin'] },
  { key: 'calibration', lane: 'fulfillment_fees', name: 'How much work each record type takes', door: '/setup/taxonomy', deps: ['taxonomy'] },
  // C15 (Kevin 2026-08-30): the admin Workflow and Process Map tabs become dedicated screens behind these rows.
  { key: 'routing_rules', lane: 'fulfillment_fees', name: 'Workflow Rules', door: '/setup/workflow-rules', deps: ['departments', 'teams'] },
  { key: 'process_map', lane: 'fulfillment_fees', name: 'Process Map', door: '/setup/process-map', deps: [] },
  // C11 (Kevin 2026-08-30): the v1 Configuration page is RETIRED — each of its six tabs became a dedicated
  // /setup screen behind a hub row. time_budgets, time_tracking (renamed 'Task Processing Time Capture'),
  // notifications (renamed 'System Notifications') and agent_rules moved to System Features and Options;
  // av_redaction ('Video Redaction Options') is NEW in the redaction lane; auth_policy stays in Technical Setup.
  // ── Lane 2b ──
  { key: 'redaction_auto', lane: 'fulfillment_redaction', name: 'Automatic redaction decisions', door: null, deps: ['redaction_rules'], noScreen: true },
  { key: 'release_review', lane: 'fulfillment_redaction', name: 'Review before records go out', door: null, deps: [], noScreen: true },
  { key: 'layout_templates', lane: 'fulfillment_redaction', name: 'Redaction layout templates', door: '/mass-redaction', deps: ['redaction_rules'] },
  { key: 'decision_reasons', lane: 'fulfillment_redaction', name: 'Standard wording for denials', door: null, deps: ['agency'], noScreen: true },
  { key: 'mass_schedule', lane: 'fulfillment_redaction', name: 'When bulk redaction runs', door: null, deps: [], noScreen: true },
  { key: 'av_redaction', lane: 'fulfillment_redaction', name: 'Video Redaction Options', door: '/setup/video-redaction', deps: [] },
  // ── Lane 3 ──
  { key: 'departments', lane: 'organization', name: 'City departments', door: '/org', deps: [] },
  { key: 'teams', lane: 'organization', name: 'Fulfillment teams', door: '/org', deps: ['departments'] },
  { key: 'staff', lane: 'organization', name: 'Staff and what each person does', door: '/staff', deps: ['teams'] },
  { key: 'record_owners', lane: 'organization', name: 'Which department owns which records', door: '/setup/taxonomy', deps: ['taxonomy', 'departments'] },
  // ── Lane 4 ──
  // C14 (Kevin 2026-08-30): renamed from 'Where the records live'; the admin Sources tab retired for its own screen.
  { key: 'sources', lane: 'technical', name: 'Record Sources and Connectors', door: '/setup/record-sources', deps: [] },
  // C12 (Kevin 2026-08-30): 'AI service keys' + 'Where AI processing happens' become ONE row and ONE screen
  // with three tabs (AI Service Keys · Deployment Model · AI Touchpoints Information); the hidden Integrations
  // tab and the AI Data Flow admin tab are retired.
  { key: 'ai_config', lane: 'technical', name: 'AI configuration', door: '/setup/ai-configuration', deps: [] },
  // C2 cleanup (Kevin 2026-08-29): renamed from 'Outgoing email'; the Integrations page's email section
  // moved to its own screen behind this row (Integrations keeps the AI keys; the v1 Configuration email
  // tab is retired — its alert-recipient field moved along).
  { key: 'email', lane: 'technical', name: 'Email configuration', door: '/setup/email', deps: [] },
  { key: 'auth_policy', lane: 'technical', name: 'User Authentication Setup', door: '/setup/authentication', deps: [] },
  { key: 'settlement', lane: 'technical', name: 'Sending charges to the finance system', door: null, deps: ['fee_law'], noScreen: true },
];
const BY_KEY = {}; ITEMS.forEach(function (i) { BY_KEY[i.key] = i; });
const LANE_BY_KEY = {}; LANES.forEach(function (l) { LANE_BY_KEY[l.key] = l; });

// ---- helpers --------------------------------------------------------------------------------------
async function cfg(key) { var r = await get('SELECT value FROM system_config WHERE key = ?', [key]); return r ? r.value : null; }
async function count(sql, params) { var r = await get(sql, params || []); return Number(r && (r.n != null ? r.n : r.count)) || 0; }
function ev(state, line, extra) { return Object.assign({ state: state, evidence: line }, extra || {}); }
function who(name, at) { return name ? ' · confirmed by ' + name + (at ? ', ' + String(at).slice(0, 10) : '') : ''; }

// Profile sections (attestation) are read ONCE per page build.
async function profileSections() {
  try {
    var JP = require('./jurisdictionProfile');
    var jid = await cfg('jurisdiction_profile');
    if (!jid) return { jid: null, sections: {}, settings: null };
    var GL = require('./goLive');
    var s = await GL.settings(jid);
    var map = {}; (s.sections || []).forEach(function (sec) { map[sec.section] = sec; });
    return { jid: jid, sections: map, settings: s, JP: JP };
  } catch (e) { return { jid: null, sections: {}, settings: null, error: e.message }; }
}
function sectionEvidence(sec, extraLine) {
  if (!sec) return ev('not_started', 'not configured yet');
  if (sec.status === 'not_configured') return ev('not_started', 'not configured yet');
  if (sec.drift) return ev('needs_attention', 'changed since it was confirmed — needs re-confirmation' + who(sec.attestedBy, sec.attestedAt));
  if (sec.attested) return ev('ready', (extraLine ? extraLine + who(sec.attestedBy, sec.attestedAt) : (sec.attestedBy ? who(sec.attestedBy, sec.attestedAt).replace(/^ · /, '') : 'confirmed')));
  if (sec.unconfirmed > 0 && sec.settings && sec.settings.length) return ev('in_progress', (sec.settings.length - sec.unconfirmed) + ' of ' + sec.settings.length + ' choices made · not yet confirmed');
  return ev('in_progress', (extraLine ? extraLine + ' · ' : '') + 'not yet confirmed');
}

// The "Test an estimate" status the Fee rules screen shows on its test tab (the retired fee_test hub row's
// reader, C8 2026-08-30): not_started until a run, needs_attention when the last run was against a version
// other than the one in use, ready when confirmed, in_progress when the last run found issues.
async function testEstimateStatus() {
  var p = await get("SELECT status, test_status, test_by, test_at, test_config_ref FROM onboarding_progress WHERE phase_key = 'fees'");
  var active = await get("SELECT version FROM fee_profiles WHERE context = 'FR' ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, version DESC LIMIT 1");
  if (!p || !p.test_status) return ev('not_started', 'no test estimate run yet');
  if (active && p.test_config_ref != null && String(p.test_config_ref) !== String(active.version)) return ev('needs_attention', 'last run was against version ' + p.test_config_ref + ', not the one in use (' + active.version + ')');
  if (p.test_status === 'confirmed') return ev('ready', 'test confirmed against the version in use' + who(p.test_by, p.test_at));
  return ev('in_progress', 'last test found issues' + who(p.test_by, p.test_at).replace('confirmed by', 'run by'));
}

// ---- the evidence readers, one per item -----------------------------------------------------------
const READERS = {
  agency: async function () {
    // H3 (WORKING_hub_linked_screens §1): ready = name, short name, jurisdiction type, street address, contact
    // email + phone, AND the jurisdiction state LOCKED (the lock is what loaded the rules).
    var name = await cfg('agency_name'), state = await cfg('state'), email = await cfg('contact_email');
    if (!name) return ev('not_started', 'no agency name yet');
    var lockedAt = await cfg('state_locked_at'), lockedBy = await cfg('state_locked_by');
    var missing = [];
    if (!(await cfg('agency_short_name'))) missing.push('short name');
    if (!(await cfg('jurisdiction_type'))) missing.push('jurisdiction type');
    if (!(await cfg('address_line1')) || !(await cfg('address_city')) || !(await cfg('address_state')) || !(await cfg('address_zip'))) missing.push('street address');
    if (!email) missing.push('contact email');
    if (!(await cfg('contact_phone'))) missing.push('contact phone');
    if (!state) missing.push('state');
    else if (!lockedAt) missing.push('state not locked');
    var head = name + (state ? ', ' + state : '');
    if (missing.length) return ev('in_progress', head + ' · ' + missing.map(function (m) { return m === 'state not locked' ? m : m + ' missing'; }).join(' · '));
    return ev('ready', head + ' · ' + email + ' · ' + state + ' rules loaded' + (lockedBy ? ' by ' + lockedBy : '') + ', ' + String(lockedAt).slice(0, 10));
  },
  deadlines: async function (ctx) { return sectionEvidence(ctx.sections.deadlines); },
  fee_law: async function (ctx) {
    // The fee-law screen (services/feeLaw.js): the law's figures load with the state; the city's decisions
    // and an approved fee schedule VERSION are what count. Attest (the `fees` section) still makes it ready.
    if (!ctx.jid) return ev('not_started', 'no jurisdiction chosen yet');
    var s = await require('./feeLaw').screen(ctx.jid);
    if (!s.jurisdiction) return ev('not_started', 'no jurisdiction chosen yet');
    var c = s.counts;
    var line = c.mandate + ' figures set by ' + s.jurisdiction.code + ' law' + (c.deferral ? ' · ' + c.decided + ' of ' + c.deferral + ' city choices decided' : '');
    if (s.waiver && s.waiver.choices.length) line += ' · waivers: ' + s.waiver.decided + ' of ' + s.waiver.choices.length + ' decided';
    if (s.clock) line += ' · payment clock: ' + (s.clock.enabled ? s.clock.confirmed + ' of ' + s.clock.choices.length + ' confirmed' : 'off');
    if (!s.version) return ev(c.decided ? 'in_progress' : 'not_started', line + ' · no fee schedule version yet');
    var sec = ctx.sections.fees;
    var r = sectionEvidence(sec, 'fee schedule v' + s.version.version);
    if (r.state === 'not_started') r = ev('in_progress', 'not yet confirmed');
    if (r.state !== 'ready') r.evidence = 'fee schedule v' + s.version.version + ' · ' + r.evidence;
    r.evidence = line + ' · ' + r.evidence;
    return r;
  },
  clarification: async function (ctx) {
    var r = sectionEvidence(ctx.sections.clarification);
    if (r.state === 'not_started') r.evidence = 'not configured yet — clarification is switched off';
    return r;
  },
  exemptions: async function (ctx) { return sectionEvidence(ctx.sections.exemption); },
  intake: async function (ctx) { return sectionEvidence(ctx.sections.intake); },
  eligibility: async function (ctx) {
    var sec = ctx.sections.eligibility;
    var r = sectionEvidence(sec);
    if (r.state === 'not_started' && sec) {
      var n = Number(sec.unconfirmed) || 0;
      r.evidence = n === 1 ? 'one decision to confirm' : n > 1 ? n + ' decisions to confirm' : r.evidence;
    }
    return r;
  },
  redaction_rules: async function (ctx) {
    var n = await count("SELECT COUNT(*) n FROM redaction_rules WHERE approval_status = 'approved' AND is_active = 1");
    var r = sectionEvidence(ctx.sections.redaction, n + ' rules');
    if (r.state === 'not_started' && n > 0) return ev('in_progress', n + ' rules · section not confirmed');
    return r;
  },
  city_choices: async function (ctx) {
    if (!ctx.settings) return ev('not_started', 'no jurisdiction profile chosen');
    var total = 0, done = 0;
    (ctx.settings.sections || []).forEach(function (s) { (s.settings || []).forEach(function (x) { total++; if (x.confirmed) done++; }); });
    if (!total) return ev('not_started', 'no city choices loaded yet');
    if (done === total) return ev('ready', 'all ' + total + ' answered');
    return ev(done ? 'in_progress' : 'not_started', done + ' of ' + total + ' answered');
  },
  law_updates: async function (ctx) {
    var pending = ctx.jid ? await count("SELECT COUNT(*) n FROM config_proposals WHERE jurisdiction_id = ? AND status = 'pending'", [ctx.jid]) : 0;
    if (pending) return ev('needs_attention', pending + ' proposed change' + (pending > 1 ? 's' : '') + ' waiting for review');
    return ev('ready', 'no proposed changes waiting');
  },
  go_live: async function (ctx) {
    var GL = require('./goLive');
    if (!ctx.jid) return ev('waiting', 'until a jurisdiction is chosen', { waitingOn: ['jurisdiction'] });
    var s = await GL.summary(ctx.jid);
    if (s.live) return ev('ready', 'enforcement is ON — the rules are real');
    if (!s.ready) return ev('waiting', 'until every rule above is confirmed · the ORO System Administrator or ORO Director flips it', { waitingOn: ['city_choices'], goLiveSummary: s });
    return ev('in_progress', 'everything is confirmed — ready to flip', { goLiveSummary: s });
  },
  taxonomy: async function () {
    var n = await count("SELECT COUNT(*) n FROM record_types WHERE status = 'active' OR status IS NULL");
    var drafts = await count("SELECT COUNT(*) n FROM record_types WHERE status = 'draft' OR status = 'discovered'");
    if (!n) return ev('not_started', 'no record types yet');
    return ev(drafts ? 'in_progress' : 'ready', n + ' record types' + (drafts ? ' · ' + drafts + ' discovered drafts to review' : ''));
  },
  calibration: async function () {
    var m = await count("SELECT COUNT(*) n FROM record_types WHERE status = 'active' OR status IS NULL");
    var n = await count('SELECT COUNT(*) n FROM record_type_estimate_profiles WHERE has_expert_seed = 1 OR sample_size > 0');
    if (!m) return ev('waiting', 'until there are record types to estimate', { waitingOn: ['taxonomy'] });
    if (!n) return ev('not_started', 'none of ' + m + ' record types calibrated');
    return ev(n >= m ? 'ready' : 'in_progress', n + ' of ' + m + ' record types calibrated');
  },
  routing_rules: async function () {
    var n = await count('SELECT COUNT(*) n FROM workflow_rules WHERE enabled = 1');
    return n ? ev('ready', n + ' routing rule' + (n > 1 ? 's' : '') + ' enabled') : ev('not_started', 'no routing rules written');
  },
  process_map: async function () {
    // Informational: the decision inventory (data/workflowModel) and how much of it is built today.
    var M = require('../data/workflowModel'); var nodes = M.nodes || (typeof M.build === 'function' ? M.build().nodes : null) || {};
    var c = { built: 0, partial: 0, planned: 0 }; Object.keys(nodes).forEach(function (k) { var st = nodes[k].status; c[st] = (c[st] || 0) + 1; });
    var total = Object.keys(nodes).length;
    if (!total) return ev('not_started', 'no process model loaded');
    return ev('ready', total + ' decision points · ' + c.built + ' built · ' + c.partial + ' partial · ' + c.planned + ' planned');
  },
  time_budgets: async function () {
    var rows = await all('SELECT task_type, budget_days FROM time_budgets WHERE record_type_id IS NULL');
    var set = rows.filter(function (r) { return r.budget_days != null; }).length;
    if (!rows.length) return ev('not_started', 'no task budgets yet');
    return ev(set === rows.length ? 'ready' : 'in_progress', set + ' of ' + rows.length + ' task types have a day budget');
  },
  time_tracking: async function () {
    // C11: reads the real per-screen setting (services/timeCaptureConfig), not a key nothing ever wrote.
    var TC = require('./timeCaptureConfig'); var c = await TC.get({ get: get, run: run });
    var on = TC.UIS.filter(function (u) { return u.available && c[u.key] && c[u.key] !== 'off'; });
    var avail = TC.UIS.filter(function (u) { return u.available; }).length;
    if (!on.length) return ev('not_started', 'off on every task screen (the shipped default)');
    return ev('ready', on.length + ' of ' + avail + ' task screens capture time · ' + on.map(function (u) { return u.label + ': ' + c[u.key]; }).join(', '));
  },
  av_redaction: async function () {
    var m = await cfg('av_redaction_mode');
    var words = { internal: 'redacted inside Optimum Q', external: 'redacted in the city\'s own tool', not_required: 'presumptively releasable, reviewed before release' };
    return m ? ev('ready', words[m] || m) : ev('not_started', 'running on the shipped default (internal)');
  },
  notifications: async function () {
    var od = await cfg('overdue_alert_days'), es = await cfg('escalation_days');
    if (!od && !es) return ev('not_started', 'running on the shipped defaults');
    if (!es) return ev('in_progress', 'overdue alerts set · no escalation day set');
    if (!od) return ev('in_progress', 'escalation set · no overdue alert days set');
    return ev('ready', 'overdue at ' + od + ' days · escalate at ' + es + ' days');
  },
  redaction_auto: async function () {
    try { var c = await require('./redactionConfig').read(); return ev(c && c.enabled === false ? 'in_progress' : 'ready', (c && c.enabled === false ? 'automation OFF' : 'automation ON') + ' · no screen yet'); }
    catch (e) { return ev('not_started', 'no screen yet'); }
  },
  release_review: async function () {
    try { var AR = require('./autoRelease'); var a = await AR.knob('auto_release'), p = await AR.knob('pre_send_review');
      var conf = [a, p].filter(function (k) { return k && k.confirmed; }).length;
      return ev(conf === 2 ? 'ready' : (conf ? 'in_progress' : 'not_started'), conf + ' of 2 release switches confirmed · no screen yet'); }
    catch (e) { return ev('not_started', 'no screen yet'); }
  },
  layout_templates: async function () {
    var n = await count("SELECT COUNT(*) n FROM layout_profiles WHERE status IS NULL OR status <> 'retired'");
    return n ? ev('ready', n + ' template' + (n > 1 ? 's' : '')) : ev('not_started', '0 templates');
  },
  decision_reasons: async function () {
    var n = await count('SELECT COUNT(*) n FROM decision_reasons WHERE is_active = 1');
    return n ? ev('ready', n + ' standard reasons · no curation screen yet') : ev('not_started', 'no screen yet');
  },
  mass_schedule: async function () {
    var ws = await cfg('mass_redaction_window_start'), b = await cfg('mass_redaction_nightly_budget');
    return (ws || b) ? ev('ready', 'runs ' + (ws || '18:00') + ' · budget ' + (b || 500) + ' · no screen yet') : ev('not_started', 'running on the shipped defaults · no screen yet');
  },
  departments: async function () {
    var n = await count("SELECT COUNT(*) n FROM departments WHERE active = 1 AND (kind IS NULL OR kind = 'department')");
    return n ? ev('ready', n + ' departments') : ev('not_started', 'no departments yet');
  },
  teams: async function () {
    var teams = await count("SELECT COUNT(*) n FROM departments WHERE active = 1 AND kind = 'team'");
    if (!teams) return ev('not_started', 'no fulfillment teams yet');
    var unserved = await count("SELECT COUNT(*) n FROM departments WHERE active = 1 AND (kind IS NULL OR kind = 'department') AND is_open_records = 0 AND processed_by IS NULL");
    return unserved ? ev('in_progress', teams + ' teams · ' + unserved + ' department' + (unserved > 1 ? 's have' : ' has') + ' no team to serve ' + (unserved > 1 ? 'them' : 'it')) : ev('ready', teams + ' teams · every department served');
  },
  staff: async function () {
    var n = await count("SELECT COUNT(*) n FROM users WHERE status = 'active'");
    var untyped = await count("SELECT COUNT(*) n FROM users u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_user_types x WHERE x.user_id = u.id)");
    var searchers = await count("SELECT COUNT(DISTINCT user_id) n FROM user_task_types WHERE task_type = 'record_search'");
    if (!n) return ev('not_started', 'no staff accounts yet');
    if (untyped) return ev('in_progress', n + ' people · ' + untyped + ' with no user type');
    if (!searchers) return ev('in_progress', n + ' people · nobody assigned to record search');
    return ev('ready', n + ' people, all typed · ' + searchers + ' can search records');
  },
  record_owners: async function () {
    var m = await count("SELECT COUNT(*) n FROM record_types WHERE status = 'active' OR status IS NULL");
    if (!m) return ev('waiting', 'until there are record types to assign', { waitingOn: ['taxonomy'] });
    var n = await count("SELECT COUNT(DISTINCT record_type_id) n FROM record_type_departments WHERE role = 'owner'");
    return ev(n >= m ? 'ready' : (n ? 'in_progress' : 'not_started'), n + ' of ' + m + ' record types have an owner');
  },
  sources: async function () {
    var rows = await all("SELECT status FROM record_repositories");
    if (!rows.length) return ev('not_started', 'no record systems connected');
    var bad = rows.filter(function (r) { return r.status && r.status !== 'active'; }).length;
    return bad ? ev('needs_attention', (rows.length - bad) + ' of ' + rows.length + ' connected · ' + bad + ' not working') : ev('ready', rows.length + ' record system' + (rows.length > 1 ? 's' : '') + ' connected');
  },
  ai_config: async function () {
    var a = await cfg('anthropic_api_key'), v = await cfg('voyage_api_key'), p = await cfg('ai_deployment_profile');
    var model = (p || 'standard') + ' deployment model' + (p ? '' : ' (default)');
    if (!a && !v) return ev('not_started', 'no AI keys entered · ' + model);
    if (!a || !v) return ev('in_progress', (a ? 'Anthropic' : 'Voyage') + ' key set · the other missing · ' + model);
    return ev('ready', 'both keys set · ' + model);
  },
  email: async function () {
    var prov = await cfg('email_provider'); var resend = await cfg('resend_api_key'); var smtp = await cfg('smtp_host');
    if (!prov && !resend && !smtp) return ev('not_started', 'no email provider set');
    var have = prov === 'smtp' ? !!smtp : (prov === 'resend' ? !!resend : !!(smtp || resend));
    var tested = await cfg('email_last_test_ok');
    if (!have) return ev('in_progress', 'provider chosen · not configured');
    return tested ? ev('ready', (prov || (resend ? 'resend' : 'smtp')) + ' · test message sent') : ev('in_progress', (prov || (resend ? 'resend' : 'smtp')) + ' set · no test message sent');
  },
  auth_policy: async function () {
    var mode = await cfg('auth_mode') || 'local', mfa = await cfg('mfa_mode'), to = await cfg('session_timeout'), pl = await cfg('min_password_length');
    return ev('ready', mode + (mfa ? ' + MFA ' + mfa : '') + (to ? ' · ' + to + ' session timeout' : '') + (pl ? ' · ' + pl + '+ character passwords' : ''));
  },
  agent_rules: async function () {
    var n = await count('SELECT COUNT(*) n FROM agent_rules WHERE enabled = 1');
    return n ? ev('ready', n + ' rule' + (n > 1 ? 's' : '') + ' in force') : ev('not_started', 'running on the shipped defaults');
  },
  settlement: async function () {
    var active = await get("SELECT config_json FROM fee_profiles WHERE context = 'FR' AND status = 'active' ORDER BY version DESC LIMIT 1");
    var mode = null; try { mode = active ? (JSON.parse(active.config_json || '{}').paymentMode || JSON.parse(active.config_json || '{}').payment_mode) : null; } catch (e) {}
    if (mode !== 'erp') return ev('ready', 'payments handled internally — nothing to send · no screen yet');
    var url = await cfg('erp_base_url'), secret = await cfg('erp_webhook_secret');
    if (!url) return ev('not_started', 'ERP mode chosen · no finance system address · no screen yet');
    return ev(secret ? 'ready' : 'in_progress', 'finance system set' + (secret ? '' : ' · webhook secret missing') + ' · no screen yet');
  },
};

// ---- sign-offs (Option A) --------------------------------------------------------------------------
async function signoffs() {
  var rows = await all('SELECT item_key, marked_by, marked_by_name, marked_at FROM setup_hub_signoffs');
  var m = {}; rows.forEach(function (r) { m[r.item_key] = r; }); return m;
}
async function mark(itemKey, user) {
  if (!BY_KEY[itemKey]) throw new Error('Unknown setup item: ' + itemKey);
  await run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT (item_key) DO UPDATE SET marked_by = EXCLUDED.marked_by, marked_by_name = EXCLUDED.marked_by_name, marked_at = EXCLUDED.marked_at',
    [itemKey, user.sub || user.id, user.name || user.email || user.sub, new Date().toISOString().slice(0, 19).replace('T', ' ')]);
}
async function unmark(itemKey) { await run('DELETE FROM setup_hub_signoffs WHERE item_key = ?', [itemKey]); }

// Who may edit / mark an item: the lane's groups (or the item's own override); go-live = the authority.
function groupsFor(item) { return item.groups || LANE_BY_KEY[item.lane].groups; }
function mayEdit(item, user) {
  if (!user) return false;
  if (item.goLive) return Array.isArray(user.authorities) && user.authorities.indexOf('go_live') !== -1;
  var g = Array.isArray(user.permissionGroups) ? user.permissionGroups : [];
  if (item.legal) return g.indexOf('legal_rules') !== -1;
  return groupsFor(item).some(function (x) { return g.indexOf(x) !== -1; });
}

// ---- the page --------------------------------------------------------------------------------------
async function build(user) {
  var ctx = await profileSections();
  var marks = await signoffs();
  var out = {};
  for (var i = 0; i < ITEMS.length; i++) {
    var it = ITEMS[i];
    var e;
    try { e = await READERS[it.key](ctx); } catch (err) { e = ev('not_started', 'could not read: ' + (err && err.message)); }
    out[it.key] = Object.assign({}, e);
  }
  // Dependencies: a row whose prerequisite is not ready shows "waiting on X" — but stays open (never a lock).
  // An item's own counted state wins when it is already in progress or ready (work done by hand is real).
  // A prerequisite MARKED done counts as ready for its dependents (golden-setup harness, 2026-08-30: email
  // marked done still left 'When the system warns you' waiting, because this pass ran before marks applied).
  // A mark never overrides needs_attention, and a marked row whose own prerequisites are not ready is itself
  // still waiting — so readiness is computed through the chain.
  var effMemo = {};
  function effReady(key, seen) {
    if (effMemo[key] != null) return effMemo[key];
    seen = seen || {}; if (seen[key]) return false; seen[key] = true;
    var it = BY_KEY[key], st = out[key];
    var v = false;
    if (st && st.state === 'ready') v = true;
    else if (st && marks[key] && st.state !== 'needs_attention') v = (it.deps || []).every(function (d) { return !out[d] || effReady(d, seen); });
    effMemo[key] = v; return v;
  }
  ITEMS.forEach(function (it) {
    var r = out[it.key];
    var notReady = (it.deps || []).filter(function (d) { return out[d] && !effReady(d); });
    if (notReady.length && (r.state === 'not_started' || r.state === 'waiting')) {
      r.state = 'waiting'; r.waitingOn = notReady;
      r.why = (it.softDeps ? 'One part of this step is not available yet. You can still open it and set it by hand. ' : 'Something else has to happen first. ') +
        'Waiting on: ' + notReady.map(function (d) { return BY_KEY[d].name + ' — ' + LANE_BY_KEY[BY_KEY[d].lane].title; }).join('; ') + '.';
    }
    // A reader may itself say 'waiting' (go-live, calibration, record owners): give it the same Why shape.
    if (r.state === 'waiting' && !r.why) {
      var on = (r.waitingOn || []).filter(function (d) { return BY_KEY[d]; });
      r.why = 'Something else has to happen first. Waiting on: ' + (on.length ? on.map(function (d) { return BY_KEY[d].name + ' — ' + LANE_BY_KEY[BY_KEY[d].lane].title; }).join('; ') : r.evidence) + '.';
      if (!r.waitingOn || !r.waitingOn.length) r.waitingOn = on;
    }
    var m = marks[it.key];
    r.signoff = m ? { by: m.marked_by_name || m.marked_by, at: m.marked_at } : null;
    if (m && r.state !== 'needs_attention' && r.state !== 'waiting') { r.state = 'ready'; r.evidence = r.evidence + ' · marked done by ' + (m.marked_by_name || m.marked_by) + ', ' + String(m.marked_at).slice(0, 10); }
    r.canEdit = mayEdit(it, user);
  });
  var counts = { ready: 0, in_progress: 0, not_started: 0, waiting: 0, needs_attention: 0 };
  ITEMS.forEach(function (it) { counts[out[it.key].state] = (counts[out[it.key].state] || 0) + 1; });
  var lanes = LANES.map(function (l) {
    var items = ITEMS.filter(function (it) { return it.lane === l.key && !it.top; }).map(function (it) {
      return Object.assign({ key: it.key, name: it.name, door: it.door, noScreen: !!it.noScreen, legal: !!it.legal, goLive: !!it.goLive, deps: it.deps, note: it.note || null }, out[it.key]);
    });
    var ready = items.filter(function (x) { return x.state === 'ready'; }).length;
    return { key: l.key, title: l.title, ownerLabel: l.ownerLabel, groups: l.groups, items: items, ready: ready, total: items.length,
      canEdit: !!user && Array.isArray(user.permissionGroups) && l.groups.some(function (g) { return user.permissionGroups.indexOf(g) !== -1; }) };
  });
  var top = ITEMS.filter(function (it) { return it.top; }).map(function (it) { return Object.assign({ key: it.key, name: it.name, door: it.door, note: it.note }, out[it.key]); });
  return { counts: counts, top: top, lanes: lanes, jurisdiction: ctx.jid, profileError: ctx.error || null };
}

module.exports = { LANES: LANES, ITEMS: ITEMS, BY_KEY: BY_KEY, build: build, mark: mark, unmark: unmark, mayEdit: mayEdit, READERS: READERS, testEstimateStatus: testEstimateStatus };
