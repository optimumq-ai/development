const fs=require('fs');
const lines=fs.readFileSync(process.argv[2],'utf8').split('\n').map(function(l){return l.replace(/\r$/,'');}).filter(function(l){return l.trim()&&l[0]!=='#';});
function q(s){return (s===undefined||s===null||s==='')?'NULL':"'"+String(s).replace(/'/g,"''")+"'";}
function arr(s){var a=(s&&s.trim())?s.split(';').map(function(x){return x.trim();}).filter(Boolean):[];return "'"+JSON.stringify(a).replace(/'/g,"''")+"'";}
var rt=[],ln=[];
lines.forEach(function(line){
 var f=line.split('^');
 var code=f[0].trim(),cat=f[1].trim(),name=f[2].trim(),intent=f[3],syn=f[4],dis=f[5],kw=f[6],fac=f[7],fmt=f[8],st=(f[9]||'0').trim(),av=(f[10]||'review_required').trim(),au=(f[11]||'0').trim(),own=(f[12]||'').trim(),so=(f[13]||'0').trim();
 var id='rt-'+code;
 rt.push('('+[q(id),q(cat),q(name),q(code),'NULL',q(intent),'NULL','NULL',arr(syn),arr(dis),arr(kw),arr(fac),arr(fmt),st,q(av),au,'NULL','0','0','NULL','0',q('active'),q('seed'),'NULL',so].join(',')+')');
 if(own){own.split(';').map(function(x){return x.trim();}).filter(Boolean).forEach(function(d){ln.push('('+[q('rd-'+code+'-'+d.replace('dept-','')+'-own'),q(id),q(d),q('owner'),'10'].join(',')+')');});}
});
var cols='id,category_id,name,code,description,intent,expected_content,typical_request_reason,synonyms,disambiguators,keywords,identifying_facets,formats,is_structured_data,public_availability,auto_release_eligible,redaction_profile_id,fee_estimate_low,fee_estimate_high,fee_estimate_note,is_canonical,status,source,confidence,sort_order';
var upd="ON CONFLICT (code) DO UPDATE SET category_id=EXCLUDED.category_id,name=EXCLUDED.name,intent=EXCLUDED.intent,synonyms=EXCLUDED.synonyms,disambiguators=EXCLUDED.disambiguators,keywords=EXCLUDED.keywords,identifying_facets=EXCLUDED.identifying_facets,formats=EXCLUDED.formats,is_structured_data=EXCLUDED.is_structured_data,public_availability=EXCLUDED.public_availability,auto_release_eligible=EXCLUDED.auto_release_eligible,sort_order=EXCLUDED.sort_order,source=EXCLUDED.source";
var out='-- AUTO-GENERATED from record_types_seed.tsv by gen_seed_sql.js. Do not edit by hand.\n';
out+='INSERT INTO record_types ('+cols+') VALUES\n'+rt.join(',\n')+'\n'+upd+";\n\n";
out+='INSERT INTO record_type_departments (id,record_type_id,department_id,role,sort_order) VALUES\n'+ln.join(',\n')+'\nON CONFLICT (record_type_id, department_id, role) DO NOTHING;\n';
fs.writeFileSync('src/db/seed_rt_all.sql',out);
console.log('types='+rt.length+' links='+ln.length);
