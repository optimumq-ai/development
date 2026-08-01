'use strict';
// EXTERNAL-CONTRIBUTOR PUBLIC ROUTES (2026-08-01). No requireAuth ANYWHERE here by design: the token IS
// the credential, checked by hash on every call. See services/externalContributor.js for the shape.
//
// Refusal grammar: unknown → 404 (no oracle: an attacker probing tokens learns nothing but "no");
// expired/revoked → 410 with a sentence that points at the person who sent the link; completed → the GET
// still answers 200 (a thanks page is not an error) but the WRITE routes refuse 410 — a completed
// assignment has nothing left to accept.
const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { get, run } = require('../db');
const { v4: uuidv4 } = require('uuid');
const XC = require('../services/externalContributor');

const UPLOAD_DIR = path.join(__dirname, '../../../uploads');
// Same envelope as the staff upload route (routes/files.js) — an external upload is not allowed a type
// the staff screen would refuse.
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) { cb(null, UPLOAD_DIR); },
    filename: function (req, file, cb) { cb(null, uuidv4() + path.extname(file.originalname)); }
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    var allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.tiff', '.mp3', '.mp4', '.mov', '.txt', '.csv'];
    if (allowed.indexOf(path.extname(file.originalname).toLowerCase()) !== -1) cb(null, true);
    else cb(new Error('File type not supported'));
  }
});

async function load(req, res) {
  var row = await XC.resolve(req.params.token);
  if (!row) { res.status(404).json({ error: 'This link is not recognized.' }); return null; }
  var state = XC.stateOf(row);
  if (state === 'expired' || state === 'revoked') {
    res.status(410).json({ error: 'This link is no longer active. Contact the person who sent it to you for a new one.', state: state });
    return null;
  }
  return { row: row, state: state };
}

// The page. A completed link still answers — "your part is done" renders as thanks, not as an error.
router.get('/:token', async function (req, res) {
  try {
    var l = await load(req, res); if (!l) return;
    if (l.state !== 'completed') await XC.recordOpen(l.row);
    res.json(await XC.payload(l.row));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function refuseIfDone(l, res) {
  if (l.state === 'completed') {
    res.status(410).json({ error: 'This assignment is already complete — nothing more can be added on this link.' });
    return true;
  }
  return false;
}

router.post('/:token/note', async function (req, res) {
  try {
    var l = await load(req, res); if (!l) return;
    if (refuseIfDone(l, res)) return;
    await XC.addNote(l.row, (req.body || {}).note);
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.post('/:token/files', upload.single('file'), async function (req, res) {
  try {
    var l = await load(req, res); if (!l) return;
    if (refuseIfDone(l, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    var id = uuidv4();
    await run('INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, uploaded_by, uploaded_at) ' +
      "VALUES (?,?,?,?,?,?,?,datetime('now'))",
      [id, l.row.request_id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, XC.uploader(l.row)]);
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
      [uuidv4(), l.row.request_id, null, l.row.email + ' (external)', 'MRR_EXTERNAL_UPLOAD',
       'The external contributor uploaded "' + req.file.originalname + '" via the secure link.']);
    res.status(201).json({ success: true, fileId: id, name: req.file.originalname });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.post('/:token/complete', async function (req, res) {
  try {
    var l = await load(req, res); if (!l) return;
    if (refuseIfDone(l, res)) return;
    await XC.complete(l.row, (req.body || {}).note);
    res.json({ success: true, state: 'completed' });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code }); }
});

module.exports = router;
