'use strict';
// Standalone config-integrity check. Exits non-zero on any error-severity finding, so it can gate a deploy.
//   cd /opt/optimumq/backend && node src/db/check_config_integrity.js
require('dotenv').config();
var db = require('../db');
var CI = require('../services/configIntegrity');

(async function () {
  await db.initDb();
  var r = await CI.check();
  console.log('\nConfig integrity — ' + r.checked + ' jurisdiction rules, active = ' + r.activeJurisdiction);
  if (r.clean && !r.warnings) { console.log('CLEAN. No drift, no test residue.\n'); process.exit(0); }
  r.findings.forEach(function (f) {
    console.log('\n  [' + f.severity.toUpperCase() + '] ' + f.where);
    console.log('    ' + f.issue);
    console.log('    fix: ' + f.fix);
  });
  console.log('\n' + r.errors + ' error(s), ' + r.warnings + ' warning(s).\n');
  process.exit(r.errors ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
