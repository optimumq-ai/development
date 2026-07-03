var engine=require('../src/services/feeEngine');
var fails=0;
function rl(res){ return res.requestLevel; }
function tr(res,rule){ return rl(res).rulesTrace.find(function(t){return t.rule===rule;}); }
function ok(label,cond){ console.log((cond?'PASS ':'FAIL ')+label); if(!cond)fails++; }
function prof(rules){ return { context:'FR', labor:{}, duplication:{}, requestRules: rules }; }
function req(amt){ return { components:[], other:{ amount:amt, description:'test' } }; }

var FULL={ minFee:40, maxFee:500, deMinimis:5, freePageAllowance:0, freeLaborHours:0, deposit:{threshold:100,percent:50}, estimateNotifyThreshold:200 };

// A) subtotal 12 -> floor applies (raised to 40)
var A=engine.compute(prof(FULL), req(12));
ok('A total = 40 (floor)', rl(A).total===40);
ok('A min_fee applied', tr(A,'min_fee').applied===true && tr(A,'min_fee').configuredValue===40);
ok('A max_fee configured, not applied', tr(A,'max_fee').configured===true && tr(A,'max_fee').applied===false);
ok('A de_minimis not applied', tr(A,'de_minimis').applied===false);
ok('A deposit not applied (40<100)', tr(A,'deposit').applied===false);
ok('A notify not applied', tr(A,'estimate_notify').applied===false);
console.log('   min_fee line: '+tr(A,'min_fee').plainLine);

// B) subtotal 250 -> floor not applied, deposit applies (125), notify applies
var B=engine.compute(prof(FULL), req(250));
ok('B total = 250', rl(B).total===250);
ok('B min_fee configured, not applied', tr(B,'min_fee').configured===true && tr(B,'min_fee').applied===false);
ok('B deposit applied', tr(B,'deposit').applied===true && /125\.00/.test(tr(B,'deposit').plainLine));
ok('B notify applied', tr(B,'estimate_notify').applied===true);
console.log('   deposit line: '+tr(B,'deposit').plainLine);
console.log('   max_fee (not reached) line: '+tr(B,'max_fee').plainLine);

// C) no rules configured -> all "not configured"
var C=engine.compute(prof({}), req(100));
ok('C min_fee not configured', tr(C,'min_fee').configured===false);
ok('C max_fee not configured', tr(C,'max_fee').configured===false);
ok('C de_minimis not configured', tr(C,'de_minimis').configured===false);
ok('C deposit not configured', tr(C,'deposit').configured===false);
ok('C notify not configured', tr(C,'estimate_notify').configured===false);
console.log('   deposit (none) line: '+tr(C,'deposit').plainLine);

// D) de minimis waives to 0
var D=engine.compute(prof({ deMinimis:15 }), req(10));
ok('D total waived to 0', rl(D).total===0);
ok('D de_minimis applied', tr(D,'de_minimis').applied===true);
console.log('   de_minimis line: '+tr(D,'de_minimis').plainLine);

// E) trace always has all 7 rules
var rules=rl(A).rulesTrace.map(function(t){return t.rule;});
ok('E all rules present', ['free_allowances','surcharge','min_fee','max_fee','de_minimis','deposit','estimate_notify'].every(function(r){return rules.indexOf(r)>=0;}));

console.log('\n'+(fails===0?'ALL PASS':('FAIL count='+fails)));
process.exit(fails?1:0);
