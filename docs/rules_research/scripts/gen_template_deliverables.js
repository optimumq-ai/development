// Phase 6 deliverables: per-state config-template HTML + index + Config_templates.xlsx
// Reads workflow/templates/*.json (built by workflow/build_state_templates.js).
const fs = require('fs');
const path = require('path');
const RESEARCH = '/opt/optimumq/docs/rules_research';
const TPL = path.join(RESEARCH, 'workflow', 'templates');
const OUT = '/home/optimumq/exchange/config_templates';
fs.mkdirSync(OUT, { recursive: true });

let ExcelJS;
for (const p of ['/tmp/claude-998/-home-optimumq/fb4aa3f1-bf0e-4830-8e27-3fd6a744a532/scratchpad/node_modules/exceljs',
                 '/tmp/claude-998/-home-optimumq/4610cbeb-c70f-4f3a-88f2-ce8c29cc92af/scratchpad/node_modules/exceljs']) {
  try { ExcelJS = require(p); break; } catch (e) {}
}
if (!ExcelJS) { console.error('exceljs not found — npm install exceljs in the scratchpad'); process.exit(1); }

const files = fs.readdirSync(TPL).filter(f => /^[A-Z]{2}\.json$/.test(f)).sort();
const templates = files.map(f => JSON.parse(fs.readFileSync(path.join(TPL, f), 'utf8')));

