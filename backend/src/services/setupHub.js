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
const crypto = require('crypto');
function digestOf(obj) { return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 20); }

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
  // LIST MODEL (2026-08-31): three rows, one Organization screen — each tab wears the strip of its own row.
  { key: 'departments', lane: 'organization', name: 'City departments', door: '/org?tab=departments', deps: [] },
  { key: 'teams', lane: 'organization', name: 'Fulfillment teams', door: '/org?tab=teams', deps: ['departments'] },
  { key: 'staff', lane: 'organization', name: 'Staff and what each person does', door: '/org?tab=staff', deps: ['teams'] },
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
// DECISIONS AS THE REQUIRED SET (Kevin 2026-08-31): for a row backed by a profile section, every unconfirmed
// local policy setting is a missing required item — the same rule go-live counts — and the digest is the
// settings' values + confirmations, so a re-confirmed choice after approval turns the row yellow.
function sectionRequired(sec) {
  if (!sec) return { required: { missing: ['State not locked — lock it on the agency screen'], total: 1 }, digest: 'none' };
  var list = sec.settings || [];
  var missing = list.filter(function (s) { return s.kind === 'dimension' ? (s.gated && !s.confirmed) : !s.confirmed; }).map(function (s) { return s.label || s.path; });
  return { required: { missing: missing, total: list.length }, digest: digestOf(list.map(function (s) { return [s.domain, s.path, s.value != null ? s.value : (s.current != null ? s.current : null), !!s.confirmed]; })) };
}
function withSection(r, sec) { return Object.assign(r, sectionRequired(sec)); }
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
    // APPROVAL MODEL (Kevin 2026-08-31): the reader also reports the REQUIRED fields still empty (red until
    // every one is saved) and a DIGEST of everything the screen holds (a saved change after approval → yellow).
    var REQ = [['agency_name', 'Agency name'], ['agency_short_name', 'Short name'], ['jurisdiction_type', 'Jurisdiction type'], ['address_line1', 'Address line 1'], ['address_city', 'City'], ['address_state', 'State'], ['address_zip', 'ZIP'], ['contact_email', 'Contact email'], ['contact_phone', 'Contact phone']];
    var vals = {}; for (var qi = 0; qi < REQ.length; qi++) vals[REQ[qi][0]] = await cfg(REQ[qi][0]);
    var extra = {}; for (var xk of ['address_line2', 'mailing_differs', 'mailing_line1', 'mailing_line2', 'mailing_city', 'mailing_state', 'mailing_zip', 'state', 'state_locked_at']) extra[xk] = await cfg(xk);
    var missingReq = REQ.filter(function (r) { return !vals[r[0]]; }).map(function (r) { return r[1]; });
    if (extra.state && !extra.state_locked_at) missingReq.push('State not locked');
    var required = { missing: missingReq, total: REQ.length + 1 };
    var digest = digestOf([vals, extra]);
    var name = vals.agency_name, state = extra.state, email = vals.contact_email;
    if (!name) return ev('not_started', 'no agency name yet', { required: required, digest: digest });
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
    if (missing.length) return ev('in_progress', head + ' · ' + missing.map(function (m) { return m === 'state not locked' ? m : m + ' missing'; }).join(' · '), { required: required, digest: digest });
    return ev('ready', head + ' · ' + email + ' · ' + state + ' rules loaded' + (lockedBy ? ' by ' + lockedBy : '') + ', ' + String(lockedAt).slice(0, 10), { required: required, digest: digest });
  },
  deadlines: async function (ctx) { return withSection(sectionEvidence(ctx.sections.deadlines), ctx.sections.deadlines); },
  fee_law: async function (ctx) {
    // The fee-law screen (services/feeLaw.js): the law's figures load with the state; the city's decisions
    // and an approved fee schedule VERSION are what count. Attest (the `fees` section) still makes it ready.
    if (!ctx.jid) return ev('not_started', 'no jurisdiction chosen yet', { required: { missing: ['State not locked — lock it on the agency screen'], total: 1 }, digest: 'none', tabs: { city: 'red' } });
    var s = await require('./feeLaw').screen(ctx.jid);
    if (!s.jurisdiction) return ev('not_started', 'no jurisdiction chosen yet', { required: { missing: ['State not locked'], total: 1 }, digest: 'none', tabs: { city: 'red' } });
    var c = s.counts;
    // required = every city decision (deferral rows), the waiver choices, the clock's six when it is on, an
    // APPROVED schedule version; plus the fees / fee_waiver / payment sections' unconfirmed settings.
    var miss = [];
    (s.rows || []).forEach(function (r0) { if (r0.binding === 'deferral' && r0.city && r0.city.value == null && r0.city.source == null) miss.push('City decisions: ' + (r0.label || r0.key)); });
    if (s.waiver) (s.waiver.choices || []).forEach(function (w) { if (w.value == null) miss.push('City decisions: ' + (w.label || w.key)); });
    if (s.clock && s.clock.enabled) (s.clock.choices || []).forEach(function (w) { if (w.value == null) miss.push('City decisions: payment clock — ' + (w.label || w.key)); });
    if (!s.version) miss.push('City decisions: approve the fee schedule (creates version 1)');
    // (The fees / fee_waiver / payment SECTION knobs this screen does not surface are go-live's concern, not this
    // row's — a screen must be able to reach yellow on its own. Audit 2026-08-31 §3-E lists them.)
    var feeExtra = { required: { missing: miss, total: (c.deferral || 0) + ((s.waiver && s.waiver.choices) ? s.waiver.choices.length : 0) + ((s.clock && s.clock.enabled && s.clock.choices) ? s.clock.choices.length : 0) + 1 }, tabs: { city: miss.length ? 'red' : 'ok' },
      digest: digestOf([(s.rows || []).map(function (r0) { return [r0.key, r0.city && r0.city.value, r0.city && r0.city.source]; }), s.waiver && s.waiver.choices, s.clock && [s.clock.enabled, s.clock.choices], s.version && s.version.id]) };
    var line = c.mandate + ' figures set by ' + s.jurisdiction.code + ' law' + (c.deferral ? ' · ' + c.decided + ' of ' + c.deferral + ' city choices decided' : '');
    if (s.waiver && s.waiver.choices.length) line += ' · waivers: ' + s.waiver.decided + ' of ' + s.waiver.choices.length + ' decided';
    if (s.clock) line += ' · payment clock: ' + (s.clock.enabled ? s.clock.confirmed + ' of ' + s.clock.choices.length + ' confirmed' : 'off');
    if (!s.version) return ev(c.decided ? 'in_progress' : 'not_started', line + ' · no fee schedule version yet', feeExtra);
    var sec = ctx.sections.fees;
    var r = sectionEvidence(sec, 'fee schedule v' + s.version.version);
    if (r.state === 'not_started') r = ev('in_progress', 'not yet confirmed');
    if (r.state !== 'ready') r.evidence = 'fee schedule v' + s.version.version + ' · ' + r.evidence;
    r.evidence = line + ' · ' + r.evidence;
    return Object.assign(r, feeExtra);
  },
  clarification: async function (ctx) {
    var r = sectionEvidence(ctx.sections.clarification);
    if (r.state === 'not_started') r.evidence = 'not configured yet — clarification is switched off';
    return withSection(r, ctx.sections.clarification);
  },
  exemptions: async function (ctx) { return withSection(sectionEvidence(ctx.sections.exemption), ctx.sections.exemption); },
  intake: async function (ctx) { return withSection(sectionEvidence(ctx.sections.intake), ctx.sections.intake); },
  eligibility: async function (ctx) {
    var sec = ctx.sections.eligibility;
    var r = sectionEvidence(sec);
    if (r.state === 'not_started' && sec) {
      var n = Number(sec.unconfirmed) || 0;
      r.evidence = n === 1 ? 'one decision to confirm' : n > 1 ? n + ' decisions to confirm' : r.evidence;
    }
    return withSection(r, sec);
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
    // LIST MODEL (2026-08-31): red until the first department; 'Ready for approval' declares the list complete.
    var rows = await all("SELECT id, name, code, processed_by, is_open_records, is_catch_all FROM departments WHERE active = 1 AND (kind IS NULL OR kind = 'department') ORDER BY id");
    var n = rows.length;
    var x = { list: { count: n, noun: 'department' }, digest: digestOf(rows) };
    return n ? ev('ready', n + ' departments', x) : ev('not_started', 'no departments yet', x);
  },
  teams: async function () {
    // LIST MODEL (2026-08-31). Health: departments with no team to serve them (never blocks the colour).
    var trows = await all("SELECT id, name, code, processed_by FROM departments WHERE active = 1 AND kind = 'team' ORDER BY id");
    var served = await all("SELECT id, processed_by FROM departments WHERE active = 1 AND (kind IS NULL OR kind = 'department') ORDER BY id");
    var teams = trows.length;
    var unserved0 = await count("SELECT COUNT(*) n FROM departments WHERE active = 1 AND (kind IS NULL OR kind = 'department') AND is_open_records = 0 AND processed_by IS NULL");
    var xt = { list: { count: teams, noun: 'team', health: unserved0 ? unserved0 + ' department' + (unserved0 > 1 ? 's have' : ' has') + ' no team to serve ' + (unserved0 > 1 ? 'them' : 'it') : '' }, digest: digestOf([trows, served]) };
    if (!teams) return ev('not_started', 'no fulfillment teams yet', xt);
    var unserved = unserved0;
    return unserved ? ev('in_progress', teams + ' teams · ' + unserved + ' department' + (unserved > 1 ? 's have' : ' has') + ' no team to serve ' + (unserved > 1 ? 'them' : 'it'), xt) : ev('ready', teams + ' teams · every department served', xt);
  },
  staff: async function () {
    // LIST MODEL (2026-08-31). Health: people with no user type.
    var srows = await all("SELECT u.id, u.display_name, u.department_id, u.status, (SELECT string_agg(x.user_type_id || ':' || COALESCE(x.team_id, ''), ',' ORDER BY x.user_type_id) FROM user_user_types x WHERE x.user_id = u.id) AS types FROM users u WHERE u.status = 'active' ORDER BY u.id");
    var n = srows.length;
    var untyped0 = srows.filter(function (r) { return !r.types; }).length;
    var xs = { list: { count: n, noun: 'person', health: untyped0 ? untyped0 + ' with no user type' : '' }, digest: digestOf(srows) };
    var untyped = await count("SELECT COUNT(*) n FROM users u WHERE u.status = 'active' AND NOT EXISTS (SELECT 1 FROM user_user_types x WHERE x.user_id = u.id)");
    var searchers = await count("SELECT COUNT(DISTINCT user_id) n FROM user_task_types WHERE task_type = 'record_search'");
    if (!n) return ev('not_started', 'no staff accounts yet', xs);
    if (untyped) return ev('in_progress', n + ' people · ' + untyped + ' with no user type', xs);
    if (!searchers) return ev('in_progress', n + ' people · nobody assigned to record search', xs);
    return ev('ready', n + ' people, all typed · ' + searchers + ' can search records', xs);
  },
  record_owners: async function () {
    var m = await count("SELECT COUNT(*) n FROM record_types WHERE status = 'active' OR status IS NULL");
    if (!m) return ev('waiting', 'until there are record types to assign', { waitingOn: ['taxonomy'] });
    var n = await count("SELECT COUNT(DISTINCT record_type_id) n FROM record_type_departments WHERE role = 'owner'");
    return ev(n >= m ? 'ready' : (n ? 'in_progress' : 'not_started'), n + ' of ' + m + ' record types have an owner');
  },
  sources: async function () {
    // LIST MODEL (Kevin 2026-08-31): red until the first connector, yellow while the list grows (quietly — no
    // notifications), 'Ready for approval' is the adder's declaration, green on approval, yellow again on any
    // add/edit/delete after approval. `list` + `digest` drive the colours in build().
    var rows = await all("SELECT id, name, connector_type, status, config FROM record_repositories ORDER BY id");
    var list = { count: rows.length, notConnected: rows.filter(function (r) { return r.status && r.status !== 'active'; }).length, noun: 'connector' };
    var digest = digestOf(rows.map(function (r) { return [r.id, r.name, r.connector_type, r.status, r.config]; }));
    if (!rows.length) return ev('not_started', 'no record systems connected', { list: list, digest: digest });
    var bad = list.notConnected;
    return bad ? ev('needs_attention', (rows.length - bad) + ' of ' + rows.length + ' connected · ' + bad + ' not working', { list: list, digest: digest }) : ev('ready', rows.length + ' record system' + (rows.length > 1 ? 's' : '') + ' connected', { list: list, digest: digest });
  },
  ai_config: async function () {
    // TABBED SCREEN (Kevin 2026-08-31): each tab has its own required set and colour; the screen's colour is the
    // worst tab; one approval for the whole screen. Informational tabs (touchpoints, security) count nothing.
    // A key from the server environment counts as set (the screen says 'configured' for it — routes/integrations.js).
    var a = (await cfg('anthropic_api_key')) || process.env.ANTHROPIC_API_KEY, v = (await cfg('voyage_api_key')) || process.env.VOYAGE_API_KEY, p = await cfg('ai_deployment_profile');
    var region = await cfg('aws_region'), titan = await cfg('titan_embed_model'), bk = await cfg('bedrock_access_key_id'), bs = await cfg('bedrock_secret_key');
    var keysMissing = []; if (!a) keysMissing.push('Anthropic key'); if (!v) keysMissing.push('Voyage key');
    var depMissing = []; if (!p) depMissing.push('deployment model not chosen');
    if (p === 'government') { if (!region) depMissing.push('GovCloud region'); if (!titan) depMissing.push('Titan embedding model'); if (!bk) depMissing.push('Bedrock access key'); if (!bs) depMissing.push('Bedrock secret key'); }
    var missing = keysMissing.map(function (m) { return 'AI Service Keys: ' + m; }).concat(depMissing.map(function (m) { return 'Deployment Model: ' + m; }));
    var tabs = { keys: keysMissing.length ? 'red' : 'ok', deployment: depMissing.length ? 'red' : 'ok' };
    var extra = { required: { missing: missing, total: 2 + (p === 'government' ? 5 : 1) }, tabs: tabs, digest: digestOf([!!a, !!v, p || null, region || null, titan || null, !!bk, !!bs]) };
    var model = (p || 'standard') + ' deployment model' + (p ? '' : ' (not chosen — standard by default)');
    if (!a && !v) return ev('not_started', 'no AI keys entered · ' + model, extra);
    if (!a || !v) return ev('in_progress', (a ? 'Anthropic' : 'Voyage') + ' key set · the other missing · ' + model, extra);
    return ev(p ? 'ready' : 'in_progress', 'both keys set · ' + model, extra);
  },
  email: async function () {
    // FORM (approval model, 2026-08-31): required = a provider and, for SMTP, host + port + from address; for Resend,
    // the key + from address. The test send is evidence, not a requirement.
    var prov = await cfg('email_provider'); var resend = await cfg('resend_api_key'); var smtp = await cfg('smtp_host');
    var port = await cfg('smtp_port'), sfrom = await cfg('smtp_from'), rfrom = await cfg('resend_from'), fromName = await cfg('email_from_name'), spass = await cfg('smtp_pass'), suser = await cfg('smtp_user');
    var effProv = prov || (resend ? 'resend' : (smtp ? 'smtp' : null));
    var missingE = [];
    if (!effProv) missingE.push('Provider');
    else if (effProv === 'smtp') { if (!smtp) missingE.push('SMTP host'); if (!port) missingE.push('Port'); if (!sfrom) missingE.push('From address'); }
    else { if (!resend) missingE.push('Resend API key'); if (!rfrom) missingE.push('From address'); }
    var extraE = { required: { missing: missingE, total: effProv === 'resend' ? 3 : 4 }, digest: digestOf([effProv, smtp, port, suser, !!spass, sfrom, !!resend, rfrom, fromName, await cfg('new_request_alert_email')]) };
    if (!prov && !resend && !smtp) return ev('not_started', 'no email provider set', extraE);
    var have = prov === 'smtp' ? !!smtp : (prov === 'resend' ? !!resend : !!(smtp || resend));
    var tested = await cfg('email_last_test_ok');
    if (!have) return ev('in_progress', 'provider chosen · not configured', extraE);
    return tested ? ev('ready', (prov || (resend ? 'resend' : 'smtp')) + ' · test message sent', extraE) : ev('in_progress', (prov || (resend ? 'resend' : 'smtp')) + ' set · no test message sent', extraE);
  },
  auth_policy: async function () {
    // FORM (approval model, 2026-08-31): the four sign-in settings must be SAVED (a shipped default is not a decision).
    var rawMode = await cfg('auth_mode'); var mode = rawMode || 'local', mfa = await cfg('mfa_mode'), to = await cfg('session_timeout'), pl = await cfg('min_password_length');
    var missingA = []; if (!rawMode) missingA.push('Authentication mode'); if (!mfa) missingA.push('Multi-factor authentication'); if (!to) missingA.push('Session timeout'); if (!pl) missingA.push('Minimum password length');
    var extraA = { required: { missing: missingA, total: 4 }, digest: digestOf([rawMode, mfa, to, pl]) };
    if (missingA.length) return ev('not_started', missingA.length === 4 ? 'running on the shipped defaults — nothing saved yet' : 'saved: ' + (4 - missingA.length) + ' of 4 settings', extraA);
    return ev('ready', mode + (mfa ? ' + MFA ' + mfa : '') + (to ? ' · ' + to + ' session timeout' : '') + (pl ? ' · ' + pl + '+ character passwords' : ''), extraA);
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
async function readies() {
  var rows = await all('SELECT item_key, ready_by, ready_by_name, ready_at FROM setup_hub_ready');
  var m = {}; rows.forEach(function (r) { m[r.item_key] = r; }); return m;
}
async function signoffs() {
  var rows = await all('SELECT item_key, marked_by, marked_by_name, marked_at, content_hash, notified_hash FROM setup_hub_signoffs');
  var m = {}; rows.forEach(function (r) { m[r.item_key] = r; }); return m;
}
// APPROVAL (Kevin 2026-08-31): a mark IS the lane owner's approval. For an item whose reader reports required
// fields, it is refused while any is empty (red); it records the item's content digest so a later saved change
// is detected (yellow again) and the owners are told.
async function readOne(itemKey) {
  var ctx = await profileSections();
  try { return await READERS[itemKey](ctx); } catch (e) { return ev('not_started', 'could not read: ' + (e && e.message)); }
}
async function mark(itemKey, user) {
  if (!BY_KEY[itemKey]) throw new Error('Unknown setup item: ' + itemKey);
  var e = await readOne(itemKey);
  if (e.required && e.required.missing && e.required.missing.length) {
    var err = new Error('Not ready to approve — ' + e.required.missing.length + ' required item(s) still missing: ' + e.required.missing.join(', ') + '. Fill and save each one first.');
    err.code = 'REQUIRED_MISSING'; err.status = 422; err.missing = e.required.missing; throw err;
  }
  await run('INSERT INTO setup_hub_signoffs (item_key, marked_by, marked_by_name, marked_at, content_hash, notified_hash) VALUES (?, ?, ?, ?, ?, NULL) ' +
    'ON CONFLICT (item_key) DO UPDATE SET marked_by = EXCLUDED.marked_by, marked_by_name = EXCLUDED.marked_by_name, marked_at = EXCLUDED.marked_at, content_hash = EXCLUDED.content_hash, notified_hash = NULL',
    [itemKey, user.sub || user.id, user.name || user.email || user.sub, new Date().toISOString().slice(0, 19).replace('T', ' '), e.digest || null]);
  await run('DELETE FROM setup_hub_ready WHERE item_key = ?', [itemKey]);
}
// LIST SCREENS: the adder says the list is complete. A signal to the lane owners (one notification), never an
// approval. Refused while red (nothing added) and meaningless while green (already approved, unchanged).
async function declareReady(itemKey, user) {
  var it = BY_KEY[itemKey]; if (!it) throw new Error('Unknown setup item: ' + itemKey);
  var e = await readOne(itemKey);
  if (e.list && !e.list.count) { var er = new Error('Nothing has been added yet — add the first ' + (e.list.noun || 'item') + ' before declaring the list complete.'); er.code = 'NOTHING_ADDED'; er.status = 422; throw er; }
  var m = (await signoffs())[itemKey];
  if (m && m.content_hash && e.digest === m.content_hash) { var eg = new Error('This item is already approved and unchanged.'); eg.code = 'ALREADY_APPROVED'; eg.status = 400; throw eg; }
  var already = (await readies())[itemKey];
  await run('INSERT INTO setup_hub_ready (item_key, ready_by, ready_by_name, ready_at) VALUES (?, ?, ?, ?) ON CONFLICT (item_key) DO UPDATE SET ready_by = EXCLUDED.ready_by, ready_by_name = EXCLUDED.ready_by_name, ready_at = EXCLUDED.ready_at',
    [itemKey, user.sub || user.id, user.name || user.email || user.sub, new Date().toISOString().slice(0, 19).replace('T', ' ')]);
  var sent = 0;
  if (!already) {
    var groups = groupsFor(it); if (it.legal) groups = ['legal_rules'];
    var ph = groups.map(function () { return '?'; }).join(',');
    var owners = await all('SELECT DISTINCT uut.user_id FROM user_user_types uut JOIN user_type_permission utp ON utp.user_type_id = uut.user_type_id JOIN users u ON u.id = uut.user_id WHERE utp.permission_group IN (' + ph + ") AND u.status = 'active'", groups);
    var N = require('./notifications');
    for (var i = 0; i < owners.length; i++) { try { await N.emit({ userId: owners[i].user_id, kind: 'setup_ready', contextType: 'setup_item', contextId: itemKey, link: it.door, title: 'Ready for approval: ' + it.name, body: (user.name || user.email || 'Someone') + ' says ' + it.name + ' is complete. Open it and approve.' }); sent++; } catch (eN) { console.error('[setupHub declareReady]', eN && eN.message); } }
  }
  return { ready: true, notified: sent };
}
async function withdrawReady(itemKey) { await run('DELETE FROM setup_hub_ready WHERE item_key = ?', [itemKey]); }
// Called by a screen's write path after a save: if the item was approved and its content changed, tell the
// lane owners ONCE per change (the guide already shows yellow from the digest alone).
async function afterChange(itemKey, actorName) {
  var it = BY_KEY[itemKey]; if (!it) return { notified: false };
  var m = (await signoffs())[itemKey]; if (!m || !m.content_hash) return { notified: false, reason: 'not approved' };
  var e = await readOne(itemKey); if (!e.digest || e.digest === m.content_hash) return { notified: false, reason: 'unchanged' };
  if (m.notified_hash === e.digest) return { notified: false, reason: 'already notified' };
  var groups = groupsFor(it); if (it.legal) groups = ['legal_rules'];
  var ph = groups.map(function () { return '?'; }).join(',');
  var owners = await all('SELECT DISTINCT uut.user_id FROM user_user_types uut JOIN user_type_permission utp ON utp.user_type_id = uut.user_type_id JOIN users u ON u.id = uut.user_id WHERE utp.permission_group IN (' + ph + ") AND u.status = 'active'", groups);
  var N = require('./notifications'); var sent = 0;
  for (var i = 0; i < owners.length; i++) {
    try { await N.emit({ userId: owners[i].user_id, kind: 'setup_reapproval', contextType: 'setup_item', contextId: itemKey, link: it.door, title: 'Re-approval needed: ' + it.name, body: (actorName || 'Someone') + ' changed and saved ' + it.name + ' after it was approved. Open it and approve again.' }); sent++; } catch (eN) { console.error('[setupHub afterChange]', eN && eN.message); }
  }
  await run('UPDATE setup_hub_signoffs SET notified_hash = ? WHERE item_key = ?', [e.digest, itemKey]);
  return { notified: true, recipients: sent };
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
  var readyMap = await readies();
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
    // THE THREE-COLOUR APPROVAL (Kevin 2026-08-31) — what the Set Up Guide's bars and each screen's indicator show.
    // fields model (reader reports required + digest): red = a required field is empty · yellow = complete but not
    // approved, or changed since approval · green = approved and unchanged. Other items derive from the counted state.
    var changed = !!(m && m.content_hash && r.digest && r.digest !== m.content_hash);
    var rd = readyMap[it.key] || null;
    r.ready = rd ? { by: rd.ready_by_name || rd.ready_by, at: rd.ready_at } : null;
    if (r.list) {
      r.approvalModel = 'list';
      var noun = r.list.noun || 'item', n = r.list.count, plural = n === 1 ? noun : noun + 's';
      var health = r.list.health ? ' · ' + r.list.health : (r.list.notConnected ? ' · ' + r.list.notConnected + ' not connected' : '');
      var plural2 = noun === 'person' ? (n === 1 ? 'person' : 'people') : plural; plural = plural2;
      if (!n) { r.approval = 'red'; r.approvalWhy = 'nothing added yet — add the first ' + noun; }
      else if (!m) { r.approval = 'yellow'; r.approvalWhy = rd ? ('ready for approval — declared by ' + (rd.ready_by_name || rd.ready_by) + ' on ' + String(rd.ready_at).slice(0, 10) + ' · ' + n + ' ' + plural + health) : ('in progress — ' + n + ' ' + plural + health + ' · say "Ready for approval" when the list is complete'); }
      else if (changed) { r.approval = 'yellow'; r.approvalWhy = 'changed since approval by ' + (m.marked_by_name || m.marked_by) + ' on ' + String(m.marked_at).slice(0, 10) + ' — awaiting re-approval · ' + n + ' ' + plural + health; }
      else { r.approval = 'green'; r.approvalWhy = 'approved by ' + (m.marked_by_name || m.marked_by) + ', ' + String(m.marked_at).slice(0, 10) + ' · ' + n + ' ' + plural + health; }
    } else if (r.required) {
      r.approvalModel = 'fields';
      if (r.required.missing.length) { var mm = r.required.missing; r.approval = 'red'; r.approvalWhy = mm.length + ' of ' + Math.max(r.required.total, mm.length) + ' required items missing — ' + mm.slice(0, 6).join(', ') + (mm.length > 6 ? ' … and ' + (mm.length - 6) + ' more' : ''); }
      else if (!m) { r.approval = 'yellow'; r.approvalWhy = 'complete — awaiting approval by ' + (it.legal ? 'Senior Legal' : LANE_BY_KEY[it.lane].ownerLabel.split(' · ')[0]); }
      else if (changed) { r.approval = 'yellow'; r.approvalWhy = 'changed since approval by ' + (m.marked_by_name || m.marked_by) + ' on ' + String(m.marked_at).slice(0, 10) + ' — awaiting re-approval'; }
      else { r.approval = 'green'; r.approvalWhy = 'approved by ' + (m.marked_by_name || m.marked_by) + ', ' + String(m.marked_at).slice(0, 10); }
    } else {
      r.approvalModel = 'derived';
      r.approval = (m && !changed && r.state !== 'needs_attention') ? 'green' : (r.state === 'ready' ? 'green' : ((r.state === 'in_progress' || r.state === 'needs_attention') ? 'yellow' : 'red'));
      r.approvalWhy = m ? ((changed ? 'changed since approval by ' : 'approved by ') + (m.marked_by_name || m.marked_by) + ', ' + String(m.marked_at).slice(0, 10)) : r.evidence;
    }
    r.changedSinceApproval = changed;
    // per-tab colours for tabbed screens: a tab is red while its required set is empty, else the screen's colour
    // a tab's own state: red while its required set is empty; otherwise yellow until the screen is approved, then green
    if (r.tabs) { var tc = {}; Object.keys(r.tabs).forEach(function (k) { tc[k] = r.tabs[k] === 'red' ? 'red' : (r.approval === 'green' ? 'green' : 'yellow'); }); r.tabs = tc; }
    delete r.required; delete r.digest; delete r.list;
    if (m && r.state !== 'needs_attention' && r.state !== 'waiting') { r.state = 'ready'; r.evidence = r.evidence + ' · marked done by ' + (m.marked_by_name || m.marked_by) + ', ' + String(m.marked_at).slice(0, 10); }
    r.canEdit = mayEdit(it, user);
  });
  var counts = { ready: 0, in_progress: 0, not_started: 0, waiting: 0, needs_attention: 0 };
  ITEMS.forEach(function (it) { counts[out[it.key].state] = (counts[out[it.key].state] || 0) + 1; });
  var colours = { red: 0, yellow: 0, green: 0 };
  ITEMS.forEach(function (it) { if (!it.goLive) colours[out[it.key].approval] = (colours[out[it.key].approval] || 0) + 1; });
  var goLiveColour = colours.red ? 'red' : (colours.yellow ? 'yellow' : 'green');
  var lanes = LANES.map(function (l) {
    var items = ITEMS.filter(function (it) { return it.lane === l.key && !it.top; }).map(function (it) {
      return Object.assign({ key: it.key, name: it.name, door: it.door, noScreen: !!it.noScreen, legal: !!it.legal, goLive: !!it.goLive, deps: it.deps, note: it.note || null }, out[it.key]);
    });
    var ready = items.filter(function (x) { return x.state === 'ready'; }).length;
    return { key: l.key, title: l.title, ownerLabel: l.ownerLabel, groups: l.groups, items: items, ready: ready, total: items.length,
      canEdit: !!user && Array.isArray(user.permissionGroups) && l.groups.some(function (g) { return user.permissionGroups.indexOf(g) !== -1; }) };
  });
  var top = ITEMS.filter(function (it) { return it.top; }).map(function (it) { return Object.assign({ key: it.key, name: it.name, door: it.door, note: it.note }, out[it.key]); });
  return { counts: counts, colours: colours, goLiveColour: goLiveColour, top: top, lanes: lanes, jurisdiction: ctx.jid, profileError: ctx.error || null };
}

module.exports = { LANES: LANES, ITEMS: ITEMS, BY_KEY: BY_KEY, build: build, mark: mark, unmark: unmark, mayEdit: mayEdit, READERS: READERS, testEstimateStatus: testEstimateStatus, afterChange: afterChange, readOne: readOne, declareReady: declareReady, withdrawReady: withdrawReady };
