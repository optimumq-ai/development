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

var SECTIONS = [
  { key: 'identity',  label: 'Jurisdiction identity & statutes', editor: '/config' },
  { key: 'fees',      label: 'Fee & cost schedule',              editor: '/fee-config' },
  { key: 'deadlines', label: 'Response deadlines & tolling',     editor: '/tickler' },
  { key: 'clarification', label: 'Clarification / vague-request policy', editor: '/clarification-policy' },
  { key: 'payment',   label: 'Deposit & payment clock',            editor: '/fee-config' },
  { key: 'exemption', label: 'Exemption model & appeals',        editor: '/config' },
  { key: 'redaction', label: 'Redaction / exemption rules',      editor: '/redaction-rules' },
  { key: 'taxonomy',  label: 'Record types & taxonomy',          editor: '/taxonomy' }
];

// A hashable signature of a section's CURRENT live config, read from its area store.
async function signature(jid, section) {
  if (section === 'identity') { return (await get("SELECT name, code, statute_name, statute_citation, exemption_model FROM jurisdiction_profiles WHERE id = ?", [jid])) || {}; }
  if (section === 'fees') { try { return await CE.adapter('fee').current(jid); } catch (e) { return {}; } }
  if (section === 'deadlines') { try { return await CE.adapter('deadline').current(jid); } catch (e) { return {}; } }
  if (section === 'clarification') { try { return await CE.adapter('clarification').current(jid); } catch (e) { return {}; } }
  if (section === 'payment') { try { return await CE.adapter('payment').current(jid); } catch (e) { return {}; } }
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
  if (section === 'identity') return !!sig.name;
  if (section === 'fees') return !!(sig.labor || sig.duplication);
  if (section === 'deadlines') return !!(sig.clocks && Object.keys(sig.clocks).length);
  if (section === 'clarification') return sig && sig.enabled === true;
  if (section === 'payment') return sig && sig.enabled === true;
  if (section === 'exemption') return !!sig.exemption_model;
  if (section === 'redaction') return (sig.count || 0) > 0;
  if (section === 'taxonomy') return (sig.count || 0) > 0;
  return false;
}

// Idempotent: recompute each section's hash from its live store; bump version on change; upsert the row.
async function sync(jid, opts) {
  opts = opts || {};
  if (!jid) return [];
  for (var i = 0; i < SECTIONS.length; i++) {
    var sec = SECTIONS[i];
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
  return SECTIONS.map(function (sec) {
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
module.exports = { SECTIONS: SECTIONS, sync: sync, getProfile: getProfile, signature: signature, hashOf: hashOf, attest: attest, unattest: unattest, sectionState: sectionState };
