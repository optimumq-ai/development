'use strict';
// WHAT THE LAW LETS YOU CHARGE — the screen behind the hub's `fee_law` row (WORKING_hub_linked_screens §2b,
// canvas approved by Kevin 2026-08-25).
//
// Two windows, four buckets, one versioned outcome:
//   STATE MANDATE   — the 22-ish items whose `basis` is fixed / ceiling / floor. Loaded from the state's
//                     verified template (the rules library on disk); the law's figure is read-only.
//                     Ceiling rows carry a "this city charges" value that DEFAULTS TO THE CEILING (Kevin,
//                     2026-08-25: less setup, priceable from day one) and may only be lowered.
//   DEFERRAL        — items whose basis is soft-standard / silent: the city decides (by hand, or proposed
//                     from a fee policy document with a page reference), "none" being a valid decision.
//   Each window splits COMPUTATION (figures the engine multiplies) from ESTIMATES / DEPOSITS / PAYMENT.
//   APPROVE         — composes every figure into ONE fee_profiles row (context FR, version n, active), the
//                     schedule estimates price from. Earlier versions are superseded, never edited.
//
// Source of truth for the law: `docs/rules_research/workflow/templates/<ST>.json` → fee_schedule.items —
// 35 keys, identical across all 32 templates (checked 2026-08-25). The import keeps the sentence
// evidence in jurisdiction_rules.fee; this service reads the items from the file by the profile's code.
// City decisions live in jurisdiction_rules domain `fee_schedule_decisions`.
const { get, all, run } = require('../db');
const STI = require('./stateTemplateImport');
const JR = require('./jurisdictionRules');
const feeBounds = require('./feeBounds');
const { v4: uuidv4 } = require('uuid');

const DECISIONS_DOMAIN = 'fee_schedule_decisions';

// The catalog: every template item key → plain name, bucket, engine path(s), and how to read its value.
//   bucket: 'computation' | 'estimate_payment'
//   path:   fee_profiles dotted path the city value writes to (null = no engine home / not fee_profiles)
//   parse:  how to turn the template's prose `value` into figures (see PARSERS)
//   unit:   what the city types
// 2026-09-08 (Kevin): the two cross-request rules are ENFORCED through the approved schedule — the Requestor
// Ledger (services/requestorLedger.js) reads `requestRules.personnelTimeAllowance` and
// `requestRules.sameDayAggregation` from it, so they carry engine paths like every other row and no gap flag.
const CATALOG = [
  { key: 'dup.bw.rate',                 label: 'Copy rate — B&W page',                  bucket: 'computation',      path: 'duplication.bw.rate',            parse: 'rate',     unit: '$ per page' },
  { key: 'dup.color.rate',              label: 'Copy rate — color page',                bucket: 'computation',      path: 'duplication.color.rate',         parse: 'rate',     unit: '$ per page' },
  { key: 'dup.oversized.rate',          label: 'Copy rate — oversized page',            bucket: 'computation',      path: 'duplication.oversized.rate',     parse: 'rate',     unit: '$ per page' },
  { key: 'dup.specialty.rate',          label: 'Specialty reproduction (photos, maps)', bucket: 'computation',      path: 'duplication.specialty.rate',     parse: 'rate',     unit: '$ per item', actualOk: true },
  { key: 'dup.tiers',                   label: 'Graduated page bands',                  bucket: 'computation',      path: null,                             parse: 'text',     unit: 'bands', noneOk: true },
  { key: 'rules.freePages',             label: 'Free page allowance per request',       bucket: 'computation',      path: 'requestRules.freePageAllowance', parse: 'int',      unit: 'pages', noneOk: true },
  { key: 'labor.search.rate',           label: 'Labor — search / retrieval',            bucket: 'computation',      path: 'labor.search.rate',              parse: 'rate',     unit: '$ per hour' },
  { key: 'labor.review.rate',           label: 'Labor — review / redaction',            bucket: 'computation',      path: 'labor.review.rate',              parse: 'rate',     unit: '$ per hour' },
  { key: 'labor.programming.rate',      label: 'Labor — programming',                   bucket: 'computation',      path: 'labor.programming.rate',         parse: 'rate',     unit: '$ per hour' },
  { key: 'labor.billableWhen',          label: 'When labor is chargeable',              bucket: 'computation',      path: 'labor.billableWhen',             parse: 'billable', unit: 'rule' },
  { key: 'labor.overheadPct',           label: 'Overhead surcharge on labor',           bucket: 'computation',      path: 'labor.overheadPct',              parse: 'pct',      unit: '%' },
  { key: 'labor.increment',             label: 'Labor time increment + rounding',       bucket: 'computation',      path: 'labor.increment',                parse: 'increment',unit: 'minutes', noneOk: true },
  { key: 'rules.freeLaborHours',        label: 'Free labor hours per request',          bucket: 'computation',      path: 'requestRules.freeLaborHours',    parse: 'num',      unit: 'hours', noneOk: true },
  { key: 'labor.periodicFreeHours',     label: 'Free personnel time per requestor',     bucket: 'computation',      path: 'requestRules.personnelTimeAllowance', parse: 'hours2', unit: 'hours per year', noneOk: true },
  { key: 'rules.estimateNotifyThreshold', label: 'Itemized estimate required above',   bucket: 'estimate_payment', path: 'requestRules.estimateNotifyThreshold', parse: 'usd', unit: '$' },
  { key: 'estimate.requesterResponseDays', label: 'Requestor must respond to estimate within', bucket: 'estimate_payment', path: 'estimatePolicy.requesterResponseDays', parse: 'int', unit: 'business days' },
  { key: 'estimate.revisionNotifyPercent', label: 'Revised estimate required over',     bucket: 'estimate_payment', path: 'estimatePolicy.revisionNotifyPercent', parse: 'pct', unit: '% overrun' },
  { key: 'estimate.validityDays',       label: 'Estimate valid for',                    bucket: 'estimate_payment', path: 'estimatePolicy.estimateValidityDays', parse: 'int', unit: 'days', noneOk: true },
  { key: 'rules.deposit.threshold',     label: 'Deposit may be required above',         bucket: 'estimate_payment', path: 'requestRules.deposit.threshold', parse: 'usd',      unit: '$' },
  { key: 'rules.deposit.percent',       label: 'Deposit capped at',                     bucket: 'estimate_payment', path: 'requestRules.deposit.percent',   parse: 'pct',      unit: '% of estimate', noneOk: true },
  { key: 'payment.productionGate',      label: 'Production conditioned on payment',     bucket: 'estimate_payment', path: null,                             parse: 'gate',     unit: 'rule' },
  { key: 'payment.nonpayment',          label: 'Nonpayment — request withdrawn after',  bucket: 'estimate_payment', path: null,                             parse: 'days',     unit: 'days' },
  { key: 'payment.depositClock',        label: 'Clock while a deposit is unpaid',       bucket: 'estimate_payment', path: null,                             parse: 'depositclock',     unit: 'rule' },
  { key: 'payment.reissue',             label: 'Overrun re-issue rules',                bucket: 'estimate_payment', path: null,                             parse: 'reissue',     unit: 'rule' },
  { key: 'rules.maxFee',                label: 'Cap on one request\'s total (optional city policy)', bucket: 'computation', path: 'requestRules.maxFee',    parse: 'maxfee',      unit: '$', noneOk: true },
  { key: 'rules.deMinimis',             label: 'De-minimis — no charge below',          bucket: 'computation',      path: 'requestRules.deMinimis',         parse: 'usd',      unit: '$', noneOk: true },
  { key: 'rules.minFee',                label: 'Minimum fee',                           bucket: 'computation',      path: 'requestRules.minFee',            parse: 'usd',      unit: '$', noneOk: true },
  { key: 'media',                       label: 'Electronic media (CD / DVD / USB)',     bucket: 'computation',      path: 'media',                          parse: 'media',    unit: '$ per item' },
  { key: 'delivery',                    label: 'Delivery — mail / handling',            bucket: 'computation',      path: 'delivery',                       parse: 'delivery', unit: '$ per request', actualOk: true, actualLabel: 'Actual postage' },
  { key: 'certification',               label: 'Certified copy charge',                 bucket: 'computation',      path: 'certification.rate',             parse: 'usd',      unit: '$ per document', noneOk: true },
  { key: 'av',                          label: 'Audio / video (body-worn camera)',      bucket: 'computation',      path: 'av',                             parse: 'av',       unit: '$' },
  { key: 'commercial',                  label: 'Commercial-purpose surcharge',          bucket: 'computation',      path: 'purposeOverrides.commercial.requestRules.surchargePct', parse: 'pct', unit: '%', noneOk: true },
  // 2026-08-27 (Kevin, "Fee rules"): the conflated 'waiver' row is gone — the two § 552.267-style grounds
  // render as their own 'waiver' bucket rows, built by waiverRows() below from the same template item.
  { key: 'waiver.forfeiture',           label: 'Late response forfeits the fee',        bucket: 'estimate_payment', path: null,                             parse: 'bool',     unit: 'yes / no', noneOk: true },
  { key: 'repeat',                      label: 'Repeat / aggregated requests',          bucket: 'computation',      path: 'requestRules.sameDayAggregation', parse: 'text', unit: 'rule' },
];
const BY_KEY = {}; CATALOG.forEach(function (c) { BY_KEY[c.key] = c; });
// Catalog parse kinds whose city value is ONE number (the unit is display only).
const NUMERIC_PARSE = ['rate', 'usd', 'pct', 'int', 'num', 'days', 'increment', 'hours2', 'maxfee'];

