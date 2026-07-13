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
var clarificationPolicy = require('./clarificationPolicy');
var clarificationPolicyExtract = require('./clarificationPolicyExtract');
var jurisdictionRules = require('./jurisdictionRules');
var { v4: uuidv4 } = require('uuid');
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
var REDACTION_CATS = ['privacy', 'law_enforcement', 'health', 'legal', 'personnel', 'commercial', 'security', 'administrative'];
function norm(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function slug(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || ('rt-' + uuidv4().slice(0, 4)); }
function srcType(t) { return ['statute', 'regulation', 'case_law'].indexOf(t) >= 0 ? t : 'statute'; }

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
function parseJSONArray(s) {
  var t = String(s || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  var a = t.indexOf('['); if (a === -1) return null;
  var depth = 0, inStr = false, esc = false;
  for (var i = a; i < t.length; i++) { var ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '[') depth++; else if (ch === ']') { depth--; if (depth === 0) { try { return JSON.parse(t.slice(a, i + 1)); } catch (e) { return null; } } }
  }
  return null;
}

// Doc-aware REDACTION rule extractor -> array of {title,description,category,legal_sources:[...]}
async function extractRedactionRules(jurNm, text) {
  var prompt = 'You read a public-records statute / ordinance excerpt for ' + jurNm + ' and list the REDACTION / WITHHOLDING rules it establishes (categories of information that must or may be withheld or redacted).\n\n'
    + 'Use ONLY these category codes: ' + REDACTION_CATS.join(', ') + '.\n\n'
    + 'Return ONLY a JSON array, each item: {"title":"short name","description":"plain-language: what to redact and when","category":"<code>","legal_sources":[{"name":"short label","citation":"formal citation","source_type":"statute|regulation|case_law","statute_text":"concise accurate summary for the reviewer"}]}.\n\n'
    + 'Base every rule on the SOURCE DOCUMENT below; include accurate citations. If the source establishes no withholding rules, return [].\n\nSOURCE DOCUMENT:\n' + String(text).slice(0, 60000);
  var msg = await client().messages.create({ model: 'claude-sonnet-4-5', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] });
  var txt = (msg.content || []).map(function (b) { return b.text || ''; }).join('\n');
  var arr = parseJSONArray(txt) || [];
  return arr;
}

