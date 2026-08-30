// ROUTE CRAWL — navigation only. Every non-GET /api request is BLOCKED (and logged), so the crawl is
// provably non-writing against the live UI. One active user per user type.
process.chdir('/opt/optimumq/backend');
require('/opt/optimumq/backend/node_modules/dotenv').config({ path: '/opt/optimumq/backend/.env' });
const fs=require('fs');const db=require('/opt/optimumq/backend/src/db');const auth=require('/opt/optimumq/backend/src/services/auth');
const { chromium } = require('playwright');
const OUT=process.argv[2];
(async()=>{
  await db.initDb();
  const app=fs.readFileSync('/opt/optimumq/frontend/src/App.js','utf8');
  const routes=[...app.matchAll(/<Route\s+path="([^"]+)"(?![^>]*Navigate)/g)].map(m=>'/'+m[1].replace(/^\//,'')).filter(r=>!r.includes(':')&&r!=='/*');
  const extra=['/admin?tab=guide','/setup/ai-configuration?tab=deployment','/setup/ai-configuration?tab=touchpoints','/setup/ai-configuration?tab=security','/setup/fee-law?tab=city','/setup/fee-law?tab=document','/setup/fee-law?tab=test','/setup/request-rules?tab=exemptions','/setup/request-rules?tab=eligibility','/setup/request-rules?tab=deadlines','/setup/request-rules?tab=intake'];
  const types=['oro_sysadmin','oro_director','oro_senior_legal','oro_supervisor','oro_associate','oro_finance','team_manager','team_supervisor','team_staff'];
  const b=await chromium.launch();const res=[];
  for(const ty of types){
    const u=await db.get("SELECT u.* FROM users u JOIN user_user_types x ON x.user_id=u.id JOIN user_types t ON t.id=x.user_type_id WHERE t.key=? AND u.status='active' ORDER BY u.id LIMIT 1",[ty]);
    if(!u){res.push({type:ty,skipped:'no active user'});continue;}
    const tok=await auth.signAccessToken(u);
    const ctx=await b.newContext({viewport:{width:1400,height:900}});const p=await ctx.newPage();
    const blocked=[],failed=[],cons=[],perr=[];
    await p.route('**/api/**',r=>{const m=r.request().method();if(m!=='GET'){blocked.push(m+' '+r.request().url().replace(/^https?:\/\/[^/]+/,''));r.abort();}else r.continue();});
    p.on('response',r=>{const url=r.url();if(url.includes('/api/')&&r.status()>=400)failed.push(r.status()+' '+url.replace(/^https?:\/\/[^/]+/,''));});
    p.on('console',m=>{if(m.type()==='error')cons.push(m.text().slice(0,200));});
    p.on('pageerror',e=>perr.push(String(e.message).slice(0,200)));
    await p.goto('http://localhost/');await p.evaluate(t=>localStorage.setItem('oq_token',t),tok);
    for(const r of routes.concat(extra)){
      blocked.length=0;failed.length=0;cons.length=0;perr.length=0;
      let landed='',text='',err='';
      try{await p.goto('http://localhost'+r,{waitUntil:'load',timeout:20000});await p.waitForTimeout(3500);landed=p.url().replace('http://localhost','');text=await p.evaluate(()=>document.body.innerText||'');}
      catch(e){err=String(e.message).slice(0,160);}
      const main=text.replace(/[\s\S]*?(Administration|Dashboard)/,'');
      res.push({type:ty,route:r,landed,err,len:text.length,loading:/Loading/.test(text),blank:text.length<400,notFound:/not found|404/i.test(text),couldNot:(text.match(/could not|failed to|something went wrong|unexpected error/gi)||[]).length,blocked:blocked.slice(),failed:failed.slice(),console:cons.slice(0,5),pageErrors:perr.slice(0,3)});
      fs.writeFileSync(OUT,JSON.stringify(res,null,1));
    }
    await ctx.close();
  }
  await b.close();fs.writeFileSync(OUT,JSON.stringify(res,null,1));console.log('done',res.length);process.exit(0);
})().catch(e=>{console.error('CRAWL ERROR',e);process.exit(1);});
