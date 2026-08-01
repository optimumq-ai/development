'use strict';
// PHASE 7 / WS5 — THE REQUESTOR-LEDGER, MVP class A.
//
// Implements docs/rules_research/workflow/DESIGN_requestor_ledger.md (decisions settled with Kevin
// 2026-07-26). That document is decided; this encodes it.
//
// WHY IT EXISTS. The parent request is a per-request financial processor, and a family of statutes is
// about state that CROSSES requests: "unpaid fees from previous requests" (TX § 552.263(c), > $100),
// "36 hours of free staff time per requestor per 12 months" (TX § 552.275), "at least 7 requests in the
// last 7 days" (IL recurrent), "10 physical deliveries per month" (OH). A per-request parent cannot hold
// any of it. This sits BESIDE the parent processors, never above them: it is passive storage plus PURE
// trigger functions evaluated at three gates that already exist. It never mutates a child's stage — the
// same rule that keeps parent→child coupling visibility-only.
//
// ══ THE HARD CONSTRAINT: IDENTITY ══
//
// Most states forbid conditioning access on identity. Ohio § 149.43(B)(4) and Texas's no-purpose,
// pseudonymous-email rules are the model. So an ADVERSE trigger — a deposit demand, an advance-payment
// gate, a denial advisory — requires an AFFIRMATIVE identity match: the same portal account, the same
// VERIFIED email, or a staff-confirmed walk-in. Never a fuzzy match, never a bare name, never an
// unverified email string that happens to be equal.
//
// An anonymous request therefore evaluates no adverse triggers at all. That is not a gap this module
// tolerates — it is what the statutes themselves accept (Ohio may demand identification only on a
// reasonable vexatious belief, § 2323.52(J)(2)). The alternative — matching on an unverified email — would
// deny a citizen their statutory right on a coincidence of strings, and they would have no way to tell
// that from a bug.
//
// The design records the consequence honestly: a determined requester can dodge the ledger with a fresh
// email. Cities already live with that; the bar is "as good as a diligent clerk", not "unbeatable".
//
// ══ MVP SCOPE (Kevin, decision 2) ══
//
//   CLASS A  balance ledger — BUILT FULLY. Evented from the parent financial processor
//            (paymentStatus.recordEvent), never recomputed from mutable request rows at read time: an A/R
//            figure a deposit demand rests on has to be reconstructable.
//   B/C/D    allowances, counters/history, flags — CONFIG STUBS with manual values. Every knob, notice and
//            timer exists, so a staff-entered number produces fully compliant output; only the automatic
//            counting is deferred until a city elects those regimes.
//
// ══ ADVISORY vs AUTOMATIC (design §Trigger evaluation) ══
//
// Monetary triggers (deposit / advance-payment / prepayment demands) are computed automatically and issue
// through the normal parent-processor communications. DENIAL-SHAPED triggers — Massachusetts's
// unpaid-balance denial, duplicate/repeat denials, vexatious gates — surface as flagged ADVISORIES that a
// person confirms. Similarity and "reasonable belief" are judgment calls, and auto-denial there would be
// automation beyond the compliant subset.
var db = require('../db');
var JR = require('./jurisdictionRules');
var uuidv4 = require('uuid').v4;