// ---- value parsing ---------------------------------------------------------------------------------
// The template's `value` is verified prose. "0.10 | 0.125" on a municipal ceiling row is AG rate |
// municipal ceiling (AG + 25%); the ceiling for a city is the LARGER figure. A single number is itself.
function nums(s) { return (String(s == null ? '' : s).match(/\d+(?:\.\d+)?/g) || []).map(Number); }
function isActual(s) { return /actual|reasonable|direct cost/i.test(String(s || '')); }
function firstNums(s) {
  // numbers in the first "a | b" segment only (not the prose that follows)
  var seg = String(s == null ? '' : s).split('|').slice(0, 2);
  return seg.map(function (x) { var n = nums(x); return n.length ? n[0] : null; });
}
// A template value is a '|'-separated list of research findings, each often prefixed 'some_key:'. For the
// screen and the citation popup they read as sentences: 'same_day_aggregation: all requests…' →
// 'Same day aggregation: all requests…' (Kevin 2026-09-08 — no underscores or dashes, capital first letter).
function humanize(raw) {
  if (raw == null || raw === '') return [];
  return String(raw).split(/\s*\|\s*/).map(function (seg) {
    var c = seg.indexOf(':');
    var t = (c > 0 && c <= 45 && /_/.test(seg.slice(0, c))) ? seg.slice(0, c).replace(/_/g, ' ').trim() + ':' + seg.slice(c + 1) : seg.trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }).filter(Boolean);
}
function parseValue(item, raw) {
  var v = raw == null ? null : String(raw);
  var out = { display: v || '—', num: null, ag: null, actual: isActual(v), parsed: {} };
  if (v == null || v === '') return out;
  switch (item.parse) {
    case 'rate': case 'usd': case 'pct': case 'int': case 'num': {
      var f = firstNums(v);
      if (f[0] != null && f[1] != null && item.parse === 'rate') { out.num = Math.max(f[0], f[1]); out.ag = Math.min(f[0], f[1]); out.display = '$' + fmt(out.num) + (item.unit.indexOf('hour') !== -1 ? ' / hr' : item.unit.indexOf('page') !== -1 ? ' / page' : ''); }
      else if (f[0] != null) { out.num = f[0]; out.display = (item.parse === 'pct' ? fmt(f[0]) + '%' : item.parse === 'rate' || item.parse === 'usd' ? '$' + fmt(f[0]) : fmt(f[0]) + ' ' + item.unit); }
      if (item.parse === 'usd' && f[0] != null && f[1] != null) out.display = '$' + fmt(f[0]) + ' ($' + fmt(f[1]) + ' small bodies)';
      break;
    }
    case 'days': { var d = v.match(/withdrawn_after_days:\s*(\d+)/i) || v.match(/(\d+)\s*(?:calendar|business)?\s*days?/i); out.num = d ? Number(d[1]) : null; out.display = d ? d[1] + ' days' : v.slice(0, 80); break; }
    case 'hours2': { var h = nums(v); out.display = h.length >= 2 ? h[0] + ' hrs / yr · ' + h[1] + ' hrs / mo' : (h.length ? h[0] + ' hrs' : v.slice(0, 80)); out.num = h.length ? h[0] : null; if (h.length) out.parsed = { hoursPerYear: h[0], hoursPerMonth: h.length >= 2 ? h[1] : null }; break; }
    case 'billable': {
      var m = v.match(/only_over_pages:\s*(\d+)/i);
      if (m) { out.num = Number(m[1]); out.parsed = { trigger: 'pages', threshold: Number(m[1]) }; out.display = 'Only over ' + m[1] + ' pages'; }
      else if (/never|not chargeable|no charge/i.test(v)) { out.parsed = { never: true }; out.display = 'Never'; }
      else out.display = v.slice(0, 80);
      break;
    }
    case 'media': {
      var cd = v.match(/CD[^|]*?(\d+\.\d+)(?:\s*\((\d+\.\d+)\))?/i), dvd = v.match(/DVD[^|]*?(\d+\.\d+)(?:\s*\((\d+\.\d+)\))?/i), usb = v.match(/USB[^|]*?(\d+\.\d+)(?:\s*\((\d+\.\d+)\))?/i);
      var pick = function (mm) { return mm ? (mm[2] ? Number(mm[2]) : Number(mm[1])) : null; };
      out.parsed = { cd: pick(cd), dvd: pick(dvd), usb: usb ? pick(usb) : (/USB[^|]*actual/i.test(v) ? 'actual' : null) };
      out.display = [out.parsed.cd != null ? 'CD $' + fmt(out.parsed.cd) : null, out.parsed.dvd != null ? 'DVD $' + fmt(out.parsed.dvd) : null, out.parsed.usb != null ? 'USB ' + (out.parsed.usb === 'actual' ? 'actual' : '$' + fmt(out.parsed.usb)) : null].filter(Boolean).join(' · ') || v.slice(0, 80);
      break;
    }
    case 'av': {
      var pr = v.match(/(\d+\.\d+)\s*per\s*(?:responsive\s*)?recording/i), pm = v.match(/(\d+\.\d+)\s*per\s*(?:full\s*)?minute/i);
      out.parsed = { perRecording: pr ? Number(pr[1]) : null, perMinute: pm ? Number(pm[1]) : null, freeMinutes: /free minutes:\s*none/i.test(v) ? 0 : null };
      out.display = pr || pm ? [pr ? '$' + fmt(pr[1]) + ' / recording' : null, pm ? '$' + fmt(pm[1]) + ' / min' : null].filter(Boolean).join(' + ') : v.slice(0, 80);
      break;
    }
    case 'delivery': { out.parsed = { mail: /postage|shipping/i.test(v) && isActual(v) ? 'actual' : null }; out.display = out.parsed.mail ? 'Actual postage' : v.slice(0, 80); break; }
    case 'increment': { var im = v.match(/(\d+)\s*min/i); out.num = im ? Number(im[1]) : null; out.display = im ? im[1] + ' min' : v.slice(0, 80); break; }
    case 'gate': { out.display = /copies_available_on_payment|on_payment/i.test(v) ? 'Copies on payment' : /prepay/i.test(v) ? 'Prepayment' : /collect_at_end|after/i.test(v) ? 'Collect at delivery' : v.split('|')[0].replace(/_/g, ' ').trim().slice(0, 60); break; }
    case 'depositclock': { out.display = /deemed received/i.test(v) ? 'Deemed received on payment' : /toll|pause|suspend/i.test(v) ? 'Clock pauses until paid' : /continue|runs/i.test(v) ? 'Clock keeps running' : v.split('|')[0].replace(/^clock_effect:\s*/i, '').trim().slice(0, 60); break; }
    case 'reissue': { var rp = v.match(/(\d+)\s*%/); out.num = rp ? Number(rp[1]) : null; out.display = /revised_estimate_required:\s*yes/i.test(v) ? 'Revised estimate' + (rp ? ' at ≥ ' + rp[1] + '% overrun' : ' required') : /no/i.test(v.split('|')[0]) ? 'No revised estimate required' : v.split('|')[0].trim().slice(0, 60); break; }
    case 'waiver': { var g = v.match(/grounds:\s*([a-z_ ,]+)/i); var grounds = g ? g[1].split(/[, ]+/).filter(Boolean).map(function (x) { return x.replace(/_/g, ' '); }).join(', ') : null; out.display = (grounds ? grounds.charAt(0).toUpperCase() + grounds.slice(1) : 'See statute') + (/MANDATORY/i.test(v) ? ' (mandatory once found)' : /discretion/i.test(v) ? ' (discretionary)' : ''); break; }
    case 'maxfee': { var mf = firstNums(v); if (mf[0] != null && !/not exceed the actual|actual cost/i.test(v.split('|')[0])) { out.num = mf[0]; out.display = '$' + fmt(mf[0]); } else out.display = /actual cost/i.test(v) ? 'Actual cost, never excessive' : v.slice(0, 80); break; }
    case 'bool': { out.parsed = { yes: /\byes\b|forfeit/i.test(v) && !/\bno\b/i.test(v) }; out.display = out.parsed.yes ? 'Yes' : 'No'; break; }
    default: { out.segments = humanize(v); out.display = out.segments[0] || v; break; }
  }
  return out;
}
function fmt(n) { n = Number(n); return Number.isInteger(n) ? String(n) : (Math.round(n * 1000) / 1000).toString(); }

