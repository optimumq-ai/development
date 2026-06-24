'use strict';
// Per-domain extractor/adapter framework for the config-freshness loop (Slice B).
// Given a SOURCE DOCUMENT (pasted text or a best-effort URL fetch), each domain adapter:
//   extract(jid, text) -> { proposed, summary }   // an AI-proposed config + plain-language change note
//   current(jid)        -> the live config for that domain (for the review diff)
//   apply(jid, cfg, actor) -> writes the approved config to the live per-area store (null = review-only)
// Nothing here applies automatically; apply() runs only from the human-approved review flow (Slice C).
var Anthropic = require('@anthropic-ai/sdk');
var crypto = require('crypto');
var { all, get, run } = require('../db');
var feePolicyExtract = require('./feePolicyExtract');

function hashText(t) { return crypto.createHash('sha256').update(String(t || ''), 'utf8').digest('hex'); }
function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
function deepMerge(base, ov) {
  if (!isObj(base) || !isObj(ov)) return ov === undefined ? base : ov;
  var out = {}; var k;
  for (k in base) if (base.hasOwnProperty(k)) out[k] = base[k];
  for (k in ov) if (ov.hasOwnProperty(k)) out[k] = (isObj(out[k]) && isObj(ov[k])) ? deepMerge(out[k], ov[k]) : ov[k];
  return out;
}
function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

// Pluggable source fetch: pasted/uploaded text wins; otherwise best-effort URL fetch.
async function fetchSource(source, rawText) {
  if (rawText && String(rawText).trim()) { var t = String(rawText).trim().slice(0, 200000); return { ok: true, text: t, via: 'pasted' }; }
  if (source && source.url) {
    try {
      var ctrl = new AbortController(); var to = setTimeout(function () { ctrl.abort(); }, 12000);
      var r = await fetch(source.url, { signal: ctrl.signal, headers: { 'User-Agent': 'OptimumQ-ConfigFreshness/1.0' } });
      clearTimeout(to);
      if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
      var body = await r.text();
      var text = htmlToText(body).slice(0, 200000);
      if (!text) return { ok: false, error: 'No readable text at source URL' };
      return { ok: true, text: text, via: 'url' };
    } catch (e) { return { ok: false, error: (e && e.message) || 'fetch failed' }; }
  }
  return { ok: false, error: 'No pasted text and no source URL to fetch' };
}

function client() { return new Anthropic(); }
function parseJSONObject(s) {
  var t = String(s || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  var a = t.indexOf('{'); if (a === -1) return null;
  var depth = 0, inStr = false, esc = false;
  for (var i = a; i < t.length; i++) { var ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(t.slice(a, i + 1)); } catch (e) { return null; } } }
  }
  return null;
}

