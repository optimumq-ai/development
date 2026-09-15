var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

// Recursive walk of the source root. Every regular file (any type) with its path RELATIVE to the root
// (forward slashes) — the census counts every file and reads what it can. Hidden files/dirs skipped.
function walk(root) {
  var out = [];
  function rec(dir, rel) {
    var ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    ents.forEach(function (d) {
      if (d.name[0] === '.') return;
      var full = path.join(dir, d.name), r = rel ? rel + '/' + d.name : d.name;
      if (d.isDirectory()) return rec(full, r);
      if (!d.isFile()) return;
      var st = null; try { st = fs.statSync(full); } catch (e) { return; }
      var ext = path.extname(d.name).slice(1).toLowerCase();
      out.push({ filename: r, fullPath: full, ext: ext, size: st.size, mtime: st.mtimeMs });
    });
  }
  if (root && fs.existsSync(root)) rec(root, '');
  out.sort(function (a, b) { return a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0; });
  return out;
}

// Legacy sample path (retires with Scan source, flow-map decision 2): alphabetical first N PDFs, 1,500 chars each.
function scan(config) {
  var files = listFiles(config);
  var limit = (config && config.sample_limit) ? config.sample_limit : 50;
  var out = [];
  for (var i = 0; i < files.length && i < limit; i++) {
    var text = '';
    try { text = execFileSync('pdftotext', [files[i].fullPath, '-'], { encoding: 'utf8', timeout: 15000 }); } catch (e) { text = ''; }
    out.push({ filename: files[i].filename, text: (text || '').trim().substring(0, 1500) });
  }
  return out;
}

// Total PDF documents in the source (recursive) — NOT a sample.
function countAll(config) { return listFiles(config).length; }

function makeSnippet(text, matched) {
  if (!text) return '';
  var low = text.toLowerCase();
  var pos = -1;
  for (var j = 0; j < matched.length; j++) {
    var p = low.indexOf(matched[j]);
    if (p !== -1 && (pos === -1 || p < pos)) pos = p;
  }
  if (pos === -1) pos = 0;
  var start = Math.max(0, pos - 60);
  var s = text.substring(start, start + 180).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '...' : '') + s + (text.length > start + 180 ? '...' : '');
}

function nativeSearch(query, config) {
  var kw = require('./keyword');
  var terms = kw.tokenize(query);
  if (!terms.length) return [];
  var files = listFiles(config);
  var out = [];
  for (var i = 0; i < files.length; i++) {
    var text = '';
    try { text = execFileSync('pdftotext', [files[i].fullPath, '-'], { encoding: 'utf8', timeout: 15000 }); } catch (e) { text = ''; }
    var cleanName = files[i].filename.replace(/\.pdf$/i, '').replace(/[_\/-]+/g, ' ');
    var m = kw.match(terms, cleanName, text);
    if (!m) continue;
    out.push({ id: 'filestore:' + files[i].filename, sourceSystem: 'Network Drive (files)', title: files[i].filename, summary: makeSnippet(text, m.matched), department: '', docType: 'File', dateCreated: '', pageCount: null, publicAvailability: 'available', matchScore: m.score, matchedTerms: m.matched });
  }
  out.sort(function (a, b) { return b.matchScore - a.matchScore; });
  return out.slice(0, 8);
}

// Every PDF with its on-disk path — the substrate for fingerprinting. RECURSIVE since 2026-09-15 (flow-map
// decision 4): `filename` is the path relative to the source root, so a sub-folder file is addressable and
// unique. Top-level files keep their bare name, so the existing index rows still match.
function listFiles(config) {
  var dir = (config && config.path) ? config.path : null;
  return walk(dir).filter(function (f) { return f.ext === 'pdf'; });
}

// Every file of every type — what the census COUNTS (documents are read, the rest reported honestly).
function listAll(config) {
  var dir = (config && config.path) ? config.path : null;
  return walk(dir);
}

module.exports = { scan: scan, countAll: countAll, nativeSearch: nativeSearch, listFiles: listFiles, listAll: listAll };
