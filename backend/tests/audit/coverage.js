// COVERAGE GAPS: backend routes no harness references; frontend routes no harness drives.
const fs=require('fs'),path=require('path');const BE='/opt/optimumq/backend';
function walk(d,out=[]){for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(fs.statSync(p).isDirectory()){if(f!=='node_modules')walk(p,out);}else if(/\.js$/.test(f))out.push(p);}return out;}
const server=fs.readFileSync(BE+'/server.js','utf8');
const mounts=[...server.matchAll(/app\.use\('(\/api[^']*)',\s*require\('([^']+)'\)/g)].map(m=>({prefix:m[1],file:path.resolve(BE,m[2])+(m[2].endsWith('.js')?'':'.js')}));
const tests=walk(BE+'/tests').map(f=>fs.readFileSync(f,'utf8')).join('\n');
const norm=p=>p.replace(/\/:[A-Za-z_]+/g,'/:p').replace(/\/$/,'');
const out={};let total=0,uncovered=0;
for(const mt of mounts){if(!fs.existsSync(mt.file))continue;const s=fs.readFileSync(mt.file,'utf8');const list=[];
 for(const m of s.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*)['"`]/g)){total++;const p=(mt.prefix.replace(/^\/api/,'')+(m[2]==='/'?'':m[2]));const segs=norm(p).split('/').filter(Boolean);
  // covered if the test text contains the literal path (params stripped to their prefix)
  const lit=segs.filter(x=>x!==':p');const probe='/'+lit.join('/');const covered=lit.length&&tests.includes(probe);if(!covered){uncovered++;list.push(m[1].toUpperCase()+' '+p);}}
 if(list.length)out[mt.file.replace('/opt/optimumq/','')]=list;}
const app=fs.readFileSync('/opt/optimumq/frontend/src/App.js','utf8');const feRoutes=[...app.matchAll(/<Route\s+path="([^"]+)"(?![^>]*Navigate)/g)].map(m=>'/'+m[1].replace(/^\//,''));
const feUncovered=feRoutes.filter(r=>!tests.includes(r.split('/:')[0]));
console.log(JSON.stringify({backendRoutes:total,backendUncovered:uncovered,byFile:out,frontendRoutes:feRoutes.length,frontendRoutesNoHarness:feUncovered},null,1));
