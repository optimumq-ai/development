// Requestor-facing fee estimate notice. Renders a saved feeContext into PLAIN LANGUAGE for the
// requester - deliberately distinct from the staff worksheet: no internal labels (no "gross
// subtotal", "ceiling applied", component internals, or handling-tier names). Deterministic text;
// staff review/edit before it is sent.

function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
function hrLabel(n) { n = Number(n) || 0; return n + (n === 1 ? ' hour' : ' hours'); }

var LABOR_LABEL = { search_labor: 'Staff time to locate and compile records', review_labor: 'Staff time to review and prepare records', programming_labor: 'Programming / data extraction time' };
var DUP_LABEL = { dup_bw: 'Black-and-white copies', dup_color: 'Color copies', dup_oversized: 'Oversized copies' };

// --- Payment-plan-aware requestor language (slice 3). Given a resolved paymentPlan
// (see paymentTiming.resolvePaymentPlan), return band-specific plain-language paragraphs. ---
function windowSentence(fp) {
  var w = fp && fp.dueWindow;
  if (!w) return null;
  var unit = (w.unit === 'business') ? 'business day' : 'day';
  unit += (w.days === 1 ? '' : 's');
  var from = (w.from === 'notice_received') ? 'after you receive this notice' : 'from the date of this notice';
  var onExpiry = w.onExpiry === 'abandoned' ? 'considered abandoned' : (w.onExpiry === 'withdrawn' ? 'considered withdrawn' : 'closed');
  return 'Please respond within ' + w.days + ' ' + unit + ' ' + from + ', or this request may be ' + onExpiry + '.';
}

function paymentLanguage(pp, moneyFn) {
  moneyFn = moneyFn || money;
  var out = [];
  var fp = pp.firstPayment || {};
  var beforeRelease = pp.secondPayment && pp.secondPayment.terms === 'due_before_release';
  var balanceLine = beforeRelease
    ? 'Any remaining balance must be paid before the records are released.'
    : 'Any remaining balance will be due upon completion.';
  switch (pp.gate) {
    case 'invoice_on_completion':
      out.push('We will begin processing your request. The estimated cost shown above will be invoiced to you when the records are ready.');
      break;
    case 'estimate_acceptance':
      out.push('Before we begin, please confirm that you accept this estimated cost. No payment is required up front.');
      var ws = windowSentence(fp); if (ws) out.push(ws);
      out.push(balanceLine);
      break;
    case 'deposit_before_work':
      var amtTxt;
      if (fp.isCeiling) amtTxt = 'A deposit of up to ' + moneyFn(fp.amount) + ' (the full anticipated cost)';
      else if (fp.amount != null) amtTxt = 'A deposit of ' + moneyFn(fp.amount);
      else amtTxt = 'A deposit';
      out.push(amtTxt + ' is required before we begin processing your request.' + (fp.creditedToFinal ? ' It will be credited toward your final invoice.' : ''));
      var ws2 = windowSentence(fp); if (ws2) out.push(ws2);
      out.push(balanceLine);
      break;
    case 'pay_in_full_before_release':
      out.push('We will process your request. The fee shown above must be paid in full before the records are released.');
      break;
    default:
      out.push('Please confirm you would like us to proceed at this estimated cost.');
  }
  (pp.notes || []).forEach(function (n) {
    if (/Delinquent|prior unpaid/i.test(n)) out.push('Because a previous request has an unpaid balance, an advance payment is required before we can begin this one.');
  });
  return out;
}

function num(n) { n = Number(n); return isFinite(n) ? n : 0; }
function buildLines(R) {
  var lines = [];
  (R.labor || []).forEach(function (li) { if (li.amount > 0) lines.push('- ' + (LABOR_LABEL[li.kind] || 'Staff time') + ': ' + hrLabel(li.billableHours) + ' at ' + money(li.rate) + '/hour = ' + money(li.amount)); });
  (R.duplication || []).forEach(function (li) {
    var label = DUP_LABEL[li.kind] || 'Copies';
    if (li.needsActual) { lines.push('- ' + label + ': actual cost to be determined'); return; }
    var pages = (li.billablePages != null ? li.billablePages : li.pages);
    if (li.amount > 0 || pages > 0) { var note = li.freePagesApplied ? ' (first ' + li.freePagesApplied + ' pages at no charge)' : ''; lines.push('- ' + label + ': ' + pages + ' pages at ' + money(li.rate) + '/page = ' + money(li.amount) + note); }
  });
  (R.media || []).forEach(function (li) { if (li.needsActual) lines.push('- Media (' + String(li.type || '').toUpperCase() + '): actual cost to be determined'); else if (li.amount > 0) lines.push('- Media (' + String(li.type || '').toUpperCase() + '): ' + li.count + ' at ' + money(li.rate) + ' = ' + money(li.amount)); });
  if (R.delivery && R.delivery.amount > 0) lines.push('- Delivery (' + R.delivery.method + '): ' + money(R.delivery.amount));
  else if (R.delivery && R.delivery.needsActual) lines.push('- Delivery (' + R.delivery.method + '): actual cost to be determined');
  if (R.certification && R.certification.amount > 0) lines.push('- Certification: ' + R.certification.count + ' at ' + money(R.certification.rate) + ' = ' + money(R.certification.amount));
  if (R.other && R.other.amount) lines.push('- ' + (R.other.description || 'Other') + ': ' + money(R.other.amount));
  return lines;
}
function relevantTrace(R) { return ((R && R.rulesTrace) || []).filter(function (t) { return ['free_allowances', 'surcharge', 'min_fee', 'max_fee', 'de_minimis'].indexOf(t.rule) >= 0 && (t.applied || t.configured); }); }