var DOMAIN = 'ledger';
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function uid(p) { return p + '-' + uuidv4().slice(0, 8); }
function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ---------------------------------------------------------------------------------------------------
// UNPAID-PRIOR-BALANCE RULES, transcribed from DESIGN_requestor_ledger.md §"Driving rules" table A.
//
// Same device as WS1's SUGGESTED_DEFAULTS and WS4's MANDATORY_CATEGORIES: a decided research document
// copied into code where it can be read, tested and cited. `citation` is filled ONLY where the design
// document states one verbatim — elsewhere the rule id IS the reference, and evaluate() enriches it from
// the state's imported template evidence when that rule is present there. Inventing a citation to fill
// the column would put a fabricated authority on a demand for money.
// ---------------------------------------------------------------------------------------------------
var PRIOR_BALANCE_RULES = {
  TX: {
    rule_id: 'TX-0035', citation: "Tex. Gov't Code § 552.263(c)",
    action: 'deposit', threshold_usd: 100, automatic: true,
    summary: 'May require a deposit or bond for unpaid amounts owed on prior requests once those exceed $100.'
  },
  OK: {
    rule_id: 'OK-S03', citation: '51 O.S. § 24A.5(4) (SB 535)',
    action: 'advance_payment', threshold_usd: 0, estimate_over_usd: 75, automatic: true,
    summary: 'May require advance payment of a new estimate where fees are outstanding (or the estimate exceeds $75).'
  },
  GA: { rule_id: 'GA-0025', citation: null, action: 'prepayment', threshold_usd: 0, automatic: true,
        summary: 'May require prepayment of the prior unpaid costs before fulfilling a new request.' },
  MA: { rule_id: 'MA-0041', citation: null, action: 'advisory_deny', threshold_usd: 0, automatic: false,
        summary: 'May DENY the new request where fees are outstanding, with written notice of reasons. Denial-shaped: a person confirms.' },
  MI: { rule_id: 'MI-0056', citation: null, action: 'increased_deposit', threshold_usd: 0, max_pct: 100, automatic: true,
        clearing_event: 'proof_of_payment',
        summary: 'May demand an increased deposit (up to 100%). MUST STOP once the requestor proves full payment.' },
  UT: { rule_id: 'UT-0037', citation: null, action: 'prepayment', threshold_usd: 0, automatic: true,
        summary: 'May require payment of past fees (plus the future estimate) before processing.' },
  WI: { rule_id: 'WI-0043', citation: null, action: 'prepayment', threshold_usd: 0, automatic: true,
        requires_flag: 'prisoner',
        summary: 'A prisoner with a prior unpaid records debt may be required to prepay.' }
};

// The three gates the ledger is consulted at — all of them already exist in the flow.
var GATES = ['intake', 'estimate', 'delivery'];

// ---------------------------------------------------------------------------------------------------
// Config — read-time normalised, so nothing needs importing or migrating and WS1's `ledger` domain row
// (which carries the state's concept evidence) stays exactly as it was written.
// ---------------------------------------------------------------------------------------------------
function normalizeConfig(code, raw) {
  raw = raw || {};
  var rule = PRIOR_BALANCE_RULES[String(code || '').toUpperCase()] || null;
  var pb = raw.prior_balance || {};
  return {
    code: code || null,
    mvp_class: 'A',
    prior_balance: rule ? {
      applies: true,
      rule_id: rule.rule_id,
      citation: rule.citation,
      action: rule.action,
      automatic: rule.automatic,
      summary: rule.summary,
      // A city may set a HIGHER bar than the statute permits (it is permissive authority — "may
      // require"), never a lower one, so the statutory threshold is the floor on how little is demanded.
      threshold_usd: pb.threshold_usd != null ? Math.max(Number(pb.threshold_usd) || 0, rule.threshold_usd || 0) : (rule.threshold_usd || 0),
      estimate_over_usd: rule.estimate_over_usd != null ? (pb.estimate_over_usd != null ? Number(pb.estimate_over_usd) : rule.estimate_over_usd) : null,
      max_pct: rule.max_pct != null ? (pb.max_pct != null ? Math.min(Number(pb.max_pct), rule.max_pct) : rule.max_pct) : null,
      requires_flag: rule.requires_flag || null,
      clearing_event: rule.clearing_event || null,
      // OFF until a city elects it. This is PERMISSIVE authority — "may require" — so switching it on is
      // a city's choice, and defaulting it on would demand money no statute compels anyone to demand.
      enabled: pb.enabled === true
    } : { applies: false, enabled: false },
    // Classes B/C/D: the knobs exist and the numbers are entered by a human until a city elects the regime.
    allowances: { mode: 'manual', enabled: (raw.allowances || {}).enabled === true },
    counters: { mode: 'manual', enabled: (raw.counters || {}).enabled === true },
    flags: { mode: 'manual', enabled: (raw.flags || {}).enabled !== false }
  };
}

async function config(jid) {
  if (!jid) jid = await JR.activeJid();
  var raw = null, code = null;
  try { raw = jid ? await JR.read(jid, DOMAIN) : null; } catch (e) { raw = null; }
  try { var r = jid ? await db.get('SELECT code FROM jurisdiction_profiles WHERE id = ?', [jid]) : null; code = r && r.code; } catch (e) {}
  var out = normalizeConfig(code, raw);
  out.jurisdictionId = jid;
  return out;
}