// Generic AI extractor for JSON-config domains other than fee.
async function genericExtract(domainLabel, jurName, currentCfg, sourceText) {
  var prompt = 'You maintain the ' + domainLabel + ' configuration for a U.S. public-records (FOIA / open-records) system in ' + (jurName || 'this jurisdiction') + '.\n\n'
    + 'CURRENT CONFIGURATION (JSON):\n' + JSON.stringify(currentCfg || {}, null, 2) + '\n\n'
    + 'AUTHORITATIVE SOURCE DOCUMENT (statute / ordinance / rule text):\n' + String(sourceText).slice(0, 60000) + '\n\n'
    + 'Propose the configuration that correctly reflects the source. Return ONLY a JSON object, no prose, no markdown fences:\n'
    + '{"config": <the full updated configuration object, same shape as CURRENT>, "summary": "<one short paragraph: what changed vs current and the citation, or \'No change indicated.\'>"}\n'
    + 'If the source does not indicate any change, return config identical to CURRENT and summary "No change indicated."';
  var msg = await client().messages.create({ model: 'claude-sonnet-4-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
  var txt = (msg.content || []).map(function (b) { return b.text || ''; }).join('\n');
  var parsed = parseJSONObject(txt) || {};
  return { proposed: parsed.config != null ? parsed.config : (currentCfg || {}), summary: parsed.summary || 'Proposed update from source document.' };
}

async function jurName(jid) { var j = jid ? await get('SELECT name FROM jurisdiction_profiles WHERE id = ?', [jid]) : null; return j ? j.name : 'this jurisdiction'; }
async function sysJSON(key) { var r = await get("SELECT value FROM system_config WHERE key = ?", [key]); if (!r || !r.value) return {}; try { return JSON.parse(r.value); } catch (e) { return {}; } }

var ADAPTERS = {
  fee: {
    label: 'Fee & cost schedule', applyTarget: 'active fee profile',
    current: async function (jid) { var p = await get("SELECT config_json FROM fee_profiles WHERE jurisdiction_id = ? AND context = 'FR' ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, version DESC LIMIT 1", [jid]); try { return p ? JSON.parse(p.config_json || '{}') : {}; } catch (e) { return {}; } },
    extract: async function (jid, text) { var r = await feePolicyExtract.extract(text, { context: 'FR' }); return { proposed: (r && r.config) || {}, summary: (r && r.notes) ? (Array.isArray(r.notes) ? r.notes.join(' ') : r.notes) : 'Proposed fee configuration extracted from the source policy text.' }; },
    apply: async function (jid, cfg, actor) {
      var p = await get("SELECT id, config_json FROM fee_profiles WHERE jurisdiction_id = ? AND context = 'FR' ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, version DESC LIMIT 1", [jid]);
      if (!p) throw new Error('No active fee profile to apply to.');
      var cur = {}; try { cur = JSON.parse(p.config_json || '{}'); } catch (e) {}
      var merged = deepMerge(cur, cfg || {});
      await run("UPDATE fee_profiles SET config_json = ? WHERE id = ?", [JSON.stringify(merged), p.id]);
      return { target: 'fee_profiles:' + p.id };
    }
  },
  deadline: {
    label: 'Response deadlines & tolling', applyTarget: "system_config 'deadline_rules'",
    current: async function () { return await sysJSON('deadline_rules'); },
    extract: async function (jid, text) { return await genericExtract('response-deadline & clock-tolling', await jurName(jid), await sysJSON('deadline_rules'), text); },
    apply: async function (jid, cfg) { await run("INSERT INTO system_config (key, value) VALUES ('deadline_rules', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(cfg || {})]); return { target: 'system_config:deadline_rules' }; }
  },
  exemption: {
    label: 'Exemption model & appeals', applyTarget: 'jurisdiction_profiles.exemption_model',
    current: async function (jid) { var j = await get('SELECT exemption_model FROM jurisdiction_profiles WHERE id = ?', [jid]); return { exemption_model: (j && j.exemption_model) || 'self_court' }; },
    extract: async function (jid, text) { return await genericExtract('exemption-handling model (pre_clearance | self_appeal_court | self_court) and appeal process', await jurName(jid), { exemption_model: (await get('SELECT exemption_model FROM jurisdiction_profiles WHERE id = ?', [jid]) || {}).exemption_model || 'self_court' }, text); },
    apply: async function (jid, cfg) { var m = cfg && cfg.exemption_model; if (['pre_clearance', 'self_appeal_court', 'self_court'].indexOf(m) === -1) throw new Error('Invalid exemption_model'); await run('UPDATE jurisdiction_profiles SET exemption_model = ? WHERE id = ?', [m, jid]); return { target: 'jurisdiction_profiles:' + jid }; }
  },
  redaction: {
    label: 'Redaction / exemption rules', applyTarget: null, reviewOnlyNote: 'Redaction rules are applied in the Redaction Rules Library, where each proposed rule is reviewed and approved individually.',
    current: async function () { return {}; },
    extract: async function (jid, text) { return await genericExtract('redaction / withholding-exemption rules (list of categories with statute citations)', await jurName(jid), {}, text); },
    apply: null
  },
  taxonomy: {
    label: 'Record types & taxonomy', applyTarget: null, reviewOnlyNote: 'Record-type changes are applied in the Taxonomy editor after review.',
    current: async function () { return {}; },
    extract: async function (jid, text) { return await genericExtract('record-type taxonomy (record types and categories)', await jurName(jid), {}, text); },
    apply: null
  }
};

function adapter(domain) { return ADAPTERS[domain] || null; }
module.exports = { hashText: hashText, fetchSource: fetchSource, deepMerge: deepMerge, adapter: adapter, ADAPTERS: ADAPTERS };
