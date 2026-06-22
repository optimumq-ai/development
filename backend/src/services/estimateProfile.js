'use strict';
// Record-type ESTIMATION PROFILE + automated-vs-manual decision.
// Profiles store expected QUANTITIES (the same vocabulary feeEngine prices); the city's rate
// config turns them into dollars. A profile is built three ways (all feed the same record):
//   - human-expert seed (set once per record type)
//   - historical actuals written back from completed requests (running mean + variance)
//   - (future) sampling at taxonomy discovery
// assess() decides whether a request of a given type can be auto-estimated, or needs a human,
// using confidence (sample size + variance) and dollar bounds. Deterministic + explainable.
var db = require('../db');
var engine = require('./feeEngine');

// Driver quantity fields we track for variance/confidence (scalar numerics).
var DRIVERS = ['searchHours','reviewHours','programmingHours','bwPages','colorPages','oversizedPages'];

// POLICY knobs (defaults; intended to live on the Jurisdiction Profile later).
var POLICY = { minSample: 3, maxCV: 0.5, highDollar: 200 };

function parse(s, d){ try { var v = JSON.parse(s); return v == null ? d : v; } catch(e){ return d; } }
function num(x){ x = Number(x); return isFinite(x) ? x : 0; }
function nowStr(){ return new Date().toISOString().replace('T',' ').slice(0,19); }

async function getRow(recordTypeId){
  return await db.get('SELECT * FROM record_type_estimate_profiles WHERE record_type_id = ?', [recordTypeId]);
}

// Per-driver {mean,std,cv,n} computed from the Welford stats.
function driverStats(statsObj){
  var out = {};
  DRIVERS.forEach(function(f){
    var st = statsObj[f] || { n:0, mean:0, M2:0 };
    var n = num(st.n), mean = num(st.mean);
    var variance = n > 1 ? st.M2 / (n - 1) : 0;
    var std = Math.sqrt(Math.max(0, variance));
    var cv = mean > 0 ? std / mean : 0;
    out[f] = { n:n, mean: Math.round(mean*100)/100, std: Math.round(std*100)/100, cv: Math.round(cv*1000)/1000 };
  });
  return out;
}

// Confidence: 'none' (no profile), 'seeded' (expert seed, little/no data), 'high' (enough low-variance data), 'low'.
function confidenceOf(row){
  if (!row) return { level:'none', reasons:['No estimation profile exists for this record type.'], drivers:{} };
  var stats = parse(row.stats_json, {});
  var drivers = driverStats(stats);
  var n = num(row.sample_size);
  var seed = !!row.has_expert_seed;
  // worst coefficient of variation among drivers that actually have data and a nonzero mean
  var maxCV = 0;
  DRIVERS.forEach(function(f){ if (drivers[f].n > 1 && drivers[f].mean > 0) maxCV = Math.max(maxCV, drivers[f].cv); });
  var reasons = [];
  if (!seed && n === 0) return { level:'none', reasons:['No expert seed and no completed requests yet.'], drivers: drivers, maxCV: 0 };
  if (n >= POLICY.minSample && maxCV <= POLICY.maxCV){
    reasons.push('Based on ' + n + ' completed request(s); low variance (max CV ' + maxCV.toFixed(2) + ' <= ' + POLICY.maxCV + ').');
    return { level:'high', reasons: reasons, drivers: drivers, maxCV: maxCV };
  }
  if (n >= POLICY.minSample && maxCV > POLICY.maxCV){
    reasons.push('Historical spread is high (max CV ' + maxCV.toFixed(2) + ' > ' + POLICY.maxCV + '); a single request is hard to predict from the average.');
    return { level:'low', reasons: reasons, drivers: drivers, maxCV: maxCV };
  }
  if (seed){
    reasons.push('Using the expert-seeded estimate' + (n>0 ? ' (' + n + ' completed request(s) so far, below the ' + POLICY.minSample + ' needed to rely on history).' : '.'));
    return { level:'seeded', reasons: reasons, drivers: drivers, maxCV: maxCV };
  }
  reasons.push('Only ' + n + ' completed request(s) so far; need ' + POLICY.minSample + ' before the average is reliable.');
  return { level:'low', reasons: reasons, drivers: drivers, maxCV: maxCV };
}

async function getProfile(recordTypeId){
  var row = await getRow(recordTypeId);
  var conf = confidenceOf(row);
  return {
    recordTypeId: recordTypeId,
    exists: !!row,
    quantities: row ? parse(row.quantities_json, {}) : {},
    sampleSize: row ? num(row.sample_size) : 0,
    hasExpertSeed: row ? !!row.has_expert_seed : false,
    source: row ? row.source : null,
    notes: row ? row.notes : null,
    seededBy: row ? row.seeded_by : null,
    updatedAt: row ? row.updated_at : null,
    confidence: conf
  };
}