async function writeConfig(jid, cfg, actor) {
  if (!jid) jid = await JR.activeJid();
  var cur = null;
  try { cur = await JR.read(jid, DOMAIN); } catch (e) {}
  cur = cur || {};
  // Preserve the imported evidence (WS1 wrote `triggers`, `caps_branch`, `_import`); only the knobs move.
  var pb = (cfg || {}).prior_balance || {};
  cur.prior_balance = {
    enabled: pb.enabled === true,
    threshold_usd: pb.threshold_usd != null ? Number(pb.threshold_usd) : undefined,
    estimate_over_usd: pb.estimate_over_usd != null ? Number(pb.estimate_over_usd) : undefined,
    max_pct: pb.max_pct != null ? Number(pb.max_pct) : undefined
  };
  Object.keys(cur.prior_balance).forEach(function (k) { if (cur.prior_balance[k] === undefined) delete cur.prior_balance[k]; });
  ['allowances', 'counters', 'flags'].forEach(function (k) {
    if ((cfg || {})[k]) cur[k] = { enabled: cfg[k].enabled === true };
  });
  return await JR.write(jid, DOMAIN, cur, actor || 'staff');
}

// ---------------------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------------------

// `email_verification_method` values that represent an ACTUAL verification event, as opposed to the
// requester asserting their own address.
//
// 'link_clicked' (IDENTITY ANCHORS, 2026-08-01) is SERVER-DERIVED: requestCreate.trustedEmailMethod()
// writes it only after checking our own email_verifications row — the link was emailed, the requester
// clicked it in time, and the verified address is the address the request names. It can never arrive
// as a client claim; the claims a client can send ('link', 'attested', 'visual') are stored as the
// untrusted assertions they are and remain OUTSIDE this set. 'staff_verified' stays: a staffer who
// checked the address is an actual verification event, whenever a producer for it ships.
//
// The old inert-by-design note (WS5): the portal's self-clicked buttons and the wizard's unconditional
// 'link' claim were the only things the product wrote, so this set excluded everything and class A was
// deliberately inert — matching on an unverified email would let one person's unpaid balance gate a
// different person who typed the same address. That rule is unchanged; what changed is that a real
// producer now exists.
var VERIFIED_EMAIL_METHODS = ['staff_verified', 'link_clicked'];

// THE ANCHOR TEST. Returns the basis, or null for "no affirmative identity" — which is the answer for an
// ordinary anonymous request and must stay the answer.
//
// A bare `requestor_email` is NOT an anchor. It is a string the submitter typed, and matching on it would
// let one person's unpaid balance block another person who typed the same address.
function anchorFor(request) {
  if (!request) return null;
  if (request.portal_account_id) return { basis: 'portal_account', key: String(request.portal_account_id) };
  if (request.requestor_email && VERIFIED_EMAIL_METHODS.indexOf(request.email_verification_method) >= 0) {
    return { basis: 'verified_email', key: String(request.requestor_email).trim().toLowerCase() };
  }
  // A staff-confirmed walk-in: a person in front of a clerk who confirmed who they are. This is an
  // EXPLICIT act — a route or a staffer sets it — never inferred from the submission channel, because
  // "arrived by paper" is not the same fact as "somebody checked".
  if (request.identity_confirmed === true || request.identity_confirmed === 1) {
    return { basis: 'staff_confirmed', key: String(request.requestor_email || request.requestor_name || '').trim().toLowerCase() };
  }
  return null;
}

