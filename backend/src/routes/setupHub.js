'use strict';
// SETUP & CONFIGURATION HUB — SPEC_setup_hub.md.
//   GET    /api/setup-hub               the page: counts, the "start here" item, five lanes of items
//   POST   /api/setup-hub/:key/done     "Mark it done" (Option A) — the lane's permission group (legal_rules on a
//                                       legal section; the go-live row is flipped elsewhere, never marked)
//   DELETE /api/setup-hub/:key/done     undo the mark — same gate
// Reads are open to any signed-in user: the page is the city's shared picture of where setup stands.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const HUB = require('../services/setupHub');

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
  try { await HUB.mark(item.key, req.user); res.json({ ok: true, key: item.key }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/:key/done', requireAuth, async function (req, res) {
  var item = gate(req, res); if (!item) return;
  try { await HUB.unmark(item.key); res.json({ ok: true, key: item.key }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
