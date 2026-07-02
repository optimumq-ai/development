const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { get } = require('../db');
const engine = require('../services/feeEngine');
const pt = require('../services/paymentTiming');

function num(x) { x = Number(x); return isFinite(x) ? x : 0; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// POST /api/fee-sandbox/preview - run the REAL fee engine on hypothetical inputs (no persistence).
// Lets a reviewer validate fee/estimate behavior (waiver, extra costs, min/max, deposit, payment)
// against the live config before approving the Fees phase. Same code path as a real estimate.
router.post('/preview', requireAuth, async function (req, res) {
  const jrow = await get("SELECT value FROM system_config WHERE key='jurisdiction_profile'");
  const jid = jrow && jrow.value;
  const prof = await get("SELECT * FROM fee_profiles WHERE jurisdiction_id = ? AND context = 'FR' ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, version DESC LIMIT 1", [jid]);
  if (!prof) return res.status(400).json({ error: 'No fee profile is configured for the active jurisdiction yet.' });
  let config; try { config = JSON.parse(prof.config_json || '{}'); } catch (e) { config = {}; }
  const b = req.body || {};
  const q = b.quantities || {};
  const request = {
    components: [{ id: 'sandbox', recordType: b.recordTypeId || 'sandbox', quantities: {
      searchHours: num(q.searchHours), reviewHours: num(q.reviewHours), programmingHours: num(q.programmingHours),
      bwPages: num(q.bwPages), colorPages: num(q.colorPages), oversizedPages: num(q.oversizedPages)
    } }],
    delivery: (b.delivery && b.delivery.method) ? b.delivery : { method: 'email' },
    certification: (b.certification && num(b.certification.count) > 0) ? { count: num(b.certification.count) } : null,
    other: (b.other && num(b.other.amount) !== 0) ? { amount: num(b.other.amount), description: b.other.description || 'Extra cost' } : null,
    purpose: b.purpose || null
  };
  const fc = engine.compute(config, request);
  const rl = fc.requestLevel;
  const waived = !!b.waived;
  const effectiveTotal = waived ? 0 : rl.total;
  const payment = num(b.payment);
  const depositDue = waived ? 0 : num(rl.depositDue);

  // --- Payment & delivery plan (read-only; slice 2). Additive: does not alter the fields above. ---
  const hasProfilePT = !!(config.paymentTiming && Object.keys(config.paymentTiming).length);
  const ptConfig = hasProfilePT ? config.paymentTiming : pt.deriveDefaultPaymentTiming(config);
  const paymentPlan = pt.resolvePaymentPlan(ptConfig, {
    estimateTotal: effectiveTotal,
    delinquent: !!b.delinquent,
    commercial: (request.purpose === 'commercial')
  });

  res.json({
    configVersion: prof.version,
    requestLevel: rl,
    computedTotal: rl.total,
    flags: { floorApplied: rl.floorApplied, ceilingApplied: rl.ceilingApplied, deMinimisWaived: rl.deMinimisWaived },
    waived: waived,
    effectiveTotal: effectiveTotal,
    deposit: { required: depositDue, basis: rl.depositBasis, satisfiedByPayment: payment >= depositDue },
    payment: { entered: payment, balanceDue: r2(Math.max(0, effectiveTotal - payment)) },
    paymentPlan: paymentPlan,
    paymentTimingSource: hasProfilePT ? 'profile' : 'derived'
  });
});

module.exports = router;
