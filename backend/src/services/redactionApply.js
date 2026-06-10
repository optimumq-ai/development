// Server-side redaction apply. For each page: bake opaque black boxes into the rendered raster
// with jimp (the underlying pixels are destroyed -> true redaction), then assemble a PDF with pdf-lib
// at the original page size, paint each box's INDEX NUMBER in white, and append a Vaughn Index:
// a numbered, itemized table where each number matches the number printed on its black box, giving
// the exemption, legal authority, and basis for every redaction. Output is a new (released) file.
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../db');

const UPLOAD_DIR = path.join(__dirname, '../../../uploads');

function clampInt(v, max) { v = Math.round(v); if (v < 0) v = 0; if (v > max) v = max; return v; }
// Keep only characters the standard PDF font (WinAnsi/Latin-1) can render.
function safe(s) {
  return String(s == null ? '' : s)
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

async function applyRedaction(jobId, actor) {
  var job = await get('SELECT * FROM redaction_jobs WHERE id = ?', [jobId]);
  if (!job) throw new Error('job not found');
  var file = await get('SELECT * FROM request_files WHERE id = ?', [job.file_id]);
  if (!file) throw new Error('source file not found');
  var pages = await all('SELECT * FROM document_pages WHERE file_id = ? ORDER BY page_no', [job.file_id]);
  if (!pages.length) throw new Error('document not processed (no pages)');
  var zones = await all("SELECT * FROM redaction_zones WHERE job_id = ? AND (review_state IS NULL OR review_state <> 'rejected')", [jobId]);
  var agencyRow = await get("SELECT value FROM system_config WHERE key = 'agency_name'");
  var agencyName = agencyRow ? agencyRow.value : 'Agency';

  // Number boxes in reading order: page, then top-to-bottom, then left-to-right.
  zones.sort(function(a, b){
    if (a.page_no !== b.page_no) return a.page_no - b.page_no;
    if (Math.abs(a.y - b.y) > 0.02) return a.y - b.y;
    return a.x - b.x;
  });
  zones.forEach(function(z, i){ z.idx = i + 1; });

  // category labels + rule lookup (title, category, description, citations)
  var catRows = await all('SELECT key, label FROM redaction_categories');
  var catLabel = {}; catRows.forEach(function(c){ catLabel[c.key] = c.label; });
  var ruleMap = {};
  var ruleIds = zones.map(function(z){ return z.rule_id; }).filter(Boolean);
  if (ruleIds.length) {
    var ph = ruleIds.map(function(){ return '?'; }).join(',');
    var rs = await all('SELECT id, title, category, description FROM redaction_rules WHERE id IN (' + ph + ')', ruleIds);
    for (var i = 0; i < rs.length; i++) {
      var cites = await all('SELECT ls.citation FROM rule_legal_sources rls JOIN legal_sources ls ON ls.id = rls.legal_source_id WHERE rls.rule_id = ?', [rs[i].id]);
      ruleMap[rs[i].id] = { title: rs[i].title, category: rs[i].category, description: rs[i].description, citations: cites.map(function(c){ return c.citation; }) };
    }
  }

  var pdf = await PDFDocument.create();
  var font = await pdf.embedFont(StandardFonts.Helvetica);
  var fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  // ---- Render pages with redaction boxes + index numbers ----
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
    // white circle badge with the index number, at the left of each box
    pageZones.forEach(function(z){
      var bxPt = z.x * wPt, byPt = z.y * hPt, bwPt = z.w * wPt, bhPt = z.h * hPt;
      var num = String(z.idx);
      var r = Math.max(4, Math.min(7, bhPt / 2 - 1));
      if (bhPt >= 7 && bwPt >= 2 * r + 2) {
        var cx = bxPt + r + 2, cy = hPt - byPt - bhPt / 2;
        page.drawCircle({ x: cx, y: cy, size: r, color: rgb(1, 1, 1) });
        var fs = 8;
        while (fs > 4 && fontB.widthOfTextAtSize(num, fs) > 2 * r - 3) fs -= 0.5;
        page.drawText(num, { x: cx - fontB.widthOfTextAtSize(num, fs) / 2, y: cy - fs * 0.36, size: fs, font: fontB, color: rgb(0.1, 0.1, 0.1) });
      } else if (bhPt >= 5 && bwPt >= 8) {
        var s2 = Math.min(7, bhPt - 1);
        page.drawText(num, { x: bxPt + 2, y: hPt - byPt - s2, size: s2, font: fontB, color: rgb(1, 1, 1) });
      }
    });
  }

  // ---- Vaughn Index ----
  var cols = {
    no:    { x: 48,  w: 24,  h: 'No.' },
    page:  { x: 76,  w: 30,  h: 'Page' },
    ex:    { x: 110, w: 134, h: 'Exemption' },
    auth:  { x: 248, w: 126, h: 'Legal Authority' },
    basis: { x: 378, w: 186, h: 'Basis for Redaction' }
  };
  var SZ = 8.5, LH = 11;
  var V = { page: null, y: 0 };
  function wrap(text, sz, maxW) {
    var words = safe(text).split(/\s+/), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (cur && font.widthOfTextAtSize(t, sz) > maxW) { lines.push(cur); cur = words[i]; } else { cur = t; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
  function headerRow() {
    Object.keys(cols).forEach(function(k){ V.page.drawText(cols[k].h, { x: cols[k].x, y: V.y, size: 9, font: fontB, color: rgb(0.1, 0.1, 0.1) }); });
    V.y -= 5;
    V.page.drawLine({ start: { x: 48, y: V.y }, end: { x: 564, y: V.y }, thickness: 0.6, color: rgb(0.55, 0.55, 0.55) });
    V.y -= 13;
  }
  function newIndexPage(withHeader) { V.page = pdf.addPage([612, 792]); V.y = 744; if (withHeader) headerRow(); }
  function row(no, pageNo, exemption, authority, basis) {
    var exL = wrap(exemption, SZ, cols.ex.w), auL = wrap(authority, SZ, cols.auth.w), baL = wrap(basis, SZ, cols.basis.w);
    var n = Math.max(exL.length, auL.length, baL.length, 1);
    var rowH = n * LH + 7;
    if (V.y - rowH < 54) newIndexPage(true);
    var top = V.y;
    V.page.drawText(String(no), { x: cols.no.x, y: top, size: SZ, font: fontB, color: rgb(0.1, 0.1, 0.1) });
    V.page.drawText('p.' + pageNo, { x: cols.page.x, y: top, size: SZ, font: font, color: rgb(0.1, 0.1, 0.1) });
    exL.forEach(function(ln, i){ V.page.drawText(ln, { x: cols.ex.x, y: top - i * LH, size: SZ, font: font, color: rgb(0.12, 0.12, 0.12) }); });
    auL.forEach(function(ln, i){ V.page.drawText(ln, { x: cols.auth.x, y: top - i * LH, size: SZ, font: font, color: rgb(0.25, 0.25, 0.25) }); });
    baL.forEach(function(ln, i){ V.page.drawText(ln, { x: cols.basis.x, y: top - i * LH, size: SZ, font: font, color: rgb(0.25, 0.25, 0.25) }); });
    V.y = top - n * LH - 7;
    V.page.drawLine({ start: { x: 48, y: V.y + 4 }, end: { x: 564, y: V.y + 4 }, thickness: 0.3, color: rgb(0.88, 0.88, 0.88) });
  }

  newIndexPage(false);
  V.page.drawText('Vaughn Index', { x: 48, y: V.y, size: 18, font: fontB, color: rgb(0.1, 0.1, 0.1) }); V.y -= 21;
  V.page.drawText('Itemized index of information withheld or redacted, keyed to the numbered boxes on the document.', { x: 48, y: V.y, size: 9, font: font, color: rgb(0.35, 0.35, 0.35) }); V.y -= 22;
  var meta = ['Agency: ' + agencyName, 'Source document: ' + (file.original_name || file.filename), 'Prepared: ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC', 'Prepared by: ' + (actor || 'Staff'), 'Total redactions: ' + zones.length];
  meta.forEach(function(m){ V.page.drawText(safe(m), { x: 48, y: V.y, size: 9.5, font: font, color: rgb(0.2, 0.2, 0.2) }); V.y -= 14; });
  V.y -= 8;
  if (!zones.length) {
    V.page.drawText('No redactions were applied to this document.', { x: 48, y: V.y, size: 10, font: font, color: rgb(0.3, 0.3, 0.3) });
  } else {
    headerRow();
    zones.forEach(function(z){
      var r = z.rule_id && ruleMap[z.rule_id];
      var exemption = r ? ((catLabel[r.category] || r.category) + ' - ' + r.title) : 'Manual redaction';
      var authority = r && r.citations.length ? r.citations.join('; ') : 'Not specified';
      var basis = r ? (r.description || 'Withheld under the cited authority.') : (z.note || 'Redacted by staff; no rule attached.');
      row(z.idx, z.page_no, exemption, authority, basis);
    });
  }

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
      [uuidv4(), file.request_id, actor || null, actor || 'Staff', 'REDACTION_APPLIED', zones.length + ' redaction(s) on ' + (file.original_name || file.filename) + ' (Vaughn Index generated)']);
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
