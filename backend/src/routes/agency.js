'use strict';
// AGENCY SETUP — the screen behind the Setup hub's "Agency name, address and contact" row (H3;
// WORKING_hub_linked_screens §1, decided 2026-08-25: lock the jurisdiction state via a BUTTON, and that click
// is what loads the state's rules — a deliberate pull, never a side effect of Save).
//
//   GET  /api/agency             the fields, the lock, and which states have a rules file
//   PUT  /api/agency             save the fields (never the jurisdiction state once it is locked)
//   POST /api/agency/lock-state  { state } → write the lock, import the state's rules, make it the city's
//                                jurisdiction. Once. Refuses a second lock and a state with no rules file.
//
// Edit gate = the hub's own gate for the agency item (operations_config or system_admin group).
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { all, get, run } = require('../db');
const HUB = require('../services/setupHub');
const STI = require('../services/stateTemplateImport');

const FIELDS = ['agency_name', 'agency_short_name', 'jurisdiction_type',
  'address_line1', 'address_line2', 'address_city', 'address_state', 'address_zip',
  'mailing_differs', 'mailing_line1', 'mailing_line2', 'mailing_city', 'mailing_state', 'mailing_zip',
  'contact_email', 'contact_phone'];
const LOCK = ['state', 'state_locked_at', 'state_locked_by'];

const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia' };

async function readAll() {
  var rows = await all('SELECT key, value FROM system_config WHERE key = ANY($1)', [FIELDS.concat(LOCK)]);
  var out = {}; rows.forEach(function (r) { out[r.key] = r.value; });
  return out;
}
async function upsert(key, value) {
  await run('INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
}
function mayEdit(user) { return HUB.mayEdit(HUB.BY_KEY.agency, user); }
function states() {
  var have = {}; STI.listTemplates().forEach(function (c) { have[c] = true; });
  return Object.keys(STATE_NAMES).sort(function (a, b) { return STATE_NAMES[a] < STATE_NAMES[b] ? -1 : 1; })
    .map(function (c) { return { code: c, name: STATE_NAMES[c], rulesAvailable: !!have[c] }; });
}
async function payload(user) {
  var cfg = await readAll();
  var fields = {}; FIELDS.forEach(function (k) { fields[k] = cfg[k] || ''; });
  var locked = !!(cfg.state && cfg.state_locked_at);
  return {
    fields: fields,
    state: cfg.state || '',
    lock: locked ? { state: cfg.state, name: STATE_NAMES[cfg.state] || cfg.state, at: cfg.state_locked_at, by: cfg.state_locked_by || '' } : null,
    states: states(),
    canEdit: mayEdit(user)
  };
}

router.get('/', requireAuth, async function (req, res) {
  try { res.json(await payload(req.user)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/', requireAuth, async function (req, res) {
  if (!mayEdit(req.user)) return res.status(403).json({ error: 'Changing the agency setup needs the operations_config or system_admin permission group.', code: 'PERMISSION_REQUIRED' });
  try {
    var body = req.body || {};
    for (var i = 0; i < FIELDS.length; i++) {
      var k = FIELDS[i];
      if (body[k] !== undefined && body[k] !== null) await upsert(k, String(body[k]).trim());
    }
    // The jurisdiction state travels with the form until it is locked; after that only the lock owns it.
    if (body.state !== undefined) {
      var cur = await readAll();
      if (cur.state_locked_at) {
        if (String(body.state).toUpperCase() !== cur.state) return res.status(409).json({ error: 'The state is locked to ' + cur.state + ' and cannot be changed here.', code: 'STATE_LOCKED' });
      } else {
        var s = String(body.state || '').toUpperCase().trim();
        if (s && !STATE_NAMES[s]) return res.status(422).json({ error: '"' + body.state + '" is not a state code.' });
        await upsert('state', s);
      }
    }
    var chg = null; try { chg = await HUB.afterChange('agency', req.user && (req.user.name || req.user.email)); } catch (eC) {}
    res.json(await payload(req.user));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/lock-state', requireAuth, async function (req, res) {
  if (!mayEdit(req.user)) return res.status(403).json({ error: 'Locking the state needs the operations_config or system_admin permission group.', code: 'PERMISSION_REQUIRED' });
  var code = String((req.body && req.body.state) || '').toUpperCase().trim();
  try {
    var cur = await readAll();
    if (cur.state_locked_at) return res.status(409).json({ error: 'The state is already locked to ' + cur.state + ' (by ' + (cur.state_locked_by || 'unknown') + ', ' + String(cur.state_locked_at).slice(0, 10) + '). Later changes in the law come in through Regenerate from state rules, not a second lock.', code: 'ALREADY_LOCKED' });
    if (!STATE_NAMES[code]) return res.status(422).json({ error: 'Choose a state before locking.', code: 'NO_STATE' });
    if (STI.listTemplates().indexOf(code) === -1) return res.status(422).json({ error: 'There is no rules file for ' + STATE_NAMES[code] + ' yet, so it cannot be locked. Rules files exist for ' + STI.listTemplates().length + ' states.', code: 'NO_RULES_FILE' });

    var who = req.user.name || req.user.email || req.user.sub;
    var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    // 1. the rules come in (idempotent; a re-run against an existing library profile stages proposals, never overwrites)
    var result = await STI.importState(code, { actor: who });
    // 2. it becomes the city's jurisdiction — the step the seed used to do by hand
    await run("UPDATE jurisdiction_profiles SET status = 'active' WHERE id = ?", [result.jid]);
    await upsert('jurisdiction_profile', result.jid);
    // 3. the lock, last: if the import throws, nothing above says "locked"
    await upsert('state', code);
    await upsert('state_locked_at', now);
    await upsert('state_locked_by', who);

    var rep = result.report || {};
    try { await HUB.afterChange('agency', req.user && (req.user.name || req.user.email)); } catch (eC) { /* notify is best-effort */ }
    res.json({
      ok: true,
      lock: { state: code, name: STATE_NAMES[code], at: now, by: who },
      loaded: {
        jurisdiction: result.jid, template: result.template,
        written: result.written, proposed: result.proposed.map(function (p) { return p.domain; }), unchanged: result.unchanged,
        primaryClock: rep.primaryClock || null,
        serviceTargets: (rep.targets || []).map(function (t) { return t.clock; }),
        cityChoices: (rep.cityKnobs || []).length,
        notConfigured: (result.sections || []).filter(function (s) { return s.status === 'not_configured'; }).map(function (s) { return s.section; })
      }
    });
  } catch (e) { res.status(500).json({ error: 'The rules could not be loaded: ' + e.message }); }
});

module.exports = router;
