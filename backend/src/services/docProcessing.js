// Document-processing foundation: turn an uploaded PDF into per-page rendered
// images plus a text layer with normalized word boxes. This is the substrate
// the redaction workspace renders on, and the source of words for auto-suggest.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { get, run } = require('../db');

const UPLOAD_DIR = path.join(__dirname, '../../../uploads');
const PROCESSED_DIR = path.join(UPLOAD_DIR, 'processed');
const RENDER_DPI = 150;

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

// Parse one page of `pdftotext -bbox` XHTML into normalized (0-1) word boxes.
function parseBboxPage(xml) {
  var pm = xml.match(/<page width="([\d.]+)" height="([\d.]+)">/);
  if (!pm) return null;
  var W = parseFloat(pm[1]), H = parseFloat(pm[2]);
  if (!W || !H) return null;
  var words = [];
  var re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g;
  var m;
  while ((m = re.exec(xml))) {
    var x0 = parseFloat(m[1]), y0 = parseFloat(m[2]), x1 = parseFloat(m[3]), y1 = parseFloat(m[4]);
    var t = decodeEntities(m[5]).trim();
    if (!t) continue;
    words.push({
      t: t,
      x: +(x0 / W).toFixed(5), y: +(y0 / H).toFixed(5),
      w: +((x1 - x0) / W).toFixed(5), h: +((y1 - y0) / H).toFixed(5)
    });
  }
  return { width: W, height: H, words: words };
}

async function processFile(fileId) {
  var file = await get('SELECT * FROM request_files WHERE id = ?', [fileId]);
  if (!file) throw new Error('file not found');
  var src = path.join(UPLOAD_DIR, file.filename);
  if (!fs.existsSync(src)) throw new Error('file missing on disk');
  var isPdf = /\.pdf$/i.test(file.filename) || file.mimetype === 'application/pdf';
  if (!isPdf) throw new Error('only PDF processing is supported in this phase');

  var info = '';
  try { info = execFileSync('pdfinfo', [src], { encoding: 'utf8', timeout: 30000 }); } catch (e) { throw new Error('pdfinfo failed: ' + e.message); }
  var pageCount = parseInt((info.match(/Pages:\s+(\d+)/) || [])[1]) || 0;
  if (!pageCount) throw new Error('could not read page count');

  var outDir = path.join(PROCESSED_DIR, fileId);
  fs.mkdirSync(outDir, { recursive: true });

  // Idempotent: clear any prior processed pages for this file.
  await run('DELETE FROM document_pages WHERE file_id = ?', [fileId]);

  var pages = [];
  for (var p = 1; p <= pageCount; p++) {
    var prefix = path.join(outDir, 'page-' + p);
    var imgPath = prefix + '.png';
    try {
      execFileSync('pdftoppm', ['-png', '-singlefile', '-r', String(RENDER_DPI), '-f', String(p), '-l', String(p), src, prefix], { timeout: 60000 });
    } catch (e) { /* leave image missing; page row still recorded */ }
    var hasImg = fs.existsSync(imgPath);

    var bbox = '';
    try { bbox = execFileSync('pdftotext', ['-bbox', '-f', String(p), '-l', String(p), src, '-'], { encoding: 'utf8', timeout: 60000 }); } catch (e) { bbox = ''; }
    var parsed = parseBboxPage(bbox) || { width: 612, height: 792, words: [] };

    var plain = '';
    try { plain = execFileSync('pdftotext', ['-f', String(p), '-l', String(p), src, '-'], { encoding: 'utf8', timeout: 60000 }); } catch (e) { plain = ''; }

    var imgW = Math.round(parsed.width * RENDER_DPI / 72);
    var imgH = Math.round(parsed.height * RENDER_DPI / 72);
    var relImg = hasImg ? path.relative(UPLOAD_DIR, imgPath) : null;

    await run(
      'INSERT INTO document_pages (id, file_id, request_id, page_no, width, height, image_path, image_width, image_height, words, text, has_text_layer) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [uuidv4(), fileId, file.request_id, p, parsed.width, parsed.height, relImg, imgW, imgH, JSON.stringify(parsed.words), plain, parsed.words.length > 0 ? 1 : 0]
    );
    pages.push({ page_no: p, words: parsed.words.length, has_image: hasImg, has_text_layer: parsed.words.length > 0 });
  }

  // A page with an image but no text layer is almost certainly scanned -> needs OCR (tesseract), added in a later phase.
  var needsOcr = pages.some(function (pg) { return pg.has_image && !pg.has_text_layer; });
  return { fileId: fileId, pageCount: pageCount, needsOcr: needsOcr, pages: pages };
}

module.exports = { processFile: processFile, PROCESSED_DIR: PROCESSED_DIR, UPLOAD_DIR: UPLOAD_DIR };
