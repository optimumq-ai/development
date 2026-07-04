require('dotenv').config();
const express = require('express');
require('express-async-errors');
const cors = require('cors');
const helmet = require('helmet');
const { initDb, get, all, run } = require('./src/db');
const { createUser } = require('./src/services/auth');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', require('./src/routes/auth'));

app.post('/api/requests/public', async function(req, res) {
  var { v4: uuidv4 } = require('uuid');
  var b = req.body;
  if (!b.requestorName || !b.requestorEmail || !b.description) return res.status(400).json({ error: 'Name, email and description are required' });
  var year = new Date().getFullYear();
  var last = await get('SELECT request_number FROM requests ORDER BY created_at DESC LIMIT 1');
  var nextNum = 1;
  if (last) { var parts = last.request_number.split('-'); if (parseInt(parts[0]) == year) nextNum = parseInt(parts[1]) + 1; }
  var requestNumber = year + '-' + String(nextNum).padStart(4,'0');
  var days = {simple:5,standard:10,complex:20,redaction_required:30}[b.classification||'standard']||10;
  var deadline = new Date(); deadline.setDate(deadline.getDate()+days);
  var deadlineStr = deadline.toISOString().split('T')[0];
  var id = uuidv4();
  await run("INSERT INTO requests (id,request_number,requestor_name,requestor_email,requestor_phone,requestor_type,delivery_method,description,classification,department_id,fee_waiver_requested,is_mrr,submission_channel,stage,status,deadline_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))",
    [id,requestNumber,b.requestorName,b.requestorEmail,b.requestorPhone||'',b.requestorType||'individual',b.deliveryMethod||'email',b.description,b.classification||'standard',b.departmentId||null,b.feeWaiverRequested?1:0,b.isMrr?1:0,'portal','intake','active',deadlineStr]);
  await run("INSERT INTO request_history (id,request_id,actor_id,actor_name,action,notes) VALUES (?,?,?,?,?,?)",
    [uuidv4(),id,'public','Public Portal','CREATED','Request submitted via public portal']);
  res.status(201).json({ success: true, requestNumber: requestNumber, requestId: id });
});

app.use('/api/requests', require('./src/routes/requests'));
app.use('/api/workflow', require('./src/routes/workflow'));
app.use('/api/estimate-profiles', require('./src/routes/estimateProfiles'));
app.use('/api/workflow-model', require('./src/routes/workflowModel'));
app.use('/api/decision-reasons', require('./src/routes/decisionReasons'));
app.use('/api/tasks', require('./src/routes/tasks'));
app.use('/api/tickler', require('./src/routes/tickler'));
app.use('/api/clocks', require('./src/routes/clocks'));
app.use('/api/staff', require('./src/routes/staff'));
app.use('/api/departments', require('./src/routes/departments'));
app.use('/api/repositories', require('./src/routes/repositories'));
app.use('/api/config', require('./src/routes/config'));
app.get('/api/config/public', async function(req,res){var db=require('./src/db');var rows=await db.all('SELECT key,value FROM system_config WHERE key IN (?,?,?)',['agency_name','contact_email','contact_phone']);var cfg={};rows.forEach(function(r){cfg[r.key]=r.value;});res.json(cfg);});
app.use('/api/classify', require('./src/routes/classify'));
app.use('/api/extract', require('./src/routes/extract'));
app.use('/api/files', require('./src/routes/files'));
app.use('/api/av-redaction', require('./src/routes/avRedaction'));
app.use('/api/semantic-search', require('./src/routes/semanticSearch'));
app.use('/api/public', require('./src/routes/publicChat'));
app.use('/api/agent-rules', require('./src/routes/agentRules'));
app.use('/api/help', require('./src/routes/help'));
app.use('/api/taxonomy', require('./src/routes/taxonomy'));
app.use('/api/redaction', require('./src/routes/redactionRules'));
app.use('/api/redaction-jobs', require('./src/routes/redactionJobs'));
app.use('/api/redaction-templates', require('./src/routes/redactionTemplates'));
app.use('/api/structured-redaction', require('./src/routes/structuredRedaction'));
app.use('/api/mass-jobs', require('./src/routes/massJobs'));
app.use('/api/fee-profiles', require('./src/routes/feeProfiles'));
app.use('/api/fee-estimates', require('./src/routes/feeEstimates'));
app.use('/api/config-freshness', require('./src/routes/configFreshness'));
app.use('/api/jurisdiction-profile', require('./src/routes/jurisdictionProfile'));
app.use('/api/onboarding', require('./src/routes/onboarding'));
app.use('/api/fee-sandbox', require('./src/routes/feeSandbox'));
app.use('/api/objections', require('./src/routes/objections'));
app.use('/api/settlement', require('./src/routes/settlement'));

