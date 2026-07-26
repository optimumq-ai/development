const fs=require('fs'); const OUT='/home/optimumq/exchange';
const C={process:['#dae8fc','#6c8ebf'],decision:['#ffe6cc','#d79b00'],parent:['#e1d5e7','#9673a6'],
 branch:['#fdf2d0','#d6b656'],legal:['#f8cecc','#b85450'],ship:['#d5e8d4','#82b366'],closed:['#eeeeee','#999999'],
 denied:['#f8cecc','#b85450'],fin:['#fff2cc','#d6b656'],finkid:['#ffffff','#d6b656'],note:['#f5f5f5','#b3b3b3'],
 gap:['#ffe0b2','#e65100'],hl:['#fff9c4','#c0a000'],band:['#fbfbfd','#dddddd']};

// ---------- PAGE 1: MASTER ----------
const MN=[
 ['title',20,10,1000,26,'title','MASTER FLOW · single-item, manual (no-AI) — v2.2 · OH + TX refinements folded (eligibility gate · soft clock · AG-referral · 2025 amendments)'],
 ['g1',20,60,214,80,'parent','Request submitted\nPortal · Online form · Clerk (paper)\n→ normalized to ≤10 items'],
 ['g2',248,54,204,92,'decision','Requester eligible?\n(state-gated: residency ·\ncitizenship · incarcerated)'],
 ['g3',462,66,150,68,'decision','MRR?\n(this pass: single)'],
 ['g4',646,58,214,84,'parent','Acknowledgment auto-sent\n(parent flag ✓)\nmuted where “no duty to\nattach” a vague request'],
 ['s1',900,50,214,50,'parent','Fee-waiver requested\n(side path → ledger)'],
 ['s2',900,108,214,50,'parent','Commercial-rate requested\n(side path → ledger)'],
 ['lane',20,196,520,20,'lanelabel','CHILD — Process Status (the work) → drives “My Tasks”'],
 ['p1',20,236,150,60,'process','In Review'],
 ['p2',210,228,182,76,'process','Intake Review\n+ Preliminary Search\n(designate request type)'],
 ['p3',432,224,182,84,'link','Estimate Data\n(template · manual · letter)\n▸ open Estimate/Fee sub-flow'],
 ['dd',654,236,150,60,'decision','Deposit before\nwork? (config)'],
 ['p4',844,228,182,76,'process','Records Search (full)\n(if not in prelim ·\nIT · police-video)'],
 ['p5',1066,236,150,60,'process','Redaction\n(auto if none)'],
 ['p6',1262,232,168,68,'ship','SHIPPED\n(gated by payment-\nadequate)'],
 ['bv',210,368,238,100,'link','VAGUE → Clarification\nawait response (implied-ext clock)\n→ resolve ↑ or timeout → Closed\n▸ open Clarification sub-flow'],
 ['bd',500,368,232,100,'link','DENIAL\nreasons from config library →\ndirect or → Legal review\n▸ open Denial sub-flow'],
 ['bn',828,372,262,92,'branch','NO RECORD FOUND\n“not found — contact us” comm →\nimplied-ext (+3d) → auto-close (10d)'],
 ['tc',560,506,150,54,'closed','CLOSED'],
 ['td',744,506,150,54,'denied','DENIED'],
 ['l1',500,596,232,74,'legal','Legal Review – Denial (UI, submit)\nspawns: Intake / Search / Redaction /\nLegal-Redaction → Closed'],
 ['l2',828,596,262,74,'legal','Legal Redaction (UI, submit)\nspawns: Intake / Search / Redaction\n→ back to spine'],
 ['fin',20,700,1120,176,'fin','PARENT — Financial Processor & Accounting'],
 ['f1',40,742,338,66,'finkid','Ledger: child lines → compute per line →\napply per-request allowances/caps → total / invoice'],
 ['f2',394,742,300,66,'finkid','Estimate Review (config: $ threshold +\nreviewer: self / supervisor / open-records / finance)'],
 ['f3',710,742,168,66,'finkid','Payment receipt\nscreen'],
 ['f5',894,742,230,66,'finkid','→ ship-auth (payment-adequate) gates SHIPPED\n→ Hold suppresses child from My Tasks\n→ Closed–Nonpayment ⇒ Active/Closed = Closed'],
 ['f4',40,820,1084,44,'finkid','Flags:   Active / Closed        ·        Financial Status:   OK  /  Hold–Awaiting Payment  /  Closed–Nonpayment'],
 ['nc',20,888,720,108,'note','CLOCK  •  Numeric-deadline states:  extended_due = received + statutory_days + implied_extension\n(implied_extension = 0 default; triggers: clarification · “additional time” letter · no-record contact-us +3d)\n•  Soft-standard states (e.g. OH “promptly / reasonable” — no number):  NO legal due date →\ncity sets an internal OPERATIONAL target (drives My Tasks / aging), explicitly NOT a legal deadline.'],
 ['nv',760,888,400,74,'note','VISIBILITY  My Tasks = child Process Status (hidden on Hold)\nRequest Queue = parent Active/Closed (Hold shown, not removed)'],
];
const ME=[
 ['g1','g2',''],['g2','g3','no / yes(attested)'],['g3','g4','no (single)'],['g4','p1',''],
 ['s1','fin',''],['s2','fin',''],
 ['p1','p2',''],['p2','p3',''],['p3','dd',''],['dd','p4','no'],['dd','fin','yes → Hold'],['p4','p5',''],['p5','p6',''],
 ['p2','bv','vague'],['bv','p3','resolved'],['bv','tc','timeout'],
 ['p2','bd','deny'],['p4','bd',''],['p5','bd',''],['bd','td',''],['bd','l1','to legal'],
 ['p4','bn','none'],['bn','tc',''],
 ['p3','fin','estimate submit → fee calc'],['fin','p6','payment-adequate'],
 ['l1','tc',''],['p4','l2',''],['p5','l2',''],['l2','p5','back'],
];
const MLINK={p3:'pgE',bv:'pgC',bd:'pgD'};

