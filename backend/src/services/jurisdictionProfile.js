'use strict';
// Jurisdiction Profile: a versioned, sectioned INDEX over the per-area config stores.
// Config still LIVES in each area (fee_profiles, system_config deadline_rules, jurisdiction_profiles,
// redaction_rules, record_types) - this layer does NOT move it. For each section it tracks a content
// hash, a version that bumps when the underlying config changes, provenance, and attestation fields
// (who/when/which version signed off). The attestation GATE (enforcement + re-arm + UI) is built on top
// of this in the next slice; here we provide the model, the sync/index, and the readiness view.
var crypto = require('crypto');
var { all, get, run } = require('../db');
var CE = require('./configExtractors');

function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function uid() { return 'jps-' + require('uuid').v4().slice(0, 8); }

// deterministic stringify (sorted keys) so hashes are stable
function stable(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(o[k]); }).join(',') + '}';
}
function hashOf(o) { return crypto.createHash('sha256').update(stable(o || {}), 'utf8').digest('hex').slice(0, 32); }

var CORE_SECTIONS = [
  { key: 'identity',  label: 'Jurisdiction identity & statutes', editor: '/config' },
  { key: 'fees',      label: 'Fee & cost schedule',              editor: '/fee-config' },
  { key: 'deadlines', label: 'Response deadlines & tolling',     editor: '/tickler' },
  { key: 'clarification', label: 'Clarification / vague-request policy', editor: '/clarification-policy' },
  { key: 'payment',   label: 'Deposit & payment clock',            editor: '/fee-config' },
  { key: 'fee_waiver', label: 'Fee-waiver policy',                 editor: '/fee-config' },
  { key: 'exemption', label: 'Exemption model & appeals',        editor: '/config' },
  { key: 'redaction', label: 'Redaction / exemption rules',      editor: '/redaction-rules' },
  { key: 'taxonomy',  label: 'Record types & taxonomy',          editor: '/taxonomy' }
];

// PHASE 7 / WS1 — the config surfaces a Phase-6 state template brings with it. They appear for a
// jurisdiction ONLY once its template has been imported (i.e. it holds a `template_import` rule row), so
// a city that has never run the importer sees exactly the nine sections it saw before.
//
// Each one reads its live config out of `jurisdiction_rules` and is `configured` only when every ⚠
// city-config knob on it has been confirmed. That is the go-live gate: `attest()` refuses a
// not_configured section, so a state cannot be signed off while a knob the statute leaves to local
// policy is still sitting on an unconfirmed suggested default.
var TEMPLATE_SECTIONS = [
  { key: 'intake',      label: 'Intake channels & acknowledgment', editor: '/config', domain: 'intake' },
  { key: 'eligibility', label: 'Requester eligibility gate',       editor: '/config', domain: 'eligibility' },
  { key: 'branches',    label: 'State branch profile',             editor: '/config', domain: 'branches' },
  { key: 'disposition', label: 'Delivery format & release hold',   editor: '/config', domain: 'disposition' },
  { key: 'ledger',      label: 'Requestor ledger',                 editor: '/config', domain: 'ledger' },
  { key: 'template_import', label: 'State template — city-config knobs', editor: '/config', domain: 'template_import' }
];
var TEMPLATE_BY_KEY = {};
TEMPLATE_SECTIONS.forEach(function (s) { TEMPLATE_BY_KEY[s.key] = s; });

// Back-compat: callers that iterate SECTIONS get the core nine, unchanged.
var SECTIONS = CORE_SECTIONS;

// The sections that apply to THIS jurisdiction: the core nine, plus the template surfaces once a
// template has actually been imported.
async function sectionsFor(jid) {
  if (!jid) return CORE_SECTIONS;
  var imported = null;
  try { imported = await get("SELECT id FROM jurisdiction_rules WHERE jurisdiction_id = ? AND domain = 'template_import'", [jid]); } catch (e) {}
  return imported ? CORE_SECTIONS.concat(TEMPLATE_SECTIONS) : CORE_SECTIONS;
}

// Every ⚠ city-config knob in a template-imported config that a human has not yet confirmed. The knobs
// hang off nodes (`knobs`/`branches`), off dimension entries (eligibility), or off the config root.
function pendingCityKnobs(cfg) {
  var pending = [];
  var visit = function (label, o) {
    if (!o || typeof o !== 'object') return;
    if (o.city_config && typeof o.city_config === 'object' && o.city_config.confirmed !== true) pending.push(label);
    if (o.confirmed === false && o.gated === true) pending.push(label); // eligibility dimensions
  };
  ['knobs', 'branches'].forEach(function (sec) {
    Object.keys((cfg && cfg[sec]) || {}).forEach(function (k) { visit(sec + '/' + k, cfg[sec][k]); });
  });
  Object.keys((cfg && cfg.dimensions) || {}).forEach(function (k) { visit('dimensions/' + k, cfg.dimensions[k]); });
  ['hold', 'caps_branch'].forEach(function (k) { if (cfg && cfg[k]) visit(k, cfg[k]); });
  if (cfg && cfg.city_config) visit('city_config', cfg);
  return pending;
}