function bindingOf(item, t) {
  var b = t.basis || null;
  if (b === 'ceiling' || b === 'fixed' || b === 'floor') return b;
  return 'deferral';
}
function lawSays(t) {
  var v = String(t.value || '');
  if (isActual(v)) return /reasonable/i.test(v) ? 'Reasonable' : 'Actual cost';
  return 'Silent';
}

// ---- fee waivers (Kevin 2026-08-27: the fee-law screen absorbs them; the waiver_policy hub row is
// retired). Two surfaces, both on the EXISTING tabs:
//   · State mandate gains a 'waiver' bucket: one row per ground the state's waiver item actually names
//     (public interest / cost of collection), each with its own must/may verb. A state whose item names
//     neither parses to the single generic row; a state with no waiver item shows none.
//   · City decisions gains two choices — who decides a waiver request (written through to the
//     approvalModules fee_waiver module, the store the engine already reads) and the waiver-denial
//     explanation (the seeded decision_reasons sentences, acknowledged as standard wording).
//     They live in this screen's own decisions domain (dec.waiver) with who/when, and gate ATTEST,
//     never Approve — routing and wording are not schedule figures.
const WAIVER_GROUNDS = [
  { key: 'waiver.public_interest', label: 'Waiver — public interest', match: /public_interest/i,
    binding: 'fixed', display: 'Must waive or reduce when providing the copy primarily benefits the general public',
    cityText: 'as law — decided per request' },
  { key: 'waiver.cost_of_collection', label: 'Waiver — cost of collection', match: /collection_cost|cost[^|]{0,30}exceed/i,
    binding: 'discretionary', display: 'May waive when collecting the charge would cost more than the charge',
    cityText: null }   // filled with the de-minimis cross-reference at read time
];
function waiverRows(tplItems, dec) {
  var t = tplItems['waiver'];
  if (!t) return [];
  var v = String(t.value || '');
  var dm = dec && dec.items && dec.items['rules.deMinimis'];
  var dmText = dm && dm.value != null && dm.value !== 'none'
    ? '$' + fmt(dm.value) + ' · set using De-minimis in City Decisions'
    : 'Set using De-minimis in City Decisions';
  var out = [];
  WAIVER_GROUNDS.forEach(function (g) {
    if (!g.match.test(v)) return;
    out.push({
      key: g.key, label: g.label, bucket: 'waiver', binding: g.binding, unit: 'rule', path: null, gap: null,
      law: { display: g.display, num: null, ag: null, actual: false, parsed: {}, authority: t.authority || '', rules: t.rule_ids || [], says: null, segments: humanize(t.value), notes: t.notes || null },
      city: { value: g.key === 'waiver.cost_of_collection' ? dmText : g.cityText, source: 'law' },
      editable: false
    });
  });
  if (!out.length) {
    var law = parseValue({ parse: 'waiver', unit: 'rule' }, t.value);
    out.push({ key: 'waiver', label: 'Fee waiver grounds', bucket: 'waiver', binding: 'fixed', unit: 'rule', path: null, gap: null,
      law: { display: law.display, num: null, ag: null, actual: false, parsed: {}, authority: t.authority || '', rules: t.rule_ids || [], says: null },
      city: { value: 'as law', source: 'law' }, editable: false });
  }
  return out;
}

