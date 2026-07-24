// Build an all-states Excel workbook into /home/optimumq/exchange.
const path = '/tmp/claude-998/-home-optimumq/fb4aa3f1-bf0e-4830-8e27-3fd6a744a532/scratchpad';
const ExcelJS = require(path + '/node_modules/exceljs');
const fs = require('fs');
const { abbr } = require(path + '/render.js');

const RESEARCH = '/opt/optimumq/docs/rules_research';
const OUT = '/home/optimumq/exchange/State_rules_ALL.xlsx';
const WAVES = ['wave1/salvage','wave2','wave3','wave4','wave5','wave6','wave7','wave8','wave9']
  .map(w => `${RESEARCH}/${w}/discovery.json`);

// load + dedup (later wave wins → refined AZ from wave2)
const map = {}, origin = {};
for (const f of WAVES) {
  let o; try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
  const arr = Array.isArray(o) ? o : (o.states || [o]);
  for (const s of arr) {
    if (!s || !s.state) continue;
    const nm = String(s.state).replace(/\..*$/, '').trim();
    map[nm] = s; origin[nm] = f.split('/').slice(-2)[0];
  }
}
const names = Object.keys(map).sort();

const wb = new ExcelJS.Workbook();
wb.creator = 'OptimumQ rules gather';
wb.created = new Date('2026-07-22T00:00:00Z');

const HDR = { bold: true, color: { argb: 'FFFFFFFF' } };
const HDRFILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5CAD' } };
function styleHeader(ws){
  const row = ws.getRow(1);
  row.font = HDR; row.height = 22;
  row.eachCell(c => { c.fill = HDRFILL; c.alignment = { vertical: 'middle' }; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ---------- Sheet 1: All Rules ----------
const s1 = wb.addWorksheet('All Rules', { views: [{ state: 'frozen', ySplit: 1 }] });
s1.columns = [
  { header: 'State', key: 'state', width: 16 },
  { header: 'Code', key: 'code', width: 6 },
  { header: 'Rule ID', key: 'rule_id', width: 10 },
  { header: 'Category', key: 'category', width: 16 },
  { header: 'Concept key', key: 'concept_key', width: 26 },
  { header: 'Rule type', key: 'rule_type', width: 12 },
  { header: 'Config home', key: 'config_home', width: 11 },
  { header: 'Constraint basis', key: 'constraint_basis', width: 13 },
  { header: 'Atomic rule (plain English)', key: 'atomic_rule', width: 60 },
  { header: 'Trigger', key: 'trigger', width: 24 },
  { header: 'Clock effect', key: 'clock_effect', width: 12 },
  { header: 'Clock spec', key: 'clock_spec', width: 28 },
  { header: 'Verbatim source language', key: 'source_language', width: 70 },
  { header: 'Paraphrase?', key: 'is_paraphrase', width: 10 },
  { header: 'Source authority', key: 'source_authority', width: 26 },
  { header: 'Effective status', key: 'effective_status', width: 22 },
  { header: 'Official link', key: 'official_link', width: 40 },
  { header: 'Notes', key: 'notes', width: 50 },
  { header: 'Source wave', key: 'wave', width: 11 },
];
for (const nm of names) {
  const s = map[nm], code = abbr(nm);
  for (const r of (s.rules || [])) {
    s1.addRow({
      state: nm, code,
      rule_id: r.rule_id || '', category: r.category || '', concept_key: r.concept_key || '',
      rule_type: r.rule_type || '', config_home: r.config_home || '',
      constraint_basis: r.constraint_basis || '', atomic_rule: r.atomic_rule || '',
      trigger: r.trigger || '', clock_effect: r.clock_effect || '', clock_spec: r.clock_spec || '',
      source_language: r.source_language || '', is_paraphrase: r.is_paraphrase ? 'yes' : '',
      source_authority: r.source_authority || '', effective_status: r.effective_status || '',
      official_link: r.official_link || '', notes: r.notes || '', wave: origin[nm] || '',
    });
  }
}
styleHeader(s1);
s1.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s1.columns.length } };
s1.eachRow((row, n) => { if (n > 1) row.alignment = { vertical: 'top', wrapText: true }; });
// hyperlink the official link column
const linkCol = s1.getColumn('official_link').number;
s1.eachRow((row, n) => { if (n > 1) { const c = row.getCell(linkCol); if (c.value) { c.value = { text: String(c.value), hyperlink: String(c.value) }; c.font = { color: { argb: 'FF0B5CAD' }, underline: true }; } } });

// ---------- Sheet 2: Summary ----------
const s2 = wb.addWorksheet('Summary');
s2.columns = [
  { header: 'State', key: 'state', width: 16 }, { header: 'Code', key: 'code', width: 6 },
  { header: 'Rules', key: 'rules', width: 8 }, { header: 'Verbatim', key: 'verb', width: 10 },
  { header: 'Material negatives', key: 'neg', width: 17 }, { header: 'Structural branches', key: 'br', width: 18 },
  { header: 'Source wave', key: 'wave', width: 12 },
];
let tot = 0;
for (const nm of names) {
  const s = map[nm];
  tot += s.rules.length;
  s2.addRow({ state: nm, code: abbr(nm), rules: s.rules.length, verb: s.verbatim_captured_count || 0,
    neg: (s.material_negatives||[]).length, br: (s.structural_branches||[]).length, wave: origin[nm] || '' });
}
const totRow = s2.addRow({ state: 'TOTAL', code: names.length + ' st', rules: tot });
totRow.font = { bold: true };
styleHeader(s2);
s2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };

// ---------- Sheet 3: Material negatives ----------
const s3 = wb.addWorksheet('Material negatives');
s3.columns = [ { header: 'State', key: 'state', width: 16 }, { header: 'Code', key: 'code', width: 6 },
  { header: 'Concept key', key: 'ck', width: 30 }, { header: 'Note', key: 'note', width: 100 } ];
for (const nm of names) for (const n of (map[nm].material_negatives||[]))
  s3.addRow({ state: nm, code: abbr(nm), ck: n.concept_key || '', note: n.note || '' });
styleHeader(s3);
s3.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };
s3.eachRow((row, n) => { if (n > 1) row.alignment = { vertical: 'top', wrapText: true }; });

// ---------- Sheet 4: Structural branches ----------
const s4 = wb.addWorksheet('Structural branches');
s4.columns = [ { header: 'State', key: 'state', width: 16 }, { header: 'Code', key: 'code', width: 6 },
  { header: 'Concept key', key: 'ck', width: 34 }, { header: 'Description', key: 'desc', width: 100 } ];
for (const nm of names) for (const b of (map[nm].structural_branches||[]))
  s4.addRow({ state: nm, code: abbr(nm), ck: b.concept_key || '', desc: b.description || '' });
styleHeader(s4);
s4.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };
s4.eachRow((row, n) => { if (n > 1) row.alignment = { vertical: 'top', wrapText: true }; });

wb.xlsx.writeFile(OUT).then(() => {
  console.log('wrote', OUT);
  console.log('All Rules rows:', tot, '| states:', names.length,
    '| negatives:', s3.rowCount - 1, '| branches:', s4.rowCount - 1);
});