// Resolve (and optionally create) the profile for a request. Never fuzzy.
async function resolveProfile(request, opts) {
  opts = opts || {};
  var a = anchorFor(request);
  if (!a || !a.key) return { profile: null, basis: null, reason: 'no affirmative identity anchor — anonymous for ledger purposes' };
  var row = null;
  if (a.basis === 'portal_account') row = await db.get('SELECT * FROM requestor_profiles WHERE portal_account_id = ?', [a.key]);
  else row = await db.get('SELECT * FROM requestor_profiles WHERE lower(primary_email) = lower(?)', [a.key]);
  if (row) return { profile: row, basis: a.basis, reason: 'matched on ' + a.basis };
  if (!opts.create) return { profile: null, basis: a.basis, reason: 'no profile yet for this ' + a.basis };
  var id = uid('rp');
  await db.run('INSERT INTO requestor_profiles (id, display_name, primary_email, portal_account_id, identity_basis, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, request.requestor_name || null,
     a.basis === 'portal_account' ? (request.requestor_email || null) : a.key,
     a.basis === 'portal_account' ? a.key : null,
     a.basis, nowStr(), nowStr()]);
  row = await db.get('SELECT * FROM requestor_profiles WHERE id = ?', [id]);
  return { profile: row, basis: a.basis, reason: 'created on first ' + a.basis };
}

// Record how a request was anchored — including that it was NOT. "We looked and this one is anonymous" is
// the reason no adverse trigger fired, and it belongs in the record rather than being inferred later from
// an absence.
async function linkRequest(requestId, opts) {
  opts = opts || {};
  var request = await db.get('SELECT id, requestor_name, requestor_email, email_verification_method, submission_channel, identity_confirmed FROM requests WHERE id = ?', [requestId]);
  if (!request) return null;
  if (opts.identityConfirmed) request.identity_confirmed = true;
  var r = await resolveProfile(request, { create: true });
  await db.run('INSERT INTO requestor_request_links (request_id, profile_id, identity_basis, reason, linked_at) VALUES (?,?,?,?,?) ' +
    'ON CONFLICT (request_id) DO UPDATE SET profile_id = EXCLUDED.profile_id, identity_basis = EXCLUDED.identity_basis, reason = EXCLUDED.reason, linked_at = EXCLUDED.linked_at',
    [requestId, r.profile ? r.profile.id : null, r.basis, r.reason, nowStr()]);
  return { profileId: r.profile ? r.profile.id : null, basis: r.basis, reason: r.reason };
}

async function profileForRequest(requestId) {
  var l = await db.get('SELECT profile_id FROM requestor_request_links WHERE request_id = ?', [requestId]);
  if (l && l.profile_id) return l.profile_id;
  // Not linked yet (an older request, or intake has not run): resolve WITHOUT creating, so a read never
  // mints a profile as a side effect.
  var request = await db.get('SELECT id, requestor_name, requestor_email, email_verification_method, identity_confirmed FROM requests WHERE id = ?', [requestId]);
  var r = await resolveProfile(request, { create: false });
  return r.profile ? r.profile.id : null;
}

// ---------------------------------------------------------------------------------------------------
// CLASS A — the balance, evented
// ---------------------------------------------------------------------------------------------------

// paymentStatus event type -> ledger entry. Only the types that MOVE money are recorded; `dunning`,
// `estimate_accepted` and the like are request-level workflow, not A/R.
var EVENT_MAP = {
  estimate_issued: 'invoiced',
  reconciliation: 'invoiced',      // the actual supersedes the estimate — see resolveInvoiced below
  payment: 'paid',
  credit: 'credited',
  closed: 'closed_nonpayment'
};

