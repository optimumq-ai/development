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

module.exports = { scan: scan };
