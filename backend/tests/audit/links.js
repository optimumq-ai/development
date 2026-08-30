// LINK & DOOR INTEGRITY: every in-app navigation target resolves to a real route (through redirects).
const fs=require('fs'), path=require('path');
const FE='/opt/optimumq/frontend/src', BE='/opt/optimumq/backend/src';
function walk(d,out=[]){for(const f of fs.readdirSync(d)){const p=path.join(d,f);const st=fs.statSync(p);if(st.isDirectory())walk(p,out);else if(/\.(js|jsx|ts|tsx)$/.test(f))out.push(p);}return out;}
const app=fs.readFileSync(FE+'/App.js','utf8');
const routes=[], redirects={};
for(const m of app.matchAll(/<Route\s+path="([^"]+)"([^>]*)>/g)){const p='/'+m[1].replace(/^\//,'');routes.push(p);const r=m[2].match(/Navigate to="([^"]+)"/);if(r)redirects[p]=r[1].split('?')[0];}
for(const m of app.matchAll(/<Route\s+index[^>]*Navigate to="([^"]+)"/g)){}
// AdministrationPage ?tab= redirects
const admin=fs.readFileSync(FE+'/pages/AdministrationPage.js','utf8');
const tabRedirect={}; for(const m of admin.matchAll(/activeKey === '([a-z-]+)'\) return <Navigate to="([^"]+)"/g)) tabRedirect[m[1]]=m[2].split('?')[0];
const tabs=[...admin.matchAll(/\{ key: '([a-z-]+)',\s+label/g)].map(m=>m[1]);
function matches(route, target){const rs=route.split('/'),ts=target.split('/');if(rs.length!==ts.length)return false;return rs.every((seg,i)=>seg.startsWith(':')||seg==='*'||seg===ts[i]);}
function resolve(t, hops=0){const [p,q]=t.split('?');const clean=p.replace(/\/$/,'')||'/';
  if(clean==='/admin'&&q){const tab=(q.match(/tab=([a-z-]+)/)||[])[1];if(tab){if(tabRedirect[tab])return resolve(tabRedirect[tab],hops+1);if(!tabs.includes(tab))return {ok:false,why:'admin tab "'+tab+'" does not exist and has no redirect'};}}
  const r=routes.find(x=>matches(x,clean));if(!r)return {ok:false,why:'no route'};
  if(redirects[r]){if(hops>5)return {ok:false,why:'redirect loop'};const res=resolve(redirects[r],hops+1);return Object.assign({via:r},res);}
  return {ok:true,route:r};}
const targets=[];
const files=walk(FE).concat(walk(BE));
const rx=/(?:nav|navigate)\(\s*['"`](\/[^'"`?#]*[^'"`]*)['"`]|\bto=\{?['"`](\/[^'"`]*)['"`]|\bto:\s*['"`](\/[^'"`]*)['"`]|Navigate to="(\/[^"]*)"|\b(?:door|editor|areaEditor|link|href):\s*['"`](\/[^'"`]*)['"`]|href="(\/(?!api)[^"]*)"/g;
for(const f of files){const s=fs.readFileSync(f,'utf8');const lines=s.split('\n');lines.forEach((ln,i)=>{for(const m of ln.matchAll(rx)){const t=m.slice(1).find(Boolean);if(!t||t.startsWith('/api')||t.startsWith('//'))continue;if(t.includes('${'))continue;targets.push({file:f.replace('/opt/optimumq/',''),line:i+1,target:t});}});}
const bad=[];for(const t of targets){const r=resolve(t.target);if(!r.ok)bad.push(Object.assign({},t,r));}
console.log(JSON.stringify({routes:routes.length,redirects:Object.keys(redirects).length,targets:targets.length,unresolved:bad},null,1));
