'use strict';
var express = require('express');
var router = express.Router();
var { requireAuth } = require('../middleware/auth');
var db = require('../db');
var secrets = require('../services/secrets');

function admin(req, res, next) {
  var roles = (req.user && req.user.roles) || [];
  if (roles.indexOf('SYSTEM_ADMIN') < 0) return res.status(403).json({ error: 'Administrator access required.' });
  next();
}
async function cfg(key) { var r = await db.get('SELECT value FROM system_config WHERE key = ?', [key]); return r ? r.value : null; }
async function setCfg(key, value) { await db.run("INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = ?", [key, value, value]); }
function hint(v) { if (!v) return null; var s = String(v); return '\u2022\u2022\u2022\u2022' + s.slice(-4); }
var MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'; // frontend shows this for a set secret; only overwrite if a real new value arrives
function isNewSecret(v) { return typeof v === 'string' && v.trim() && v.indexOf('\u2022') < 0; }

// GET current integration status (secrets masked; never returned in clear)
router.get('/', requireAuth, admin, async function (req, res) {
  try {
    var savedAnthropic = await cfg('anthropic_api_key');
    var savedVoyage = await cfg('voyage_api_key');
    var resendKey = await cfg('resend_api_key');
    var provider = (await cfg('email_provider')) || (resendKey ? 'resend' : 'smtp');
    res.json({
      ai: {
        anthropic: { set: !!(savedAnthropic || process.env.ANTHROPIC_API_KEY), fromSaved: !!savedAnthropic, hint: hint(savedAnthropic || process.env.ANTHROPIC_API_KEY) },
        voyage: { set: !!(savedVoyage || process.env.VOYAGE_API_KEY), fromSaved: !!savedVoyage, hint: hint(savedVoyage || process.env.VOYAGE_API_KEY) }
      },
      deployment: {
        profile: (await cfg('ai_deployment_profile')) || 'standard',
        aws_region: (await cfg('aws_region')) || 'us-gov-west-1',
        titan_model: (await cfg('titan_embed_model')) || 'amazon.titan-embed-text-v2:0',
        bedrock_key_set: !!(await cfg('bedrock_access_key_id')),
        bedrock_secret_set: !!(await cfg('bedrock_secret_key'))
      },
      email: {
        provider: provider,
        from_name: (await cfg('agency_name')) || '',
        smtp_host: (await cfg('smtp_host')) || '',
        smtp_port: (await cfg('smtp_port')) || '587',
        smtp_user: (await cfg('smtp_user')) || '',
        smtp_from: (await cfg('smtp_from')) || '',
        smtp_pass_set: !!(await cfg('smtp_pass')),
        resend_from: (await cfg('resend_from')) || '',
        resend_key_set: !!resendKey
      }
    });
  } catch (e) { console.error('[integrations GET]', e && e.message); res.status(500).json({ error: 'Could not load integration settings.' }); }
});

// Save integration settings. Secrets only overwritten when a real new value is supplied.
router.post('/', requireAuth, admin, async function (req, res) {
  try {
    var b = req.body || {};
    // AI keys
    if (b.ai) {
      if (isNewSecret(b.ai.anthropic_api_key)) await setCfg('anthropic_api_key', b.ai.anthropic_api_key.trim());
      if (isNewSecret(b.ai.voyage_api_key)) await setCfg('voyage_api_key', b.ai.voyage_api_key.trim());
      await secrets.applySecrets(); // push into process.env live
    }
    // Deployment profile + Government (Bedrock/GovCloud) connection settings
    if (b.deployment) {
      var dp = b.deployment;
      if (typeof dp.profile === 'string') await setCfg('ai_deployment_profile', dp.profile);
      if (typeof dp.aws_region === 'string') await setCfg('aws_region', dp.aws_region.trim());
      if (typeof dp.titan_model === 'string') await setCfg('titan_embed_model', dp.titan_model.trim());
      if (isNewSecret(dp.bedrock_access_key_id)) await setCfg('bedrock_access_key_id', dp.bedrock_access_key_id.trim());
      if (isNewSecret(dp.bedrock_secret_key)) await setCfg('bedrock_secret_key', dp.bedrock_secret_key.trim());
    }
    // Email
    if (b.email) {
      var e = b.email;
      if (typeof e.provider === 'string') await setCfg('email_provider', e.provider);
      if (typeof e.from_name === 'string') await setCfg('agency_name', e.from_name);
      if (e.provider === 'smtp') {
        if (typeof e.smtp_host === 'string') await setCfg('smtp_host', e.smtp_host.trim());
        if (typeof e.smtp_port === 'string') await setCfg('smtp_port', String(e.smtp_port).trim());
        if (typeof e.smtp_user === 'string') await setCfg('smtp_user', e.smtp_user.trim());
        if (typeof e.smtp_from === 'string') await setCfg('smtp_from', e.smtp_from.trim());
        if (isNewSecret(e.smtp_pass)) await setCfg('smtp_pass', e.smtp_pass);
        await setCfg('resend_api_key', ''); // ensure SMTP path is used (email.js prefers Resend if key present)
      } else if (e.provider === 'resend') {
        if (typeof e.resend_from === 'string') await setCfg('resend_from', e.resend_from.trim());
        if (isNewSecret(e.resend_api_key)) await setCfg('resend_api_key', e.resend_api_key.trim());
      }
    }
    res.json({ ok: true });
  } catch (e) { console.error('[integrations POST]', e && e.message); res.status(500).json({ error: 'Could not save integration settings.' }); }
});

