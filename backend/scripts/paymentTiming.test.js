// paymentTiming.test.js - slice 1 resolver tests. Run: node scripts/paymentTiming.test.js
// Seed configs reflect PRIMARY-SOURCE-VERIFIED values (TX, VA, MI) per
// FEE_ESTIMATE_VARIABLE_MAP.md section E (verification log 2026-07-01).
var pt = require('../src/services/paymentTiming');
var pass = 0, fail = 0;
function checkStr(label, got, want) {
  var ok = String(got) === String(want);
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + got + ' want=' + want);
  ok ? pass++ : fail++;
}
function checkNum(label, got, want) {
  var ok = (got == null && want == null) || Math.abs(Number(got) - Number(want)) < 0.005;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + got + ' want=' + want);
  ok ? pass++ : fail++;
}
function checkBool(label, got, want) {
  var ok = (!!got === !!want);
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + got + ' want=' + want);
  ok ? pass++ : fail++;
}

// ---- Verified seed configs ----
var TX = {
  estimateRequiredOver: 40,
  bands: [
    { upTo: 40,   gate: 'invoice_on_completion', deliveryTrigger: 'invoice_on_completion' },
    { upTo: 100,  gate: 'estimate_acceptance',    deliveryTrigger: 'estimate_acceptance' },
    { upTo: null, gate: 'deposit_before_work',    deliveryTrigger: 'deposit_before_work' }
  ],
  firstPayment: { basis: 'up_to_anticipated_cost', cap: 'estimate',
    dueWindow: { days: 10, unit: 'business', from: 'notice_sent', onExpiry: 'withdrawn' }, creditedToFinal: true },
  secondPayment: { basis: 'actual', terms: null },
  delinquent: { depositPercent: 100 }
};
var VA = {
  estimateRequiredOver: 'on_request',
  bands: [
    { upTo: 200,  gate: 'estimate_acceptance', deliveryTrigger: 'invoice_on_completion' },
    { upTo: null, gate: 'deposit_before_work', deliveryTrigger: 'deposit_before_work' }
  ],
  firstPayment: { basis: 'up_to_anticipated_cost', cap: 'estimate',
    dueWindow: { days: 30, unit: 'calendar', from: 'notice_sent', onExpiry: 'withdrawn' }, creditedToFinal: true },
  secondPayment: { basis: 'actual', terms: null },
  delinquent: { depositPercent: 100 }
};
var MI = {
  estimateRequiredOver: 50,
  bands: [
    { upTo: 50,   gate: 'pay_in_full_before_release', deliveryTrigger: 'pay_in_full_before_release' },
    { upTo: null, gate: 'deposit_before_work',        deliveryTrigger: 'deposit_before_work' }
  ],
  firstPayment: { basis: 'percent', percent: 50, cap: 'half_estimate',
    dueWindow: { days: 45, unit: 'calendar', from: 'notice_received', onExpiry: 'abandoned' }, creditedToFinal: true },
  secondPayment: { basis: 'actual', terms: 'due_before_release' },
  delinquent: { depositPercent: 100 }
};

// ---- TEXAS ----
var tx30 = pt.resolvePaymentPlan(TX, { estimateTotal: 30 });
checkBool('TX $30 estimateRequired (30<=40)', tx30.estimateRequired, false);
checkStr('TX $30 gate', tx30.gate, 'invoice_on_completion');
checkBool('TX $30 firstPayment.required', tx30.firstPayment.required, false);
checkStr('TX $30 deliveryTrigger', tx30.deliveryTrigger, 'invoice_on_completion');

var tx70 = pt.resolvePaymentPlan(TX, { estimateTotal: 70 });
checkStr('TX $70 gate', tx70.gate, 'estimate_acceptance');
checkBool('TX $70 firstPayment.required', tx70.firstPayment.required, false);
checkStr('TX $70 deliveryTrigger', tx70.deliveryTrigger, 'estimate_acceptance');

