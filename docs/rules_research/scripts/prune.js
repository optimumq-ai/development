// Apply the approved relevance prune. Originals (wave*/discovery.json) untouched.
// Removes every CUT/MAYBE rule EXCEPT the 15 held items; writes pruned dataset + audit log to the
// repo and regenerates per-state HTML + an Excel (kept + removed sheets) into exchange/pruned/.
const P = '/tmp/claude-998/-home-optimumq/fb4aa3f1-bf0e-4830-8e27-3fd6a744a532/scratchpad';
const ExcelJS = require(P + '/node_modules/exceljs');
const fs = require('fs'); const path = require('path');
const { abbr } = require(P + '/render.js');

const RESEARCH = '/opt/optimumq/docs/rules_research';
const REPO_OUT = RESEARCH + '/pruned';
const EX_OUT = '/home/optimumq/exchange/pruned';
const WAVES = ['wave1/salvage','wave2','wave3','wave4','wave5','wave6','wave7','wave8','wave9'].map(w=>`${RESEARCH}/${w}/discovery.json`);
const origin = {};
const map = {};
for (const f of WAVES) { let o; try{o=JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){continue}
  for (const s of (Array.isArray(o)?o:o.states||[o])) { if(!s||!s.state)continue; const nm=String(s.state).replace(/\..*$/,'').trim(); map[nm]=s; origin[nm]=f.split('/').slice(-2)[0]; } }
// merge completeness-cross-check additions (verified, always KEEP) into the matching state
let ADDED = 0;
try { const supp=JSON.parse(fs.readFileSync(RESEARCH+'/supplements/completeness_additions.json','utf8'));
  for (const a of (supp.additions||[])) { const s=map[a.state]; if(!s)continue;
    for (const r of a.rules) { if(!s.rules.some(x=>x.rule_id===r.rule_id)){ s.rules.push(r); ADDED++; } } }
} catch(e) {}

// ---- verdicts: hand-approved for CA/IL/CT, classifier for the rest (same as calibrated triage) ----
const HAND = {
  'CA-0004':['CUT'],'CA-0005':['CUT'],'CA-0015':['CUT'],'CA-0016':['CUT'],'CA-0029':['CUT'],'CA-0030':['CUT'],'CA-0031':['CUT'],
  'IL-0005':['MAYBE'],'IL-0008':['MAYBE'],'IL-0009':['MAYBE'],'IL-0041':['CUT'],'IL-0042':['CUT'],'IL-0043':['CUT'],'IL-0044':['CUT'],'IL-0045':['CUT'],'IL-0046':['CUT'],'IL-0047':['CUT'],'IL-0048':['CUT'],
  'CT-0004':['CUT'],'CT-0005':['CUT'],'CT-0006':['CUT'],'CT-0008':['CUT'],'CT-0011':['CUT'],'CT-0019':['MAYBE'],'CT-0021':['CUT'],'CT-0023':['MAYBE'],'CT-0027':['MAYBE'],'CT-0033':['CUT'],'CT-0034':['CUT'],'CT-0035':['CUT'],'CT-0036':['CUT'],'CT-0037':['CUT'],'CT-0038':['MAYBE'],'CT-0039':['MAYBE'],'CT-0040':['MAYBE'],
};
const KEEP_DEF = /(recurrent|voluminous|commercial|standard_request|time_intensive|resident|custodian|foia_officer|public_officer|records_officer|records_custodian)/;
function classify(r){
  const cat=(r.category||'').toLowerCase().trim(); const ck=(r.concept_key||'').toLowerCase();
  const fam=ck.split('.')[0]; const type=(r.rule_type||'').toLowerCase();
  if (fam==='inspection') return ['CUT','walk-in / in-person inspection'];
  if (/inspect/.test(ck) && !/copy|electronic|format|deliver|self/.test(ck)) return ['CUT','walk-in / in-person inspection'];
  if (/(notif|notice|inform|advise)/.test(ck) && /(appeal|review|pac|counselor|commission|judicial|court)/.test(ck)) return ['CUT','appeal-rights notice content'];
  if (/^(appeal|appeals|enforcement|remedy|penalty|penalties)$/.test(fam)) return ['CUT','external appeal / enforcement'];
  if (/^(appeals?|enforcement)$/.test(cat)) return ['CUT','external appeal / enforcement'];
  if (/^(coverage|scope)$/.test(fam)) return ['CUT','scope definition (no workflow branch)'];
  if ((type==='definition' || /_definition$/.test(ck)) && !KEEP_DEF.test(ck)) return ['CUT','scope definition (no workflow branch)'];
  if (fam==='review' || cat==='review') return ['MAYBE','external-agency review'];
  if (/burden(?!some)|presumption/.test(ck)) return ['MAYBE','policy principle / evidentiary standard'];
  if (fam==='handling' || /no_delay|no_obstruct|no_third_party/.test(ck)) return ['MAYBE','policy principle'];
  if (/vexatious/.test(ck)) return ['MAYBE','vexatious-requester relief'];
  if (/special.?record|inmate|security_record|preservation|retention|trade_secret/.test(ck)) return ['MAYBE','special-record / niche'];
  return ['KEEP','core request→response workflow'];
}
const VALIDATED = ['California','Illinois','Connecticut'];
function verdict(nm,r){ if(VALIDATED.includes(nm)){ const h=HAND[r.rule_id]; return h?[h[0], 'approved']:['KEEP','core']; } return classify(r); }