// The two city choices, with the engine's CURRENT waiver routing as the suggested answer.
async function waiverState(jid, dec) {
  var AM = require('./approvalModules');
  var cfg = await AM.config(jid);
  var mod = (cfg.modules && cfg.modules.fee_waiver) || {};
  var w = (dec && dec.waiver) || {};
  var sentences = await all("SELECT id, text FROM decision_reasons WHERE is_active = 1 AND id LIKE 'dr-fw-%' ORDER BY id");
  var choices = [
    { key: 'waiver.decider', label: 'Who decides a waiver request',
      value: w.decider ? w.decider.value : null, by: w.decider ? w.decider.by : null, at: w.decider ? w.decider.at : null,
      current: { enabled: mod.enabled !== false, mode: mod.mode || 'routed_task', role: (mod.routed_task && mod.routed_task.assignee_role) || 'FINANCE' },
      options: [
        { value: 'routed_task', label: 'Routed as its own task — ' + ((mod.routed_task && mod.routed_task.assignee_role) || 'FINANCE') },
        { value: 'intake_review', label: 'Decided inline at Intake Review' }
      ] },
    { key: 'waiver.denial_wording', label: 'The waiver-denial explanation',
      value: w.denial_wording ? w.denial_wording.value : null, by: w.denial_wording ? w.denial_wording.by : null, at: w.denial_wording ? w.denial_wording.at : null }
  ];
  return { choices: choices, decided: choices.filter(function (c) { return c.value != null; }).length,
    sentences: sentences.map(function (s) { return { id: s.id, text: s.text }; }) };
}

// Record the waiver choices: who/when in this screen's decisions domain; the routing choice written
// through to the approvalModules store the engine reads. Gates Attest, never Approve.
async function decideWaiver(jid, body, user) {
  var s = await screen(jid);
  if (!s.jurisdiction) throw Object.assign(new Error('No jurisdiction is locked yet.'), { status: 409 });
  var AM = require('./approvalModules');
  var dec = await decisions(jid);
  dec.waiver = dec.waiver || {};
  var who = user.name || user.email || user.sub;
  var when = nowStr();
  if (body.decider !== undefined) {
    var mode = body.decider;
    if (['intake_review', 'routed_task'].indexOf(mode) < 0) {
      throw Object.assign(new Error('Who decides a waiver takes "intake_review" or "routed_task" — nothing else is a decision.'), { status: 422 });
    }
    var raw = (await JR.read(jid, AM.DOMAIN)) || {};
    var fw = raw.fee_waiver || {};
    fw.mode = mode;
    raw.fee_waiver = fw;
    await AM.write(jid, raw, who);
    dec.waiver.decider = { value: mode, by: who, at: when };
  }
  if (body.denialWording !== undefined) {
    if (body.denialWording === true) dec.waiver.denial_wording = { value: 'standard_wording', by: who, at: when };
    else delete dec.waiver.denial_wording;
  }
  await JR.write(jid, DECISIONS_DOMAIN, dec, who);
  return { waiver: await waiverState(jid, dec), screen: await screen(jid) };
}

// ---- deposit & payment clock (Kevin 2026-08-29, F3: the fee-law screen absorbs the payment policy;
// the 'deposits' hub row is retired). The six settings ARE the paymentClockPolicy store the engine
// already reads (depositAction, feeReissue, the tickler) — until now they sat behind a separate
// jurisdiction-config section, switched off, with safe-manual defaults that contradict what Texas law
// fixes. The screen renders them the clarification way: a MASTER SWITCH (these settings stop clocks and
// withdraw requests, so arming the automation is its own explicit act), then the six answers pre-filled
// from the state template for individual confirmation. Confirming writes the value through to the
// policy store; provenance (citations + rule ids the importer filed) rides along untouched. Nothing
// automated runs until the switch is on AND the payment section attests — the engine's double gate is
// unchanged. The six gate ATTEST of this screen, never Approve. In a state whose template answers none
// of this, the rows render as open choices and leaving the switch off is itself the configured answer.
const CLOCK_FIELDS = [
  { key: 'deposit_clock_effect', kind: 'choice', label: 'What the response clock does while a deposit is unpaid',
    options: [
      { value: 'runs_no_stop', label: 'Keeps running' },
      { value: 'toll_pause_resume', label: 'Pauses, resumes when paid' },
      { value: 'toll_and_restart', label: 'Restarts when the deposit is paid' },
      { value: 'operational_hold', label: 'Operational hold — clock untouched' }
    ] },
  { key: 'deposit_grace_days', kind: 'days', label: 'How long the requestor has to pay a deposit' },
  { key: 'deposit_lapse_action', kind: 'choice', label: 'What happens when that window passes unpaid',
    options: [
      { value: 'flag_only', label: 'Flag for staff — close nothing' },
      { value: 'withdraw', label: 'The request is considered withdrawn' }
    ] },
  { key: 'reissue_required_on_variance', kind: 'bool', label: 'A cost overrun requires a revised estimate to be re-sent' },
  { key: 'reissue_blocks_collection', kind: 'bool', label: 'Until it is re-sent, the overrun cannot be collected' },
  { key: 'reissue_restarts_response_window', kind: 'bool', label: 'Re-sending gives the requestor a fresh response window' }
];

