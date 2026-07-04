'use strict';
var express = require('express');
var router = express.Router();
var { requireAuth } = require('../middleware/auth');
var helpAgent = require('../services/helpAgent');

// POST /api/help/ask { messages:[{role,content}], page } -> { answer }
router.post('/ask', requireAuth, async function (req, res) {
  try {
    var messages = (req.body && req.body.messages) || [];
    var page = req.body && req.body.page;
    var text = await helpAgent.answer(messages, page);
    res.json({ answer: text || 'I\u2019m not sure about that one - your system administrator can help.' });
  } catch (e) {
    console.error('[help/ask]', e && e.message);
    res.status(500).json({ error: 'The help assistant is unavailable right now.' });
  }
});
module.exports = router;
