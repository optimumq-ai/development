const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get, all } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const docProcessing = require('../services/docProcessing');

const UPLOAD_DIR = path.join(__dirname, '../../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: function(req, file, cb) { cb(null, UPLOAD_DIR); },
  filename: function(req, file, cb) {
    var ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    var allowed = ['.pdf','.doc','.docx','.xls','.xlsx','.jpg','.jpeg','.png','.tiff','.mp3','.mp4','.mov','.txt','.csv'];
    var ext = path.extname(file.originalname).toLowerCase();
    if (allowed.indexOf(ext) !== -1) { cb(null, true); }
    else { cb(new Error('File type not supported')); }
  }
});

router.post('/upload/:requestId', requireAuth, upload.single('file'), async function(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  var requestId = req.params.requestId;
  var request = await get('SELECT id FROM requests WHERE id = ?', [requestId]);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  var fileId = uuidv4();
  await run('INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
    [fileId, requestId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.sub]);

  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), requestId, req.user.sub, req.user.name||'Staff', 'FILE_UPLOADED', 'Uploaded: ' + req.file.originalname]);

  res.json({ success: true, fileId: fileId, filename: req.file.originalname, size: req.file.size });
});

// ============================================================================================
// THE RECORD-SEARCH SURFACE (SPEC_record_search_task_screen §4a).
//
// Until now there was NO staff path to search the source systems and attach what you find. The public
// portal could search; the searcher — whose entire job this is — could not. DocSearchPanel searches
// INSIDE documents already attached to a request, which is a different thing entirely.
//
// Deliberately the SAME engine the portal uses (searchAll -> judgeResults). If the searcher's ranking
// differed from the one the requestor saw, the "queries the portal already ran" panel would be a lie —
// re-running a portal query here would produce a different answer for the same words.
// ============================================================================================
router.post('/search/records', requireAuth, async function (req, res) {
  var query = String((req.body && req.body.query) || '').trim();
  if (!query) return res.status(400).json({ error: 'Empty query' });
  try {
    var recordSearch = require('../services/recordSearch');
    var results = await recordSearch.searchAll(query);
    results = await recordSearch.judgeResults(query, results);
    res.json({ query: query, results: results || [] });
  } catch (e) {
    console.error('staff record search failed:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Attach a found source-system record to the request, optionally marking it Include in Response.
//
// THE BLOB IS COPIED, NOT SHARED. It is tempting to point the new request_files row at the SAME
// `filename` on disk — one row, no I/O. That is a landmine: DELETE /files/:fileId UNLINKS THE FILE FROM
// DISK, so removing the record from one request would silently destroy it inside the other, which is a
// released record in someone else's fulfilled request. Two rows, two blobs.
router.post('/attach/:requestId', requireAuth, async function (req, res) {
  try {
    var requestId = req.params.requestId;
    var rec = (req.body && req.body.record) || {};
    var request = await get('SELECT id FROM requests WHERE id = ?', [requestId]);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    // A record with no underlying file cannot be attached — it has to be PULLED from the source system,
    // and the connectors that would do that are stubs. Say so plainly rather than attaching an empty row
    // that looks like a record and contains nothing.
    if (!rec.fileId) {
      return res.status(422).json({
        error: 'This record has no retrievable file. It must be pulled from ' + (rec.sourceSystem || 'its source system') + '.',
        code: 'RETRIEVAL_REQUIRED'
      });
    }
    var src = await get('SELECT * FROM request_files WHERE id = ?', [rec.fileId]);
    if (!src) return res.status(404).json({ error: 'Source file not found' });

    var srcPath = path.join(UPLOAD_DIR, src.filename);
    if (!fs.existsSync(srcPath)) return res.status(404).json({ error: 'Source file is missing from storage' });

    var ext = path.extname(src.filename);
    var newName = uuidv4() + ext;
    fs.copyFileSync(srcPath, path.join(UPLOAD_DIR, newName));

    var fileId = uuidv4();
    var include = req.body.includeInResponse ? 1 : 0;
    await run('INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, responsive, uploaded_by) VALUES (?,?,?,?,?,?,?,?)',
      [fileId, requestId, newName, src.original_name, src.mimetype, src.size, include, req.user.sub]);
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
      [uuidv4(), requestId, req.user.sub, req.user.name || 'Staff', 'RECORD_ATTACHED',
       'Attached from ' + (rec.sourceSystem || 'source system') + ': ' + src.original_name
       + (include ? ' — marked Include in Response' : '')]);

    res.json({ success: true, fileId: fileId, originalName: src.original_name, includeInResponse: !!include });
  } catch (e) {
    console.error('attach failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/:requestId', requireAuth, async function(req, res) {
  var files = await all('SELECT * FROM request_files WHERE request_id = ? ORDER BY uploaded_at DESC', [req.params.requestId]);
  res.json({ files: files });
});

router.delete('/:fileId', requireAuth, async function(req, res) {
  var file = await get('SELECT * FROM request_files WHERE id = ?', [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  var filePath = path.join(UPLOAD_DIR, file.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await run('DELETE FROM request_files WHERE id = ?', [req.params.fileId]);
  res.json({ success: true });
});

router.get('/download/:fileId', requireAuth, async function(req, res) {
  var file = await get('SELECT * FROM request_files WHERE id = ?', [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  var filePath = path.join(UPLOAD_DIR, file.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
  res.download(filePath, file.original_name);
});

router.patch('/:fileId/status', requireAuth, async function(req, res) {
  var file = await get('SELECT * FROM request_files WHERE id = ?', [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  var responsive = req.body.responsive ? 1 : 0;
  await run('UPDATE request_files SET responsive = ? WHERE id = ?', [responsive, req.params.fileId]);
  await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), file.request_id, req.user.sub, req.user.name||'Staff', responsive ? 'MARKED_RESPONSIVE' : 'MARKED_NOT_RESPONSIVE', file.original_name]);
  res.json({ success: true });
});

// --- Document processing foundation (render pages + extract text/word boxes) ---
router.post('/:fileId/process', requireAuth, async function(req, res) {
  var file = await get('SELECT * FROM request_files WHERE id = ?', [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  try {
    var result = await docProcessing.processFile(req.params.fileId);
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), file.request_id, req.user.sub, req.user.name||'Staff', 'DOCUMENT_PROCESSED', file.original_name + ' (' + result.pageCount + ' pages' + (result.needsOcr ? ', scanned - OCR needed' : '') + ')']);
    res.json(Object.assign({ success: true }, result));
  } catch(e) {
    console.error('[files] process failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/page-image/:pageId', requireAuth, async function(req, res) {
  var page = await get('SELECT image_path FROM document_pages WHERE id = ?', [req.params.pageId]);
  if (!page || !page.image_path) return res.status(404).json({ error: 'Page image not found' });
  var imgPath = path.join(UPLOAD_DIR, page.image_path);
  if (!fs.existsSync(imgPath)) return res.status(404).json({ error: 'Image missing on disk' });
  res.type('png').sendFile(imgPath);
});

router.get('/:fileId/pages', requireAuth, async function(req, res) {
  var rows = await all('SELECT id, page_no, width, height, image_width, image_height, words, has_text_layer FROM document_pages WHERE file_id = ? ORDER BY page_no', [req.params.fileId]);
  var pages = rows.map(function(r){
    var words = [];
    try { words = r.words ? JSON.parse(r.words) : []; } catch(e) { words = []; }
    return {
      id: r.id, page_no: r.page_no, width: r.width, height: r.height,
      image_width: r.image_width, image_height: r.image_height,
      has_text_layer: !!r.has_text_layer, word_count: words.length, words: words,
      image_url: '/api/files/page-image/' + r.id
    };
  });
  res.json({ fileId: req.params.fileId, pageCount: pages.length, pages: pages });
});

module.exports = router;
