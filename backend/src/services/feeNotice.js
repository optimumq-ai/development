// Requestor-facing fee estimate notice. Renders a saved feeContext into PLAIN LANGUAGE for the
// requester - deliberately distinct from the staff worksheet: no internal labels (no "gross
// subtotal", "ceiling applied", component internals, or handling-tier names). Deterministic text;
// staff review/edit before it is sent.

function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
function hrLabel(n) { n = Number(n) || 0; return n + (n === 1 ? ' hour' : ' hours'); }

var LABOR_LABEL = { search_labor: 'Staff time to locate and compile records', review_labor: 'Staff time to review and prepare records', programming_labor: 'Programming / data extraction time' };
var DUP_LABEL = { dup_bw: 'Black-and-white copies', dup_color: 'Color copies', dup_oversized: 'Oversized copies' };

function buildNotice(request, feeContext, opts) {
  opts = opts || {};
  var R = (feeContext && feeContext.requestLevel) || {};
  var agency = opts.agencyName || 'the City';
  var num = request.request_number || '';
  var name = request.requestor_name || 'Requestor';
  var total = (R.total != null ? R.total : 0);

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

  var subject = 'Cost estimate for your public records request' + (num ? ' ' + num : '');
  var body = '';
  body += 'Dear ' + name + ',\n\n';
  body += 'Thank you for your public records request' + (num ? ' (' + num + ')' : '') + '. We have reviewed it and prepared an estimate of the cost to fulfill it.\n\n';
  body += 'Estimated cost: ' + money(total) + '\n\n';
  if (lines.length) body += 'This estimate is based on:\n' + lines.join('\n') + '\n\n';
  if (R.depositDue && R.depositDue > 0) body += 'A deposit of ' + money(R.depositDue) + ' is required before we begin processing. Once it is received we will proceed, and any remaining balance will be due upon completion.\n\n';
  else body += 'Please confirm you would like us to proceed at this estimated cost.\n\n';
  if (opts.responseDays) body += 'Please respond within ' + opts.responseDays + ' business days, or this request may be considered withdrawn.\n\n';
  body += 'This is an estimate; the final cost may differ based on the records actually located and the time required. Any item shown as "actual cost to be determined" will be calculated once known. If you have questions, or would like to narrow your request to reduce the cost, please reply to this message.\n\n';
  body += 'Sincerely,\n' + agency + ' - Open Records';

  return { subject: subject, text: body };
}

module.exports = { buildNotice: buildNotice };
