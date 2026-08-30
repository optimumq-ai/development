// DEAD / UNFINISHED CODE: orphan frontend files, backend routes nobody calls, frontend calls to no route,
// services nothing requires, system_config keys read-but-never-written / written-but-never-read (heuristics).
const fs=require('fs'), path=require('path');
const FE='/opt/optimumq/frontend/src', BE='/opt/optimumq/backend', SRC=BE+'/src';
function walk(d,out=[]){for(const f of fs.readdirSync(d)){const p=path.join(d,f);const st=fs.statSync(p);if(st.isDirectory()){if(f==='node_modules')continue;walk(p,out);}else if(/\.(js|jsx|ts|tsx)$/.test(f))out.push(p);}return out;}
const rel=p=>p.replace('/opt/optimumq/','');
// 1. frontend import graph
const feFiles=walk(FE); const seen=new Set(); const entry=fs.existsSync(FE+'/index.js')?FE+'/index.js':FE+'/index.tsx';
function resolveImp(from,spec){if(!spec.startsWith('.'))return null;const base=path.resolve(path.dirname(from),spec);for(const c of [base,base+'.js',base+'.jsx',base+'.ts',base+'.tsx',base+'/index.js',base+'/index.tsx']){if(fs.existsSync(c)&&fs.statSync(c).isFile())return c;}return null;}
(function visit(f){if(seen.has(f))return;seen.add(f);const s=fs.readFileSync(f,'utf8');for(const m of s.matchAll(/(?:import[^'"]*from\s*|import\s*\(|require\()\s*['"]([^'"]+)['"]/g)){const r=resolveImp(f,m[1]);if(r)visit(r);}})(entry);
const orphans=feFiles.filter(f=>!seen.has(f)&&!/\.test\.|setupTests|reportWebVitals|react-app-env/.test(f)).map(rel);
// 2. backend routes
const server=fs.readFileSync(BE+'/server.js','utf8');
const mounts=[...server.matchAll(/app\.use\('(\/api[^']*)',\s*require\('([^']+)'\)/g)].map(m=>({prefix:m[1],file:path.resolve(BE,m[2])+(m[2].endsWith('.js')?'':'.js')}));
const beRoutes=[];for(const mt of mounts){if(!fs.existsSync(mt.file))continue;const s=fs.readFileSync(mt.file,'utf8');for(const m of s.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*)['"`]/g)){beRoutes.push({method:m[1].toUpperCase(),path:(mt.prefix+(m[2]==='/'?'':m[2])).replace(/\/$/,'')||mt.prefix,file:rel(mt.file)});}}
const norm=p=>p.replace(/\/:[A-Za-z_]+\??/g,'/:p').replace(/\/$/,'');
function routeMatch(rt,call){const a=norm(rt).split('/'),b=norm(call).split('/');if(a.length!==b.length)return false;return a.every((s,i)=>s===':p'||b[i]===':p'||s===b[i]);}
// frontend api calls — whole first argument; concatenations and template params → :p
function argPattern(arg){let a=arg.trim();a=a.replace(/\$\{[^}]*\}/g,':p');a=a.replace(/['"`]\s*\+\s*[^+'"`]+?\s*\+\s*['"`]/g,':p');a=a.replace(/['"`]\s*\+\s*[^+'"`]+$/,'/:p');a=a.replace(/^['"`]|['"`]$/g,'');a=a.replace(/\/+/g,'/');return a.split('?')[0].replace(/\/$/,'');}
const feCalls=[];
for(const f of feFiles){const s=fs.readFileSync(f,'utf8');const lines=s.split('\n');lines.forEach((ln,i)=>{
 const rx=/api\.(get|post|put|patch|delete)\(/g;let m;while((m=rx.exec(ln))){let j=m.index+m[0].length,depth=0,arg='';for(;j<ln.length;j++){const c=ln[j];if(c==='('||c==='['||c==='{')depth++;if(c===')'||c===']'||c==='}'){if(depth===0)break;depth--;}if(c===','&&depth===0)break;arg+=c;}
  if(!/^\s*['"`]\//.test(arg))continue;feCalls.push({method:m[1].toUpperCase(),path:'/api'+argPattern(arg),file:rel(f),line:i+1});}
 for(const m2 of ln.matchAll(/fetch\(\s*['"`](\/api[^'"`?]*)/g)){feCalls.push({method:'GET?',path:m2[1],file:rel(f),line:i+1});}});}
// tests references
const testFiles=walk(BE+'/tests');const testText=testFiles.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const testPaths=new Set();for(const m of testText.matchAll(/['"`](\/[a-z][a-z0-9\-\/:_]*)/gi)){testPaths.add(m[1]);}
function testCovers(rt){const p=rt.path.replace(/^\/api/,'');for(const t of testPaths){if(routeMatch(p,t.split('?')[0]))return true;}return false;}
const uncalled=beRoutes.filter(rt=>!feCalls.some(c=>(c.method===rt.method||c.method==='GET?')&&routeMatch(rt.path,c.path)));
const uncalledUntested=uncalled.filter(rt=>!testCovers(rt));
const noRoute=feCalls.filter(c=>!beRoutes.some(rt=>(c.method===rt.method||c.method==='GET?')&&routeMatch(rt.path,c.path)));
// 3. services nobody requires
const svc=walk(SRC+'/services');const all=walk(SRC).concat([BE+'/server.js']).concat(testFiles);const allText=all.map(f=>({f,s:fs.readFileSync(f,'utf8')}));
const unrequired=svc.filter(f=>{const base=path.basename(f,'.js');return !allText.some(x=>x.f!==f&&new RegExp("require\\([^)]*['\"/]"+base+"(\\.js)?['\"]").test(x.s));}).map(rel);
// 4. system_config keys (heuristic: a key literal in any backend file that writes system_config counts as written)
const beFiles=allText.filter(x=>x.f.startsWith(SRC));const beText=beFiles.map(x=>x.s).join('\n');
const reads=new Set([...beText.matchAll(/cfg\(\s*'([a-z_0-9]+)'/g)].map(m=>m[1]).concat([...beText.matchAll(/FROM system_config WHERE key\s*=\s*'([a-z_0-9]+)'/g)].map(m=>m[1])));
const writes=new Set();const cfgRoute=fs.readFileSync(SRC+'/routes/config.js','utf8');const al=cfgRoute.match(/var allowed = \[([^\]]*)\]/);if(al)for(const m of al[1].matchAll(/'([a-z_0-9]+)'/g))writes.add(m[1]);
for(const x of beFiles){if(/INSERT INTO system_config|UPDATE system_config|system_config \(key, value\)/.test(x.s)){for(const k of reads){if(new RegExp("['\"]"+k+"['\"]").test(x.s))writes.add(k);}}}
const fixture=fs.readFileSync(SRC+'/db/seed_fixture.sql','utf8');const seeded=new Set([...fixture.matchAll(/\('([a-z_0-9]+)', '[^']*', '20/g)].map(m=>m[1]));
const readNeverWritten=[...reads].filter(k=>!writes.has(k)).map(k=>({key:k,seeded:seeded.has(k)}));
const writtenNeverRead=[...writes].filter(k=>!reads.has(k)&&!new RegExp("['\"]"+k+"['\"]").test(beText.replace(cfgRoute,'')));
console.log(JSON.stringify({feFiles:feFiles.length,orphanFrontendFiles:orphans,backendRoutes:beRoutes.length,frontendApiCalls:feCalls.length,backendRoutesNoFrontendCaller:uncalled.map(r=>r.method+' '+r.path),backendRoutesNoFrontendNoTest:uncalledUntested,frontendCallsWithNoRoute:noRoute,servicesNothingRequires:unrequired,configKeysReadNeverWritten:readNeverWritten,configKeysWrittenNeverRead:writtenNeverRead},null,1));
