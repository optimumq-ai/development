// paymentTiming.derive.test.js - slice 2 derive-from-legacy-config tests.
// Run: node scripts/paymentTiming.derive.test.js
var pt = require('../src/services/paymentTiming');
var pass = 0, fail = 0;
function checkStr(l, g, w){var ok=String(g)===String(w);console.log((ok?'PASS ':'FAIL ')+l+'  got='+g+' want='+w);ok?pass++:fail++;}
function checkNum(l, g, w){var ok=(g==null&&w==null)||Math.abs(Number(g)-Number(w))<0.005;console.log((ok?'PASS ':'FAIL ')+l+'  got='+g+' want='+w);ok?pass++:fail++;}
function checkBool(l, g, w){var ok=(!!g===!!w);console.log((ok?'PASS ':'FAIL ')+l+'  got='+g+' want='+w);ok?pass++:fail++;}

// Legacy TX-shaped profile config (estimate-notify + deposit threshold/percent), no paymentTiming block.
var legacy = { requestRules: { estimateNotifyThreshold: 40, deposit: { threshold: 100, percent: 50 } } };
var d = pt.deriveDefaultPaymentTiming(legacy);
checkBool('derived flag', d._derived, true);
checkNum('derived band count', d.bands.length, 3);
checkStr('derived firstPayment basis (percent from legacy)', d.firstPayment.basis, 'percent');
checkNum('derived firstPayment percent', d.firstPayment.percent, 50);

var p30 = pt.resolvePaymentPlan(d, { estimateTotal: 30 });
checkStr('derived $30 gate', p30.gate, 'invoice_on_completion');
checkBool('derived $30 estimateRequired', p30.estimateRequired, false);

var p70 = pt.resolvePaymentPlan(d, { estimateTotal: 70 });
checkStr('derived $70 gate', p70.gate, 'estimate_acceptance');
checkBool('derived $70 estimateRequired (>40)', p70.estimateRequired, true);

var p250 = pt.resolvePaymentPlan(d, { estimateTotal: 250 });
checkStr('derived $250 gate', p250.gate, 'deposit_before_work');
checkNum('derived $250 deposit (50% legacy policy = 125)', p250.firstPayment.amount, 125);
checkStr('derived $250 dueWindowText (unknown -> null)', p250.firstPayment.dueWindowText, 'null');

// Legacy with only a deposit threshold, no percent -> up_to_anticipated_cost, 2 bands.
var legacy2 = { requestRules: { deposit: { threshold: 200 } } };
var d2 = pt.deriveDefaultPaymentTiming(legacy2);
checkNum('derived2 band count', d2.bands.length, 2);
checkStr('derived2 firstPayment basis', d2.firstPayment.basis, 'up_to_anticipated_cost');
var d2p = pt.resolvePaymentPlan(d2, { estimateTotal: 250 });
checkNum('derived2 $250 amount (up to full)', d2p.firstPayment.amount, 250);

// Empty config -> single invoice-on-completion band, nothing required.
var d3 = pt.deriveDefaultPaymentTiming({});
checkNum('derived3 band count', d3.bands.length, 1);
var d3p = pt.resolvePaymentPlan(d3, { estimateTotal: 999 });
checkStr('derived3 gate', d3p.gate, 'invoice_on_completion');
checkBool('derived3 firstPayment.required', d3p.firstPayment.required, false);

console.log('\n' + (fail===0?'ALL PASS':'HAS FAILURES') + '  pass='+pass+' fail='+fail);
process.exit(fail===0?0:1);