var tx250 = pt.resolvePaymentPlan(TX, { estimateTotal: 250 });
checkStr('TX $250 gate', tx250.gate, 'deposit_before_work');
checkBool('TX $250 firstPayment.required', tx250.firstPayment.required, true);
checkStr('TX $250 basis', tx250.firstPayment.basis, 'up_to_anticipated_cost');
checkNum('TX $250 amount (up to full)', tx250.firstPayment.amount, 250);
checkBool('TX $250 isCeiling', tx250.firstPayment.isCeiling, true);
checkNum('TX $250 dueWindow days', tx250.firstPayment.dueWindow.days, 10);
checkStr('TX $250 dueWindow unit', tx250.firstPayment.dueWindow.unit, 'business');
checkStr('TX $250 onExpiry', tx250.firstPayment.dueWindow.onExpiry, 'withdrawn');
checkBool('TX $250 creditedToFinal', tx250.firstPayment.creditedToFinal, true);
checkStr('TX $250 deliveryTrigger', tx250.deliveryTrigger, 'deposit_before_work');

// ---- VIRGINIA ----
var va150 = pt.resolvePaymentPlan(VA, { estimateTotal: 150 });
checkStr('VA $150 gate (<=200)', va150.gate, 'estimate_acceptance');
checkBool('VA $150 firstPayment.required', va150.firstPayment.required, false);
checkStr('VA $150 deliveryTrigger', va150.deliveryTrigger, 'invoice_on_completion');

var va250 = pt.resolvePaymentPlan(VA, { estimateTotal: 250 });
checkStr('VA $250 gate (>200)', va250.gate, 'deposit_before_work');
checkNum('VA $250 amount (up to full)', va250.firstPayment.amount, 250);
checkNum('VA $250 dueWindow days', va250.firstPayment.dueWindow.days, 30);
checkStr('VA $250 onExpiry', va250.firstPayment.dueWindow.onExpiry, 'withdrawn');
checkBool('VA $250 creditedToFinal', va250.firstPayment.creditedToFinal, true);

// ---- MICHIGAN ----
var mi40 = pt.resolvePaymentPlan(MI, { estimateTotal: 40 });
checkBool('MI $40 estimateRequired (40<=50)', mi40.estimateRequired, false);
checkStr('MI $40 gate', mi40.gate, 'pay_in_full_before_release');
checkBool('MI $40 firstPayment.required', mi40.firstPayment.required, false);
checkStr('MI $40 deliveryTrigger', mi40.deliveryTrigger, 'pay_in_full_before_release');

var mi250 = pt.resolvePaymentPlan(MI, { estimateTotal: 250 });
checkStr('MI $250 gate', mi250.gate, 'deposit_before_work');
checkStr('MI $250 basis', mi250.firstPayment.basis, 'percent');
checkNum('MI $250 amount (50%, cap half = 125)', mi250.firstPayment.amount, 125);
checkNum('MI $250 dueWindow days', mi250.firstPayment.dueWindow.days, 45);
checkStr('MI $250 from', mi250.firstPayment.dueWindow.from, 'notice_received');
checkStr('MI $250 onExpiry', mi250.firstPayment.dueWindow.onExpiry, 'abandoned');
checkStr('MI $250 secondPayment terms', mi250.secondPayment.terms, 'due_before_release');

// ---- Delinquency override (TX $30, normally no deposit) ----
var txDel = pt.resolvePaymentPlan(TX, { estimateTotal: 30, delinquent: true });
checkBool('TX $30 delinquent depositForced', txDel.depositForced, true);
checkStr('TX $30 delinquent gate', txDel.gate, 'deposit_before_work');
checkBool('TX $30 delinquent firstPayment.required', txDel.firstPayment.required, true);
checkNum('TX $30 delinquent amount (100% of 30)', txDel.firstPayment.amount, 30);

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAILURES') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