// Doc-aware TAXONOMY extractor -> array of {name,code,category,description,intent,public_availability}
async function extractTaxonomy(jurNm, text) {
  var prompt = 'You read a public-records source for ' + jurNm + ' and list the RECORD TYPES (kinds of records) it references that a city records program would track.\n\n'
    + 'Return ONLY a JSON array, each: {"name":"record type name","code":"short_snake_code","category":"a broad category label","description":"one sentence","intent":"what a requester usually wants","public_availability":"public|review_required|confidential"}.\n\n'
    + 'Only include record types clearly implied by the source. If none, return [].\n\nSOURCE DOCUMENT:\n' + String(text).slice(0, 60000);
  var msg = await client().messages.create({ model: 'claude-sonnet-4-5', max_tokens: 2500, messages: [{ role: 'user', content: prompt }] });
  var txt = (msg.content || []).map(function (b) { return b.text || ''; }).join('\n');
  return parseJSONArray(txt) || [];
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
    label: 'Fee & cost schedule', applyTarget: 'active fee profile', applyMode: 'live',
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
    label: 'Response deadlines & tolling', applyTarget: "jurisdiction_rules 'deadline'", applyMode: 'live',
    current: async function (jid) { return await jurisdictionRules.read(jid, 'deadline') || {}; },
    extract: async function (jid, text) { return await genericExtract('response-deadline & clock-tolling', await jurName(jid), await jurisdictionRules.read(jid, 'deadline') || {}, text); },
    apply: async function (jid, cfg, actor) { return await jurisdictionRules.write(jid, 'deadline', cfg || {}, actor); }
  },
  clarification: {
    label: 'Clarification / vague-request policy', applyTarget: "jurisdiction_rules 'clarification'", applyMode: 'live',
    current: async function (jid) { return await clarificationPolicy.read(jid); },
    extract: async function (jid, text) { return await clarificationPolicyExtract.extract(text, { jurName: await jurName(jid), currentCfg: await clarificationPolicy.read(jid) }); },
    apply: async function (jid, cfg, actor) { var r = await clarificationPolicy.write(jid, cfg, actor); return { target: r.target }; }
  },
  exemption: {
    label: 'Exemption model & appeals', applyTarget: 'jurisdiction_profiles.exemption_model', applyMode: 'live',
    current: async function (jid) { var j = await get('SELECT exemption_model FROM jurisdiction_profiles WHERE id = ?', [jid]); return { exemption_model: (j && j.exemption_model) || 'self_court' }; },
    extract: async function (jid, text) { return await genericExtract('exemption-handling model (pre_clearance | self_appeal_court | self_court) and appeal process', await jurName(jid), { exemption_model: (await get('SELECT exemption_model FROM jurisdiction_profiles WHERE id = ?', [jid]) || {}).exemption_model || 'self_court' }, text); },
    apply: async function (jid, cfg) { var m = cfg && cfg.exemption_model; if (['pre_clearance', 'self_appeal_court', 'self_court'].indexOf(m) === -1) throw new Error('Invalid exemption_model'); await run('UPDATE jurisdiction_profiles SET exemption_model = ? WHERE id = ?', [m, jid]); return { target: 'jurisdiction_profiles:' + jid }; }
  },
  redaction: {
    label: 'Redaction / exemption rules', applyTarget: 'Redaction Rules Library (as pending-review drafts)', applyMode: 'stage_drafts',
    current: async function (jid) { var r = await get("SELECT COUNT(*) AS n FROM redaction_rules WHERE jurisdiction_id = ?", [jid]); return { existingRuleCount: r ? Number(r.n) : 0 }; },
    extract: async function (jid, text) { var arr = await extractRedactionRules(await jurName(jid), text); return { proposed: { rules: arr }, summary: (arr.length || 'No') + ' redaction rule(s) proposed from the source; each will be added as a pending-review draft for legal verification.' }; },
    apply: async function (jid, cfg, actor) {
      var rules = (cfg && cfg.rules) || []; var added = 0;
      var existing = await all("SELECT title FROM redaction_rules WHERE jurisdiction_id = ?", [jid]); var seen = {}; existing.forEach(function (e) { seen[norm(e.title)] = 1; });
      for (var i = 0; i < rules.length; i++) {
        var rl = rules[i]; if (!rl || !rl.title || !rl.description || seen[norm(rl.title)]) continue;
        var cat = REDACTION_CATS.indexOf(rl.category) >= 0 ? rl.category : 'administrative';
        var rid = uuidv4();
        await run("INSERT INTO redaction_rules (id, jurisdiction_id, title, description, category, approval_status, is_active, source) VALUES (?,?,?,?,?,?,?,?)", [rid, jid, rl.title, rl.description, cat, 'pending_review', 0, 'ai']);
        var srcs = Array.isArray(rl.legal_sources) ? rl.legal_sources : [];
        for (var j = 0; j < srcs.length; j++) { var sc = srcs[j]; var cite = ((sc && (sc.citation || sc.name)) || '').trim(); if (!cite) continue;
          var ex = await get("SELECT id FROM legal_sources WHERE jurisdiction_id = ? AND citation = ?", [jid, cite]); var sid = ex ? ex.id : uuidv4();
          if (!ex) await run("INSERT INTO legal_sources (id, jurisdiction_id, name, citation, source_type, description, statute_text, source) VALUES (?,?,?,?,?,?,?,?)", [sid, jid, sc.name || cite, cite, srcType(sc.source_type), sc.description || null, sc.statute_text || null, 'ai']);
          await run("INSERT INTO rule_legal_sources (id, rule_id, legal_source_id) VALUES (?,?,?)", [uuidv4(), rid, sid]); }
        seen[norm(rl.title)] = 1; added++;
      }
      return { target: 'redaction_rules', added: added };
    }
  },
  taxonomy: {
    label: 'Record types & taxonomy', applyTarget: 'Taxonomy (as draft record types)', applyMode: 'stage_drafts',
    current: async function (jid) { var r = await get("SELECT COUNT(*) AS n FROM record_types"); return { existingRecordTypes: r ? Number(r.n) : 0 }; },
    extract: async function (jid, text) { var arr = await extractTaxonomy(await jurName(jid), text); return { proposed: { recordTypes: arr }, summary: (arr.length || 'No') + ' record type(s) proposed from the source; each will be added as a draft in the Taxonomy editor for review.' }; },
    apply: async function (jid, cfg, actor) {
      var rts = (cfg && cfg.recordTypes) || []; var added = 0;
      var cats = await all("SELECT id, name FROM categories"); var catBy = {}; cats.forEach(function (c) { catBy[norm(c.name)] = c.id; });
      for (var i = 0; i < rts.length; i++) {
        var rt = rts[i]; if (!rt || !rt.name) continue;
        var catId = catBy[norm(rt.category)] || 'cat-other';
        var code = slug(rt.code || rt.name); var dup = await get("SELECT id FROM record_types WHERE code = ?", [code]); if (dup) code = code + '-' + uuidv4().slice(0, 4);
        var id = 'rt-' + uuidv4().slice(0, 8);
        await run("INSERT INTO record_types (id, category_id, name, code, description, intent, public_availability, status, source, confidence, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          [id, catId, rt.name, code, rt.description || null, rt.intent || null, rt.public_availability || 'review_required', 'draft', 'ai', 70, 100]);
        added++;
      }
      return { target: 'record_types', added: added };
    }
  }
};

