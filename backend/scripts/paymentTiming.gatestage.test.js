var pt=require('../src/services/paymentTiming');
var f=0;function eq(l,g,w){var ok=g===w;console.log((ok?'PASS ':'FAIL ')+l+' got='+g+' want='+w);if(!ok)f++;}
eq('deposit_before_work->awaiting_payment', pt.gateToStage('deposit_before_work'),'awaiting_payment');
eq('estimate_acceptance->record_search', pt.gateToStage('estimate_acceptance'),'record_search');
eq('invoice_on_completion->record_search', pt.gateToStage('invoice_on_completion'),'record_search');
eq('pay_in_full_before_release->record_search', pt.gateToStage('pay_in_full_before_release'),'record_search');
eq('unknown->record_search', pt.gateToStage('weird'),'record_search');
console.log('\n'+(f===0?'ALL PASS':'FAIL')+' fail='+f);process.exit(f?1:0);
