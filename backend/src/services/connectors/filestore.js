var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

function scan(config) {
  var dir = (config && config.path) ? config.path : null;
  if (!dir || !fs.existsSync(dir)) return [];
  var files = fs.readdirSync(dir).filter(function(f){ return /\.pdf$/i.test(f); });
  var limit = (config && config.sample_limit) ? config.sample_limit : 50;
  var out = [];
  for (var i = 0; i < files.length && i < limit; i++) {
    var full = path.join(dir, files[i]);
    var text = '';
    try { text = execFileSync('pdftotext', [full, '-'], { encoding: 'utf8', timeout: 15000 }); } catch (e) { text = ''; }
    out.push({ filename: files[i], text: (text || '').trim().substring(0, 1500) });
  }
  return out;
}

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
  var dir = (config && config.path) ? config.path : null;
  if (!dir || !fs.existsSync(dir)) return [];
  var files = fs.readdirSync(dir).filter(function(f){ return /\.pdf$/i.test(f); });
  var out = [];
  for (var i = 0; i < files.length; i++) {
    var full = path.join(dir, files[i]);
    var text = '';
    try { text = execFileSync('pdftotext', [full, '-'], { encoding: 'utf8', timeout: 15000 }); } catch (e) { text = ''; }
    var cleanName = files[i].replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
    var m = kw.match(terms, cleanName, text);
    if (!m) continue;
    out.push({ id: 'filestore:' + files[i], sourceSystem: 'Network Drive (files)', title: files[i], summary: makeSnippet(text, m.matched), department: '', docType: 'File', dateCreated: '', pageCount: null, publicAvailability: 'available', matchScore: m.score, matchedTerms: m.matched });
  }
  out.sort(function(a, b) { return b.matchScore - a.matchScore; });
  return out.slice(0, 8);
}

module.exports = { scan: scan, nativeSearch: nativeSearch };