// ---------- PAGE 2: CLARIFICATION ----------
const CN=[
 ['title',20,10,760,26,'title','Clarification sub-flow (child-level) — shared spine; per-state = params + gated branches'],
 ['n1',350,58,300,54,'process','Item marked VAGUE at Intake Review\n(child-level decision)'],
 ['d1',370,146,260,80,'decision','Assist / confer required\nbefore any denial?\n(state-gated)'],
 ['deny',700,152,330,70,'branch','Deny as vague / overbroad\n(TN · NJ · OH — OH must still offer revise;\nOK only AFTER engagement — SB 535)\n→ DENIAL sub-flow'],
 ['n2',350,268,300,64,'process','Send clarification / assist request\n(may itself be due within the response window;\nTX: letter MUST state consequences of\nnon-response — § 552.222(d))'],
 ['d2',370,372,260,80,'decision','Clock effect of sending?\n(state-gated)'],
 ['ct',30,378,300,68,'note','TOLL / RESTART:\nAL restart · OR · TX toll → clock pauses'],
 ['ci',700,372,340,80,'note','NO PAUSE (most states) → IMPLIED-EXTENSION\nextended_due = received + statutory_days\n+ implied_extension (triggered here)'],
 ['n3',330,500,340,96,'hl','Await requester response\nResponse deadline:\n• MO = 90d · TX = 61 days (statutory)\n• KS = soft “reasonable efforts”\n• all others = CITY SOFT-POLICY (config)'],
 ['gap',720,486,360,110,'gap','⚠ GAP (narrowed 2026-07-26)\nThe requester-response window &\nclose-on-nonresponse are statutory ONLY in\nMO (90d) + TX (61d, § 552.222(e));\nKS soft; all others silent.\n→ elsewhere this edge is a CONFIG KNOB, not law.'],
 ['d3',390,636,240,64,'decision','Responded by\ndeadline?'],
 ['close',40,628,300,80,'closed','CLOSE item (withdrawn)\nMO 90d · TX 61d · KS soft · else city policy\n→ CLOSED'],
 ['n4',380,736,260,50,'process','Revised request received'],
 ['d4',370,822,280,80,'decision','Materially revised?\n(design / config — no statute)'],
 ['nnew',700,828,330,64,'process','Treat as NEW request →\nnew receipt & clock →\nre-enter Intake Review'],
 ['d5',390,932,240,64,'decision','Reasonably\ndescribed now?'],
 ['resume',320,1030,360,64,'ship','RESUME processing\n(clock per toll decision above)\n→ back to spine (Estimate Data)'],
 ['duty',30,1024,300,80,'branch','Still vague after reasonable effort →\nDuty satisfied (CA-0008) →\ndeny / close → CLOSED / DENIED'],
 ['leg',700,940,380,150,'note','STATE COVERAGE\nAssist: CA·NJ·NV·TN·WA    Confer: IL·KS·NV·OH·OK\nExplicit toll: AL·OR·TX (TX re-measures 10-bd AG clock)\nStatutory response deadline: MO 90d · TX 61d\nDeny-as-vague: TN·NJ·OH · OK only after engagement\nDuty satisfied: CA\nOK specificity (SB 535): time-frame · identifiable\nrecords · search terms'],
];
const CE=[['n1','d1',''],['d1','deny','deny allowed'],['d1','n2','assist / confer first'],['n2','d2',''],['d2','n3',''],
 ['n3','d3',''],['d3','close','no'],['d3','n4','yes'],['n4','d4',''],['d4','nnew','yes → material'],['d4','d5','no → resume original'],
 ['d5','resume','yes'],['d5','duty','no / still vague']];

