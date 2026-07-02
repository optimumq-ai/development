'use strict';
// Release gate (4d): given a request id, resolve its estimate's payment plan + balance and report
// whether records may be released. Read-only. Consumed by the stage-advance endpoint; fails open
// (the caller treats any error as "no gate") so a gate fault can never block unrelated transitions.
var db = require('../db');
var pt = require('./paymentTiming');

async function releaseGate(rid) {
  var est = await db.get("SELECT * FROM request_fee_estimates WHERE request_id = ? AND kind = 'estimate' ORDER BY created_at DESC LIMIT 1", [rid]);
  if (!est) return { hasEstimate: false, requiresPaymentBeforeRelease: false, paidInFull: true, balanceDue: 0, plan: null, paymentInstructions: null };
  var prof = est.config_profile_id
    ? await db.get('SELECT config_json FROM fee_profiles WHERE id = ?', [est.config_profile_id])
    : await db.get("SELECT config_json FROM fee_profiles WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1");
  var cfg = {}; try { cfg = JSON.parse((prof && prof.config_json) || '{}'); } catch (e) { cfg = {}; }
  var ptCfg = (cfg.paymentTiming && Object.keys(cfg.paymentTiming).length) ? cfg.paymentTiming : pt.deriveDefaultPaymentTiming(cfg);
  var plan = pt.resolvePaymentPlan(ptCfg, { estimateTotal: Number(est.total) || 0 });
  var recon = await db.get("SELECT total FROM request_fee_estimates WHERE request_id = ? AND kind = 'reconciliation' ORDER BY created_at DESC LIMIT 1", [rid]);
  var effectiveTotal = (recon && recon.total != null) ? Number(recon.total) : (Number(est.total) || 0);
  var bal = pt.computeBalance(effectiveTotal, est.deposit_paid_amount, est.final_paid_amount);
  return {
    hasEstimate: true,
    requiresPaymentBeforeRelease: pt.requiresPaymentBeforeRelease(plan),
    paidInFull: bal.paidInFull, balanceDue: bal.balanceDue, effectiveTotal: bal.effectiveTotal,
    plan: plan, paymentInstructions: cfg.paymentInstructions || null
  };
}
module.exports = { releaseGate: releaseGate };