// The state's answers, read from the SAME template items the mandate rows render
// (payment.depositClock, payment.reissue). A value the template does not state parses to no prefill —
// the row is then an open city choice, which is exactly the silent-state design.
function clockPrefills(tplItems) {
  var dc = tplItems['payment.depositClock'] || {};
  var ri = tplItems['payment.reissue'] || {};
  var dv = String(dc.value || ''), rv = String(ri.value || '');
  function src(item) { return { authority: item.authority || '', rules: item.rule_ids || [] }; }
  var out = {};
  var eff = /deemed received|received on the date the deposit/i.test(dv) ? 'toll_and_restart'
    : /paus/i.test(dv) ? 'toll_pause_resume'
    : /keeps running|runs[, ]|no (stop|clock effect)/i.test(dv) ? 'runs_no_stop' : null;
  if (eff) out.deposit_clock_effect = Object.assign({ value: eff }, src(dc));
  var g = dv.match(/grace:\s*(\d+)(\s*business)?/i);
  if (g) out.deposit_grace_days = Object.assign({ value: Number(g[1]), businessDays: !!g[2] }, src(dc));
  var la = /lapse_action:\s*withdraw/i.test(dv) ? 'withdraw' : /lapse_action:\s*flag/i.test(dv) ? 'flag_only' : null;
  if (la) out.deposit_lapse_action = Object.assign({ value: la }, src(dc));
  if (/revised_estimate_required:\s*yes/i.test(rv)) out.reissue_required_on_variance = Object.assign({ value: true }, src(ri));
  else if (/revised_estimate_required:\s*no/i.test(rv)) out.reissue_required_on_variance = Object.assign({ value: false }, src(ri));
  if (/collection cap/i.test(rv)) out.reissue_blocks_collection = Object.assign({ value: true }, src(ri));
  if (/window restarts/i.test(rv)) out.reissue_restarts_response_window = Object.assign({ value: true }, src(ri));
  return out;
}

async function clockState(jid, dec, tplItems) {
  var PCP = require('./paymentClockPolicy');
  var pol = await PCP.read(jid);
  var c = (dec && dec.clock) || {};
  var pre = clockPrefills(tplItems || {});
  var choices = CLOCK_FIELDS.map(function (f) {
    var d = c[f.key];
    return { key: f.key, kind: f.kind, label: f.label, options: f.options || null,
      prefill: pre[f.key] || null,
      value: d ? d.value : null, by: d ? d.by : null, at: d ? d.at : null,
      current: pol[f.key] };
  });
  var sw = c._switch || null;
  return { enabled: pol.enabled === true,
    switchedBy: sw ? sw.by : null, switchedAt: sw ? sw.at : null,
    choices: choices,
    confirmed: choices.filter(function (x) { return x.value != null; }).length };
}

// Record the switch or one confirmation. Both write through to the paymentClockPolicy store; who/when
// live in this screen's decisions domain (dec.clock). Confirming needs the switch on — while it is off
// the settings do not exist as recorded city decisions, and off itself is a valid, attestable posture.
async function decideClock(jid, body, user) {
  var s = await screen(jid);
  if (!s.jurisdiction) throw Object.assign(new Error('No jurisdiction is locked yet.'), { status: 409 });
  var PCP = require('./paymentClockPolicy');
  var dec = await decisions(jid);
  dec.clock = dec.clock || {};
  var who = user.name || user.email || user.sub;
  var when = nowStr();
  var raw = (await JR.read(jid, PCP.DOMAIN)) || {};
  if (body.enabled !== undefined) {
    raw.enabled = body.enabled === true;
    await PCP.write(jid, raw, who);
    dec.clock._switch = { value: body.enabled === true, by: who, at: when };
  }
  if (body.confirm) {
    var f = CLOCK_FIELDS.filter(function (x) { return x.key === (body.confirm && body.confirm.key); })[0];
    if (!f) throw Object.assign(new Error('Not one of the six deposit & payment clock settings.'), { status: 422 });
    if (!(PCP.normalize(raw).enabled === true)) {
      throw Object.assign(new Error('Turn the deposit & payment clock on first — the six settings are confirmed while it is on.'), { status: 409 });
    }
    raw[f.key] = body.confirm.value;
    try { await PCP.write(jid, raw, who); }
    catch (e) { throw Object.assign(new Error(e.message), { status: 422 }); }
    var pol = await PCP.read(jid);
    dec.clock[f.key] = { value: pol[f.key], by: who, at: when };
  }
  await JR.write(jid, DECISIONS_DOMAIN, dec, who);
  var tpl = templateItems(s.jurisdiction.code);
  return { clock: await clockState(jid, dec, tpl.items), screen: await screen(jid) };
}

// ---- reading -------------------------------------------------------------------------------------
async function activeJurisdiction() {
  var jid = await JR.activeJid();
  if (!jid) return null;
  var p = await get('SELECT id, code, name FROM jurisdiction_profiles WHERE id = ?', [jid]);
  return p || null;
}
function templateItems(code) {
  var meta = STI.loadTemplate(code);
  return { items: (meta.tpl.fee_schedule && meta.tpl.fee_schedule.items) || {}, file: meta.file, sha: meta.sha256, stateName: meta.tpl.state };
}
async function decisions(jid) {
  var d = await JR.read(jid, DECISIONS_DOMAIN);
  return d && typeof d === 'object' ? d : { items: {} };
}
async function currentVersion(jid) {
  return await get("SELECT id, version, status, name, created_by, created_at FROM fee_profiles WHERE jurisdiction_id = ? AND context = 'FR' AND status = 'active' ORDER BY version DESC LIMIT 1", [jid]);
}

// One row of either window.
function row(item, t, dec) {
  var law = parseValue(item, t.value);
  var binding = bindingOf(item, t);
  var r = {
    key: item.key, label: item.label, bucket: item.bucket, binding: binding, unit: item.unit, path: item.path, gap: item.gap || null,
    law: { display: law.display, num: law.num, ag: law.ag, actual: law.actual, parsed: law.parsed, authority: t.authority || '', rules: t.rule_ids || [], says: binding === 'deferral' ? lawSays(t) : null,
      // the research text behind the citation, for the popup when no corpus record resolves (Kevin 2026-09-08)
      segments: law.segments || (law.num != null || (law.parsed && Object.keys(law.parsed).length) ? [law.display] : humanize(t.value)), notes: t.notes || null },
    city: null
  };
  var d = dec && dec.items && dec.items[item.key];
  if (binding === 'ceiling') {
    // default = the ceiling (decided 2026-08-25); a decision may only lower it
    var cap = law.num;
    r.ceiling = cap;
    r.city = d ? Object.assign({ source: 'hand' }, d) : { value: cap != null ? cap : (law.parsed && Object.keys(law.parsed).length ? law.parsed : null), source: 'default' };
    r.editable = true;
  } else if (binding === 'fixed') {
    // a prose rule ('repeat') reads 'as law' in the city column — the text itself lives in TX allows and the popup
    r.city = { value: law.num != null ? law.num : (Object.keys(law.parsed).length ? law.parsed : (item.parse === 'text' ? 'as law' : law.display)), source: 'law' };
    r.editable = false;
  } else if (binding === 'floor') {
    r.floor = law.num;
    r.city = d ? Object.assign({ source: 'hand' }, d) : { value: law.num, source: 'default' };
    r.editable = true; r.noneOk = !!item.noneOk;
  } else {
    r.city = d ? Object.assign({ source: 'hand' }, d) : { value: null, source: null };
    r.editable = true; r.noneOk = !!item.noneOk; r.actualOk = !!item.actualOk; if (item.actualLabel) r.actualLabel = item.actualLabel;
  }
  return r;
}