// ---------- PAGE 3: ESTIMATE/FEE ----------
const EBANDS=[['cb',20,48,1200,336,'CHILD — Estimate Data (per item)'],['pb',20,398,1200,470,'PARENT — Financial Processor & Accounting']];
const EN=[
 ['title',20,10,900,26,'title','Estimate / Fee sub-flow — child entry + parent financial processor'],
 ['e1',40,86,290,54,'process','From Intake Review\n(record maybe attached via prelim search)'],
 ['dreq',400,78,240,78,'decision','Estimate required?\n(threshold: $ / hours —\nper-state parameter)'],
 ['skip',720,86,250,54,'process','No → $0 / minimal →\nproceed to work'],
 ['dtmpl',400,190,240,86,'decision','Record attached /\ntemplate match?'],
 ['tmpl',60,200,270,58,'process','TEMPLATE → auto-fill\nestimate lines'],
 ['addt',720,188,300,88,'branch','NOT ESTIMABLE YET →\n“additional time” letter (delay;\nsoft/“reasonable” → implied-ext)\n→ loop when data ready'],
 ['manual',410,300,240,42,'process','or MANUAL entry (knowledge)'],
 ['esub',400,348,250,44,'process','Submit estimate data (child)\n→ rolls up as a parent line'],
 ['fled',40,420,330,66,'finkid','Ledger: per-line → aggregate →\napply per-request allowances/caps → TOTAL'],
 ['dwv',420,424,190,60,'decision','Fee waiver\nrequested? (19st)'],
 ['wrev',660,420,350,66,'branch','Review (public-interest / indigent /\nvictim / resident-free) → grant(adjust) / deny'],
 ['frev',40,512,330,60,'finkid','Estimate Review (config: $ threshold + reviewer:\nself / supervisor / open-records / finance)'],
 ['fcom',420,512,290,60,'finkid','Send itemized good-faith estimate /\ninvoice (due within N days: GA 3bd…)'],
 ['drsp',770,506,230,74,'decision','Requester response\nrequired?'],
 ['optout',770,612,230,54,'closed','opt-out / no response\n→ CLOSED'],
 ['ddep',420,610,270,80,'decision','Deposit / pay before\nwork? (config; ~21st\npermit; AL t-i requires)'],
 ['hold',40,616,330,64,'hl','HOLD–Awaiting Payment\n(parent override → hides child\nfrom My Tasks)'],
 ['paid',40,708,150,46,'process','paid → resume'],
 ['cnp',210,706,300,64,'closed','nonpayment (MO 90d · OR 60d ·\nelse config) → CLOSED–Nonpayment'],
 ['proc',560,706,300,64,'process','No → proceed to work; collect at end\n(pay-before-release: AL·AZ·IL·KS·\nMA·NE·NV·OH → Hold at delivery)'],
 ['exit',420,800,430,54,'ship','→ back to child spine (Search → Redaction);\nbalance at disposition → Awaiting Payment'],
 ['gap',20,884,600,84,'gap','⚠ GAP: requester-response-to-estimate window & close-on-\nnonpayment are clean statute only in TX·IL (10bd), OR (60d),\nMO (90d); LA soft; ALL OTHERS = configurable city policy.'],
 ['chick',640,884,300,84,'note','Chicken-and-egg: the estimate must include redaction labor,\nbut that needs the record → why Preliminary Search feeds\nthis stage (see Intake).'],
 ['leg',960,600,270,266,'note','STATE COVERAGE\nEstimate rule: AL·GA·MA·MO·TN·TX·VA\nThreshold: GA$25 · OR$25 · TX$40 · KS5h · NY2h\nDeposit / advance: 21 states · OK statutory:\n>$75 est. OR unpaid prior fees (SB 535, 11/25)\nPay-before-release: AL·AZ·IL·KS·MA·NE·NV·OH\nNonpayment-close: MO90d · OR60d · LA soft\nWaiver: 19 states\nCross-request triggers (requestor-level ledger):\nTX 552.263(c)/552.275 · OK unpaid-fees'],
];
const EE=[['e1','dreq',''],['dreq','skip','no'],['dreq','dtmpl','yes'],['dtmpl','tmpl','template'],['dtmpl','manual','manual'],
 ['dtmpl','addt','not estimable'],['addt','dtmpl','when ready'],['tmpl','esub',''],['manual','esub',''],['skip','exit',''],
 ['esub','fled',''],['fled','dwv',''],['dwv','wrev','yes'],['wrev','frev','adjust'],['dwv','frev','no'],['frev','fcom',''],
 ['fcom','drsp',''],['drsp','optout','no'],['drsp','ddep','yes / pays'],['ddep','hold','yes'],['ddep','proc','no'],
 ['hold','paid','paid'],['hold','cnp','nonpay'],['paid','exit',''],['proc','exit','']];

