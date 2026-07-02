// feeNotice.paymenttiming.test.js - slice 3 requestor-language tests.
// Run: node scripts/feeNotice.paymenttiming.test.js
var notice = require('../src/services/feeNotice');
var pt = require('../src/services/paymentTiming');
var pass = 0, fail = 0;
function has(label, text, substr) {
  var ok = text.indexOf(substr) !== -1;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (ok ? '' : '  MISSING: <' + substr + '>'));
  ok ? pass++ : fail++;
}
function absent(label, text, substr) {
  var ok = text.indexOf(substr) === -1;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (ok ? '' : '  UNEXPECTED: <' + substr + '>'));
  ok ? pass++ : fail++;
}
function ctx(total){ return { requestLevel: { total: total, labor: [], duplication: [], media: [] } }; }
function req(){ return { request_number: 'PREVIEW', requestor_name: 'Sam Rivera' }; }

var TX = { estimateRequiredOver: 40, bands: [
  { upTo: 40, gate: 'invoice_on_completion', deliveryTrigger: 'invoice_on_completion' },
  { upTo: 100, gate: 'estimate_acceptance', deliveryTrigger: 'estimate_acceptance' },
  { upTo: null, gate: 'deposit_before_work', deliveryTrigger: 'deposit_before_work' } ],
  firstPayment: { basis: 'up_to_anticipated_cost', cap: 'estimate', dueWindow: { days: 10, unit: 'business', from: 'notice_sent', onExpiry: 'withdrawn' }, creditedToFinal: true },
  secondPayment: { basis: 'actual', terms: null }, delinquent: { depositPercent: 100 } };
var MI = { estimateRequiredOver: 50, bands: [
  { upTo: 50, gate: 'pay_in_full_before_release', deliveryTrigger: 'pay_in_full_before_release' },
  { upTo: null, gate: 'deposit_before_work', deliveryTrigger: 'deposit_before_work' } ],
  firstPayment: { basis: 'percent', percent: 50, cap: 'half_estimate', dueWindow: { days: 45, unit: 'calendar', from: 'notice_received', onExpiry: 'abandoned' }, creditedToFinal: true },
  secondPayment: { basis: 'actual', terms: 'due_before_release' }, delinquent: { depositPercent: 100 } };

// TX $250 deposit
var t1 = notice.buildNotice(req(), ctx(250), { paymentPlan: pt.resolvePaymentPlan(TX, { estimateTotal: 250 }) }).text;
has('TX250 up-to-full deposit', t1, 'A deposit of up to $250.00 (the full anticipated cost)');
has('TX250 credited', t1, 'credited toward your final invoice');
has('TX250 10 business days', t1, '10 business days');
has('TX250 withdrawn', t1, 'considered withdrawn');

// TX $70 acceptance
var t2 = notice.buildNotice(req(), ctx(70), { paymentPlan: pt.resolvePaymentPlan(TX, { estimateTotal: 70 }) }).text;
has('TX70 confirm-accept', t2, 'please confirm that you accept');
has('TX70 no up-front', t2, 'No payment is required up front');
absent('TX70 no deposit language', t2, 'A deposit');

// TX $30 invoice on completion
var t3 = notice.buildNotice(req(), ctx(30), { paymentPlan: pt.resolvePaymentPlan(TX, { estimateTotal: 30 }) }).text;
has('TX30 invoice on completion', t3, 'invoiced to you when the records are ready');

// MI $250 deposit percent, due-before-release, abandoned, notice_received
var m1 = notice.buildNotice(req(), ctx(250), { paymentPlan: pt.resolvePaymentPlan(MI, { estimateTotal: 250 }) }).text;
has('MI250 deposit $125', m1, 'A deposit of $125.00');
has('MI250 45 calendar days', m1, '45 days');
has('MI250 after you receive', m1, 'after you receive this notice');
has('MI250 abandoned', m1, 'considered abandoned');
has('MI250 balance before release', m1, 'must be paid before the records are released');

// MI $40 pay in full before release
var m2 = notice.buildNotice(req(), ctx(40), { paymentPlan: pt.resolvePaymentPlan(MI, { estimateTotal: 40 }) }).text;
has('MI40 pay in full before release', m2, 'must be paid in full before the records are released');

// Delinquent
var d1 = notice.buildNotice(req(), ctx(30), { paymentPlan: pt.resolvePaymentPlan(TX, { estimateTotal: 30, delinquent: true }) }).text;
has('delinquent language', d1, 'a previous request has an unpaid balance');

// Backward compat: no paymentPlan -> legacy behavior preserved
var legacy = notice.buildNotice(req(), { requestLevel: { total: 250, depositDue: 125, labor: [], duplication: [], media: [] } }, { responseDays: 10 }).text;
has('legacy deposit text', legacy, 'A deposit of $125.00 is required before we begin processing');
has('legacy responseDays', legacy, 'Please respond within 10 business days');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAILURES') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
