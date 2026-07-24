// Generate one self-contained HTML file per state into /home/optimumq/exchange, plus an index.
const fs = require('fs');
const path = require('path');
const { abbr } = require('/tmp/claude-998/-home-optimumq/fb4aa3f1-bf0e-4830-8e27-3fd6a744a532/scratchpad/render.js');

const RESEARCH = '/opt/optimumq/docs/rules_research';
const OUT = '/home/optimumq/exchange';
const WAVES = ['wave1/salvage','wave2','wave3','wave4','wave5','wave6','wave7','wave8','wave9']
  .map(w => `${RESEARCH}/${w}/discovery.json`);

// --- load + dedup (later wave wins; puts refined AZ from wave2 over wave1) ---
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

const esc = t => String(t == null ? '' : t)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function homeCell(r){
  if (r.config_home === 'parameter') {
    const cb = r.constraint_basis && r.constraint_basis !== 'n/a' ? r.constraint_basis : '';
    return cb ? `parameter · ${esc(cb)}` : 'parameter';
  }
  return 'structural';
}
function clockCell(r){
  const eff = r.clock_effect || 'none';
  return r.clock_spec ? `${esc(eff)} · ${esc(r.clock_spec)}` : esc(eff);
}
function authCell(r){
  const a = esc(r.source_authority);
  return r.official_link ? `<a href="${esc(r.official_link)}" target="_blank" rel="noopener">${a}</a>` : a;
}
function ruleRows(rules){
  return rules.map(r => `      <tr>
        <td class="id"><code>${esc(r.rule_id)}</code></td>
        <td class="home">${homeCell(r)}</td>
        <td class="clock">${clockCell(r)}</td>
        <td class="rule"><div class="atomic">${esc(r.atomic_rule)}${r.is_paraphrase?' <span class="para">(paraphrase)</span>':''}</div><div class="verbatim">&ldquo;${esc(r.source_language)}&rdquo;</div></td>
        <td class="auth">${authCell(r)}</td>
      </tr>`).join('\n');
}

const CSS = `
:root{--fg:#1a1a1a;--muted:#666;--line:#e2e2e2;--bg:#fff;--accent:#0b5cad;--verbatim:#3a5a3a;--chip:#f0f3f7}
*{box-sizing:border-box}
body{font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg);margin:0;padding:0 24px 80px}
.wrap{max-width:1100px;margin:0 auto}
header{padding:28px 0 8px;border-bottom:2px solid var(--fg);margin-bottom:8px}
h1{font-size:26px;margin:0 0 6px}
.sub{color:var(--muted);font-size:13.5px}
.stats{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px}
.chip{background:var(--chip);border:1px solid var(--line);border-radius:20px;padding:3px 12px;font-size:12.5px;color:#333}
h2{font-size:18px;margin:34px 0 10px;padding-bottom:5px;border-bottom:1px solid var(--line);color:var(--accent)}
table{width:100%;border-collapse:collapse;margin:6px 0 10px;font-size:13.5px}
th{text-align:left;background:#f7f8fa;border-bottom:2px solid var(--line);padding:7px 9px;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#555;vertical-align:bottom}
td{border-bottom:1px solid var(--line);padding:9px;vertical-align:top}
td.id{white-space:nowrap}
code{background:#f2f2f2;border-radius:4px;padding:1px 5px;font-size:12px}
.home,.clock{font-size:12.5px;color:#444;white-space:normal}
.atomic{font-weight:600;margin-bottom:5px}
.verbatim{color:var(--verbatim);font-style:italic;font-size:12.8px}
.para{color:#a15c00;font-weight:600;font-style:italic;font-size:11.5px}
.auth{font-size:12.5px;white-space:nowrap}
.auth a{color:var(--accent)}
ul.notes{margin:6px 0 0;padding-left:20px}
ul.notes li{margin:5px 0;font-size:13.5px}
ul.notes code{font-size:11.5px}
.note-box{background:#fbf7ec;border:1px solid #e6d9b0;border-radius:6px;padding:12px 14px;font-size:13px;margin:12px 0;white-space:pre-wrap}
footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media print{body{padding:0}.chip{background:none}}
`;

function categoryOrder(rules){ const c=[]; for(const r of rules) if(!c.includes(r.category)) c.push(r.category); return c; }

