var engine = require('../src/services/feeEngine');
var pass = 0, fail = 0;
function check(label, got, want) {
  var ok = Math.abs(Number(got) - Number(want)) < 0.005;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + got + ' want=' + want);
  if (ok) pass++; else fail++;
}
function checkBool(label, got, want) {
  var ok = (!!got === !!want);
  console.log((ok ? 'PASS ' : 'FAIL ') + label + '  got=' + got + ' want=' + want);
  if (ok) pass++; else fail++;
}

// ---- Texas-flavored example FR config (illustrative; figures to be verified) ----
var TX = {
  context: 'FR', version: 1,
  labor: { search: { rate: 15, increment: 0, rounding: 'up' }, review: { rate: 15, increment: 0 }, programming: { rate: 28.5, increment: 0 } },
  duplication: { bw: { rate: 0.10 }, color: { rate: 0.50 }, oversized: { rate: 0.50 } },
  media: { cd: 1.00, dvd: 3.00, usb: 'actual' },
  delivery: { email: 0, mail: 'actual', handling: 0 },
  certification: { rate: 0, unit: 'per_record' },
  requestRules: { freePageAllowance: 0, freeLaborHours: 0, deMinimis: 0, minFee: 0, maxFee: null, deposit: { threshold: 100, percent: 50 }, estimateNotifyThreshold: 40 }
};

// Case 1: single component (master-of-one): 2h search + 100 bw + 1 CD
var r1 = engine.compute(TX, { components: [{ label: 'Permit file', quantities: { searchHours: 2, bwPages: 100, media: [{ type: 'cd', count: 1 }] } }] });
check('1 grossSubtotal', r1.requestLevel.grossSubtotal, 41);
check('1 total', r1.requestLevel.total, 41);
check('1 depositDue (41<100 -> 0)', r1.requestLevel.depositDue, 0);
checkBool('1 notify (41>40)', r1.requestLevel.estimateNotifyTriggered, true);

// Case 2: TWO components, free 50 pages + max fee $20 -> cap applied at PARENT on aggregate
var TX2 = JSON.parse(JSON.stringify(TX));
TX2.requestRules.freePageAllowance = 50; TX2.requestRules.maxFee = 20;
var r2c = engine.compute(TX2, { components: [
  { label: 'A', quantities: { searchHours: 1, bwPages: 40 } },
  { label: 'B', quantities: { bwPages: 40, oversizedPages: 10 } }
] });
check('2 grossSubtotal (19+9)', r2c.requestLevel.grossSubtotal, 28);
check('2 adjustedSubtotal (15 + 30bw*.1=3 + 10os*.5=5)', r2c.requestLevel.adjustedSubtotal, 23);
check('2 total (capped to 20)', r2c.requestLevel.total, 20);
checkBool('2 ceilingApplied', r2c.requestLevel.ceilingApplied, true);

// Case 3: de minimis waive ($3 <= $5 -> 0)
var TX3 = JSON.parse(JSON.stringify(TX)); TX3.requestRules.deMinimis = 5;
var r3 = engine.compute(TX3, { components: [{ quantities: { bwPages: 30 } }] });
check('3 total (waived)', r3.requestLevel.total, 0);
checkBool('3 deMinimisWaived', r3.requestLevel.deMinimisWaived, true);

// Case 4: free labor hours (10h, 8 free -> 2 billable * 15 = 30)
var TX4 = JSON.parse(JSON.stringify(TX)); TX4.requestRules.freeLaborHours = 8;
var r4t = engine.compute(TX4, { components: [{ quantities: { searchHours: 10 } }] });
check('4 total (2 billable hrs)', r4t.requestLevel.total, 30);

// Case 5: deposit (total 200 > 100 -> 50% = 100)
var r5 = engine.compute(TX, { components: [{ quantities: { bwPages: 2000 } }] });
check('5 total', r5.requestLevel.total, 200);
check('5 depositDue (50% of 200)', r5.requestLevel.depositDue, 100);

// Case 6: quarter-hour increment rounding UP (1.1h -> 1.25h * 15 = 18.75)
var TX6 = JSON.parse(JSON.stringify(TX)); TX6.labor.search.increment = 0.25; TX6.labor.search.rounding = 'up';
var r6 = engine.compute(TX6, { components: [{ quantities: { searchHours: 1.1 } }] });
check('6 total (1.1h ->1.25h @15)', r6.requestLevel.total, 18.75);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