// Fed from paymentStatus.recordEvent — the single chokepoint every money event already passes through.
// Idempotent on `source` (the payment-event id), so a retried write cannot double an A/R balance.
async function onMoneyEvent(requestId, evt, paymentEventId) {
  try {
    var type = EVENT_MAP[(evt && evt.type) || ''];
    if (!type) return null;
    var profileId = await profileForRequest(requestId);
    if (!profileId) return null;   // anonymous — nothing accrues, and nothing adverse can
    var amount = (evt.amount != null) ? money(evt.amount) : null;
    if (type !== 'closed_nonpayment' && (amount == null || amount === 0)) return null;
    if (paymentEventId) {
      var dupe = await db.get('SELECT id FROM requestor_ledger_events WHERE source = ?', [paymentEventId]);
      if (dupe) return null;
    }
    // A reconciliation REPLACES this request's invoiced figure rather than adding to it: the actual cost
    // supersedes the estimate, and summing both would bill the requestor twice for one request.
    if (type === 'invoiced' && evt.type === 'reconciliation') {
      await db.run("DELETE FROM requestor_ledger_events WHERE profile_id = ? AND request_id = ? AND type = 'invoiced'", [profileId, requestId]);
    }
    await db.run('INSERT INTO requestor_ledger_events (id, profile_id, request_id, type, amount, reason, source, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [uid('rle'), profileId, requestId, type, amount, evt.reason || null, paymentEventId || null, nowStr()]);
    return { profileId: profileId, type: type, amount: amount };
  } catch (e) { console.error('[requestorLedger onMoneyEvent]', e && e.message); return null; }
}

// A waiver granted anywhere on a request removes what was invoiced for it — the city is not owed it.
async function onWaiverGranted(requestId, reason) {
  try {
    var profileId = await profileForRequest(requestId);
    if (!profileId) return null;
    await db.run("INSERT INTO requestor_ledger_events (id, profile_id, request_id, type, amount, reason, created_at) " +
      "SELECT ?, ?, ?, 'waived', COALESCE(SUM(amount),0), ?, ? FROM requestor_ledger_events WHERE profile_id = ? AND request_id = ? AND type = 'invoiced'",
      [uid('rle'), profileId, requestId, reason || 'fee waiver granted', nowStr(), profileId, requestId]);
    return { profileId: profileId };
  } catch (e) { console.error('[requestorLedger onWaiverGranted]', e && e.message); return null; }
}

// The A/R roll-up, plus the per-request breakdown the design asks for. Pure read over the event log.
async function balance(profileId) {
  var zero = { profileId: profileId || null, invoiced: 0, paid: 0, credited: 0, waived: 0, writtenOff: 0, outstanding: 0, byRequest: [] };
  if (!profileId) return zero;
  var rows = await db.all('SELECT request_id, type, COALESCE(SUM(amount),0) AS amt, MIN(created_at) AS first_at FROM requestor_ledger_events WHERE profile_id = ? GROUP BY request_id, type', [profileId]);
  var out = Object.assign({}, zero, { byRequest: [] });
  var per = {};
  rows.forEach(function (r) {
    var a = money(r.amt);
    var k = { invoiced: 'invoiced', paid: 'paid', credited: 'credited', waived: 'waived', written_off: 'writtenOff' }[r.type];
    if (k) out[k] = money(out[k] + a);
    var p = per[r.request_id] = per[r.request_id] || { requestId: r.request_id, invoiced: 0, paid: 0, credited: 0, waived: 0, firstAt: r.first_at };
    if (k && p[k === 'writtenOff' ? 'waived' : k] !== undefined) p[k === 'writtenOff' ? 'waived' : k] = money(p[k === 'writtenOff' ? 'waived' : k] + a);
    if (r.first_at && (!p.firstAt || r.first_at < p.firstAt)) p.firstAt = r.first_at;
  });
  out.outstanding = money(out.invoiced - out.paid - out.credited - out.waived - out.writtenOff);
  if (out.outstanding < 0) out.outstanding = 0;   // a credit balance is not a debt
  out.byRequest = Object.keys(per).map(function (k) {
    var p = per[k];
    p.outstanding = money(p.invoiced - p.paid - p.credited - p.waived);
    if (p.outstanding < 0) p.outstanding = 0;
    return p;
  }).filter(function (p) { return p.outstanding > 0; }).sort(function (a, b) { return (a.firstAt || '') < (b.firstAt || '') ? -1 : 1; });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Classes B/C/D — stubs with manual values (every knob and notice exists; only the counting is deferred)
// ---------------------------------------------------------------------------------------------------
async function setAllowance(profileId, name, patch, actor) {
  patch = patch || {};
  await db.run('INSERT INTO requestor_allowances (id, profile_id, name, unit, window_spec, allowance, consumed, period_start, source, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ' +
    'ON CONFLICT (profile_id, name) DO UPDATE SET unit = EXCLUDED.unit, window_spec = EXCLUDED.window_spec, allowance = EXCLUDED.allowance, consumed = EXCLUDED.consumed, period_start = EXCLUDED.period_start, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at',
    [uid('ral'), profileId, name, patch.unit || null, patch.window || null,
     patch.allowance != null ? Number(patch.allowance) : null, patch.consumed != null ? Number(patch.consumed) : 0,
     patch.periodStart || null, 'manual', actor || 'staff', nowStr()]);
  return await db.get('SELECT * FROM requestor_allowances WHERE profile_id = ? AND name = ?', [profileId, name]);
}
async function setCounter(profileId, name, patch, actor) {
  patch = patch || {};
  await db.run('INSERT INTO requestor_counters (id, profile_id, name, window_spec, count, period_start, source, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ' +
    'ON CONFLICT (profile_id, name) DO UPDATE SET window_spec = EXCLUDED.window_spec, count = EXCLUDED.count, period_start = EXCLUDED.period_start, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at',
    [uid('rct'), profileId, name, patch.window || null, patch.count != null ? Number(patch.count) : 0, patch.periodStart || null, 'manual', actor || 'staff', nowStr()]);
  return await db.get('SELECT * FROM requestor_counters WHERE profile_id = ? AND name = ?', [profileId, name]);
}
// A flag is RECORDED, never decided here: the OH vexatious list is the court's and the UT designation is
// the director's order. `source` names whose decision it was, and the system only applies it until it
// expires or its clearing event arrives.
async function setFlag(profileId, flag, patch, actor) {
  patch = patch || {};
  var id = uid('rfl');
  await db.run('INSERT INTO requestor_flags (id, profile_id, flag, source, citation, set_at, expires_at, clearing_event, note, set_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, profileId, flag, patch.source || 'manual', patch.citation || null, nowStr(), patch.expiresAt || null, patch.clearingEvent || null, patch.note || null, actor || 'staff']);
  return await db.get('SELECT * FROM requestor_flags WHERE id = ?', [id]);
}
async function clearFlag(profileId, flag, event) {
  await db.run("UPDATE requestor_flags SET cleared_at = ?, clearing_event = COALESCE(clearing_event, ?) WHERE profile_id = ? AND flag = ? AND cleared_at IS NULL", [nowStr(), event || 'manual', profileId, flag]);
}
async function activeFlags(profileId) {
  if (!profileId) return [];
  return await db.all("SELECT * FROM requestor_flags WHERE profile_id = ? AND cleared_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY set_at DESC", [profileId, nowStr()]);
}

// ---------------------------------------------------------------------------------------------------
// TRIGGER EVALUATION — pure over what the ledger holds. Never mutates a request.
// ---------------------------------------------------------------------------------------------------

// The shape every gate returns. `triggers` are things to DO; `advisories` are things a person must confirm.
function emptyResult(gate, cfg, link) {
  return {
    gate: gate, jurisdictionId: cfg.jurisdictionId, code: cfg.code,
    profileId: link ? link.profileId : null, identityBasis: link ? link.basis : null,
    anonymous: !(link && link.profileId),
    triggers: [], advisories: [], balance: null
  };
}

async function linkInfo(requestId) {
  var l = await db.get('SELECT profile_id, identity_basis, reason FROM requestor_request_links WHERE request_id = ?', [requestId]);
  if (l) return { profileId: l.profile_id, basis: l.identity_basis, reason: l.reason };
  var pid = await profileForRequest(requestId);
  return { profileId: pid, basis: pid ? 'resolved' : null, reason: pid ? 'resolved at read time' : 'no affirmative identity anchor' };
}

// The prior-balance evaluation shared by the intake and estimate gates.
async function priorBalance(cfg, link, opts) {
  opts = opts || {};
  var pb = cfg.prior_balance;
  var out = { triggers: [], advisories: [], balance: null };
  if (!pb.applies || !pb.enabled) return out;
  // THE IDENTITY CONSTRAINT, enforced in one place. No anchor, no adverse trigger — ever.
  if (!link.profileId) return out;
  var bal = await balance(link.profileId);
  out.balance = bal;
  var over = bal.outstanding > (pb.threshold_usd || 0);
  var estimateOver = pb.estimate_over_usd != null && opts.estimateTotal != null && Number(opts.estimateTotal) > pb.estimate_over_usd;
  if (!over && !estimateOver) return out;
  // A rule scoped to a class (Wisconsin's prisoner prepayment) fires only when that flag is on the profile.
  if (pb.requires_flag) {
    var flags = await activeFlags(link.profileId);
    if (!flags.some(function (f) { return f.flag === pb.requires_flag; })) return out;
  }
  var item = {
    rule_id: pb.rule_id, citation: pb.citation, action: pb.action,
    outstanding: bal.outstanding, threshold_usd: pb.threshold_usd,
    triggeredBy: over ? 'unpaid prior balance' : 'estimate over ' + pb.estimate_over_usd,
    identityBasis: link.basis,
    summary: pb.summary,
    requests: bal.byRequest.map(function (r) { return { requestId: r.requestId, outstanding: r.outstanding }; })
  };
  if (pb.max_pct != null) item.max_pct = pb.max_pct;
  if (pb.clearing_event) item.clearing_event = pb.clearing_event;
  // Monetary triggers issue automatically through the normal parent-processor communications.
  // Denial-shaped ones surface as an advisory a person confirms — similarity and "reasonable belief" are
  // judgment calls, and auto-denial is automation beyond the compliant subset.
  (pb.automatic ? out.triggers : out.advisories).push(item);
  return out;
}

// GATE 1 — intake eligibility (Master g2). Vexatious flag, the MA unpaid-balance denial advisory.
async function evaluateIntake(jid, requestId) {
  var cfg = await config(jid);
  var link = await linkInfo(requestId);
  var out = emptyResult('intake', cfg, link);
  if (!link.profileId) { out.reason = link.reason; return out; }
  var pb = await priorBalance(cfg, link, {});
  out.triggers = out.triggers.concat(pb.triggers.filter(function (t) { return t.action === 'advisory_deny'; }));
  out.advisories = out.advisories.concat(pb.advisories);
  out.balance = pb.balance;
  (await activeFlags(link.profileId)).forEach(function (f) {
    // A flag is an externally-established status. The system applies it; it never decided it, and the
    // advisory says whose decision it was so a reviewer can go and check.
    out.advisories.push({ flag: f.flag, source: f.source, citation: f.citation, expires_at: f.expires_at,
      note: f.note, summary: 'Status recorded from ' + (f.source || 'an external decision') + ' — confirm before acting on it.' });
  });
  return out;
}

// GATE 2 — estimate / deposit decision (Estimate-Fee ddep / fcom). The money triggers live here.
async function evaluateEstimate(jid, requestId, opts) {
  opts = opts || {};
  var cfg = await config(jid);
  var link = await linkInfo(requestId);
  var out = emptyResult('estimate', cfg, link);
  if (!link.profileId) { out.reason = link.reason; return out; }
  var pb = await priorBalance(cfg, link, { estimateTotal: opts.estimateTotal });
  out.triggers = pb.triggers.filter(function (t) { return t.action !== 'advisory_deny'; });
  out.advisories = pb.advisories;
  out.balance = pb.balance;
  return out;
}

// GATE 3 — delivery / ship (Master p6). OH monthly delivery caps; decrements on actual delivery. Class C/D
// is a manual stub, so this reports what a human entered rather than counting for itself.
async function evaluateDelivery(jid, requestId) {
  var cfg = await config(jid);
  var link = await linkInfo(requestId);
  var out = emptyResult('delivery', cfg, link);
  if (!link.profileId) { out.reason = link.reason; return out; }
  var counters = await db.all('SELECT * FROM requestor_counters WHERE profile_id = ?', [link.profileId]);
  counters.forEach(function (c) {
    if (c.count == null) return;
    out.advisories.push({ counter: c.name, window: c.window_spec, count: Number(c.count), source: c.source,
      summary: 'Counter entered by staff (class C is a manual stub in v1) — check it before relying on it.' });
  });
  return out;
}

module.exports = {
  DOMAIN: DOMAIN, GATES: GATES, PRIOR_BALANCE_RULES: PRIOR_BALANCE_RULES,
  VERIFIED_EMAIL_METHODS: VERIFIED_EMAIL_METHODS,
  normalizeConfig: normalizeConfig, config: config, writeConfig: writeConfig,
  anchorFor: anchorFor, resolveProfile: resolveProfile, linkRequest: linkRequest, profileForRequest: profileForRequest,
  onMoneyEvent: onMoneyEvent, onWaiverGranted: onWaiverGranted, balance: balance,
  setAllowance: setAllowance, setCounter: setCounter, setFlag: setFlag, clearFlag: clearFlag, activeFlags: activeFlags,
  evaluateIntake: evaluateIntake, evaluateEstimate: evaluateEstimate, evaluateDelivery: evaluateDelivery
};