app.get('/api/health', function(req, res) {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.post('/api/admin/seed', async function(req, res) {
  var existing = await get('SELECT count(*) as c FROM requests');
  if (existing && existing.c > 0) return res.json({ message: 'Already seeded', count: existing.c });
  var depts=['dept-clerk','dept-police','dept-finance','dept-building','dept-attorney','dept-publicworks'];
  var stages=['intake','record_search','redaction_review','fee_review','awaiting_payment','delivery'];
  var classes=['simple','standard','complex','redaction_required'];
  var data=[
    ['Jane Martinez','jane.martinez@email.com','individual','Copies of all city council meeting minutes for calendar year 2024',0,0,0],
    ['Robert Brooks','rbrooks@lawfirm.com','attorney','Body camera footage for Officer Smith badge 4471 on December 3 2025 between 4pm and 6pm',0,0,0],
    ['Sarah Chen','schen@channel7.com','journalist','Complete payroll records for all department heads fiscal year 2024',1,0,0],
    ['David Okafor','dokafor@nonprofit.org','nonprofit','All building permits issued for 1234 Main Street since January 2020',0,0,0],
    ['Karen Ellis','kellis@gmail.com','individual','Legal opinion letters regarding the proposed downtown development agreement',0,1,0],
    ['Tom Bradley','tbradley@consulting.com','individual','All water main inspection records for the Riverside District from 2022 to present',0,0,0],
    ['Maria Garcia','mgarcia@email.com','individual','Email correspondence between the mayor office and Acme Development',0,0,0],
    ['James Wilson','jwilson@university.edu','researcher','Complete incident report for case number 2025-CR-04471',0,0,1],
  ];
  for (const [i, d] of data.entries()) {
    var id=uuidv4();
    var num='2026-'+String(i+1).padStart(4,'0');
    var dl=new Date();
    dl.setDate(dl.getDate()+(i<2?-2:i<4?5:12));
    await run('INSERT OR IGNORE INTO requests (id,request_number,requestor_name,requestor_email,requestor_type,delivery_method,description,classification,department_id,stage,status,deadline_date,submission_channel,fee_waiver_requested,legal_flag,is_mrr) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id,num,d[0],d[1],d[2],'email',d[3],classes[i%4],depts[i%6],stages[i%6],'active',dl.toISOString().split('T')[0],'portal',d[4],d[5],d[6]]);
    await run('INSERT OR IGNORE INTO request_history (id,request_id,actor_id,actor_name,action) VALUES (?,?,?,?,?)',[uuidv4(),id,null,'System','REQUEST_CREATED']);
  }
  var count=await get('SELECT count(*) as c FROM requests');
  res.json({ success: true, count: count.c });
});

app.use(function(req, res) {
  res.status(404).json({ error: 'Not found' });
});

app.use(function(err, req, res, next) {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

async function seedAdmin() {
  var existing = await get('SELECT id FROM users WHERE email = ?', ['admin@optimumq.ai']);
  if (existing) return;
  console.log('Seeding default admin...');
  var sysAdminRole = await get('SELECT id FROM function_roles WHERE name = ?', ['SYSTEM_ADMIN']);
  var allPerms = await all('SELECT id FROM permission_roles');
  var uid = uuidv4();
  var crypto = require('crypto');
  // Use ADMIN_PASSWORD env var if provided, otherwise generate a strong random one
  var adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    adminPassword = crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').substring(0, 12) + '!';
    console.log('');
    console.log('============================================================');
    console.log('  INITIAL ADMIN PASSWORD (save this — it will not be shown again):');
    console.log('    Email:    admin@optimumq.ai');
    console.log('    Password: ' + adminPassword);
    console.log('  You will be required to change it on first login.');
    console.log('============================================================');
    console.log('');
  }
  var hash = crypto.createHash('sha256').update(adminPassword + 'optimumq_salt_2024').digest('hex');
  await run('INSERT INTO users (id,email,display_name,title,department_id,password_hash,temp_password) VALUES (?,?,?,?,?,?,?)',
    [uid,'admin@optimumq.ai','System Administrator','System Administrator','dept-openrecords',hash,1]);
  if (sysAdminRole) await run('INSERT OR IGNORE INTO user_function_roles VALUES (?,?)',[uid,sysAdminRole.id]);
  for (var p of allPerms) { await run('INSERT OR IGNORE INTO user_permission_roles VALUES (?,?)',[uid,p.id]); }
  console.log('Admin created: admin@optimumq.ai');
}

async function start() {
  await initDb();
  await seedAdmin();
  app.listen(PORT, function() {
    console.log('Optimum Q API running on port ' + PORT);
    require('./src/services/massJobs').startWorker();
    require('./src/services/connectors/nena911').ensureSetup().catch(function(e){ console.error('[nena911 setup]', e && e.message); });
    require('./src/services/connectors/nena911').startScheduler();
    require('./src/db').run("INSERT INTO requests (id, request_number, requestor_name, requestor_email, description, classification, department_id, stage, status, created_at) VALUES ('req-template-samples','SYS-TEMPLATE-SAMPLES','Template Samples','system@optimumq.ai','Holding area for sample records used to build redaction templates.','standard',null,'intake','active',datetime('now')) ON CONFLICT (id) DO NOTHING").catch(function(e){ console.error('[template-samples ensure]', e && e.message); });
    require('./src/services/tickler').startScheduler();
    require('./src/services/configFreshness').startScheduler();
    require('./src/services/effectiveConfig').startPromotionScheduler();
  });
}

start().catch(function(e){ console.error('startup failed:', e.message); process.exit(1); });
