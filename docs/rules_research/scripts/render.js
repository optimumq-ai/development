// Render discovery.json states -> DATA_state_rules markdown, matching the committed wave format.
const fs = require('fs');

const ABBR = { Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',Connecticut:'CT',
  Delaware:'DE',Florida:'FL',Georgia:'GA',Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',
  Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',
  Mississippi:'MS',Missouri:'MO',Montana:'MT',Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ',
  'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',
  Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',
  Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',Wisconsin:'WI',Wyoming:'WY' };
function abbr(s){ return ABBR[s] || s.slice(0,2).toUpperCase(); }

function esc(t){
  return String(t == null ? '' : t)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}
function homeCell(r){
  if (r.config_home === 'parameter') {
    const cb = r.constraint_basis && r.constraint_basis !== 'n/a' ? r.constraint_basis : '';
    return cb ? `parameter · ${esc(cb)}` : 'parameter';
  }
  return 'structural';
}
function clockCell(r){
  const eff = r.clock_effect || 'none';
  return r.clock_spec ? `${eff} · ${esc(r.clock_spec)}` : eff;
}
function ruleRow(r){
  const para = r.is_paraphrase ? ' _(paraphrase)_' : '';
  const atomic = `**${esc(r.atomic_rule)}**${para}<br><br>_“${esc(r.source_language)}”_`;
  return `| \`${r.rule_id}\` | ${homeCell(r)} | ${clockCell(r)} | ${atomic} | ${esc(r.source_authority)} |`;
}
function stateSection(s){
  const out = [];
  out.push(`## ${s.state} (${abbr(s.state)}) — ${s.rules.length} rules`, '');
  const cats = [];
  for (const r of s.rules) if (!cats.includes(r.category)) cats.push(r.category);
  for (const c of cats){
    out.push(`### ${c}`, '');
    out.push('| Rule ID | Home / Basis | Clock | Atomic rule &amp; verbatim source | Authority |');
    out.push('|---|---|---|---|---|');
    for (const r of s.rules) if (r.category === c) out.push(ruleRow(r));
    out.push('');
  }
  const negs = s.material_negatives || [];
  if (negs.length){
    out.push('### Material negatives', '');
    for (const n of negs){
      out.push(n.concept_key ? `- \`${n.concept_key}\` — ${esc(n.note)}` : `- ${esc(n.note)}`);
    }
    out.push('');
  }
  const brs = s.structural_branches || [];
  if (brs.length){
    out.push('### Structural branches', '');
    for (const b of brs){
      out.push(b.concept_key ? `- \`${b.concept_key}\` — ${esc(b.description)}` : `- ${esc(b.description)}`);
    }
    out.push('');
  }
  return out.join('\n');
}

module.exports = { abbr, esc, stateSection };

// CLI: node render.js <discovery.json> [--check <expected.md from-line>]
if (require.main === module){
  const states = require(process.argv[2]);
  const arr = Array.isArray(states) ? states : states.states;
  process.stdout.write(arr.map(stateSection).join('\n---\n\n'));
}