function buildNotice(request, feeContext, opts) {
  opts = opts || {};
  var R = (feeContext && feeContext.requestLevel) || {};
  var agency = opts.agencyName || 'the City';
  var num = request.request_number || '';
  var name = request.requestor_name || 'Requestor';
  var total = (R.total != null ? R.total : 0);

  var lines = buildLines(R);

  var waiverGranted = !!(opts.feeWaiver && opts.feeWaiver.granted);
  var method = opts.computationMethod || 'Standard';
  var traceRel = relevantTrace(R);

  var subject = (waiverGranted ? 'Your public records request \u2014 fees waived' : 'Cost estimate for your public records request') + (num ? ' ' + num : '');
  var body = '';
  body += 'Dear ' + name + ',\n\n';
  body += 'Thank you for your public records request' + (num ? ' (' + num + ')' : '') + '. We have reviewed it and prepared the cost detail below.\n\n';
  if (method && method !== 'Standard' && !waiverGranted) body += 'This request was priced using ' + method.toLowerCase() + '.\n\n';
  body += (waiverGranted ? 'Computed cost: ' + money(total) + ' (waived)\n\n' : 'Estimated cost: ' + money(total) + '\n\n');
  if (lines.length) body += 'This estimate is based on:\n' + lines.join('\n') + '\n\n';
  if (traceRel.length) body += 'How your total was determined:\n' + traceRel.map(function (t) { return '- ' + t.plainLine; }).join('\n') + '\n\n';
  if (waiverGranted) {
    body += 'These fees have been waived. No payment is required, and we will proceed with your request.\n\n';
  } else if (opts.paymentMode === 'erp') {
    body += 'This notice explains how your cost was calculated. You will receive an invoice and payment instructions in a separate communication from our finance office.\n\n';
    if (opts.responseDays) body += 'Please respond within ' + opts.responseDays + ' business days to confirm you would like us to proceed, or this request may be considered withdrawn.\n\n';
  } else if (opts.paymentPlan) {
    paymentLanguage(opts.paymentPlan, money).forEach(function (p) { body += p + '\n\n'; });
  } else {
    if (R.depositDue && R.depositDue > 0) body += 'A deposit of ' + money(R.depositDue) + ' is required before we begin processing. Once it is received we will proceed, and any remaining balance will be due upon completion.\n\n';
    else body += 'Please confirm you would like us to proceed at this estimated cost.\n\n';
    if (opts.responseDays) body += 'Please respond within ' + opts.responseDays + ' business days, or this request may be considered withdrawn.\n\n';
  }
  if (!waiverGranted) body += 'This is an estimate; the final cost may differ based on the records actually located and the time required. Any item shown as "actual cost to be determined" will be calculated once known. If you have questions, or would like to narrow your request to reduce the cost, please reply to this message.\n\n';
  body += 'Sincerely,\n' + agency + ' - Open Records';

  return { subject: subject, text: body };
}

