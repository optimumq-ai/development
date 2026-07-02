const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../src/db');
const fs = require('fs');
const TX_PT = {
  estimateRequiredOver: 40,
  bands: [
    { upTo: 40,   gate: 'invoice_on_completion', deliveryTrigger: 'invoice_on_completion' },
    { upTo: 100,  gate: 'estimate_acceptance',    deliveryTrigger: 'estimate_acceptance' },
    { upTo: null, gate: 'deposit_before_work',    deliveryTrigger: 'deposit_before_work' }
  ],
  firstPayment: { basis: 'up_to_anticipated_cost', cap: 'estimate',
    dueWindow: { days: 10, unit: 'business', from: 'notice_sent', onExpiry: 'withdrawn' }, creditedToFinal: true },
  secondPayment: { basis: 'actual', terms: null },
  delinquent: { depositPercent: 100 },
  _verified: 'TX primary sources 2026-07-01 (see FEE_ESTIMATE_VARIABLE_MAP section E)'
};
(async () => {
  await db.initDb();
  const jrow = await db.get("SELECT value FROM system_config WHERE key='jurisdiction_profile'");
  const jid = jrow && jrow.value;
  const prof = await db.get("SELECT id, version, status, config_json FROM fee_profiles WHERE jurisdiction_id = ? AND context = 'FR' ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, version DESC LIMIT 1", [jid]);
  if (!prof) { console.error('No active FR profile'); process.exit(1); }
  const bak = '/opt/optimumq/backups/fee_profile_' + prof.id + '_config.bak-20260701.json';
  fs.writeFileSync(bak, prof.config_json || '{}');
  console.log('backup written:', bak, '(' + (prof.config_json || '').length + ' bytes)');
  let cfg = {}; try { cfg = JSON.parse(prof.config_json || '{}'); } catch (e) {}
  const had = !!cfg.paymentTiming;
  cfg.paymentTiming = TX_PT;
  await db.run("UPDATE fee_profiles SET config_json = ? WHERE id = ?", [JSON.stringify(cfg), prof.id]);
  const check = await db.get("SELECT config_json FROM fee_profiles WHERE id = ?", [prof.id]);
  const nc = JSON.parse(check.config_json);
  console.log('profile id=' + prof.id + ' v' + prof.version + ' status=' + prof.status + ' (paymentTiming existed before: ' + had + ')');
  console.log('paymentTiming now present:', !!nc.paymentTiming, '| bands:', nc.paymentTiming.bands.length, '| firstPayment.basis:', nc.paymentTiming.firstPayment.basis);
  console.log('top-level config keys:', Object.keys(nc).join(','));
  process.exit(0);
})().catch(e => { console.error('ERR', (e && (e.stack || e.message)) || e); process.exit(1); });
