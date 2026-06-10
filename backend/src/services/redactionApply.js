// Server-side redaction apply. For each page: bake opaque black boxes into the rendered raster
// with jimp (the underlying pixels are destroyed -> true redaction), then assemble a PDF with pdf-lib
// at the original page size, paint the exemption-category label in white on each box, and append a
// documentation sheet. Output is registered as a new (released) request_file.
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../db');

const UPLOAD_DIR = path.join(__dirname, '../../../uploads');

function clampInt(v, max) { v = Math.round(v); if (v < 0) v = 0; if (v > max) v = max; return v; }

async function applyRedaction(jobId, actor) {
  var job = await get('SELECT * FROM redaction_jobs WHERE id = ?', [jobId]);
  if (!job) throw new Error('job not found');
  var file = await get('SELECT * FROM request_files WHERE id = ?', [job.file_id]);
  if (!file) throw new Error('source file not found');
  var pages = await all('SELECT * FROM document_pages WHERE file_id = ? ORDER BY page_no', [job.file_id]);
  if (!pages.length) throw new Error('document not processed (no pages)');
  var zones = await all('SELECT * FROM redaction_zones WHERE job_id = ? ORDER BY page_no', [jobId]);

  // category labels + rule lookup (title, category, citations) for labels and the doc sheet
  var catRows = await all('SELECT key, label FROM redaction_categories');
  var catLabel = {}; catRows.forEach(function(c){ catLabel[c.key] = c.label; });
  var ruleMap = {};
  var ruleIds = zones.map(function(z){ return z.rule_id; }).filter(Boolean);
  if (ruleIds.length) {
    var ph = ruleIds.map(function(){ return '?'; }).join(',');
    var rs = await all('SELECT id, title, category FROM redaction_rules WHERE id IN (' + ph + ')', ruleIds);
    for (var i = 0; i < rs.length; i++) {
      var cites = await all('SELECT ls.citation FROM rule_legal_sources rls JOIN legal_sources ls ON ls.id = rls.legal_source_id WHERE rls.rule_id = ?', [rs[i].id]);
      ruleMap[rs[i].id] = { title: rs[i].title, category: rs[i].category, citations: cites.map(function(c){ return c.citation; }) };
    }
  }
  function zoneLabel(z) {
    var r = z.rule_id && ruleMap[z.rule_id];
    if (r) return catLabel[r.category] || r.title;
    return 'REDACTED';
  }

  var pdf = await PDFDocument.create();
  var font = await pdf.embedFont(StandardFonts.Helvetica);
  var fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (var p = 0; p < pages.length; p++) {
    var pg = pages[p];
    var pageZones = zones.filter(function(z){ return z.page_no === pg.page_no; });
    var imgPath = pg.image_path ? path.join(UPLOAD_DIR, pg.image_path) : null;
    var buf;
    if (imgPath && fs.existsSync(imgPath)) {
      var img = await Jimp.read(imgPath);
      var iw = img.bitmap.width, ih = img.bitmap.height;
      pageZones.forEach(function(z){
        var bx = clampInt(z.x * iw, iw), by = clampInt(z.y * ih, ih);
        var bw = clampInt(z.w * iw, iw - bx), bh = clampInt(z.h * ih, ih - by);
        if (bw > 0 && bh > 0) { var black = new Jimp(bw, bh, 0x000000FF); img.composite(black, bx, by); }
      });
      buf = await img.getBufferAsync(Jimp.MIME_PNG);
    }
    var wPt = pg.width || 612, hPt = pg.height || 792;
    var page = pdf.addPage([wPt, hPt]);
    if (buf) {
      var png = await pdf.embedPng(buf);
      page.drawImage(png, { x: 0, y: 0, width: wPt, height: hPt });
    }
    // white category label near the top-left of each box
    pageZones.forEach(function(z){
      var label = zoneLabel(z);
      var bxPt = z.x * wPt, byPt = z.y * hPt, bwPt = z.w * wPt, bhPt = z.h * hPt;
      if (bhPt < 9 || bwPt < 18) return;
      var maxChars = Math.max(3, Math.floor(bwPt / 5));
      if (label.length > maxChars) label = label.slice(0, maxChars - 1) + '...';
      var size = Math.min(9, bhPt - 3);
      page.drawText(label, { x: bxPt + 3, y: hPt - byPt - size - 2, size: size, font: font, color: rgb(1, 1, 1) });
    });
  }

  // Documentation sheet(s)
  function addDocPage() {
    var dp = pdf.addPage([612, 792]); return { page: dp, y: 740 };
  }
  var dpState = addDocPage();
  function line(text, opts) {
    opts = opts || {};
    if (dpState.y < 54) dpState = addDocPage();
    dpState.page.drawText(text, { x: 54, y: dpState.y, size: opts.size || 10, font: opts.bold ? fontB : font, color: rgb(0.1, 0.1, 0.1) });
    dpState.y -= (opts.gap || 16);
  }
  line('Redaction Documentation Sheet', { bold: true, size: 16, gap: 24 });
  line('Source document: ' + (file.original_name || file.filename), { size: 10 });
  line('Generated: ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC', { size: 10 });
  line('Processed by: ' + (actor || 'Staff'), { size: 10, gap: 22 });
  line('Redactions applied (' + zones.length + '):', { bold: true, gap: 18 });
  if (!zones.length) line('No redactions were applied.', { size: 10 });
  zones.forEach(function(z, i) {
    var r = z.rule_id && ruleMap[z.rule_id];
    var cat = r ? (catLabel[r.category] || r.category) : 'Unspecified';
    var title = r ? r.title : 'Manual redaction (no rule attached)';
    var cites = r && r.citations.length ? r.citations.join('; ') : 'No citation';
    line((i + 1) + '. Page ' + z.page_no + ' - ' + title + ' [' + cat + ']', { size: 10, gap: 14 });
    line('     Legal basis: ' + cites, { size: 9, gap: 16 });
  });

  var bytes = await pdf.save();
  var outName = uuidv4() + '.pdf';
  fs.writeFileSync(path.join(UPLOAD_DIR, outName), bytes);
  var outId = uuidv4();
  var origLabel = 'Redacted - ' + (file.original_name || file.filename);
  await run('INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,datetime(\'now\'))',
    [outId, file.request_id, outName, origLabel, 'application/pdf', bytes.length, 'redacted', actor || null]);
  await run("UPDATE redaction_jobs SET status = 'applied', output_file_id = ?, updated_at = datetime('now') WHERE id = ?", [outId, jobId]);
  if (file.request_id) {
    await run('INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)',
      [uuidv4(), file.request_id, actor || null, actor || 'Staff', 'REDACTION_APPLIED', zones.length + ' redaction(s) on ' + (file.original_name || file.filename)]);
  }
  // Record into the Fulfilled Request Index (public-ready tier of search).
  try {
    var reqRow = file.request_id ? await get('SELECT description, record_type_id, department_id FROM requests WHERE id = ?', [file.request_id]) : null;
    var rtName = '';
    if (reqRow && reqRow.record_type_id) { var rt = await get('SELECT name FROM record_types WHERE id = ?', [reqRow.record_type_id]); rtName = rt ? rt.name : ''; }
    var baseTitle = (file.original_name || file.filename || 'Released record').replace(/\.[a-z0-9]+$/i, '');
    await run('DELETE FROM fulfilled_records WHERE source_file_id = ?', [file.id]);
    await run('INSERT INTO fulfilled_records (id, request_id, source_file_id, output_file_id, title, summary, record_type_id, department_id, keywords, public_availability, page_count, released_by, released_at, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime(\'now\'),?)',
      [uuidv4(), file.request_id || null, file.id, outId, baseTitle, (reqRow && reqRow.description) || baseTitle, (reqRow && reqRow.record_type_id) || null, (reqRow && reqRow.department_id) || null, (rtName + ' ' + baseTitle).trim(), zones.length ? 'redacted' : 'released', pages.length, actor || null, 'released']);
  } catch (e) { console.error('[fulfilled index]', e.message); }

  return { outputFileId: outId, fileName: origLabel, zoneCount: zones.length, pageCount: pages.length, bytes: bytes.length };
}

module.exports = { applyRedaction: applyRedaction };