function statePage(s){
  const nm = String(s.state).replace(/\..*$/,'').trim();
  const code = abbr(nm);
  const rules = s.rules || [];
  const negs = s.material_negatives || [];
  const brs = s.structural_branches || [];
  const cats = categoryOrder(rules);
  const catBlocks = cats.map(c => {
    const rs = rules.filter(r => r.category === c);
    return `    <h2>${esc(c)} <span style="color:#999;font-weight:400;font-size:13px">(${rs.length})</span></h2>
    <table>
      <thead><tr><th>Rule&nbsp;ID</th><th>Home / Basis</th><th>Clock</th><th>Atomic rule &amp; verbatim source</th><th>Authority</th></tr></thead>
      <tbody>
${ruleRows(rs)}
      </tbody>
    </table>`;
  }).join('\n');

  const negBlock = negs.length ? `    <h2>Material negatives <span style="color:#999;font-weight:400;font-size:13px">(${negs.length})</span></h2>
    <ul class="notes">
${negs.map(n => `      <li>${n.concept_key?`<code>${esc(n.concept_key)}</code> — `:''}${esc(n.note)}</li>`).join('\n')}
    </ul>` : '';
  const brBlock = brs.length ? `    <h2>Structural branches <span style="color:#999;font-weight:400;font-size:13px">(${brs.length})</span></h2>
    <ul class="notes">
${brs.map(b => `      <li>${b.concept_key?`<code>${esc(b.concept_key)}</code> — `:''}${esc(b.description)}</li>`).join('\n')}
    </ul>` : '';
  const researchNote = s.research_note ? `    <div class="note-box"><strong>Research note (from discovery agent):</strong>\n${esc(s.research_note)}</div>` : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(nm)} (${esc(code)}) — public-records rules</title>
<style>${CSS}</style>
</head><body><div class="wrap">
  <header>
    <h1>${esc(nm)} <span style="color:#999">(${esc(code)})</span></h1>
    <div class="sub">Public-records request-processing rules — discovery output, verbatim statutory language with citations. Not legal advice; no reconciliation applied.</div>
    <div class="stats">
      <span class="chip"><b>${rules.length}</b> rules</span>
      <span class="chip"><b>${s.verbatim_captured_count||0}</b> verbatim</span>
      <span class="chip"><b>${negs.length}</b> material negatives</span>
      <span class="chip"><b>${brs.length}</b> structural branches</span>
      <span class="chip">source: ${esc(origin[nm]||'')}</span>
    </div>
  </header>
${researchNote}
${catBlocks}
${negBlock}
${brBlock}
  <footer>OptimumQ 50-state rules gather · ${esc(nm)} · generated 2026-07-22 · discovery only (no reconciliation) · for review/brainstorming.</footer>
</div></body></html>`;
}

// --- write files ---
const names = Object.keys(map).sort();
const written = [];
for (const nm of names) {
  const code = abbr(nm);
  const fname = `${nm.replace(/\s+/g,'_')}_${code}.html`;
  fs.writeFileSync(path.join(OUT, fname), statePage(map[nm]));
  written.push({ nm, code, fname, rules: map[nm].rules.length });
}

// --- index.html ---
const rows = written.map(w => `    <tr><td><a href="${esc(w.fname)}">${esc(w.nm)}</a></td><td>${esc(w.code)}</td><td style="text-align:right">${w.rules}</td></tr>`).join('\n');
const total = written.reduce((a,w)=>a+w.rules,0);
const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>State rules — index (${written.length} states)</title><style>${CSS}
table{max-width:560px}th,td{padding:7px 10px}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}</style>
</head><body><div class="wrap">
  <header><h1>State public-records rules</h1>
  <div class="sub">${written.length} states · ${total} rules · discovery output (no reconciliation) · generated 2026-07-22</div></header>
  <p style="color:#666;font-size:13px">Click a state to open it. (Links work when the state files sit in the same folder as this index.)</p>
  <table><thead><tr><th>State</th><th>Code</th><th style="text-align:right">Rules</th></tr></thead>
  <tbody>
${rows}
    <tr style="font-weight:700;border-top:2px solid #ccc"><td>TOTAL</td><td>${written.length} states</td><td style="text-align:right">${total}</td></tr>
  </tbody></table>
  <footer>OptimumQ 50-state rules gather · for review/brainstorming.</footer>
</div></body></html>`;
fs.writeFileSync(path.join(OUT, '_index.html'), index);

console.log(`wrote ${written.length} state files + _index.html to ${OUT}`);
console.log(`total rules: ${total}`);
