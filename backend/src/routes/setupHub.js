'use strict';
// SETUP & CONFIGURATION HUB — SPEC_setup_hub.md.
//   GET    /api/setup-hub               the page: counts, the "start here" item, five lanes of items
//   POST   /api/setup-hub/:key/done     "Mark it done" (Option A) — the lane's permission group (legal_rules on a
//                                       legal section; the go-live row is flipped elsewhere, never marked)
//   DELETE /api/setup-hub/:key/done     undo the mark — same gate
// Reads are open to any signed-in user: the page is the city's shared picture of where setup stands.
//
// ATTESTATION FOLD (Kevin 2026-08-29): an item with `foldSections` fronts profile sections its screen
// absorbed. Marking it done ALSO attests each folded section that is configured — the attests run FIRST,
// so a refusal (a real gate, e.g. an unconfirmed knob) fails the whole act in words and no mark is
// written. A section with nothing configured is skipped, not an error: `payment` while the clock switch
// is off stays un-attested by design (off is a valid posture; automation stays unarmed). Undoing the
// mark un-attests every folded section.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const HUB = require('../services/setupHub');
const JP = require('../services/jurisdictionProfile');
const JR = require('../services/jurisdictionRules');

router.get('/', requireAuth, async function (req, res) {
  try { res.json(await HUB.build(req.user)); }
  catch (e) { res.status(500).json({ error: 'The setup page could not be built: ' + (e && e.message) }); }
});

function gate(req, res) {
  var item = HUB.BY_KEY[req.params.key];
  if (!item) { res.status(404).json({ error: 'Unknown setup item: ' + req.params.key }); return null; }
  if (item.goLive) { res.status(400).json({ error: 'Go-live is not marked done — it is flipped on the Jurisdiction Configuration page by the ORO System Administrator or ORO Director.', code: 'NOT_MARKABLE' }); return null; }
  if (!HUB.mayEdit(item, req.user)) {
    res.status(403).json({ error: 'Marking "' + item.name + '" done needs the ' + (item.legal ? 'legal_rules' : (item.groups || HUB.LANES.filter(function (l) { return l.key === item.lane; })[0].groups).join(' or ')) + ' permission group.', code: 'PERMISSION_REQUIRED' });
    return null;
  }
  return item;
}
router.post('/:key/done', requireAuth, async function (req, res) {
  var item = gate(req, res); if (!item) return;
  try {
    var attested = [], skipped = [];
    if (item.foldSections && item.foldSections.length) {
      var jid = await JR.activeJid();
      for (var i = 0; i < item.foldSections.length; i++) {
        var section = item.foldSections[i];
        var st = await JP.sectionState(jid, section);
        if (!st || st.status === 'not_configured') { skipped.push(section); continue; }
        try { await JP.attest(jid, section, req.user && req.user.name); attested.push(section); }
        catch (e) { return res.status(422).json({ error: 'The ' + section + ' section refused attestation: ' + e.message, code: 'ATTEST_REFUSED', section: section }); }
      }
    }
    try { await HUB.mark(item.key, req.user); } catch (eM) { if (eM && eM.code === 'REQUIRED_MISSING') return res.status(422).json({ error: eM.message, code: 'REQUIRED_MISSING', missing: eM.missing }); throw eM; }
    res.json({ ok: true, key: item.key, attested: attested, skipped: skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/:key/done', requireAuth, async function (req, res) {
  var item = gate(req, res); if (!item) return;
  try {
    await HUB.unmark(item.key);
    var unattested = [];
    if (item.foldSections && item.foldSections.length) {
      var jid = await JR.activeJid();
      for (var i = 0; i < item.foldSections.length; i++) {
        try { await JP.unattest(jid, item.foldSections[i]); unattested.push(item.foldSections[i]); }
        catch (e) { /* an unknown/never-attested section is nothing to undo */ }
      }
    }
    res.json({ ok: true, key: item.key, unattested: unattested });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