// A hashable signature of a section's CURRENT live config, read from its area store.
async function signature(jid, section) {
  var tsec = TEMPLATE_BY_KEY[section];
  if (tsec) {
    var cfg = null;
    try { cfg = await require('./jurisdictionRules').read(jid, tsec.domain); } catch (e) {}
    if (!cfg) return {};
    if (section !== 'template_import') return { config: cfg, pending: pendingCityKnobs(cfg) };
    // The manifest section is the WHOLE-TEMPLATE gate: it is configured only when every city-config
    // knob on every imported surface has been confirmed, wherever that knob lives. Rolling it up here
    // means one attestation cannot be signed while another surface still has an open knob.
    var pending = [];
    for (var i = 0; i < TEMPLATE_SECTIONS.length; i++) {
      var d = TEMPLATE_SECTIONS[i];
      if (d.key === 'template_import') continue;
      var c = null;
      try { c = await require('./jurisdictionRules').read(jid, d.domain); } catch (e) {}
      if (c) pendingCityKnobs(c).forEach(function (p) { pending.push(d.key + '/' + p); });
    }
    // Knobs also live on surfaces owned by a pre-existing section (fee, exemption, redaction,
    // clarification, payment). Sweep those domains too — they are listed in the manifest.
    var extra = ['fee', 'exemption', 'redaction'];
    for (var j = 0; j < extra.length; j++) {
      var ec = null;
      try { ec = await require('./jurisdictionRules').read(jid, extra[j]); } catch (e) {}
      if (ec && ec._import) pendingCityKnobs(ec).forEach(function (p) { pending.push(extra[j] + '/' + p); });
    }
    return { manifest: cfg, pending: pending.sort() };
  }
  if (section === 'identity') { return (await get("SELECT name, code, statute_name, statute_citation, exemption_model FROM jurisdiction_profiles WHERE id = ?", [jid])) || {}; }
  if (section === 'fees') { try { return await CE.adapter('fee').current(jid); } catch (e) { return {}; } }
  if (section === 'deadlines') { try { return await CE.adapter('deadline').current(jid); } catch (e) { return {}; } }
  if (section === 'clarification') { try { return await CE.adapter('clarification').current(jid); } catch (e) { return {}; } }
  if (section === 'payment') { try { return await CE.adapter('payment').current(jid); } catch (e) { return {}; } }
  if (section === 'fee_waiver') { try { return await CE.adapter('fee_waiver').current(jid); } catch (e) { return {}; } }
  if (section === 'exemption') { try { return await CE.adapter('exemption').current(jid); } catch (e) { return {}; } }
  if (section === 'redaction') {
    var rows = await all("SELECT id, approval_status, is_active, COALESCE(updated_at, created_at) AS u FROM redaction_rules WHERE jurisdiction_id = ? ORDER BY id", [jid]);
    return { count: rows.length, active: rows.filter(function (r) { return r.is_active == 1; }).length, pending: rows.filter(function (r) { return r.approval_status === 'pending_review'; }).length, digest: rows.map(function (r) { return r.id + ':' + r.approval_status + ':' + r.is_active + ':' + r.u; }).join('|') };
  }
  if (section === 'taxonomy') {
    var rts = await all("SELECT id, status, COALESCE(updated_at, created_at) AS u FROM record_types ORDER BY id");
    return { count: rts.length, draft: rts.filter(function (r) { return r.status === 'draft'; }).length, digest: rts.map(function (r) { return r.id + ':' + r.status + ':' + r.u; }).join('|') };
  }
  return {};
}

function isConfigured(section, sig) {
  if (!sig) return false;
  if (TEMPLATE_BY_KEY[section]) {
    // Imported, but not yet CONFIGURED: an unconfirmed city-config knob is a decision the statute left
    // to the city and nobody has made. Holding the section at not_configured is what blocks attest().
    var body = sig.config || sig.manifest;
    return !!body && Array.isArray(sig.pending) && sig.pending.length === 0;
  }
  if (section === 'identity') return !!sig.name;
  if (section === 'fees') return !!(sig.labor || sig.duplication);
  if (section === 'deadlines') return !!(sig.clocks && Object.keys(sig.clocks).length);
  if (section === 'clarification') return sig && sig.enabled === true;
  if (section === 'payment') return sig && sig.enabled === true;
  if (section === 'fee_waiver') return sig && sig.enabled === true;
  if (section === 'exemption') return !!sig.exemption_model;
  if (section === 'redaction') return (sig.count || 0) > 0;
  if (section === 'taxonomy') return (sig.count || 0) > 0;
  return false;
}