// ---------- PAGE 4: DENIAL ----------
const DN=[
 ['title',20,10,900,26,'title','Denial sub-flow — config reason-library + legal routing; deemed-denial is clock-driven; AG-referral states have NO staff denial'],
 ['e1',400,56,380,54,'process','DENY clicked\n(from Intake · Search · Redaction · Legal-Redaction)'],
 ['dag',810,50,310,74,'decision','Mandatory EXTERNAL ruling\nto withhold? (state-gated:\nTX — no staff denial)'],
 ['ntypes',20,150,352,138,'note','DENIAL TYPES:\n• full — record exempt\n• partial → Redaction / segregability\n• no responsive records (MI·TN·UT · TX 10bd)\n• burden / vexatious (IL·KS·PA · OH gate)\n• vague / overbroad → Clarification (NJ·OH·OK)\n• neither-confirm-nor-deny (OR)\n• AG-referral — no staff denial (TX)'],
 ['nreason',420,150,330,74,'process','Select reason(s) from config library\n(AI-filled at setup from exemption\ncatalog; edit / attest)'],
 ['dlegal',445,262,280,84,'decision','Legal approval\nrequired?'],
 ['ncfg',770,258,360,96,'note','Config: always-route-to-legal ON → forced.\nOFF → user picks “submit for legal approval”\nor “submit” (direct to comm).\nAny city may force-route denials to legal.'],
 ['legal',770,384,300,58,'legal','Legal Review – Denial\n(dedicated UI, submit-complete)'],
 ['dlegok',835,470,170,64,'decision','Approved?'],
 ['back',770,566,300,54,'process','rejected → back to processing\n(re-enter spine)'],
 ['ncomm',420,384,330,86,'process','Compose denial communication'],
 ['ncontent',20,372,352,150,'note','CONTENT (assembled per state):\n• reasons + exemption citation (13st)\n• responsible person (CA·NE)\n• partial particularity (VA) — if partial\n• no-records notice (MI·TN·UT · TX 10bd) — if no-records\n• previous-determination id (TX 10bd, § 552.221(g))\n• appeal-rights block — CITY-DRAFTED (not a rule)'],
 ['ddl',445,506,280,84,'decision','Denial deadline?\n(CT 4bd · KS/MO 3bd ·\nIN 24hr/7d; else resp. window)'],
 ['send',410,622,350,60,'closed','Send denial comm → child status = DENIED\n→ (single item: request denied) → CLOSED'],
 ['deemed',20,710,560,96,'gap','DEEMED / CONSTRUCTIVE DENIAL  (clock-driven, 16 states)\nNo response by the deadline → auto-denied (AL 30/180bd rebuttable\npresumption; IN 24hr in-person / 7d mail). System AVOIDS this by\nresponding in time; the requestor’s remedy is external (out of scope).\n↔ TX INVERTS this — see DEEMED DISCLOSURE in the AG band below.'],
 ['lib',600,710,290,96,'note','CONFIG LIBRARY: every state has an exemption /\ndenial-reason list → loaded once at setup\n(upload → AI draft → edit → attest),\nsame pattern as all other config.'],
 ['leg',910,506,300,300,'note','STATE COVERAGE\nReasons + citation: 13 states\nResponsible person: CA · NE\nPartial notice: VA\nNo-records notice: MI · TN · UT · TX (10bd)\nBurden / vexatious: IL · KS · PA · OH (2323.52(J))\nDenial deadline: CT · KS · MO · IN\nDeemed denial: 16 states · Deemed DISCLOSURE: TX\nNeither-confirm-nor-deny: OR\nAG-ruling-to-withhold: TX (10bd hard)\nAppeal-rights content: city-drafted'],
 ['agband',20,830,1200,20,'lanelabel','AG-REFERRAL BAND (state-gated: TX + any future AG-ruling state) — “to withhold, petition the external authority in time — or the record goes public”'],
 ['dprev',20,868,300,76,'decision','Previous determination\ncovers this info?\n(§ 552.301(a) exception)'],
 ['ag1',360,868,300,76,'process','Prepare AG ruling request —\nmust state the SPECIFIC exceptions\nclaimed (§ 552.301(b), HB 4219)'],
 ['agclk',700,868,280,76,'hl','HARD CLOCKS (from receipt;\nclarification re-measures):\nsubmit by 10th bd · comments,\nrequest copy + samples by 15th bd'],
 ['agnot',1000,868,220,76,'process','Requestor notices:\nwithholding + AG-request (10bd);\nredacted comments copy (15bd)'],
 ['agwait',1000,980,220,64,'branch','AWAIT AG ruling [external]\n≈45bd (+10 ext) — informational,\nnot a city duty'],
 ['agdec',700,980,240,64,'decision','AG ruling?'],
 ['agrel',360,1064,320,54,'ship','RELEASE ordered / deemed public →\nback to spine (Redaction → Shipped)'],
 ['agmiss',20,980,640,72,'gap','DEEMED DISCLOSURE (inverts deemed-denial): miss the 10-bd/15-bd clocks →\ninformation PRESUMED PUBLIC (§ 552.302) — release absent compelling reason.\nPost-HB 4219 no request silently closes: five 10-bd exits (produce · certify\ndate · no-records · previous-determination · AG request).'],
];
const DE=[['e1','nreason',''],['nreason','dag',''],['dag','dlegal','no — staff denial allowed'],['dag','dprev','yes (TX)'],
 ['dprev','ncomm','yes → § 552.221(g) notice ids the specific prior determination (10bd)'],['dprev','ag1','no → must petition AG'],
 ['ag1','agclk',''],['agclk','agnot',''],['agnot','agwait',''],['agwait','agdec',''],
 ['agdec','ncomm','withhold approved'],['agdec','agrel','release ordered'],['agclk','agmiss','missed'],
 ['dlegal','legal','yes / route'],['dlegal','ncomm','no → direct submit'],
 ['legal','dlegok',''],['dlegok','ncomm','approved'],['dlegok','back','rejected'],['ncomm','ddl',''],['ddl','send','']];