// Expert seed: set the expected quantities directly.
async function seedProfile(recordTypeId, quantities, userName, notes){
  quantities = quantities || {};
  var existing = await getRow(recordTypeId);
  var source = existing && num(existing.sample_size) > 0 ? 'mixed' : 'human-expert';
  if (existing){
    await db.run('UPDATE record_type_estimate_profiles SET quantities_json = ?, has_expert_seed = 1, source = ?, notes = ?, seeded_by = ?, seeded_at = ?, updated_at = ? WHERE record_type_id = ?',
      [JSON.stringify(quantities), source, notes || existing.notes || null, userName || null, nowStr(), nowStr(), recordTypeId]);
  } else {
    await db.run('INSERT INTO record_type_estimate_profiles (record_type_id, quantities_json, stats_json, sample_size, has_expert_seed, source, notes, seeded_by, seeded_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [recordTypeId, JSON.stringify(quantities), '{}', 0, 1, 'human-expert', notes || null, userName || null, nowStr(), nowStr()]);
  }
  return await getProfile(recordTypeId);
}

// Fold one completed request's ACTUAL quantities into the running profile (Welford).
async function recordActuals(recordTypeId, actuals){
  actuals = actuals || {};
  var row = await getRow(recordTypeId);
  var stats = row ? parse(row.stats_json, {}) : {};
  DRIVERS.forEach(function(f){
    var x = num(actuals[f]);
    var st = stats[f] || { n:0, mean:0, M2:0 };
    st.n += 1; var delta = x - st.mean; st.mean += delta / st.n; var delta2 = x - st.mean; st.M2 += delta * delta2;
    stats[f] = st;
  });
  var n = (row ? num(row.sample_size) : 0) + 1;
  // quantities = historical means for drivers (carry any non-driver fields like media from the seed)
  var quantities = row ? parse(row.quantities_json, {}) : {};
  DRIVERS.forEach(function(f){ quantities[f] = Math.round(stats[f].mean * 100) / 100; });
  var hadSeed = row ? !!row.has_expert_seed : false;
  var source = hadSeed ? 'mixed' : 'historical';
  if (row){
    await db.run('UPDATE record_type_estimate_profiles SET quantities_json = ?, stats_json = ?, sample_size = ?, source = ?, updated_at = ? WHERE record_type_id = ?',
      [JSON.stringify(quantities), JSON.stringify(stats), n, source, nowStr(), recordTypeId]);
  } else {
    await db.run('INSERT INTO record_type_estimate_profiles (record_type_id, quantities_json, stats_json, sample_size, has_expert_seed, source, updated_at) VALUES (?,?,?,?,?,?,?)',
      [recordTypeId, JSON.stringify(quantities), JSON.stringify(stats), n, 0, 'historical', nowStr()]);
  }
  return await getProfile(recordTypeId);
}

async function activeJurisdiction(){
  var row = await db.get("SELECT value FROM system_config WHERE key = 'jurisdiction_profile'");
  return (row && row.value) || 'jur-tx';
}
async function activeFeeConfig(jid){
  var row = await db.get("SELECT * FROM fee_profiles WHERE jurisdiction_id = ? AND context = 'FR' ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, version DESC LIMIT 1", [jid]);
  if (!row) return null;
  return parse(row.config_json, {});
}

function priceQuantities(config, recordTypeId, quantities){
  var feeContext = engine.compute(config || {}, { components: [{ id: recordTypeId, recordType: recordTypeId, quantities: quantities || {} }], delivery: { method: 'email' } });
  return feeContext && feeContext.requestLevel ? feeContext.requestLevel : { total: 0, depositDue: 0 };
}

// THE decision node: automated estimate or manual?
async function assess(recordTypeId, opts){
  opts = opts || {};
  var prof = await getProfile(recordTypeId);
  var level = prof.confidence.level;
  var reasons = prof.confidence.reasons.slice();
  if (level === 'none' || level === 'low'){
    return { decision:'manual', confidence: level, basis: null, quantities: prof.quantities, estimatedTotal: null, depositDue: null, reasons: reasons, drivers: prof.confidence.drivers };
  }
  // automatable -> price it
  var jid = opts.jurisdictionId || await activeJurisdiction();
  var config = opts.config || await activeFeeConfig(jid);
  if (!config){
    return { decision:'manual', confidence: level, basis: null, quantities: prof.quantities, estimatedTotal: null, depositDue: null, reasons: reasons.concat(['No fee configuration for the active jurisdiction; cannot price automatically.']), drivers: prof.confidence.drivers };
  }
  var R = priceQuantities(config, recordTypeId, prof.quantities);
  var total = num(R.total);
  var basis = level === 'seeded' ? 'human-expert seed' : 'historical actuals (n=' + prof.sampleSize + ')';
  // dollar-bound override: large estimates always get a human look
  if (total > POLICY.highDollar){
    reasons.push('Estimated $' + total.toFixed(2) + ' exceeds the $' + POLICY.highDollar + ' review threshold; routed to a human to confirm.');
    return { decision:'manual', confidence: level, basis: basis, quantities: prof.quantities, estimatedTotal: total, depositDue: num(R.depositDue), reasons: reasons, drivers: prof.confidence.drivers };
  }
  return { decision:'automated', confidence: level, basis: basis, quantities: prof.quantities, estimatedTotal: total, depositDue: num(R.depositDue), reasons: reasons, drivers: prof.confidence.drivers };
}

module.exports = { getProfile:getProfile, seedProfile:seedProfile, recordActuals:recordActuals, assess:assess, confidenceOf:confidenceOf, DRIVERS:DRIVERS, POLICY:POLICY };
