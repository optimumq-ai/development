// Regenerate exchange Master_concept_dictionary.xlsx from the master dictionary (same 7-col format).
const ExcelJS = require('/tmp/claude-998/-home-optimumq/fb4aa3f1-bf0e-4830-8e27-3fd6a744a532/scratchpad/node_modules/exceljs');
const m = require('/opt/optimumq/docs/rules_research/alignment/master_concept_dictionary.json');
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Master concept dictionary', { views:[{state:'frozen',ySplit:1}] });
ws.columns = [
 {header:'Family',key:'f',width:16},{header:'Canonical concept',key:'k',width:38},
 {header:'config_home',key:'h',width:16},{header:'States',key:'n',width:8},
 {header:'Source keys merged',key:'mk',width:10},{header:'Definition (representative)',key:'d',width:80},
 {header:'State list',key:'s',width:40}];
for (const c of m) ws.addRow({f:c.family,k:c.canonical_key,h:c.config_home,n:c.state_count,
  mk:(c.merged_from||[]).length,d:c.definition||'',s:(c.states||[]).join(' ')});
const h=ws.getRow(1); h.font={bold:true,color:{argb:'FFFFFFFF'}};
h.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0B5CAD'}});
ws.autoFilter={from:{row:1,column:1},to:{row:1,column:7}};
ws.eachRow((r,n)=>{ if(n>1) r.alignment={vertical:'top',wrapText:true}; });
wb.xlsx.writeFile('/home/optimumq/exchange/Master_concept_dictionary.xlsx')
  .then(()=>console.log('wrote', m.length, 'concepts to exchange/Master_concept_dictionary.xlsx'));
