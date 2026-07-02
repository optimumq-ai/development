var pt=require('../src/services/paymentTiming');
var fn=require('../src/services/feeNotice');
var f=0;function ok(l,c){console.log((c?'PASS ':'FAIL ')+l);if(!c)f++;}
// requiresPaymentBeforeRelease
ok('pay_in_full -> true', pt.requiresPaymentBeforeRelease({deliveryTrigger:'pay_in_full_before_release'})===true);
ok('due_before_release terms -> true', pt.requiresPaymentBeforeRelease({deliveryTrigger:'deposit_before_work',secondPayment:{terms:'due_before_release'}})===true);
ok('TX deposit (no terms) -> false', pt.requiresPaymentBeforeRelease({deliveryTrigger:'deposit_before_work',secondPayment:{terms:null}})===false);
ok('invoice_on_completion -> false', pt.requiresPaymentBeforeRelease({deliveryTrigger:'invoice_on_completion'})===false);
ok('null plan -> false', pt.requiresPaymentBeforeRelease(null)===false);
// buildBalanceDueNotice
var n1=fn.buildBalanceDueNotice({request_number:'2026-9',requestor_name:'Lee'},{balanceDue:125},{agencyName:'City of X',paymentInstructions:{onlineUrl:'https://pay.x.gov/abc',mailText:'Check to City of X, 1 Main St',walkInText:'City Hall, Rm 100, 8-5 M-F'}});
ok('balance shown', n1.text.indexOf('$125.00')!==-1);
ok('online instr', n1.text.indexOf('https://pay.x.gov/abc')!==-1);
ok('mail instr', n1.text.indexOf('By mail: Check to City of X')!==-1);
ok('walkin instr', n1.text.indexOf('In person: City Hall')!==-1);
ok('ready language', n1.text.indexOf('is complete and your records are ready')!==-1);
var n2=fn.buildBalanceDueNotice({requestor_name:'Lee'},{balanceDue:40},{agencyName:'City of X'});
ok('no instr -> omits How to pay', n2.text.indexOf('How to pay')===-1 && n2.text.indexOf('$40.00')!==-1);
console.log('\n'+(f===0?'ALL PASS':'FAIL')+' fail='+f);process.exit(f?1:0);
