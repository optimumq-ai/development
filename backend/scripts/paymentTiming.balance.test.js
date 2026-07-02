var pt=require('../src/services/paymentTiming');var f=0;
function j(l,g,w){var ok=JSON.stringify(g)===JSON.stringify(w);console.log((ok?'PASS ':'FAIL ')+l+(ok?'':' got='+JSON.stringify(g)));if(!ok)f++;}
j('no payments: $250 est', pt.computeBalance(250,0,0), {effectiveTotal:250,paid:0,balanceDue:250,paidInFull:false});
j('deposit 125 of 250', pt.computeBalance(250,125,0), {effectiveTotal:250,paid:125,balanceDue:125,paidInFull:false});
j('deposit 125 + final 125 = paid', pt.computeBalance(250,125,125), {effectiveTotal:250,paid:250,balanceDue:0,paidInFull:true});
j('overpaid', pt.computeBalance(250,200,100), {effectiveTotal:250,paid:300,balanceDue:0,paidInFull:true});
j('reconciled actual lower (200) deposit 125', pt.computeBalance(200,125,0), {effectiveTotal:200,paid:125,balanceDue:75,paidInFull:false});
j('zero (waived)', pt.computeBalance(0,0,0), {effectiveTotal:0,paid:0,balanceDue:0,paidInFull:true});
console.log('\n'+(f===0?'ALL PASS':'FAIL')+' fail='+f);process.exit(f?1:0);