// ---- items with no place on a state's screen (Kevin 2026-09-13) --------------------------------------
// An item the state neither sets nor leaves to the city is not a decision — it is noise. Each rule reads the
// template's verified cells and answers WHY the item is omitted, or null to keep it. The row is dropped from
// the screen, a decision on it is refused as an unknown item, and the engine keeps the skeleton's default.
//   rules.minFee — a minimum charge exists only where the state names one (OH, TN speak to it) or where the
//   state leaves copy charges to the body's own reasonable-cost schedule (a city may then adopt a minimum as
//   part of it). Where the state is silent AND its copy charges are a fixed or capped statutory schedule, the
//   chargeable categories are the schedule's and a minimum is not among them — TX: no minimum in ch. 552 or
//   1 TAC ch. 70, and § 552.262(a) binds cities to the AG rules within 25%.
var OMIT_RULES = {
  'rules.minFee': function (items) {
    var mf = items['rules.minFee'] || {}, bw = items['dup.bw.rate'] || {};
    var stateSilent = !mf.resolution || mf.resolution === 'silent';
    var cappedSchedule = bw.resolution === 'ceiling' || bw.resolution === 'value';
    return (stateSilent && cappedSchedule) ? 'The state names no minimum fee, and its copy charges are a fixed or capped statutory schedule the city may not add a minimum to.' : null;
  }
};
function omittedItems(items) {
  return CATALOG.map(function (c) { var fn = OMIT_RULES[c.key]; var why = fn ? fn(items || {}) : null; return why ? { key: c.key, label: c.label, why: why } : null; }).filter(Boolean);
}

async function screen(jid) {
  var prof = jid ? await get('SELECT id, code, name FROM jurisdiction_profiles WHERE id = ?', [jid]) : await activeJurisdiction();
  if (!prof) return { jurisdiction: null, rows: [], counts: null, version: null };
  var tpl = templateItems(prof.code);
  var dec = await decisions(prof.id);
  var omitted = omittedItems(tpl.items);
  var omittedKeys = omitted.map(function (o) { return o.key; });
  var rows = CATALOG.filter(function (item) { return omittedKeys.indexOf(item.key) === -1; }).map(function (item) { return row(item, tpl.items[item.key] || {}, dec); });
  rows = rows.concat(waiverRows(tpl.items, dec));
  var mandate = rows.filter(function (r) { return r.binding !== 'deferral'; });
  var deferral = rows.filter(function (r) { return r.binding === 'deferral'; });
  var undecided = deferral.filter(function (r) { return r.city.value == null && r.city.source == null; });
  var ceilings = mandate.filter(function (r) { return r.binding === 'ceiling'; });
  var ver = await currentVersion(prof.id);
  return {
    jurisdiction: { id: prof.id, code: prof.code, name: prof.name || tpl.stateName, stateName: tpl.stateName },
    template: { file: tpl.file, sha: tpl.sha },
    rows: rows,
    omitted: omitted,
    counts: { mandate: mandate.length, ceilings: ceilings.length, ceilingsDefaulted: ceilings.filter(function (r) { return r.city.source === 'default'; }).length, deferral: deferral.length, decided: deferral.length - undecided.length, undecided: undecided.length, gaps: rows.filter(function (r) { return r.gap; }).length },
    document: dec.document || null,
    waiver: await waiverState(prof.id, dec),
    clock: await clockState(prof.id, dec, tpl.items),
    version: ver ? { id: ver.id, version: ver.version, name: ver.name, by: ver.created_by, at: ver.created_at } : null
  };
}

// ---- deciding ------------------------------------------------------------------------------------
// items: { key: { value, source: 'hand'|'document', ref } } — value may be a number, 'none', 'actual', or
// a structured object for media/av/billable. Ceiling rows are refused above the ceiling.
async function decide(jid, items, user) {
  var s = await screen(jid);
  if (!s.jurisdiction) throw Object.assign(new Error('No jurisdiction is locked yet — lock the state on the agency screen first.'), { status: 409 });
  var dec = await decisions(jid);
  dec.items = dec.items || {};
  var refused = [];
  Object.keys(items || {}).forEach(function (k) {
    var r = s.rows.filter(function (x) { return x.key === k; })[0];
    if (!r || !r.editable) { refused.push({ key: k, why: !r ? 'unknown item' : 'set by law, not editable' }); return; }
    var d = items[k] || {};
    var val = d.value;
    if (val === '' || val === undefined) val = null;
    if (typeof val === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(val)) val = Number(val);
    // A figure typed with its unit — "5%", "$3", ".50", "30 days" — is the number inside it. Stored as text it
    // reached the engine as NaN and priced as 0 (the live "5%" commercial surcharge, 2026-09-13). Text that
    // holds no number at all on a numeric item is refused by name rather than saved as a figure of nothing.
    var cat = BY_KEY[k] || {};
    if (typeof val === 'string' && NUMERIC_PARSE.indexOf(cat.parse) !== -1 && !/^\s*(none|no|actual)/i.test(val)) {
      var found = nums(val);
      if (!found.length) { refused.push({ key: k, why: 'enter a figure' + (cat.unit ? ' in ' + cat.unit : '') + ' (e.g. 5 for 5%), "none" or "actual"' }); return; }
      val = found[0];
    }
    // Electronic media arrives as one field per item (Kevin 2026-09-08): each is a figure, 'actual', or empty;
    // a figure above that item's state ceiling is refused by name.
    if (r.key === 'media' && val && typeof val === 'object') {
      var caps = r.law.parsed || {}, mo = {}, over = [];
      ['cd', 'dvd', 'usb'].forEach(function (mk) {
        var mv = val[mk]; if (mv === '' || mv === undefined) mv = null;
        if (typeof mv === 'string') { mv = /^\s*actual/i.test(mv) ? 'actual' : (/^\s*\$?\s*-?\d+(\.\d+)?\s*$/.test(mv) ? Number(mv.replace(/[$\s]/g, '')) : null); }
        if (typeof mv === 'number' && typeof caps[mk] === 'number' && mv > caps[mk] + 1e-9) over.push(mk.toUpperCase() + ' above ' + fmt(caps[mk]));
        mo[mk] = mv;
      });
      if (over.length) { refused.push({ key: k, why: 'above the ' + s.jurisdiction.code + ' ceiling: ' + over.join(', ') }); return; }
      val = (mo.cd == null && mo.dvd == null && mo.usb == null) ? null : mo;
    }
    if (r.binding === 'ceiling' && r.ceiling != null && typeof val === 'number' && val > r.ceiling + 1e-9) { refused.push({ key: k, why: 'above the ' + s.jurisdiction.code + ' ceiling of ' + fmt(r.ceiling) }); return; }
    if (r.binding === 'floor' && r.floor != null && typeof val === 'number' && val < r.floor - 1e-9) { refused.push({ key: k, why: 'below the ' + s.jurisdiction.code + ' minimum of ' + fmt(r.floor) }); return; }
    if (val === null && d.source !== 'document') { delete dec.items[k]; return; }
    dec.items[k] = { value: val, source: d.source === 'document' ? 'document' : 'hand', ref: d.ref || null, by: user.name || user.email || user.sub, at: nowStr() };
  });
  await JR.write(jid, DECISIONS_DOMAIN, dec, user.name || user.sub);
  return { refused: refused, screen: await screen(jid) };
}

