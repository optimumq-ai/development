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

// DATA-SYSTEM CENSUS substrate (2026-09-15): every record KIND the definition declares, with its fields and a sample
// row. This definition format carries no row counts or date ranges — they are reported as unknown, never invented.
function listKinds(config) {
  var p = config && config.path;
  if (!p || !fs.existsSync(p)) return [];
  var data; try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return []; }
  var sys = (data && data.system) || 'System';
  return ((data && data.tables) || []).map(function (t) {
    return { key: t.name, name: String(t.name || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }), description: t.desc || '', system: sys,
      fields: (t.columns || []).map(String), sample: t.sample || null, row_count: (typeof t.row_count === 'number') ? t.row_count : null,
      date_range: t.date_range || null };
  });
}
module.exports.listKinds = listKinds;