const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1a1a1a;max-width:1200px}
h1{font-size:22px;border-bottom:3px solid #0b5cad;padding-bottom:6px}
h2{font-size:17px;color:#0b5cad;margin-top:28px}
table{border-collapse:collapse;width:100%;margin:8px 0 18px;font-size:13px}
th{background:#0b5cad;color:#fff;text-align:left;padding:6px 8px}
td{border:1px solid #cfd8e3;padding:6px 8px;vertical-align:top}
tr:nth-child(even) td{background:#f4f7fb}
.on{background:#1a7f37;color:#fff;border-radius:3px;padding:1px 7px;font-size:12px}
.off{background:#8a94a0;color:#fff;border-radius:3px;padding:1px 7px;font-size:12px}
.cc{background:#fff7e0;border:1px solid #e6c200;border-radius:3px;padding:2px 6px;font-size:12px;display:inline-block;margin-top:3px}
.rid{font-family:Consolas,monospace;font-size:12px;color:#5a2ea6;white-space:nowrap}
.auth{color:#555;font-size:12px}
.clk{color:#b25000;font-size:12px}
.note{color:#555;font-style:italic;font-size:12.5px}
.legend{background:#eef3f9;border:1px solid #b9cbe0;padding:10px 14px;border-radius:4px;font-size:13px}
`;

const evRows = ev => ev.map(e =>
  `<div><span class="rid">${esc(e.rule_id)}</span> <span class="auth">${esc(e.authority)}</span>` +
  (e.clock_spec ? ` <span class="clk">⏱ ${esc(e.clock_spec)}</span>` : '') +
  `<br>${esc(e.summary)}</div>`).join('<hr style="border:none;border-top:1px dashed #ccc">');

const conceptTable = block => Object.entries(block).map(([k, ev]) =>
  `<tr><td style="width:26%"><b>${esc(k)}</b></td><td>${evRows(ev)}</td></tr>`).join('');

for (const t of templates) {
  const knobRows = Object.entries(t.knobs).map(([node, k]) => {
    const stat = Object.keys(k.statutory).length
      ? `<table>${conceptTable(k.statutory)}</table>` : '<span class="note">no statutory constraint here</span>';
    const cc = k.city_config ? `<div class="cc">⚠ city config: ${esc(k.city_config)}</div>` : '';
    return `<tr><td style="width:15%"><b>${esc(node)}</b><br><span class="note">${esc(k.label)}</span></td><td>${stat}${cc}</td></tr>`;
  }).join('');

  const brRows = Object.entries(t.branches).map(([node, b]) => {
    const badge = b.active ? '<span class="on">ON</span>' : '<span class="off">off</span>';
    const parts = [];
    if (b.activated_by) parts.push(`<b>activated by:</b><table>${conceptTable(b.activated_by)}</table>`);
    if (b.suppressed_by) parts.push(`<b>suppressed by:</b><table>${conceptTable(b.suppressed_by)}</table>`);
    if (b.context) parts.push(`<b>context (does not activate):</b><table>${conceptTable(b.context)}</table>`);
    if (b.note) parts.push(`<span class="note">${esc(b.note)}</span>`);
    return `<tr><td style="width:15%"><b>${esc(node)}</b><br><span class="note">${esc(b.label)}</span></td><td style="width:6%">${badge}</td><td>${parts.join('') || '<span class="note">—</span>'}</td></tr>`;
  }).join('');

  const clkRows = Object.entries(t.clock_matrix).map(([timer, v]) =>
    `<tr><td style="width:18%"><b>${esc(timer)}</b></td><td style="width:8%">${v.present ? '<span class="on">statutory</span>' : '<span class="off">city</span>'}</td><td>${v.present ? `<table>${conceptTable(v.statutory)}</table>` : `<span class="note">${esc(v.note)}</span>`}</td></tr>`).join('');

  const secTable = sec => Object.keys(sec).length
    ? `<table>${conceptTable(sec)}</table>` : '<p class="note">Nothing statutory in this state — city policy / defaults apply.</p>';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(t.state)} — workflow config template (Phase 6)</title><style>${CSS}</style></head><body>
<h1>${esc(t.state)} (${esc(t.code)}) — workflow config template</h1>
<div class="legend">Generated from the master workflow overlay (v2.5) + concept dictionary. <b>◆ Knobs</b>:
each needs a configured value — statutory evidence shown where the state constrains it, <span class="cc">⚠ city config</span>
marks what remains local policy. <b>▲ Branches</b>: <span class="on">ON</span> = active in this state.
Clock matrix / fee schedule / program setup / requestor-ledger are the engine data tables.
Audit: ${t.audit.rules_referenced}/${t.audit.rules_total} state rules carried into this template.</div>
<h2>◆ Value knobs (${Object.keys(t.knobs).length})</h2><table><tr><th>Node</th><th>Statutory constraints & city config</th></tr>${knobRows}</table>
<h2>▲ State-gated branches (${Object.keys(t.branches).length})</h2><table><tr><th>Node</th><th>State</th><th>Why</th></tr>${brRows}</table>
<h2>Clock matrix (named timers)</h2><table><tr><th>Timer</th><th>Basis</th><th>Evidence</th></tr>${clkRows}</table>
<h2>Fee schedule</h2>${secTable(t.fee_schedule)}
<h2>Program setup (org-level obligations)</h2>${secTable(t.program_setup)}
<h2>Requestor-ledger triggers</h2>${secTable(t.ledger)}
<p class="note">Generated ${new Date().toISOString().slice(0, 10)} · source: docs/rules_research/workflow/templates/${esc(t.code)}.json</p>
</body></html>`;
  fs.writeFileSync(path.join(OUT, `${t.code}_config_template.html`), html);
}

// ---- index ----
const idxRows = templates.map(t => {
  const on = Object.entries(t.branches).filter(([, b]) => b.active).length;
  const timers = Object.values(t.clock_matrix).filter(v => v.present).length;
  return `<tr><td><a href="${t.code}_config_template.html">${esc(t.state)}</a></td><td>${t.code}</td><td>${on}/${Object.keys(t.branches).length}</td><td>${timers}/10</td><td>${t.audit.rules_total}</td></tr>`;
}).join('');
fs.writeFileSync(path.join(OUT, 'index.html'), `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Per-state workflow config templates (Phase 6)</title><style>${CSS}</style></head><body>
<h1>Per-state workflow config templates — 32 states (Phase 6)</h1>
<div class="legend">One page per state: every ◆ value-knob with its statutory evidence and ⚠ city-config notes,
every ▲ branch with its ON/off gate, plus the clock-matrix, fee-schedule, program-setup and requestor-ledger tables.</div>
<table><tr><th>State</th><th>Code</th><th>Branches ON</th><th>Statutory timers</th><th>Rules</th></tr>${idxRows}</table>
</body></html>`);

// ---- xlsx ----
const wb = new ExcelJS.Workbook();
const paint = ws => { const h = ws.getRow(1); h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5CAD' } });
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }]; };

const sum = wb.addWorksheet('Summary');
sum.columns = [{ header: 'State', key: 's', width: 16 }, { header: 'Code', key: 'c', width: 7 },
  { header: 'Branches ON', key: 'b', width: 12 }, { header: 'Statutory timers', key: 't', width: 15 },
  { header: 'Rules', key: 'r', width: 8 }, { header: 'Active branches', key: 'ab', width: 70 }];
for (const t of templates) sum.addRow({ s: t.state, c: t.code,
  b: Object.values(t.branches).filter(b => b.active).length,
  t: Object.values(t.clock_matrix).filter(v => v.present).length,
  r: t.audit.rules_total,
  ab: Object.entries(t.branches).filter(([, b]) => b.active).map(([k]) => k).join('  ') });
paint(sum);

const branchKeys = Object.keys(templates[0].branches);
const bm = wb.addWorksheet('Branch matrix');
bm.columns = [{ header: 'Branch', key: 'k', width: 24 }, { header: 'ON count', key: 'n', width: 9 },
  ...templates.map(t => ({ header: t.code, key: t.code, width: 5 }))];
for (const k of branchKeys) {
  const row = { k, n: templates.filter(t => t.branches[k].active).length };
  for (const t of templates) row[t.code] = t.branches[k].active ? '✓' : '';
  bm.addRow(row);
}
paint(bm);

const timerKeys = Object.keys(templates[0].clock_matrix);
const tm = wb.addWorksheet('Timer matrix');
tm.columns = [{ header: 'Timer', key: 'k', width: 24 }, { header: 'Statutory count', key: 'n', width: 14 },
  ...templates.map(t => ({ header: t.code, key: t.code, width: 5 }))];
for (const k of timerKeys) {
  const row = { k, n: templates.filter(t => t.clock_matrix[k].present).length };
  for (const t of templates) row[t.code] = t.clock_matrix[k].present ? '✓' : '';
  tm.addRow(row);
}
paint(tm);

wb.xlsx.writeFile(path.join(OUT, 'Config_templates.xlsx')).then(() => {
  console.log(`wrote ${templates.length} state HTMLs + index.html + Config_templates.xlsx to ${OUT}`);
});
