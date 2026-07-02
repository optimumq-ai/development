var t = require('../src/services/tickler');
var f = 0; function ok(l, c){ console.log((c?'PASS ':'FAIL ')+l); if(!c) f++; }
function agoStr(days){ return new Date(Date.now()-days*86400000).toISOString().slice(0,19).replace('T',' '); }
var now = Date.now();

// windowFromPlan
var txPlan = { firstPayment: { dueWindow: { days: 10, unit: 'business', onExpiry: 'withdrawn' } } };
var w1 = t.windowFromPlan(txPlan, 21);
ok('plan window days=10', w1.days === 10);
ok('plan window unit=business', w1.unit === 'business');
ok('plan window onExpiry=withdrawn', w1.onExpiry === 'withdrawn');
ok('plan window fromPlan=true', w1.fromPlan === true);
var w2 = t.windowFromPlan({}, 21);
ok('fallback days=21', w2.days === 21 && w2.unit === 'calendar' && w2.fromPlan === false);
var w3 = t.windowFromPlan({ firstPayment: { dueWindow: { days: 45, unit: 'calendar', onExpiry: 'abandoned' } } }, 10);
ok('abandoned onExpiry', w3.onExpiry === 'abandoned' && w3.days === 45);

// overdue - calendar
ok('cal 12d ago > 10 -> overdue', t.overdue(agoStr(12), 10, 'calendar', now) === true);
ok('cal 8d ago > 10 -> not', t.overdue(agoStr(8), 10, 'calendar', now) === false);
ok('null anchor -> not overdue', t.overdue(null, 10, 'calendar', now) === false);
// overdue - business (10 business ~ 14 calendar)
ok('biz 20d ago > 10biz -> overdue', t.overdue(agoStr(20), 10, 'business', now) === true);
ok('biz 10d ago > 10biz -> not', t.overdue(agoStr(10), 10, 'business', now) === false);

console.log('\n' + (f===0?'ALL PASS':'FAIL') + ' fail='+f); process.exit(f?1:0);
