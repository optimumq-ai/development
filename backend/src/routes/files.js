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
  limits: { fileSize: 50 * 1024 * 1024 },
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
