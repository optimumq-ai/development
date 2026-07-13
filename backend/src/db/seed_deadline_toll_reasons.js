'use strict';
// Make `tollReasons` load-bearing, safely.
//
// tolling.toll() now REJECTS a reason the jurisdiction has not declared (it used to accept any string, so a
// typo silently became a new toll reason and no city could constrain what may stop its clock). But the
// seeded TX deadline config declares only [clarification_pending, payment_pending, extension] — while
// routes/requests.js has been tolling the SAME clock with `ag_ruling_pending` since the AG flow was built.
// Turning on validation without this fix would break the AG hold.
//
// This backfills `ag_ruling_pending` into every jurisdiction's respond-clock reasons. Idempotent.
//
// NOTE ON EXTENSIONS: no `extension` cap is seeded for TX, deliberately. The Texas PIA has NO
// unusual-circumstances extension — volume extends what is "reasonable" but grants no extra statutory days
// (§ 552.221(a); TML PIA Made Easy). An absent cap means extend() is uncapped-but-recorded, which is the
// honest posture: if a TX city grants itself extra days, that is a decision that should be in the ledger,
// not silently blocked or silently allowed. IL (one 5-business-day extension, 5 ILCS 140/3(e)) and CA (one,
// max 14 days, § 7922.535(b)) have real caps — seed them when those jurisdictions get deadline configs.
//
// Run: cd /opt/optimumq/backend && node src/db/seed_deadline_toll_reasons.js
require('dotenv').config();
var db = require('../db');

var REQUIRED = ['clarification_pending', 'payment_pending', 'ag_ruling_pending', 'extension'];

(async function () {
  await db.initDb();
  var rows = await db.all("SELECT id, jurisdiction_id, config_json FROM jurisdiction_rules WHERE domain = 'deadline'");
  var touched = 0;
  for (var i = 0; i < rows.length; i++) {
    var cfg;
    try { cfg = JSON.parse(rows[i].config_json); } catch (e) { continue; }
    if (!cfg.clocks || !cfg.clocks.respond) continue;
    var cur = cfg.clocks.respond.tollReasons || [];
    var missing = REQUIRED.filter(function (r) { return cur.indexOf(r) < 0; });
    if (!missing.length) { console.log('  ' + rows[i].jurisdiction_id + '  already complete'); continue; }
    cfg.clocks.respond.tollReasons = cur.concat(missing);
    await db.run('UPDATE jurisdiction_rules SET config_json = ? WHERE id = ?', [JSON.stringify(cfg), rows[i].id]);
    console.log('  ' + rows[i].jurisdiction_id + '  + ' + missing.join(', '));
    touched++;
  }
  console.log('\n' + touched + ' jurisdiction deadline config(s) updated; ' + rows.length + ' inspected.');
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