const HELD = new Set(['AL-0011','FL-0023','MI-0081','MN-0023','NV-0021','NJ-T24','NJ-T39','NJ-T42','NJ-T43','NJ-T44','NY-0005','NY-0037','OR-0034','PA-0001','TN-0041']);

// ---- prune ----
const pruned = []; const cutlog = []; let kept=0, removed=0, heldKept=0;
const heldSeen = new Set();
for (const nm of Object.keys(map).sort()) {
  const s = map[nm]; const keepRules = [];
  for (const r of s.rules) {
    const [v] = verdict(nm, r);
    const flagged = (v==='CUT' || v==='MAYBE');
    if (flagged && HELD.has(r.rule_id)) { heldKept++; heldSeen.add(r.rule_id); }
    if (flagged && !HELD.has(r.rule_id)) {
      removed++;
      cutlog.push({ state:nm, code:abbr(nm), id:r.rule_id, verdict:v, category:r.category, concept_key:r.concept_key, rule:(r.atomic_rule||'') });
    } else { keepRules.push(r); kept++; }
  }
  pruned.push({ state:nm, code:abbr(nm), source_wave:origin[nm], rules:keepRules,
    material_negatives:s.material_negatives||[], structural_branches:s.structural_branches||[],
    verbatim_captured_count:s.verbatim_captured_count, ...(s.research_note?{research_note:s.research_note}:{}) });
}

// ---- write repo artifacts ----
fs.mkdirSync(REPO_OUT, { recursive:true });
fs.writeFileSync(REPO_OUT + '/pruned_discovery.json', JSON.stringify(pruned,null,2)+'\n');
let cl = `# Relevance-prune cut log\n\nApplied 2026-07-23. Removed ${removed} of ${kept+removed} rules (kept ${kept}). `
 + `Originals untouched in \`../wave*/discovery.json\`. The ${HELD.size} held items (pulled by Kevin for individual review) were RETAINED.\n\n`
 + `Rules removed, by state:\n\n| State | Rule ID | Verdict | Category | Concept key | Rule |\n|---|---|---|---|---|---|\n`;
for (const c of cutlog) cl += `| ${c.code} | ${c.id} | ${c.verdict} | ${c.category} | \`${c.concept_key}\` | ${String(c.rule).replace(/\|/g,'\\|').slice(0,160)} |\n`;
cl += `\n## Held (retained despite CUT/MAYBE flag)\n\n` + [...HELD].map(id=>`- ${id}`).join('\n') + '\n';
fs.writeFileSync(REPO_OUT + '/CUT_LOG.md', cl);