function adapter(domain) { return ADAPTERS[domain] || null; }

// Shared staging pipeline: fetch -> snapshot -> drift-diff -> extract -> stage a pending proposal.
// Used by the on-demand check/extract endpoints AND the optional scheduled auto-extract.
async function stageFromSource(jid, source, rawText, actor, opts) {
  opts = opts || {};
  var domain = (source && source.domain) || opts.domain;
  var ad = adapter(domain); if (!ad) return { ok: false, error: 'Unknown domain: ' + domain };
  var fr = await fetchSource(source || {}, rawText); if (!fr.ok) return { ok: false, error: fr.error };
  var hash = hashText(fr.text);
  var changed = !(source && source.last_version_hash && source.last_version_hash === hash);
  if (opts.onlyIfChanged && !changed) { if (source) await run("UPDATE config_sources SET last_checked_at = ? WHERE id = ?", [nowStr(), source.id]); return { ok: true, changed: false, skipped: true }; }
  var snapId = 'snap-' + uuidv4().slice(0, 8);
  await run("INSERT INTO config_source_snapshots (id, source_id, jurisdiction_id, domain, hash, text, fetched_at) VALUES (?,?,?,?,?,?,?)", [snapId, source ? source.id : null, jid, domain, hash, fr.text.slice(0, 100000), nowStr()]);
  if (source) await run("UPDATE config_sources SET last_checked_at = ?, last_version_hash = ?" + (changed ? ", last_change_at = ?" : "") + " WHERE id = ?", changed ? [nowStr(), hash, nowStr(), source.id] : [nowStr(), hash, source.id]);
  var ex = await ad.extract(jid, fr.text);
  var current = await ad.current(jid);
  var pid = 'prop-' + uuidv4().slice(0, 8);
  await run("INSERT INTO config_proposals (id, jurisdiction_id, domain, status, summary, proposed_json, current_json, source_ref, snapshot_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [pid, jid, domain, 'pending', ex.summary, JSON.stringify(ex.proposed), JSON.stringify(current), source ? source.id : '(pasted)', snapId, actor || 'scan', nowStr()]);
  return { ok: true, proposalId: pid, changed: changed, via: fr.via, summary: ex.summary };
}

module.exports = { hashText: hashText, fetchSource: fetchSource, deepMerge: deepMerge, adapter: adapter, ADAPTERS: ADAPTERS, stageFromSource: stageFromSource };
