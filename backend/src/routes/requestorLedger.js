'use strict';
// FRONT DESK — the requestor-ledger LOOKUP (Kevin 2026-09-04). The ledger service (WS5) held
// cross-request money/allowance state with no screen; the counter is where it gets asked about
// ("do I owe anything from before?", "how much free time is left this year?"). Read-only: every
// mutation still happens through the gates in services/requestorLedger.js. requireAuth like the
// cash-drawer reconciliation endpoint — staff-facing money summaries, no citizen surface.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { get, all } = require('../db');
const RL = require('../services/requestorLedger');
const scope = require('../services/requestScope');

router.get('/search', requireAuth, async function (req, res) {
  try {
    var q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ profiles: [] });
    var like = '%' + q.toLowerCase() + '%';
    var rows = await all(
      'SELECT id, display_name, primary_email, identity_basis FROM requestor_profiles ' +
      'WHERE lower(coalesce(display_name, \'\')) LIKE ? OR lower(coalesce(primary_email, \'\')) LIKE ? ORDER BY display_name LIMIT 10', [like, like]);
    for (var i = 0; i < rows.length; i++) {
      rows[i].balance = await RL.balance(rows[i].id);
      var cnt = await get('SELECT count(*)::int AS n FROM requestor_request_links WHERE profile_id = ?', [rows[i].id]);
      rows[i].request_count = cnt ? Number(cnt.n) : 0;
    }
    res.json({ profiles: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/profile/:id', requireAuth, async function (req, res) {
  try {
    var p = await get('SELECT * FROM requestor_profiles WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Requestor profile not found' });
    var balance = await RL.balance(p.id);
    var allowances = await all('SELECT name, unit, window_spec, allowance, consumed, updated_at FROM requestor_allowances WHERE profile_id = ? ORDER BY name', [p.id]);
    var counters = await all('SELECT name, count, window_spec, updated_at FROM requestor_counters WHERE profile_id = ? ORDER BY name', [p.id]);
    var flags = await RL.activeFlags(p.id);
    var events = await all('SELECT type, amount, reason, request_id, created_at FROM requestor_ledger_events WHERE profile_id = ? ORDER BY created_at DESC LIMIT 15', [p.id]);
    var requests = await all(
      'SELECT r.id, ' + scope.numberExpr('r') + ' AS request_number, r.stage, l.linked_at FROM requestor_request_links l ' +
      'JOIN requests r ON r.id = l.request_id ' + scope.numberJoin('r') +
      ' WHERE l.profile_id = ? ORDER BY l.linked_at DESC LIMIT 20', [p.id]);
    res.json({ profile: p, balance: balance, allowances: allowances, counters: counters, flags: flags, events: events, requests: requests });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
