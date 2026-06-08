var fs = require('fs');

function scan(config) {
  var p = config && config.path;
  if (!p || !fs.existsSync(p)) return [];
  var data;
  try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return []; }
  var tables = (data && data.tables) || [];
  var sys = (data && data.system) || 'System';
  return tables.map(function(t) {
    var cols = (t.columns || []).join(', ');
    var sample = t.sample ? JSON.stringify(t.sample) : '';
    var text = 'Source system: ' + sys + '\nReport/Table name: ' + t.name + '\nDescription: ' + (t.desc || '') + '\nColumns: ' + cols + '\nSample row: ' + sample;
    return { filename: t.name + ' (' + sys + ')', text: text.substring(0, 1500) };
  });
}

module.exports = { scan: scan };