// ---- approving -----------------------------------------------------------------------------------
function setPath(obj, dotted, val) {
  var parts = dotted.split('.'); var cur = obj;
  for (var i = 0; i < parts.length - 1; i++) { if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = val;
}
function skeleton() {
  return {
    context: 'FR',
    labor: { overheadPct: 0, search: { rate: 0, increment: 0, rounding: 'up', billable: true }, review: { rate: 0, increment: 0, rounding: 'up', billable: true }, programming: { rate: 0, increment: 0, rounding: 'up', billable: true } },
    duplication: { bw: { rate: 0 }, color: { rate: 0 }, oversized: { rate: 0 }, specialty: { rate: 'actual' } },
    media: { cd: 0, dvd: 0, usb: 'actual' },
    av: { perRecording: 0, perMinute: 0, freeMinutes: 0 },
    delivery: { email: 0, pickup: 0, mail: 'actual', handling: 0 },
    certification: { rate: 0, unit: 'per_record' },
    requestRules: { freePageAllowance: 0, freeLaborHours: 0, deMinimis: 0, minFee: 0, maxFee: null, deposit: { threshold: null, percent: null }, estimateNotifyThreshold: null, personnelTimeAllowance: null, sameDayAggregation: false },
    estimatePolicy: { requesterResponseDays: null, revisionNotifyPercent: null, estimateValidityDays: null },
    payment_mode: 'internal'
  };
}
// Turn the screen's rows into the engine's config. Every figure has exactly one home.
function compose(s) {
  var cfg = skeleton();
  var noneToZero = function (v) { return v === 'none' || v == null ? 0 : v; };
  s.rows.forEach(function (r) {
    var v = r.city && r.city.value;
    // A decision recorded as text on a numeric item before decide() normalised them ("5%", "50%", ".50") is
    // its number here, so the draft and the next approval price it — never a string the engine reads as 0.
    var cat = BY_KEY[r.key] || {};
    if (typeof v === 'string' && NUMERIC_PARSE.indexOf(cat.parse) !== -1 && v !== 'none' && v !== 'actual') { var fn = nums(v); if (fn.length) v = fn[0]; }
    switch (r.key) {
      case 'media': { var m = (v && typeof v === 'object') ? v : (r.law.parsed || {}); if (m.cd != null) cfg.media.cd = m.cd; if (m.dvd != null) cfg.media.dvd = m.dvd; if (m.usb != null) cfg.media.usb = m.usb; return; }
      case 'av': { var a = (v && typeof v === 'object') ? v : (r.law.parsed || {}); ['perRecording', 'perMinute', 'freeMinutes'].forEach(function (k) { if (a[k] != null) cfg.av[k] = a[k]; }); return; }
      case 'delivery': { if (v === 'actual' || (v == null && r.law.parsed && r.law.parsed.mail === 'actual')) cfg.delivery.mail = 'actual'; else if (typeof v === 'number') cfg.delivery.mail = v; return; }
      case 'labor.billableWhen': { var b = r.law.parsed || {}; ['search', 'review', 'programming'].forEach(function (k) { if (b.never) { cfg.labor[k].billable = false; } else if (b.trigger) { cfg.labor[k].billable = true; cfg.labor[k].billableWhen = { mode: 'all_or_nothing', trigger: b.trigger, threshold: b.threshold }; } }); return; }
      case 'labor.increment': { if (typeof v === 'number') { var hrs = v >= 1 ? v / 60 : v; ['search', 'review', 'programming'].forEach(function (k) { cfg.labor[k].increment = hrs; }); } return; }
      case 'dup.tiers': return; // bands stay a hand edit on the rate table for now
      // § 552.275: the city's yearly allowance (at or above the state floor) with the state's monthly floor;
      // "none" = the city has not adopted the optional regime → the ledger meters nothing.
      case 'labor.periodicFreeHours': {
        var lp = r.law.parsed || {};
        cfg.requestRules.personnelTimeAllowance = (typeof v === 'number') ? { hoursPerYear: v, hoursPerMonth: lp.hoursPerMonth != null ? lp.hoursPerMonth : null, citation: r.law.authority || null } : null;
        return;
      }
      // § 552.261(e): same-calendar-day requests from one requestor MAY be treated as one for cost calculation.
      case 'repeat': { cfg.requestRules.sameDayAggregation = (r.law.segments || []).some(function (t) { return /same.day.aggregation/i.test(t); }); return; }
      default: break;
    }
    if (!r.path) return;
    if (r.binding === 'deferral') {
      if (v == null && !r.noneOk) return;
      if (v === 'actual') { setPath(cfg, r.path, 'actual'); return; }
      setPath(cfg, r.path, r.path === 'requestRules.maxFee' || r.path.indexOf('deposit.') !== -1 || r.path.indexOf('estimatePolicy') !== -1 || r.path.indexOf('purposeOverrides') !== -1 ? (v === 'none' ? null : v) : noneToZero(v));
      return;
    }
    if (typeof v === 'number') setPath(cfg, r.path, v);
    else if (v === 'actual') setPath(cfg, r.path, 'actual');
  });
  // a commercial surcharge of null means no override at all
  if (cfg.purposeOverrides && cfg.purposeOverrides.commercial && cfg.purposeOverrides.commercial.requestRules && cfg.purposeOverrides.commercial.requestRules.surchargePct == null) delete cfg.purposeOverrides;
  return cfg;
}
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

async function approve(jid, user, opts) {
  opts = opts || {};
  var s = await screen(jid);
  if (!s.jurisdiction) throw Object.assign(new Error('No jurisdiction is locked yet.'), { status: 409 });
  if (s.counts.undecided && !opts.allowUndecided) {
    throw Object.assign(new Error(s.counts.undecided + ' item(s) the law leaves to the city are still undecided. Enter a figure or choose "none" for each, then approve.'), { status: 422, code: 'UNDECIDED', undecided: s.rows.filter(function (r) { return r.binding === 'deferral' && r.city.value == null && r.city.source == null; }).map(function (r) { return r.key; }) });
  }
  var cfg = compose(s);
  var violations = feeBounds.check(cfg, s.jurisdiction.code);
  if (violations.length) throw Object.assign(new Error('Refused: ' + violations.length + ' value(s) contradict ' + s.jurisdiction.code + ' state law.'), { status: 422, code: 'BOUNDS', violations: violations });
  var last = await get("SELECT MAX(version) v FROM fee_profiles WHERE jurisdiction_id = ? AND context = 'FR'", [jid]);
  var version = (last && Number(last.v) || 0) + 1;
  var id = 'feeprof-' + uuidv4().slice(0, 8);
  var who = user.name || user.email || user.sub;
  var now = nowStr();
  cfg.version = version;
  await run('BEGIN');
  try {
    await run("UPDATE fee_profiles SET status = 'superseded', updated_at = ? WHERE jurisdiction_id = ? AND context = 'FR' AND status = 'active'", [now, jid]);
    await run('INSERT INTO fee_profiles (id, jurisdiction_id, context, version, status, name, config_json, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, jid, 'FR', version, 'active', s.jurisdiction.code + ' fee schedule v' + version, JSON.stringify(cfg), who, now, now]);
    await run('UPDATE config_history SET effective_to = ? WHERE jurisdiction_id = ? AND domain = ? AND effective_to IS NULL', [now.slice(0, 10), jid, 'fee_schedule']);
    await run('INSERT INTO config_history (id, jurisdiction_id, domain, config_json, summary, effective_from, effective_to, source, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      ['ch-' + uuidv4().slice(0, 8), jid, 'fee_schedule', JSON.stringify({ profile: id, version: version, decisions: s.rows.map(function (r) { return { key: r.key, value: r.city && r.city.value, source: r.city && r.city.source, ref: r.city && r.city.ref }; }) }),
        'Fee schedule v' + version + ' approved by ' + who + ' — ' + s.counts.mandate + ' figures set by law, ' + s.counts.decided + ' city decisions', now.slice(0, 10), null, 'fee_law', now]);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }
  try { await require('./jurisdictionProfile').sync(jid, { source: 'fee_law', actor: who }); } catch (e) { /* the attestation index self-heals on next read */ }
  return { profile: { id: id, version: version, status: 'active', config: cfg }, screen: await screen(jid) };
}

// ---- reading a fee policy document ---------------------------------------------------------------
// Text in (a pasted or uploaded policy), the existing extractor out, mapped onto the deferral rows and
// the ceiling rows by engine path, filed as 'document' decisions with the extractor's citation as the
// reference. Nothing is charged differently until approve().
async function readDocument(jid, text, docName, user) {
  var feePolicyExtract = require('./feePolicyExtract');
  var s = await screen(jid);
  if (!s.jurisdiction) throw Object.assign(new Error('No jurisdiction is locked yet.'), { status: 409 });
  var r = await feePolicyExtract.extract(text, { context: 'FR' });
  var cfg = r.config || {}, prov = r.provenance || [];
  var byPath = {}; prov.forEach(function (p) { if (p && p.field) byPath[p.field] = p; });
  var getPath = function (o, d) { return d.split('.').reduce(function (c, k) { return c == null ? undefined : c[k]; }, o); };
  var items = {}, found = [], skipped = [];
  s.rows.forEach(function (row) {
    if (!row.editable || !row.path) return;
    var v;
    if (row.key === 'media') { v = cfg.media && (cfg.media.cd != null || cfg.media.dvd != null || cfg.media.usb != null) ? { cd: cfg.media.cd, dvd: cfg.media.dvd, usb: cfg.media.usb } : undefined; }
    else if (row.key === 'av') { v = cfg.av && (cfg.av.perRecording != null || cfg.av.perMinute != null) ? { perRecording: cfg.av.perRecording, perMinute: cfg.av.perMinute, freeMinutes: cfg.av.freeMinutes } : undefined; }
    else if (row.key === 'delivery') { v = cfg.delivery ? (cfg.delivery.mail != null ? cfg.delivery.mail : undefined) : undefined; }
    else if (row.key === 'labor.increment') { v = cfg.labor && cfg.labor.search && cfg.labor.search.increment ? cfg.labor.search.increment * 60 : undefined; }
    else v = getPath(cfg, row.path);
    if (v === undefined || v === null) { if (row.binding === 'deferral') skipped.push(row.key); return; }
    var p = byPath[row.path] || byPath[row.path.split('.')[0]] || null;
    items[row.key] = { value: v, source: 'document', ref: (p && p.citation) || null, confidence: p ? p.confidence : null };
    found.push(row.key);
  });
  var res = await decide(jid, items, user);
  var dec = await decisions(jid);
  dec.document = { name: docName || 'pasted text', at: nowStr(), by: user.name || user.email || user.sub, found: found.length, notes: r.notes || '' };
  await JR.write(jid, DECISIONS_DOMAIN, dec, user.name || user.sub);
  return { found: found, skipped: skipped, refused: res.refused, notes: r.notes || '', screen: await screen(jid) };
}

module.exports = { CATALOG: CATALOG, BY_KEY: BY_KEY, DECISIONS_DOMAIN: DECISIONS_DOMAIN, WAIVER_GROUNDS: WAIVER_GROUNDS, CLOCK_FIELDS: CLOCK_FIELDS, parseValue: parseValue, screen: screen, decide: decide, decideWaiver: decideWaiver, decideClock: decideClock, clockPrefills: clockPrefills, approve: approve, compose: compose, readDocument: readDocument, templateItems: templateItems };
module.exports.omittedItems = omittedItems;