// Idempotent: recompute each section's hash from its live store; bump version on change; upsert the row.
async function sync(jid, opts) {
  opts = opts || {};
  if (!jid) return [];
  var secs = await sectionsFor(jid);
  for (var i = 0; i < secs.length; i++) {
    var sec = secs[i];
    var sig = await signature(jid, sec.key);
    var hash = hashOf(sig);
    var configured = isConfigured(sec.key, sig);
    var row = await get("SELECT * FROM jurisdiction_profile_sections WHERE jurisdiction_id = ? AND section = ?", [jid, sec.key]);
    var now = nowStr();
    if (!row) {
      await run("INSERT INTO jurisdiction_profile_sections (id, jurisdiction_id, section, label, content_hash, version, status, source, last_changed_at, last_changed_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [uid(), jid, sec.key, sec.label, hash, configured ? 1 : 0, configured ? 'configured' : 'not_configured', opts.source || 'seed', now, opts.actor || 'system', now, now]);
    } else if (row.content_hash !== hash) {
      await run("UPDATE jurisdiction_profile_sections SET label = ?, content_hash = ?, version = ?, status = ?, source = ?, last_changed_at = ?, last_changed_by = ?, updated_at = ? WHERE id = ?",
        [sec.label, hash, (Number(row.version) || 0) + 1, configured ? 'configured' : 'not_configured', opts.source || row.source || 'updated', now, opts.actor || row.last_changed_by || 'system', now, row.id]);
    } else if (row.label !== sec.label) {
      await run("UPDATE jurisdiction_profile_sections SET label = ?, updated_at = ? WHERE id = ?", [sec.label, now, row.id]);
    }
  }
  return await rows(jid);
}

async function rows(jid) {
  var list = await all("SELECT * FROM jurisdiction_profile_sections WHERE jurisdiction_id = ? ORDER BY section", [jid]);
  var byKey = {}; (list || []).forEach(function (r) { byKey[r.section] = r; });
  return (await sectionsFor(jid)).map(function (sec) {
    var r = byKey[sec.key] || { section: sec.key, label: sec.label, version: 0, status: 'not_configured', content_hash: null };
    var attested = !!(r.attested_hash);
    var drift = attested && r.attested_hash !== r.content_hash;
    var readiness = r.status === 'not_configured' ? 'not_configured' : (attested ? (drift ? 'needs_reattestation' : 'attested') : 'configured');
    return { section: sec.key, label: sec.label, editor: sec.editor, version: Number(r.version) || 0, status: r.status, source: r.source || null,
      lastChangedAt: r.last_changed_at || null, lastChangedBy: r.last_changed_by || null,
      attestedBy: r.attested_by || null, attestedAt: r.attested_at || null, attestedVersion: r.attested_version || null,
      attested: attested, drift: drift, readiness: readiness, contentHash: r.content_hash || null };
  });
}

async function getProfile(jid) {
  var jur = jid ? await get("SELECT id, name, code, status FROM jurisdiction_profiles WHERE id = ?", [jid]) : null;
  await sync(jid);
  var secs = await rows(jid);
  var configured = secs.filter(function (s) { return s.status !== 'not_configured'; }).length;
  var attested = secs.filter(function (s) { return s.attested; }).length;
  var drifted = secs.filter(function (s) { return s.drift; }).length;
  return { jurisdiction: jur, sections: secs, summary: { total: secs.length, configured: configured, attested: attested, drifted: drifted, notConfigured: secs.length - configured } };
}

async function attest(jid, section, actor) {
  if (!jid || !section) throw new Error('Jurisdiction and section are required.');
  await sync(jid);
  var row = await get("SELECT * FROM jurisdiction_profile_sections WHERE jurisdiction_id = ? AND section = ?", [jid, section]);
  if (!row) throw new Error('Unknown section: ' + section);
  if (row.status === 'not_configured') throw new Error('This section has no configuration yet, so there is nothing to sign off on.');
  var now = nowStr();
  await run("UPDATE jurisdiction_profile_sections SET attested_by = ?, attested_at = ?, attested_version = ?, attested_hash = ?, updated_at = ? WHERE id = ?", [actor || 'unknown', now, row.version, row.content_hash, now, row.id]);
  return await rows(jid);
}
async function unattest(jid, section) {
  if (!jid || !section) throw new Error('Jurisdiction and section are required.');
  var row = await get("SELECT * FROM jurisdiction_profile_sections WHERE jurisdiction_id = ? AND section = ?", [jid, section]);
  if (!row) throw new Error('Unknown section: ' + section);
  await run("UPDATE jurisdiction_profile_sections SET attested_by = NULL, attested_at = NULL, attested_version = NULL, attested_hash = NULL, updated_at = ? WHERE id = ?", [nowStr(), row.id]);
  return await rows(jid);
}
async function sectionState(jid, section) {
  if (!jid) return null;
  await sync(jid);
  var list = await rows(jid);
  for (var i = 0; i < list.length; i++) { if (list[i].section === section) return list[i]; }
  return null;
}
module.exports = { SECTIONS: SECTIONS, CORE_SECTIONS: CORE_SECTIONS, TEMPLATE_SECTIONS: TEMPLATE_SECTIONS, sectionsFor: sectionsFor, pendingCityKnobs: pendingCityKnobs, sync: sync, getProfile: getProfile, signature: signature, hashOf: hashOf, attest: attest, unattest: unattest, sectionState: sectionState };
