// Deterministic public-records fee engine.
//
// PURE: (jurisdiction fee config + request quantities) -> itemized feeContext.
// No AI, no DB, no side effects, no randomness. The same inputs always produce the same
// itemized, line-by-line result, so every charge is explainable and reproducible. AI is used
// only to CONFIGURE (elsewhere); the engine only COMPUTES.
//
// Two tiers (matches the parent/child request model):
//   - per COMPONENT: gross line items (transparency: what each record type would cost).
//   - per REQUEST: free allowances, floor/ceiling, de minimis, deposit, notify - applied ONCE on
//     the aggregated total. Applying these at the request level is what stops a requester (or the
//     intake) from splitting one ask into many to dodge a per-request maximum.
//
// Used in two MODES by passing different quantities: ESTIMATE (projected) and FINAL (actual).
// ES5 style to match the codebase. All money rounded to cents.

function num(x) { x = Number(x); return isFinite(x) ? x : 0; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function r4(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }
function capWord(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function dupDesc(k) { return k === 'bw' ? 'B&W copies' : k === 'color' ? 'Color copies' : k === 'oversized' ? 'Oversized copies' : (k + ' copies'); }
// Graduated rate bands: tiers=[{upTo, rate}, ...] price qty in bands (upTo null/missing = unlimited top band).
// e.g. [{upTo:50,rate:0},{rate:0.15}] = first 50 free then $0.15; [{upTo:1,rate:0.25},{rate:0.10}] = first page $0.25 then $0.10.
function tieredAmount(qty, tiers) {
  qty = num(qty); var amt = 0, lower = 0;
  for (var i = 0; i < tiers.length && qty > lower; i++) {
    var t = tiers[i]; var upTo = (t.upTo == null) ? Infinity : num(t.upTo);
    var inBand = Math.min(qty, upTo) - lower; if (inBand > 0) amt += inBand * num(t.rate); lower = upTo;
  }
  return r2(amt);
}
function hasTiers(cfg) { return cfg && cfg.tiers && cfg.tiers.length; }

// Round labor hours to the billing increment (e.g. 0.25). mode: 'up' (default) | 'down' | 'nearest'.
// increment 0/null -> bill actual hours, no rounding.
function roundHours(hours, increment, mode) {
  hours = num(hours);
  increment = num(increment);
  if (increment <= 0) return hours;
  var q = hours / increment;
  if (mode === 'down') q = Math.floor(q);
  else if (mode === 'nearest') q = Math.round(q);
  else q = Math.ceil(q);
  return r4(q * increment);
}

function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
function isPlainObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
function deepMerge(base, ov) {
  if (!isPlainObj(base) || !isPlainObj(ov)) return ov === undefined ? base : ov;
  var out = clone(base) || {};
  for (var k in ov) { if (ov.hasOwnProperty(k)) { out[k] = (isPlainObj(out[k]) && isPlainObj(ov[k])) ? deepMerge(out[k], ov[k]) : (isPlainObj(ov[k]) ? deepMerge({}, ov[k]) : ov[k]); } }
  return out;
}

var LABOR_ORDER = ['search', 'review', 'programming']; // order free hours are consumed in

// Per-driver labor billability: a hard non-billable flag (CA/NY/OH forbid labor charges) OR an all-or-nothing
// trigger (TX: no labor until total pages exceed 50; FL/NY: no labor until total labor time exceeds a threshold).
// Purely additive: a driver with no billable/billableWhen config charges normally (unchanged behavior).
// `deliveryMethod` is the request's chosen delivery. Some statutes scope the labor bar to PAPER copies:
// Tex. Gov't Code § 552.261(a) bars materials/labor/overhead on "50 or fewer pages of PAPER records" and
// limits the charge to "each page of the paper record that is photocopied". So a config may declare
// `paperOnly: true` + the delivery methods that COUNT as paper (`paperMethods`). An electronic delivery
// then falls outside the bar and labor is chargeable.
//
// ⚠ THE paperOnly READING IS UNVERIFIED (Kevin's call, 2026-07-14) and it is LOAD-BEARING: the demo's
// default delivery is `email`, so paperOnly:true means the 50-page bar does NOT fire on most requests.
// It is a ONE-VALUE flip if counsel reads § 552.261(a) as reaching electronic delivery. Do not bury it.
function laborGate(lcfg, totalPages, totalLaborHours, deliveryMethod) {
  if (lcfg && lcfg.billable === false) return { charge: false, reason: 'Not chargeable in this jurisdiction.' };
  var bw = lcfg && lcfg.billableWhen;
  if (bw && bw.mode === 'all_or_nothing' && bw.trigger && bw.trigger !== 'none') {
    // Scope check first: if the bar is paper-only and this is not a paper delivery, the bar does not apply.
    if (bw.paperOnly) {
      var paperMethods = bw.paperMethods || ['mail', 'pickup', 'paper'];
      if (deliveryMethod && paperMethods.indexOf(deliveryMethod) < 0) {
        return { charge: true, reason: null };
      }
    }
    var q = bw.trigger === 'pages' ? totalPages : (bw.trigger === 'hours' ? totalLaborHours : 0);
    var thr = num(bw.threshold);
    if (q <= thr) return { charge: false, reason: 'Not chargeable until ' + bw.trigger + ' exceed ' + thr + ' (currently ' + q + ').' };
  }
  return { charge: true, reason: null };
}

function compute(profile, request) {
  profile = profile || {};
  // Requester-PURPOSE schedule switch: a commercial (or other) purpose deep-merges its override config
  // onto the base (e.g. labor becomes chargeable, a commercial surcharge applies). Additive: no purpose /
  // no override -> base config unchanged.
  var purpose = (request && request.purpose) || 'standard';
  var purposeApplied = false;
  if (purpose && purpose !== 'standard' && profile.purposeOverrides && profile.purposeOverrides[purpose]) { profile = deepMerge(profile, profile.purposeOverrides[purpose]); purposeApplied = true; }
  var labor = profile.labor || {};
  var dup = profile.duplication || {};
  var media = profile.media || {};
  var av = profile.av || {};
  var delivery = profile.delivery || {};
  var cert = profile.certification || {};
  var rules = profile.requestRules || {};
  var components = (request && request.components) || [];
  // Per-request ACTUAL-RATE override: jurisdictions (FL/NY/TN) bill labor at the actual wage of the assigned
  // (lowest-paid capable) employee, which varies per request. request.rateOverrides[k] overrides the config rate.
  var rateOv = (request && request.rateOverrides) || {};
  function laborRate(k) { var ov = rateOv[k]; return (ov != null && ov !== '') ? num(ov) : num((labor[k] || {}).rate); }

  var i, k;
  var agg = { search: 0, review: 0, programming: 0, bw: 0, color: 0, oversized: 0 };
  var mediaAgg = {};
  var avAgg = { recordings: 0, minutes: 0 };
  var compOut = [];

  function laborGross(kind, hours) {
    var cfg = labor[kind]; hours = num(hours);
    if (!cfg || hours <= 0) return null;
    var rate = laborRate(kind);
    return { kind: kind + '_labor', description: capWord(kind) + ' labor', unit: 'hour', quantity: hours, rate: rate, amount: r2(hours * rate) };
  }
  function dupGross(kind, pages) {
    var cfg = dup[kind]; pages = num(pages);
    if (!cfg || pages <= 0) return null;
    if (cfg.rate === 'actual') return { kind: 'dup_' + kind, description: dupDesc(kind), unit: 'page', quantity: pages, rate: 'actual', amount: 0, needsActual: true };
    var rate = num(cfg.rate);
    return { kind: 'dup_' + kind, description: dupDesc(kind), unit: 'page', quantity: pages, rate: rate, amount: r2(pages * rate) };
  }

  for (i = 0; i < components.length; i++) {
    var c = components[i] || {};
    var q = c.quantities || {};
    var items = [], gross = 0, ln;
    ln = laborGross('search', q.searchHours); if (ln) { items.push(ln); gross += ln.amount; agg.search += num(q.searchHours); }
    ln = laborGross('review', q.reviewHours); if (ln) { items.push(ln); gross += ln.amount; agg.review += num(q.reviewHours); }
    ln = laborGross('programming', q.programmingHours); if (ln) { items.push(ln); gross += ln.amount; agg.programming += num(q.programmingHours); }
    ln = dupGross('bw', q.bwPages); if (ln) { items.push(ln); gross += ln.amount; agg.bw += num(q.bwPages); }
    ln = dupGross('color', q.colorPages); if (ln) { items.push(ln); gross += ln.amount; agg.color += num(q.colorPages); }
    ln = dupGross('oversized', q.oversizedPages); if (ln) { items.push(ln); gross += ln.amount; agg.oversized += num(q.oversizedPages); }
    var mlist = q.media || [];
    for (var m = 0; m < mlist.length; m++) {
      var mt = mlist[m].type, mc = num(mlist[m].count);
      if (!mt || mc <= 0) continue;
      mediaAgg[mt] = (mediaAgg[mt] || 0) + mc;
      var mr = media[mt];
      if (mr === 'actual' || mr == null) items.push({ kind: 'media', description: 'Media: ' + mt, unit: 'item', quantity: mc, rate: (mr == null ? 0 : 'actual'), amount: 0, needsActual: mr === 'actual' });
      else { var ma = r2(mc * num(mr)); items.push({ kind: 'media', description: 'Media: ' + mt, unit: 'item', quantity: mc, rate: num(mr), amount: ma }); gross += ma; }
    }
    var avq = q.av || null;
    if (avq) {
      var recs = num(avq.recordings), mins = num(avq.minutes);
      if (recs > 0 && num(av.perRecording) > 0) { var rAmt = r2(recs * num(av.perRecording)); items.push({ kind: 'av_recording', description: 'Recordings (per recording)', unit: 'recording', quantity: recs, rate: num(av.perRecording), amount: rAmt }); gross += rAmt; }
      if (mins > 0 && num(av.perMinute) > 0) { var mAmt2 = r2(mins * num(av.perMinute)); items.push({ kind: 'av_minute', description: 'Recording duration (per minute)', unit: 'minute', quantity: mins, rate: num(av.perMinute), amount: mAmt2 }); gross += mAmt2; }
      avAgg.recordings += recs; avAgg.minutes += mins;
    }
    compOut.push({ id: c.id || ('comp-' + (i + 1)), label: c.label || ('Component ' + (i + 1)), recordType: c.recordType || null, lineItems: items, componentGross: r2(gross) });
  }

  var grossSubtotal = 0;
  for (i = 0; i < compOut.length; i++) grossSubtotal += compOut[i].componentGross;
  grossSubtotal = r2(grossSubtotal);

  // ---- request-level: free labor hours consumed in order, then increment-rounded + priced ----
  var billable = { search: agg.search, review: agg.review, programming: agg.programming };
  var remainingFree = num(rules.freeLaborHours);
  for (i = 0; i < LABOR_ORDER.length && remainingFree > 0; i++) {
    k = LABOR_ORDER[i];
    var take = Math.min(remainingFree, billable[k]);
    billable[k] = r4(billable[k] - take);
    remainingFree = r4(remainingFree - take);
  }
  var totalPages = num(agg.bw) + num(agg.color) + num(agg.oversized);
  var totalLaborHours = num(agg.search) + num(agg.review) + num(agg.programming);
  // Delivery drives the labor gate's paper-only scope (§ 552.261(a)), so it must be known BEFORE labor is
  // priced -- not just at the delivery line below.
  var deliveryMethod = (request && request.delivery && request.delivery.method) || null;
  var laborItems = [], laborSubtotal = 0;
  for (i = 0; i < LABOR_ORDER.length; i++) {
    k = LABOR_ORDER[i]; var lcfg = labor[k];
    if (!lcfg || agg[k] <= 0) continue;
    var bh = roundHours(billable[k], lcfg.increment, lcfg.rounding);
    var gate = laborGate(lcfg, totalPages, totalLaborHours, deliveryMethod);
    var lrate = laborRate(k);
    var amt = gate.charge ? r2(bh * lrate) : 0;
    laborItems.push({ kind: k + '_labor', aggregateHours: r4(agg[k]), billableHours: bh, rate: lrate, amount: amt, nonBillable: !gate.charge, billabilityNote: gate.reason });
    if (gate.charge) laborSubtotal += amt;
  }

  // ---- labor overhead surcharge (e.g. TX +20% of billable labor); zero when labor is non-billable ----
  var laborOverheadPct = num(labor.overheadPct);
  var laborOverhead = laborOverheadPct > 0 ? r2(laborSubtotal * laborOverheadPct / 100) : 0;

  // ---- free B&W page allowance (request-level), then duplication ----
  var freePages = num(rules.freePageAllowance);
  var dupItems = [], dupSubtotal = 0;
  if (agg.bw > 0 && dup.bw) {
    var billBw, bwAmt, bwFree;
    if (hasTiers(dup.bw)) { billBw = agg.bw; bwFree = 0; bwAmt = tieredAmount(agg.bw, dup.bw.tiers); }
    else { billBw = Math.max(0, agg.bw - freePages); bwFree = Math.min(freePages, agg.bw); bwAmt = (dup.bw.rate === 'actual') ? 0 : r2(billBw * num(dup.bw.rate)); }
    dupItems.push({ kind: 'dup_bw', aggregatePages: agg.bw, freePagesApplied: bwFree, billablePages: billBw, rate: hasTiers(dup.bw) ? 'tiered' : dup.bw.rate, amount: bwAmt, needsActual: dup.bw.rate === 'actual' });
    dupSubtotal += bwAmt;
  }
  if (agg.color > 0 && dup.color) { var cAmt = hasTiers(dup.color) ? tieredAmount(agg.color, dup.color.tiers) : ((dup.color.rate === 'actual') ? 0 : r2(agg.color * num(dup.color.rate))); dupItems.push({ kind: 'dup_color', pages: agg.color, rate: hasTiers(dup.color) ? 'tiered' : dup.color.rate, amount: cAmt, needsActual: dup.color.rate === 'actual' }); dupSubtotal += cAmt; }
  if (agg.oversized > 0 && dup.oversized) { var oAmt = hasTiers(dup.oversized) ? tieredAmount(agg.oversized, dup.oversized.tiers) : ((dup.oversized.rate === 'actual') ? 0 : r2(agg.oversized * num(dup.oversized.rate))); dupItems.push({ kind: 'dup_oversized', pages: agg.oversized, rate: hasTiers(dup.oversized) ? 'tiered' : dup.oversized.rate, amount: oAmt, needsActual: dup.oversized.rate === 'actual' }); dupSubtotal += oAmt; }

  // ---- media (request-level aggregate) ----
  var mediaItems = [], mediaSubtotal = 0;
  for (var mtype in mediaAgg) {
    if (!mediaAgg.hasOwnProperty(mtype)) continue;
    var mrate = media[mtype], cnt = mediaAgg[mtype];
    if (mrate === 'actual' || mrate == null) mediaItems.push({ kind: 'media', type: mtype, count: cnt, rate: (mrate == null ? 0 : 'actual'), amount: 0, needsActual: mrate === 'actual' });
    else { var mamt = r2(cnt * num(mrate)); mediaItems.push({ kind: 'media', type: mtype, count: cnt, rate: num(mrate), amount: mamt }); mediaSubtotal += mamt; }
  }

  // ---- audio/video (request-level): per-recording + per-minute, with optional free-minute allowance ----
  var avItems = [], avSubtotal = 0;
  if (avAgg.recordings > 0 && num(av.perRecording) > 0) { var avR = r2(avAgg.recordings * num(av.perRecording)); avItems.push({ kind: 'av_recording', count: avAgg.recordings, rate: num(av.perRecording), amount: avR }); avSubtotal += avR; }
  if (avAgg.minutes > 0 && num(av.perMinute) > 0) { var freeMin = num(av.freeMinutes); var billMin = Math.max(0, avAgg.minutes - freeMin); var avM = r2(billMin * num(av.perMinute)); avItems.push({ kind: 'av_minute', totalMinutes: avAgg.minutes, freeMinutesApplied: Math.min(freeMin, avAgg.minutes), billableMinutes: billMin, rate: num(av.perMinute), amount: avM }); avSubtotal += avM; }
  avSubtotal = r2(avSubtotal);

  // ---- delivery (once per request) ----
  var deliveryItem = null, deliverySubtotal = 0;
  var dmethod = deliveryMethod;
  if (dmethod && delivery[dmethod] != null) {
    var dr = delivery[dmethod];
    if (dr === 'actual') deliveryItem = { kind: 'delivery', method: dmethod, rate: 'actual', amount: 0, needsActual: true };
    else { var handling = r2(num(delivery.handling)); var damt = r2(num(dr) + handling); deliveryItem = { kind: 'delivery', method: dmethod, rate: num(dr), handling: handling, amount: damt }; deliverySubtotal += damt; }
  }

  // ---- certification (once per request) ----
  var certItem = null, certSubtotal = 0;
  var certCount = num(request && request.certification && request.certification.count);
  if (certCount > 0 && cert.rate) { var camt = r2(certCount * num(cert.rate)); certItem = { kind: 'certification', unit: cert.unit || 'per_record', count: certCount, rate: num(cert.rate), amount: camt }; certSubtotal += camt; }

  // ---- other: a staff-entered one-off cost not covered by the configured scope (amount + label) ----
  var otherItem = null, otherSubtotal = 0;
  var other = request && request.other;
  if (other && num(other.amount) !== 0) { otherSubtotal = r2(num(other.amount)); otherItem = { kind: 'other', description: (other.description || 'Other'), amount: otherSubtotal }; }

  var adjustedSubtotal = r2(laborSubtotal + laborOverhead + dupSubtotal + mediaSubtotal + avSubtotal + deliverySubtotal + certSubtotal + otherSubtotal);

  // ---- purpose/commercial surcharge (percent of the subtotal) ----
  var surchargePct = num(rules.surchargePct);
  var surcharge = surchargePct > 0 ? r2(adjustedSubtotal * surchargePct / 100) : 0;
  var surchargedSubtotal = r2(adjustedSubtotal + surcharge);

  // ---- floor -> ceiling -> de minimis waive (documented order) ----
  var total = surchargedSubtotal, floorApplied = false, ceilingApplied = false, deMinimisWaived = false;
  var minFee = num(rules.minFee), maxFee = (rules.maxFee == null ? null : num(rules.maxFee));
  if (minFee > 0 && total > 0 && total < minFee) { total = r2(minFee); floorApplied = true; }
  if (maxFee != null && total > maxFee) { total = r2(maxFee); ceilingApplied = true; }
  var deMinimis = num(rules.deMinimis);
  if (deMinimis > 0 && total > 0 && total <= deMinimis) { total = 0; deMinimisWaived = true; }

  // ---- deposit + estimate-notify ----
  var depositDue = 0, depositBasis = null, dep = rules.deposit || {};
  if (dep.threshold != null && total > num(dep.threshold) && dep.percent) { depositDue = r2(total * (num(dep.percent) / 100)); depositBasis = num(dep.percent) + '% of $' + total.toFixed(2) + ' (estimate exceeds $' + num(dep.threshold) + ')'; }
  var notify = (rules.estimateNotifyThreshold != null && total > num(rules.estimateNotifyThreshold));

  // ---- explanation trace: every request-level rule, whether configured/applied or not, with a
  // plain-language line. The Financial Profile renders this so the estimate "shows its work",
  // including rules that did NOT apply. Generated from the same values used above (never drifts).
  function te(rule, label, configured, configuredValue, applied, plainLine) {
    return { rule: rule, label: label, configured: !!configured, configuredValue: (configuredValue === undefined ? null : configuredValue), applied: !!applied, plainLine: plainLine };
  }
  var rulesTrace = [];
  (function () {
    var fp = num(freePages), fh = num(rules.freeLaborHours), cfg = (fp > 0 || fh > 0);
    rulesTrace.push(te('free_allowances', 'Free allowances', cfg, { freePages: fp, freeLaborHours: fh }, cfg,
      cfg ? ('First ' + fp + ' page(s) and ' + fh + ' labor hour(s) are free, applied before charges.') : 'No free allowances configured.'));
  })();
  rulesTrace.push(te('surcharge', 'Surcharge', surchargePct > 0, surchargePct, surchargePct > 0,
    surchargePct > 0 ? (surchargePct + '% surcharge on $' + adjustedSubtotal.toFixed(2) + ' = $' + surcharge.toFixed(2) + '.') : 'No surcharge configured.'));
  rulesTrace.push(te('min_fee', 'Minimum fee (floor)', minFee > 0, (minFee > 0 ? minFee : null), floorApplied,
    minFee <= 0 ? 'No minimum fee configured.' : (floorApplied
      ? ('Subtotal $' + surchargedSubtotal.toFixed(2) + ' was below the $' + minFee.toFixed(2) + ' minimum, raised to $' + minFee.toFixed(2) + '.')
      : ('Minimum fee $' + minFee.toFixed(2) + ' — subtotal $' + surchargedSubtotal.toFixed(2) + ' met it, no floor adjustment.'))));
  rulesTrace.push(te('max_fee', 'Maximum fee (ceiling)', maxFee != null, maxFee, ceilingApplied,
    maxFee == null ? 'No maximum fee configured.' : (ceilingApplied
      ? ('Subtotal exceeded the $' + maxFee.toFixed(2) + ' maximum, capped at $' + maxFee.toFixed(2) + '.')
      : ('Maximum fee $' + maxFee.toFixed(2) + ' — not reached (total $' + total.toFixed(2) + ').'))));
  rulesTrace.push(te('de_minimis', 'De minimis waiver', deMinimis > 0, (deMinimis > 0 ? deMinimis : null), deMinimisWaived,
    deMinimis <= 0 ? 'No de minimis waiver configured.' : (deMinimisWaived
      ? ('Total was at or under $' + deMinimis.toFixed(2) + ', waived to $0.00.')
      : ('De minimis waive at or under $' + deMinimis.toFixed(2) + ' — not triggered (total $' + total.toFixed(2) + ').'))));
  (function () {
    var cfg = !!(dep && dep.threshold != null && dep.percent);
    rulesTrace.push(te('deposit', 'Deposit', cfg, (cfg ? { threshold: num(dep.threshold), percent: num(dep.percent) } : null), depositDue > 0,
      !cfg ? 'No deposit required for this jurisdiction.' : (depositDue > 0
        ? ('Deposit required: ' + depositBasis + ' = $' + depositDue.toFixed(2) + '.')
        : ('Deposit of ' + num(dep.percent) + '% required when the estimate exceeds $' + num(dep.threshold).toFixed(2) + ' — not triggered (total $' + total.toFixed(2) + ').'))));
  })();
  (function () {
    var t = rules.estimateNotifyThreshold, cfg = (t != null);
    rulesTrace.push(te('estimate_notify', 'Requestor notification threshold', cfg, (cfg ? num(t) : null), notify,
      !cfg ? 'No notification threshold configured.' : (notify
        ? ('Estimate exceeds $' + num(t).toFixed(2) + ' — requestor notification / consent required.')
        : ('Notification threshold $' + num(t).toFixed(2) + ' — not exceeded (total $' + total.toFixed(2) + ').'))));
  })();

  return {
    context: profile.context || 'FR',
    configVersion: (profile.version != null ? profile.version : null),
    components: compOut,
    requestLevel: {
      grossSubtotal: grossSubtotal,
      labor: laborItems, laborSubtotal: r2(laborSubtotal),
      laborOverhead: laborOverhead, laborOverheadPct: laborOverheadPct,
      duplication: dupItems, duplicationSubtotal: r2(dupSubtotal),
      media: mediaItems, mediaSubtotal: r2(mediaSubtotal),
      av: avItems, avSubtotal: r2(avSubtotal),
      delivery: deliveryItem, deliverySubtotal: r2(deliverySubtotal),
      certification: certItem, certificationSubtotal: r2(certSubtotal),
      other: otherItem, otherSubtotal: r2(otherSubtotal),
      freeAllowances: { freeLaborHours: num(rules.freeLaborHours), freePageAllowance: freePages },
      adjustedSubtotal: adjustedSubtotal,
      surchargePct: surchargePct, surcharge: surcharge, surchargedSubtotal: surchargedSubtotal,
      purpose: purpose, purposeApplied: purposeApplied,
      floorApplied: floorApplied, ceilingApplied: ceilingApplied, deMinimisWaived: deMinimisWaived,
      total: r2(total),
      depositDue: depositDue, depositBasis: depositBasis,
      estimateNotifyTriggered: notify,
      rulesTrace: rulesTrace
    },
    generatedAt: new Date().toISOString()
  };
}

module.exports = { compute: compute, roundHours: roundHours };