// Test a given integration. Accepts an optional key in the body to test before saving.
router.post('/test/:which', requireAuth, admin, async function (req, res) {
  var which = req.params.which, b = req.body || {};
  try {
    if (which === 'anthropic') {
      var Anthropic = require('@anthropic-ai/sdk');
      var key = isNewSecret(b.key) ? b.key.trim() : process.env.ANTHROPIC_API_KEY;
      if (!key) return res.json({ ok: false, message: 'No Anthropic key configured.' });
      var c = new Anthropic({ apiKey: key });
      await c.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] });
      return res.json({ ok: true, message: 'Anthropic key works.' });
    }
    if (which === 'voyage') {
      var prevV = process.env.VOYAGE_API_KEY;
      if (isNewSecret(b.key)) process.env.VOYAGE_API_KEY = b.key.trim();
      try { var v = require('../services/voyageEmbed'); var out = await v.embed(['test'], { inputType: 'query' }); return res.json({ ok: !!(out && out[0] && out[0].length), message: 'Voyage key works.' }); }
      finally { if (isNewSecret(b.key)) process.env.VOYAGE_API_KEY = prevV; }
    }
    if (which === 'email') {
      var to = (b.to || '').trim();
      if (!to) return res.json({ ok: false, message: 'Enter a test recipient address.' });
      var email = require('../services/email');
      var r = await email.send({ to: to, subject: 'Optimum Q email test', text: 'This is a test message confirming your email settings work.', html: '<p>This is a test message confirming your email settings work.</p>' });
      return res.json({ ok: !!(r && r.sent), message: r && r.sent ? ('Test email sent via ' + (r.provider || 'SMTP') + '.') : 'Send failed - check the settings.' });
    }
    res.status(400).json({ ok: false, message: 'Unknown test.' });
  } catch (e) { res.json({ ok: false, message: (e && e.message) ? e.message.slice(0, 200) : 'Test failed.' }); }
});
// Live code excerpts for the AI Data-Flow inspector: reads the REAL source at whitelisted line
// ranges so the screen shows exactly what is in the running codebase (falsifiable, always current).
var fs = require('fs');
var path = require('path');
var TP_CODE = {
  'zone-discovery':     { file: 'services/zoneDiscovery.js',        from: 44, to: 53 },
  'intake-extract':     { file: 'routes/extract.js',               from: 30, to: 40 },
  'schema-discovery':   { file: 'services/schemaDiscovery.js',      from: 29, to: 47 },
  'search-judge':       { file: 'services/recordSearch.js',         from: 260, to: 269 },
  'classify':           { file: 'services/classifier.js',           from: 44, to: 50 },
  'connector-catalog':  { file: 'services/connectors/laserfiche.js', from: 68, to: 76 },
  'doc-embeddings':     { file: 'services/embedIndex.js',           from: 38, to: 46 },
  'meta-extract':       { file: 'services/recordMetaExtract.js',    from: 3, to: 7 },
  'report-agent':       { file: 'services/reportAgent.js',          from: 30, to: 35 },
  'help-agent':         { file: 'services/helpAgent.js',            from: 38, to: 44 },
  'fee-policy':         { file: 'services/feePolicyExtract.js',     from: 45, to: 47 },
  'public-portal':      { file: 'routes/publicChat.js',            from: 170, to: 176 }
};
router.get('/touchpoint-code/:id', requireAuth, admin, function (req, res) {
  var tp = TP_CODE[req.params.id];
  if (!tp) return res.status(404).json({ error: 'Unknown touchpoint.' });
  try {
    var full = path.join(__dirname, '..', tp.file);
    var lines = fs.readFileSync(full, 'utf8').split('\n');
    res.json({ file: 'backend/src/' + tp.file, lines: tp.from + '-' + tp.to, code: lines.slice(tp.from - 1, tp.to).join('\n') });
  } catch (e) { res.status(500).json({ error: 'Could not read source.' }); }
});

module.exports = router;