// Balance-due notice (4d): records are ready but a pre-release balance remains. Includes configurable
// payment instructions (online link / mail / walk-in); each is omitted when not configured.
function buildBalanceDueNotice(request, state, opts) {
  opts = opts || {};
  var agency = opts.agencyName || 'the City';
  var num = request.request_number || '';
  var name = request.requestor_name || 'Requestor';
  var pi = opts.paymentInstructions || {};
  var bal = (state && state.balanceDue != null) ? state.balanceDue : 0;
  var subject = 'Your records are ready \u2014 balance due before release' + (num ? ' (' + num + ')' : '');
  var body = 'Dear ' + name + ',\n\n';
  body += 'Good news: processing of your public records request' + (num ? ' (' + num + ')' : '') + ' is complete and your records are ready.\n\n';
  body += 'Before we can release them, the remaining balance of ' + money(bal) + ' must be paid.\n\n';
  var how = [];
  if (pi.onlineUrl) how.push('- Online: ' + pi.onlineUrl);
  if (pi.mailText) how.push('- By mail: ' + pi.mailText);
  if (pi.walkInText) how.push('- In person: ' + pi.walkInText);
  if (how.length) body += 'How to pay:\n' + how.join('\n') + '\n\n';
  body += 'As soon as your payment is received, your records will be delivered promptly. If you have any questions, please reply to this message.\n\n';
  body += 'Sincerely,\n' + agency + ' - Open Records';
  return { subject: subject, text: body };
}

function buildAdjustmentNotice(request, estimateFc, actualFc, opts) {
  opts = opts || {};
  var eR = (estimateFc && estimateFc.requestLevel) || {};
  var aR = (actualFc && actualFc.requestLevel) || {};
  var estTotal = num(eR.total), actualTotal = num(aR.total);
  var delta = Math.round((actualTotal - estTotal) * 100) / 100;
  var numr = request.request_number || '', name = request.requestor_name || 'Requestor', agency = opts.agencyName || 'the City';
  var waiverGranted = !!(opts.feeWaiver && opts.feeWaiver.granted);
  var lines = buildLines(aR), traceRel = relevantTrace(aR);

  var subject = 'Final cost for your public records request' + (numr ? ' ' + numr : '');
  var body = 'Dear ' + name + ',\n\n';
  body += 'Your public records request' + (numr ? ' (' + numr + ')' : '') + ' has been completed, and we have calculated the final actual cost.\n\n';
  body += 'Original estimate: ' + money(estTotal) + '\n';
  body += 'Final actual cost: ' + money(actualTotal) + '\n';
  body += (delta === 0 ? 'This matches your estimate; there is no change.\n\n' : (delta > 0 ? 'This is an increase of ' + money(delta) + ' from the estimate.\n\n' : 'This is a decrease of ' + money(Math.abs(delta)) + ' from the estimate.\n\n'));
  if (lines.length) body += 'The final cost is based on:\n' + lines.join('\n') + '\n\n';
  if (traceRel.length) body += 'How your total was determined:\n' + traceRel.map(function (t) { return '- ' + t.plainLine; }).join('\n') + '\n\n';
  if (waiverGranted) {
    body += 'These fees have been waived. No payment is required.\n\n';
  } else if (opts.paymentMode === 'erp') {
    body += 'You will receive an updated invoice and payment instructions in a separate communication from our finance office.\n\n';
  } else {
    var bal = opts.balanceDue;
    if (bal != null) {
      if (bal > 0.005) body += 'Balance now due: ' + money(bal) + '. Please submit payment so we can release your records.\n\n';
      else if (bal < -0.005) body += 'You have paid ' + money(Math.abs(bal)) + ' more than the final cost; a refund or credit will be arranged.\n\n';
      else body += 'Your balance is paid in full; your records will be released.\n\n';
    }
  }
  body += 'If you have any questions about this final cost, please reply to this message.\n\n';
  body += 'Sincerely,\n' + agency + ' - Open Records';
  return { subject: subject, text: body };
}

function buildDunningNotice(request, state, opts) {
  opts = opts || {};
  var name = request.requestor_name || 'Requestor', num = request.request_number || '', agency = opts.agencyName || 'the City';
  var bal = Number(state.balanceDue) || 0, closeBy = Number(state.closeByDays) || 15;
  var subject = 'Payment reminder \u2014 public records request' + (num ? ' ' + num : '');
  var body = 'Dear ' + name + ',\n\n';
  body += 'Our records show an outstanding balance of ' + money(bal) + ' on your public records request' + (num ? ' (' + num + ')' : '') + '.\n\n';
  body += 'Please submit payment to complete your request. If payment is not received within ' + closeBy + ' days, this request may be closed for nonpayment. A closed request can be reopened if you still wish to proceed.\n\n';
  body += 'If you have already paid, or have any questions, please reply to this message.\n\n';
  body += 'Sincerely,\n' + agency + ' - Open Records';
  return { subject: subject, text: body };
}

module.exports = { buildNotice: buildNotice, buildBalanceDueNotice: buildBalanceDueNotice, buildAdjustmentNotice: buildAdjustmentNotice, buildDunningNotice: buildDunningNotice, paymentLanguage: paymentLanguage };
