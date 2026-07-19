// Find the DANGEROUS shape specifically: inside a route handler, a PERSISTING call sits in a try whose
// catch swallows (empty, or logs only), and the handler then answers with an unconditional 2xx.
// That is "the write failed and we told the caller it worked".
var fs = require('fs'), path = require('path');
var ROOT = '/opt/optimumq/backend/src/routes';

// Calls that actually persist something. A swallow around a READ is not this defect.
var WRITES = /\b(run\(|db\.run\(|applyStageTransition\(|createTask\(|logHistory\(|autoRouteOrPool\(|assign\(|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)/;
// A catch body that does nothing, or only logs.
function swallows(body) {
  var b = body.trim();
  if (b === '') return true;
  var lines = b.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  return lines.every(function (l) { return /^console\.(error|warn|log)\(/.test(l) || l === '}' || /^\/\//.test(l); });
}
// Extract balanced {...} starting at the index of '{'
function block(src, open) {
  var d = 0;
  for (var i = open; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return { text: src.slice(open + 1, i), end: i }; }
  }
  return null;
}

var findings = [];
fs.readdirSync(ROOT).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
  var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  var re = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g, m;
  while ((m = re.exec(src))) {
    var openIdx = src.indexOf('{', m.index);
    if (openIdx < 0) continue;
    var h = block(src, openIdx);
    if (!h) continue;
    var body = h.text;
    var line = src.slice(0, m.index).split('\n').length;

    // every try/catch inside this handler
    var tre = /\btry\s*\{/g, tm;
    while ((tm = tre.exec(body))) {
      var tryBlk = block(body, tm.index + tm[0].length - 1);
      if (!tryBlk) continue;
      var after = body.slice(tryBlk.end + 1);
      var cm = after.match(/^\s*catch\s*\([^)]*\)\s*\{/);
      if (!cm) continue;
      var catchOpen = tryBlk.end + 1 + cm[0].length - 1;
      var catchBlk = block(body, catchOpen);
      if (!catchBlk) continue;
      if (!WRITES.test(tryBlk.text)) continue;          // not a write -> not this defect
      if (!swallows(catchBlk.text)) continue;            // handled properly -> fine
      // does the catch itself return/respond? then it's handled.
      if (/\breturn\b|res\.(status|json|send)/.test(catchBlk.text)) continue;
      // after the catch, does the handler answer 2xx unconditionally?
      var tail = body.slice(catchBlk.end + 1);
      var responds2xx = /res\.json\(|res\.status\(\s*20\d\s*\)|res\.send\(/.test(tail);
      var respondsErr = /res\.status\(\s*[45]\d\d\s*\)/.test(tail.split('res.json(')[0] || '');
      if (responds2xx && !respondsErr) {
        findings.push({ file: f, route: m[1].toUpperCase() + ' ' + m[2], line: line,
                        wrote: (tryBlk.text.match(WRITES) || [''])[0].trim() });
      }
    }
  }
});
console.log('CANDIDATES: ' + findings.length + '\n');
findings.forEach(function (x) { console.log('  ' + x.file + ':' + x.line + '  ' + x.route + '   [' + x.wrote + ']'); });