// ---------- emit ----------
const xe=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const dL=s=>xe(s).replace(/\n/g,'&#10;');
function styleOf(cat){const [fill,stroke]=C[cat]||C.process; let st=`whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};fontSize=11;`;
  if(cat==='decision')st='rhombus;'+st; else if(cat==='note'||cat==='gap')st='shape=note;size=12;align=left;verticalAlign=top;'+st;
  else if(cat==='band')st='rounded=0;verticalAlign=top;align=left;fontStyle=2;fontColor=#888;dashed=1;'+st;
  else if(cat==='fin')st='rounded=0;verticalAlign=top;fontStyle=1;'+st;
  else if(cat==='link')st='rounded=1;'+st+'strokeWidth=2.5;fontStyle=1;';
  else st='rounded=1;'+st;
  if(cat==='gap'||cat==='hl'||cat==='ship'||cat==='closed'||cat==='legal')st+='fontStyle=1;';
  return st;}
function page(name,id,N,E,BANDS,linkMap,pw,ph){
  let cells=''; const all=[...(BANDS||[]).map(b=>[b[0],b[1],b[2],b[3],b[4],'band',b[5]]),...N];
  for(const [nid,x,y,w,h,cat,label] of all){
    if(cat==='title'){cells+=`<mxCell id="${nid}" value="${dL(label)}" style="text;html=1;fontSize=14;fontStyle=1;align=left;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;continue;}
    if(cat==='lanelabel'){cells+=`<mxCell id="${nid}" value="${dL(label)}" style="text;html=1;fontSize=12;fontStyle=2;align=left;fontColor=#555;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;continue;}
    const st=styleOf(cat); const link=linkMap&&linkMap[nid];
    if(link) cells+=`<UserObject label="${dL(label)}" link="data:page/id,${link}" id="${nid}"><mxCell style="${st}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell></UserObject>`;
    else cells+=`<mxCell id="${nid}" value="${dL(label)}" style="${st}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
  }
  let i=0;for(const [s,t,l] of E){i++;cells+=`<mxCell id="${id}_e${i}" value="${dL(l)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;fontSize=10;endArrow=block;endFill=1;strokeColor=#555;" edge="1" parent="1" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry"/></mxCell>`;}
  return `<diagram name="${name}" id="${id}"><mxGraphModel dx="1300" dy="1000" grid="1" gridSize="10" page="1" pageWidth="${pw}" pageHeight="${ph}"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram>`;
}
const doc='<mxfile host="app.diagrams.net">'
 +page('Master','pgM',MN,ME,null,MLINK,1600,1000)
 +page('Clarification','pgC',CN,CE,null,null,1120,1140)
 +page('Estimate-Fee','pgE',EN,EE,EBANDS,null,1260,990)
 +page('Denial','pgD',DN,DE,null,null,1240,1160)
 +'</mxfile>';
fs.writeFileSync(OUT+'/request_flow_master_v2.drawio',doc);
// ---- master-page SVG preview (shows the ▸ drill-down badges) ----
C.link=['#dae8fc','#2d6a9f'];
const se=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const byId=Object.fromEntries(MN.map(n=>[n[0],n])); const cx=n=>n[1]+n[3]/2,cy=n=>n[2]+n[4]/2;
const W=1600,H=1000; let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Segoe UI,Helvetica,Arial,sans-serif"><defs><marker id="a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#555"/></marker></defs><rect width="${W}" height="${H}" fill="#fff"/>`;
function anchors(s,t){const sx=cx(s),sy=cy(s),tx=cx(t),ty=cy(t);
  if(Math.abs(sy-ty)<28){const x1=sx<tx?s[1]+s[3]:s[1],x2=sx<tx?t[1]:t[1]+t[3];return[[x1,sy],[x2,ty]];}
  const y1=sy<ty?s[2]+s[4]:s[2],y2=sy<ty?t[2]:t[2]+t[4],my=(y1+y2)/2;if(Math.abs(sx-tx)<10)return[[sx,y1],[tx,y2]];return[[sx,y1],[sx,my],[tx,my],[tx,y2]];}
for(const [sId,tId,l] of ME){const s=byId[sId],t=byId[tId];if(!s||!t)continue;const pts=anchors(s,t);const d=pts.map((p,i)=>(i?'L':'M')+p[0]+' '+p[1]).join(' ');
  svg+=`<path d="${d}" fill="none" stroke="#555" stroke-width="1.3" marker-end="url(#a)"/>`;
  if(l){const lx=(pts[0][0]+pts[pts.length-1][0])/2,ly=(pts[0][1]+pts[pts.length-1][1])/2;svg+=`<rect x="${lx-se(l).length*3.1-3}" y="${ly-9}" width="${se(l).length*6.2+6}" height="15" fill="#fff" opacity="0.9"/><text x="${lx}" y="${ly+2}" font-size="10" fill="#444" text-anchor="middle">${se(l)}</text>`;}}
for(const [id,x,y,w,h,cat,label] of MN){
  if(cat==='title'){svg+=`<text x="${x}" y="${y+18}" font-size="15" font-weight="700" fill="#222">${se(label)}</text>`;continue;}
  if(cat==='lanelabel'){svg+=`<text x="${x}" y="${y+14}" font-size="12" font-style="italic" fill="#666">${se(label)}</text>`;continue;}
  const [fill,stroke]=C[cat]||C.process;
  if(cat==='decision'){const mx=x+w/2,my=y+h/2;svg+=`<polygon points="${mx},${y} ${x+w},${my} ${mx},${y+h} ${x},${my}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`;}
  else svg+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${(cat==='note'||cat==='fin'||cat==='finkid')?2:10}" fill="${fill}" stroke="${stroke}" stroke-width="${cat==='link'?2.6:1.4}"/>`;
  const lines=String(label).split('\n');const left=(cat==='note'||cat==='fin'||cat==='finkid');const fs2=cat==='fin'?12:left?9.6:10.3;
  const startY=(cat==='fin'||cat==='note')?y+15:y+h/2-(lines.length-1)*(fs2*0.62);const ax=left?x+8:x+w/2;const ta=left?'start':'middle';
  const b=(cat==='ship'||cat==='closed'||cat==='denied'||cat==='fin'||cat==='link');
  lines.forEach((ln,i)=>{const badge=(cat==='link'&&i===lines.length-1);svg+=`<text x="${ax}" y="${startY+i*(fs2+2.6)}" font-size="${fs2}" font-weight="${(i===0&&b)||badge?'700':'400'}" fill="${badge?'#2d6a9f':'#222'}" text-anchor="${ta}">${se(ln)}</text>`;});
}
svg+='</svg>'; fs.writeFileSync(OUT+'/request_flow_master_v2.svg',svg);
console.log('wrote request_flow_master_v2.drawio (4 linked pages) + request_flow_master_v2.svg (master preview)');
