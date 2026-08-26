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
  { key: 'labor.periodicFreeHours',     label: 'Free personnel time per requestor',     bucket: 'computation',      path: null,                             parse: 'hours2',   unit: 'hours', gap: 'needs requestor ledger' },
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
  { key: 'rules.maxFee',                label: 'Request-level ceiling',                 bucket: 'computation',      path: 'requestRules.maxFee',            parse: 'maxfee',      unit: '$', noneOk: true },
  { key: 'rules.deMinimis',             label: 'De-minimis — no charge below',          bucket: 'computation',      path: 'requestRules.deMinimis',         parse: 'usd',      unit: '$', noneOk: true },
  { key: 'rules.minFee',                label: 'Minimum fee',                           bucket: 'computation',      path: 'requestRules.minFee',            parse: 'usd',      unit: '$', noneOk: true },
  { key: 'media',                       label: 'Electronic media (CD / DVD / USB)',     bucket: 'computation',      path: 'media',                          parse: 'media',    unit: '$ per item' },
  { key: 'delivery',                    label: 'Delivery — mail / handling',            bucket: 'computation',      path: 'delivery',                       parse: 'delivery', unit: '$ or actual postage', actualOk: true },
  { key: 'certification',               label: 'Certified copy charge',                 bucket: 'computation',      path: 'certification.rate',             parse: 'usd',      unit: '$ per document', noneOk: true },
  { key: 'av',                          label: 'Audio / video (body-worn camera)',      bucket: 'computation',      path: 'av',                             parse: 'av',       unit: '$' },
  { key: 'commercial',                  label: 'Commercial-purpose surcharge',          bucket: 'computation',      path: 'purposeOverrides.commercial.requestRules.surchargePct', parse: 'pct', unit: '%', noneOk: true },
  { key: 'waiver',                      label: 'Fee waiver grounds',                    bucket: 'estimate_payment', path: null,                             parse: 'waiver',     unit: 'rule' },
  { key: 'waiver.forfeiture',           label: 'Late response forfeits the fee',        bucket: 'estimate_payment', path: null,                             parse: 'bool',     unit: 'yes / no', noneOk: true },
  { key: 'repeat',                      label: 'Repeat / aggregated requests',          bucket: 'computation',      path: null,                             parse: 'text',     unit: 'rule', gap: 'needs requestor ledger' },
];
const BY_KEY = {}; CATALOG.forEach(function (c) { BY_KEY[c.key] = c; });

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
    case 'hours2': { var h = nums(v); out.display = h.length >= 2 ? h[0] + ' hrs / yr · ' + h[1] + ' hrs / mo' : (h.length ? h[0] + ' hrs' : v.slice(0, 80)); out.num = h.length ? h[0] : null; break; }
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
    default: out.display = v.length > 90 ? v.slice(0, 87) + '…' : v;
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
    law: { display: law.display, num: law.num, ag: law.ag, actual: law.actual, parsed: law.parsed, authority: t.authority || '', rules: t.rule_ids || [], says: binding === 'deferral' ? lawSays(t) : null },
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
    r.city = { value: law.num != null ? law.num : (Object.keys(law.parsed).length ? law.parsed : law.display), source: 'law' };
    r.editable = false;
  } else if (binding === 'floor') {
    r.floor = law.num;
    r.city = d ? Object.assign({ source: 'hand' }, d) : { value: law.num, source: 'default' };
    r.editable = true;
  } else {
    r.city = d ? Object.assign({ source: 'hand' }, d) : { value: null, source: null };
    r.editable = true; r.noneOk = !!item.noneOk; r.actualOk = !!item.actualOk;
  }
  return r;
}

async function screen(jid) {
  var prof = jid ? await get('SELECT id, code, name FROM jurisdiction_profiles WHERE id = ?', [jid]) : await activeJurisdiction();
  if (!prof) return { jurisdiction: null, rows: [], counts: null, version: null };
  var tpl = templateItems(prof.code);
  var dec = await decisions(prof.id);
  var rows = CATALOG.map(function (item) { return row(item, tpl.items[item.key] || {}, dec); });
  var mandate = rows.filter(function (r) { return r.binding !== 'deferral'; });
  var deferral = rows.filter(function (r) { return r.binding === 'deferral'; });
  var undecided = deferral.filter(function (r) { return r.city.value == null && r.city.source == null; });
  var ceilings = mandate.filter(function (r) { return r.binding === 'ceiling'; });
  var ver = await currentVersion(prof.id);
  return {
    jurisdiction: { id: prof.id, code: prof.code, name: prof.name || tpl.stateName, stateName: tpl.stateName },
    template: { file: tpl.file, sha: tpl.sha },
    rows: rows,
    counts: { mandate: mandate.length, ceilings: ceilings.length, ceilingsDefaulted: ceilings.filter(function (r) { return r.city.source === 'default'; }).length, deferral: deferral.length, decided: deferral.length - undecided.length, undecided: undecided.length, gaps: rows.filter(function (r) { return r.gap; }).length },
    document: dec.document || null,
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
    requestRules: { freePageAllowance: 0, freeLaborHours: 0, deMinimis: 0, minFee: 0, maxFee: null, deposit: { threshold: null, percent: null }, estimateNotifyThreshold: null },
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
    switch (r.key) {
      case 'media': { var m = (v && typeof v === 'object') ? v : (r.law.parsed || {}); if (m.cd != null) cfg.media.cd = m.cd; if (m.dvd != null) cfg.media.dvd = m.dvd; if (m.usb != null) cfg.media.usb = m.usb; return; }
      case 'av': { var a = (v && typeof v === 'object') ? v : (r.law.parsed || {}); ['perRecording', 'perMinute', 'freeMinutes'].forEach(function (k) { if (a[k] != null) cfg.av[k] = a[k]; }); return; }
      case 'delivery': { if (v === 'actual' || (v == null && r.law.parsed && r.law.parsed.mail === 'actual')) cfg.delivery.mail = 'actual'; else if (typeof v === 'number') cfg.delivery.mail = v; return; }
      case 'labor.billableWhen': { var b = r.law.parsed || {}; ['search', 'review', 'programming'].forEach(function (k) { if (b.never) { cfg.labor[k].billable = false; } else if (b.trigger) { cfg.labor[k].billable = true; cfg.labor[k].billableWhen = { mode: 'all_or_nothing', trigger: b.trigger, threshold: b.threshold }; } }); return; }
      case 'labor.increment': { if (typeof v === 'number') { var hrs = v >= 1 ? v / 60 : v; ['search', 'review', 'programming'].forEach(function (k) { cfg.labor[k].increment = hrs; }); } return; }
      case 'dup.tiers': return; // bands stay a hand edit on the rate table for now
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

module.exports = { CATALOG: CATALOG, BY_KEY: BY_KEY, DECISIONS_DOMAIN: DECISIONS_DOMAIN, parseValue: parseValue, screen: screen, decide: decide, approve: approve, compose: compose, readDocument: readDocument, templateItems: templateItems };
