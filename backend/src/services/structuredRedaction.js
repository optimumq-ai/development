// Structured-data redaction (the FIELDS intake mode). For a structured record exported as CSV, the
// officer marks which columns are exempt; we DROP those columns' values and then render a clean
// "born redacted" PDF + a Fields Withheld index. The key property: an exempt value is never written
// into the output file at all (unlike page redaction, which covers a value that did get rendered).
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../db');
const { UPLOAD_DIR } = require('./docProcessing');

function safe(s) {
  return String(s == null ? '' : s)
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, embedded commas/newlines.
function parseCsv(text) {
  text = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var rows = [], row = [], cur = '', inQ = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(function (r) { return r.length > 1 || (r.length === 1 && String(r[0]).trim() !== ''); });
}

function wrap(text, size, maxW, font) {
  text = safe(text); if (!text) return [''];
  var words = text.split(/\s+/), lines = [], cur = '';
  for (var i = 0; i < words.length; i++) {
    var word = words[i];
    while (font.widthOfTextAtSize(word, size) > maxW && word.length > 1) {
      var cut = word.length;
      while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > maxW) cut--;
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(word.slice(0, cut)); word = word.slice(cut);
    }
    var t = cur ? cur + ' ' + word : word;
    if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = word; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

async function ruleDetails(ruleIds) {
  var map = {}, ids = ruleIds.filter(Boolean);
  if (!ids.length) return map;
  var ph = ids.map(function () { return '?'; }).join(',');
  var rs = await all('SELECT id, title, category, description FROM redaction_rules WHERE id IN (' + ph + ')', ids);
  var catRows = await all('SELECT key, label FROM redaction_categories');
  var catLabel = {}; catRows.forEach(function (c) { catLabel[c.key] = c.label; });
  for (var i = 0; i < rs.length; i++) {
    var cites = await all('SELECT ls.citation FROM rule_legal_sources rls JOIN legal_sources ls ON ls.id = rls.legal_source_id WHERE rls.rule_id = ?', [rs[i].id]);
    map[rs[i].id] = { title: rs[i].title, catLabel: catLabel[rs[i].category] || rs[i].category, description: rs[i].description, citations: cites.map(function (c) { return c.citation; }) };
  }
  return map;
}

async function readCsvFile(fileId) {
  var file = await get('SELECT * FROM request_files WHERE id = ?', [fileId]);
  if (!file) throw new Error('file not found');
  var src = path.join(UPLOAD_DIR, file.filename);
  if (!fs.existsSync(src)) throw new Error('file missing on disk');
  var rows = parseCsv(fs.readFileSync(src, 'utf8'));
  if (!rows.length) throw new Error('empty CSV');
  return { file: file, headers: rows[0].map(function (h) { return safe(h).trim(); }), data: rows.slice(1) };
}

// Columns + a few sample rows, for the field-picker UI.
async function preview(fileId) {
  var p = await readCsvFile(fileId);
  var sample = p.data.slice(0, 3).map(function (r) { var o = {}; p.headers.forEach(function (h, c) { o[h] = r[c] == null ? '' : r[c]; }); return o; });
  return { columns: p.headers, sampleRows: sample, rowCount: p.data.length };
}

// field_map: [{ field: "<column>", rule_id: "<id|null>" }] listing EXEMPT columns.
async function applyFieldMap(fileId, fieldMap, actor, actorSub) {
  var P = await readCsvFile(fileId);
  var file = P.file, headers = P.headers, data = P.data;
  if (!data.length) throw new Error('CSV has no data rows');

  var fmByName = {};
  (fieldMap || []).forEach(function (f) { if (f && f.field) fmByName[String(f.field).trim().toLowerCase()] = f.rule_id || null; });
  var exemptIdx = {}, withheldFields = [];
  headers.forEach(function (h, c) { var k = h.toLowerCase(); if (Object.prototype.hasOwnProperty.call(fmByName, k)) { exemptIdx[c] = fmByName[k]; withheldFields.push({ field: h, rule_id: fmByName[k] }); } });
  var rmap = await ruleDetails(withheldFields.map(function (w) { return w.rule_id; }));
  var agencyRow = await get("SELECT value FROM system_config WHERE key = 'agency_name'");
  var agencyName = agencyRow ? agencyRow.value : 'Agency';
  var baseTitle = (file.original_name || file.filename || 'record').replace(/\.[a-z0-9]+$/i, '');

  var pdf = await PDFDocument.create();
  var font = await pdf.embedFont(StandardFonts.Helvetica);
  var fontB = await pdf.embedFont(StandardFonts.HelveticaBold);
  var V = {};
  function newPage() { V.page = pdf.addPage([612, 792]); V.y = 744; }
  newPage();

  V.page.drawText(safe(agencyName), { x: 48, y: V.y, size: 16, font: fontB, color: rgb(0.1, 0.1, 0.1) }); V.y -= 19;
  V.page.drawText('Released Record - structured data (field-level review)', { x: 48, y: V.y, size: 10.5, font: fontB, color: rgb(0.2, 0.2, 0.2) }); V.y -= 16;
  ['Source: ' + (file.original_name || file.filename), 'Records: ' + data.length,
   'Prepared: ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC', 'Prepared by: ' + (actor || 'Staff'),
   'Withheld fields: ' + (withheldFields.length ? withheldFields.map(function (w) { return w.field; }).join(', ') : 'none')
  ].forEach(function (m) { V.page.drawText(safe(m), { x: 48, y: V.y, size: 9, font: font, color: rgb(0.3, 0.3, 0.3) }); V.y -= 13; });
  V.y -= 6; V.page.drawLine({ start: { x: 48, y: V.y }, end: { x: 564, y: V.y }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) }); V.y -= 16;

  var labelX = 56, valX = 190, valW = 372;
  for (var r = 0; r < data.length; r++) {
    if (V.y < 92) newPage();
    V.page.drawText('Record ' + (r + 1) + ' of ' + data.length, { x: 48, y: V.y, size: 10, font: fontB, color: rgb(0.12, 0.27, 0.5) }); V.y -= 15;
    for (var c = 0; c < headers.length; c++) {
      if (V.y < 60) newPage();
      var labLines = wrap((headers[c] || ('Column ' + (c + 1))) + ':', 9, valX - labelX - 8, fontB);
      labLines.forEach(function (ln, i) { V.page.drawText(ln, { x: labelX, y: V.y - i * 11, size: 9, font: fontB, color: rgb(0.25, 0.25, 0.25) }); });
      if (Object.prototype.hasOwnProperty.call(exemptIdx, c)) {
        var barW = 132, barH = 11;
        V.page.drawRectangle({ x: valX, y: V.y - 2, width: barW, height: barH, color: rgb(0, 0, 0) });
        V.page.drawText('WITHHELD', { x: valX + 6, y: V.y + 0.5, size: 7.5, font: fontB, color: rgb(1, 1, 1) });
        var rd = exemptIdx[c] && rmap[exemptIdx[c]];
        var cite = rd ? (rd.catLabel + ' - ' + rd.title + (rd.citations.length ? ' (' + rd.citations.join('; ') + ')' : '')) : 'Withheld';
        var cLines = wrap(cite, 8, valW - barW - 10, font);
        cLines.forEach(function (ln, i) { V.page.drawText(ln, { x: valX + barW + 8, y: V.y + 0.5 - i * 10, size: 8, font: font, color: rgb(0.42, 0.42, 0.42) }); });
        V.y -= Math.max(labLines.length * 11, barH + 2, cLines.length * 10) + 5;
      } else {
        var vLines = wrap(data[r][c] == null || data[r][c] === '' ? '-' : data[r][c], 9, valW, font);
        vLines.forEach(function (ln, i) { V.page.drawText(ln, { x: valX, y: V.y - i * 11, size: 9, font: font, color: rgb(0.1, 0.1, 0.1) }); });
        V.y -= Math.max(labLines.length, vLines.length) * 11 + 5;
      }
    }
    V.y -= 4; if (V.y > 60) V.page.drawLine({ start: { x: 48, y: V.y }, end: { x: 564, y: V.y }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) }); V.y -= 12;
  }

  newPage();
  V.page.drawText('Fields Withheld', { x: 48, y: V.y, size: 16, font: fontB, color: rgb(0.1, 0.1, 0.1) }); V.y -= 19;
  V.page.drawText('Each field below was withheld from every record under the cited authority. The withheld values were removed before this document was generated and are not present anywhere in this file.', { x: 48, y: V.y, size: 9, font: font, color: rgb(0.35, 0.35, 0.35), maxWidth: 516, lineHeight: 12 }); V.y -= 42;
  if (!withheldFields.length) {
    V.page.drawText('No fields were withheld.', { x: 48, y: V.y, size: 10, font: font, color: rgb(0.3, 0.3, 0.3) });
  } else {
    withheldFields.forEach(function (w) {
      if (V.y < 96) newPage();
      var rd = w.rule_id && rmap[w.rule_id];
      V.page.drawText(safe(w.field), { x: 48, y: V.y, size: 10, font: fontB, color: rgb(0.1, 0.1, 0.1) }); V.y -= 13;
      wrap(rd ? (rd.catLabel + ' - ' + rd.title) : 'Withheld by staff', 9, 510, font).forEach(function (ln) { V.page.drawText(ln, { x: 56, y: V.y, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) }); V.y -= 12; });
      if (rd && rd.citations.length) wrap('Authority: ' + rd.citations.join('; '), 9, 510, font).forEach(function (ln) { V.page.drawText(ln, { x: 56, y: V.y, size: 9, font: font, color: rgb(0.35, 0.35, 0.35) }); V.y -= 12; });
      if (rd && rd.description) wrap('Basis: ' + rd.description, 8.5, 510, font).forEach(function (ln) { V.page.drawText(ln, { x: 56, y: V.y, size: 8.5, font: font, color: rgb(0.42, 0.42, 0.42) }); V.y -= 11; });
      V.y -= 9;
    });
  }

  var bytes = await pdf.save();
  var outName = uuidv4() + '.pdf';
  fs.writeFileSync(path.join(UPLOAD_DIR, outName), bytes);
  var outId = uuidv4();
  var pageCount = pdf.getPageCount();
  var origLabel = 'Redacted - ' + baseTitle + '.pdf';
  await run("INSERT INTO request_files (id, request_id, filename, original_name, mimetype, size, status, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
    [outId, file.request_id, outName, origLabel, 'application/pdf', bytes.length, 'redacted', actor || null]);
  if (file.request_id) {
    await run("INSERT INTO request_history (id, request_id, actor_id, actor_name, action, notes) VALUES (?,?,?,?,?,?)",
      [uuidv4(), file.request_id, actorSub || null, actor || 'Staff', 'REDACTION_APPLIED', 'Structured record released; ' + withheldFields.length + ' field(s) withheld across ' + data.length + ' record(s)']);
  }
  try {
    var reqRow = file.request_id ? await get('SELECT description, record_type_id, department_id FROM requests WHERE id = ?', [file.request_id]) : null;
    var frId = uuidv4();
    var frStatus = 'released';
    try { if (file.request_id && await require('./paymentStatus').publicationHeld(file.request_id)) frStatus = 'held'; } catch (eF) {}
    await run('DELETE FROM fulfilled_records WHERE source_file_id = ?', [file.id]);
    await run("INSERT INTO fulfilled_records (id, request_id, source_file_id, output_file_id, title, summary, record_type_id, department_id, keywords, public_availability, page_count, released_by, released_at, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?)",
      [frId, file.request_id || null, file.id, outId, baseTitle, (reqRow && reqRow.description) || baseTitle, (reqRow && reqRow.record_type_id) || null, (reqRow && reqRow.department_id) || null, baseTitle, withheldFields.length ? 'redacted' : 'released', pageCount, actor || null, frStatus]);
    require('./embedIndex').bg(require('./recordMetaExtract').enrichFulfilledMeta(frId), 'enrich ' + frId);
  } catch (e) { console.error('[fulfilled index structured]', e.message); }

  return { outputFileId: outId, fileName: origLabel, recordCount: data.length, withheldFields: withheldFields.map(function (w) { return w.field; }), pageCount: pageCount };
}

module.exports = { preview: preview, applyFieldMap: applyFieldMap };