// ---- render pruned per-state HTML (same format as before) ----
fs.mkdirSync(EX_OUT, { recursive:true });
const esc = t => String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const homeCell=r=>r.config_home==='parameter'?(r.constraint_basis&&r.constraint_basis!=='n/a'?`parameter · ${esc(r.constraint_basis)}`:'parameter'):'structural';
const clockCell=r=>{const e=r.clock_effect||'none';return r.clock_spec?`${esc(e)} · ${esc(r.clock_spec)}`:esc(e);};
const authCell=r=>{const a=esc(r.source_authority);return r.official_link?`<a href="${esc(r.official_link)}" target="_blank" rel="noopener">${a}</a>`:a;};
const CSS=`:root{--fg:#1a1a1a;--muted:#666;--line:#e2e2e2;--bg:#fff;--accent:#0b5cad;--verbatim:#3a5a3a;--chip:#f0f3f7}*{box-sizing:border-box}body{font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg);margin:0;padding:0 24px 80px}.wrap{max-width:1100px;margin:0 auto}header{padding:28px 0 8px;border-bottom:2px solid var(--fg);margin-bottom:8px}h1{font-size:26px;margin:0 0 6px}.sub{color:var(--muted);font-size:13.5px}.stats{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px}.chip{background:var(--chip);border:1px solid var(--line);border-radius:20px;padding:3px 12px;font-size:12.5px;color:#333}h2{font-size:18px;margin:34px 0 10px;padding-bottom:5px;border-bottom:1px solid var(--line);color:var(--accent)}table{width:100%;border-collapse:collapse;margin:6px 0 10px;font-size:13.5px}th{text-align:left;background:#f7f8fa;border-bottom:2px solid var(--line);padding:7px 9px;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#555;vertical-align:bottom}td{border-bottom:1px solid var(--line);padding:9px;vertical-align:top}td.id{white-space:nowrap}code{background:#f2f2f2;border-radius:4px;padding:1px 5px;font-size:12px}.home,.clock{font-size:12.5px;color:#444}.atomic{font-weight:600;margin-bottom:5px}.verbatim{color:var(--verbatim);font-style:italic;font-size:12.8px}.para{color:#a15c00;font-weight:600;font-style:italic;font-size:11.5px}.auth{font-size:12.5px;white-space:nowrap}.auth a{color:var(--accent)}ul.notes{margin:6px 0 0;padding-left:20px}ul.notes li{margin:5px 0;font-size:13.5px}footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}`;
function ruleRows(rs){return rs.map(r=>`<tr><td class="id"><code>${esc(r.rule_id)}</code></td><td class="home">${homeCell(r)}</td><td class="clock">${clockCell(r)}</td><td class="rule"><div class="atomic">${esc(r.atomic_rule)}${r.is_paraphrase?' <span class="para">(paraphrase)</span>':''}</div><div class="verbatim">&ldquo;${esc(r.source_language)}&rdquo;</div></td><td class="auth">${authCell(r)}</td></tr>`).join('\n');}
function statePage(s){
  const rules=s.rules||[]; const cats=[]; for(const r of rules) if(!cats.includes(r.category)) cats.push(r.category);
  const blocks=cats.map(c=>{const rs=rules.filter(r=>r.category===c);return `<h2>${esc(c)} <span style="color:#999;font-weight:400;font-size:13px">(${rs.length})</span></h2>\n<table><thead><tr><th>Rule ID</th><th>Home / Basis</th><th>Clock</th><th>Atomic rule &amp; verbatim source</th><th>Authority</th></tr></thead><tbody>\n${ruleRows(rs)}\n</tbody></table>`;}).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.state)} (${esc(s.code)}) — pruned rules</title><style>${CSS}</style></head><body><div class="wrap"><header><h1>${esc(s.state)} <span style="color:#999">(${esc(s.code)})</span></h1><div class="sub">Public-records request-processing rules — <b>relevance-pruned</b> to what the automated system acts on. Verbatim + citations. Not legal advice.</div><div class="stats"><span class="chip"><b>${rules.length}</b> rules (kept)</span><span class="chip">source: ${esc(s.source_wave||'')}</span></div></header>\n${blocks}\n<footer>OptimumQ 50-state rules gather · ${esc(s.state)} · pruned 2026-07-23 · originals retained in git.</footer></div></body></html>`;
}
for (const s of pruned) fs.writeFileSync(path.join(EX_OUT, `${s.state.replace(/\s+/g,'_')}_${s.code}.html`), statePage(s));

// ---- pruned Excel (All Rules kept + Summary + Removed audit) ----
const wb = new ExcelJS.Workbook();
const s1 = wb.addWorksheet('All Rules (kept)', { views:[{state:'frozen',ySplit:1}] });
s1.columns = [{header:'State',key:'st',width:15},{header:'Code',key:'cd',width:6},{header:'Rule ID',key:'id',width:10},{header:'Category',key:'cat',width:15},{header:'Concept key',key:'ck',width:30},{header:'Home/Basis',key:'hb',width:14},{header:'Clock',key:'cl',width:26},{header:'Atomic rule',key:'ar',width:64},{header:'Verbatim source',key:'src',width:64},{header:'Authority',key:'au',width:26},{header:'Official link',key:'ln',width:36}];
for (const s of pruned) for (const r of s.rules) s1.addRow({st:s.state,cd:s.code,id:r.rule_id,cat:r.category,ck:r.concept_key,hb:homeCell(r),cl:(r.clock_effect||'none')+(r.clock_spec?' · '+r.clock_spec:''),ar:r.atomic_rule||'',src:r.source_language||'',au:r.source_authority||'',ln:r.official_link||''});
const s2 = wb.addWorksheet('Summary');
s2.columns=[{header:'State',key:'st',width:16},{header:'Code',key:'cd',width:6},{header:'Kept',key:'k',width:8},{header:'Removed',key:'r',width:9}];
const s3 = wb.addWorksheet('Removed (audit)', { views:[{state:'frozen',ySplit:1}] });
s3.columns=[{header:'State',key:'st',width:15},{header:'Rule ID',key:'id',width:10},{header:'Verdict',key:'v',width:8},{header:'Category',key:'cat',width:15},{header:'Concept key',key:'ck',width:32},{header:'Rule',key:'ar',width:90}];
const remByState={}; for(const c of cutlog){remByState[c.state]=(remByState[c.state]||0)+1; s3.addRow({st:c.code,id:c.id,v:c.verdict,cat:c.category,ck:c.concept_key,ar:c.rule});}
for(const s of pruned) s2.addRow({st:s.state,cd:s.code,k:s.rules.length,r:remByState[s.state]||0});
s2.addRow({st:'TOTAL',cd:'',k:kept,r:removed}).font={bold:true};
for (const ws of [s1,s2,s3]){ const h=ws.getRow(1); h.font={bold:true,color:{argb:'FFFFFFFF'}}; h.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0B5CAD'}}); ws.autoFilter={from:{row:1,column:1},to:{row:1,column:ws.columns.length}}; ws.eachRow((row,n)=>{if(n>1)row.alignment={vertical:'top',wrapText:true};}); }
wb.xlsx.writeFile(EX_OUT + '/State_rules_PRUNED.xlsx').then(()=>{
  console.log(`PRUNE COMPLETE (supplement additions merged: ${ADDED})`);
  console.log(`  kept ${kept} · removed ${removed} · held-and-retained ${heldKept}/${HELD.size}`);
  const missing=[...HELD].filter(id=>!heldSeen.has(id) && !pruned.some(s=>s.rules.some(r=>r.rule_id===id)));
  console.log(`  held items retained: ${[...HELD].filter(id=>pruned.some(s=>s.rules.some(r=>r.rule_id===id))).length}/${HELD.size}` + (missing.length?`  MISSING: ${missing.join(',')}`:''));
  console.log(`  repo: ${REPO_OUT}/pruned_discovery.json + CUT_LOG.md`);
  console.log(`  exchange: ${EX_OUT}/ (32 HTML + State_rules_PRUNED.xlsx)`);
});
