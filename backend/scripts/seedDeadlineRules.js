// Seeds the DEFAULT deadline/tolling rules into system_config (key 'deadline_rules'). Idempotent upsert.
// These are a sensible default (US federal observed holidays 2026-2027 + TX-style respond/ag_ruling clocks);
// the Jurisdiction Profile will supply/override per city once built. Run from /opt/optimumq/backend.
require('dotenv').config();
var db = require('../src/db');
var RULES = {
  version: 1,
  note: "Default deadline rules. Holiday set = US federal (observed) 2026-2027 - VERIFY/override per jurisdiction. Supplied by the Jurisdiction Profile once built.",
  weekend: [0, 6],
  holidays: [
    "2026-01-01","2026-01-19","2026-02-16","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-10-12","2026-11-11","2026-11-26","2026-11-27","2026-12-25",
    "2027-01-01","2027-01-18","2027-02-15","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-10-11","2027-11-11","2027-11-25","2027-11-26","2027-12-24"
  ],
  clocks: {
    respond: { label: "Respond / produce", basis: "calendar_days", durationByClassification: { simple: 5, standard: 10, complex: 20, redaction_required: 30 }, default: 10, startOn: "intake", primary: true, tollReasons: ["clarification_pending", "payment_pending", "extension"] },
    ag_ruling: { label: "Request AG ruling", basis: "business_days", duration: 10, startOn: "demand", primary: false, tollReasons: ["extension"] }
  }
};
(async () => {
  await db.initDb();
  await db.run("INSERT INTO system_config (key,value,updated_at) VALUES ('deadline_rules',?,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at", [JSON.stringify(RULES)]);
  console.log('deadline_rules seeded');
  process.exit(0);
})().catch(function (e) { console.error(e.message); process.exit(1); });
