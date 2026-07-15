const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const N = require('../services/notifications');

// A user's own notifications (the bell). ?unread=1 for unread only, ?all=1 to include dismissed.
router.get('/', requireAuth, async function (req, res) {
  try {
    const rows = await N.list(req.user.sub, { unreadOnly: req.query.unread === '1', includeDismissed: req.query.all === '1' });
    res.json({ notifications: rows, unread: await N.unreadCount(req.user.sub) });
  } catch (e) { res.status(500).json({ error: 'Could not load notifications.' }); }
});

router.get('/unread-count', requireAuth, async function (req, res) {
  try { res.json({ unread: await N.unreadCount(req.user.sub) }); }
  catch (e) { res.status(500).json({ error: 'Could not load count.' }); }
});

router.post('/:id/read', requireAuth, async function (req, res) {
  const row = await N.markRead(req.params.id, req.user.sub);
  if (!row) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ notification: row });
});

router.post('/read-all', requireAuth, async function (req, res) {
  res.json({ unread: await N.markAllRead(req.user.sub) });
});

router.post('/:id/dismiss', requireAuth, async function (req, res) {
  const row = await N.dismiss(req.params.id, req.user.sub);
  if (!row) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ notification: row });
});

module.exports = router;
