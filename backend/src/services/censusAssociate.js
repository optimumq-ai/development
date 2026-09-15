'use strict';
// CENSUS ASSOCIATION + THE THREE DOORS (inventory build slice 3, 2026-09-15). Design: DESIGN_setup_flow_map.md §3 step 3,
// mockups/inventory_census (Associate, Sample, NoRedaction artboards), HANDOFF 2026-09-15 (b) (Kevin's "No redaction needed").
//
//  suggest      — the ONE paid step of the inventory flow: one small naming/matching call per unassociated grouping
//                 (two first-page excerpts + the label set + the count), against the active catalog. Writes nothing.
//  associate    — the HUMAN approval: an existing type/variant, or a new draft variant under a bucket. Only here are the
//                 type↔source link, the fingerprint stamps, the variant and its signature written (flow-map decision 3).
//  redactByHand — the old Mass Redaction dismiss, honestly named: each request's copies reviewed one by one.
//  noRedaction  — a RELEASE decision written to the variant (public availability Releasable + auto-release on), guarded:
//                 the bucket's legal-redaction gate must be off (a legal gate never loosens at a more specific level), the
//                 bucket must not be Restricted/Confidential, a reason is required, everything is recorded in
//                 taxonomy_audit and reversible. The existing record-type-clean bypass then releases a document as-is ONLY
//                 when the automatic clean read finds nothing — this designation opens no new release path.
var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;
var { all, get, run } = require('../db');
var { v4: uuidv4 } = require('uuid');
var docFingerprint = require('./docFingerprint');
var SD = require('./schemaDiscovery');

function nid(p) { return p + '-' + uuidv4().substring(0, 8); }
function now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function parseJson(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
function cfgOf(repo) { return parseJson(repo.config, {}) || {}; }

async function audit(entityType, entityId, action, actor, details) {
  await run('INSERT INTO taxonomy_audit (id, entity_type, entity_id, action, actor_id, actor_name, details) VALUES (?,?,?,?,?,?,?)',
    [nid('aud'), entityType, entityId, action, (actor && actor.id) || null, (actor && (actor.name || actor.email)) || 'system', details ? JSON.stringify(details) : null]);
}
async function linkRepo(recordTypeId, repositoryId) {
  var dup = await get('SELECT id FROM record_type_repositories WHERE record_type_id = ? AND repository_id = ?', [recordTypeId, repositoryId]);
  if (dup) return false;
  await run('INSERT INTO record_type_repositories (id, record_type_id, repository_id, format, filter_spec, sort_order) VALUES (?,?,?,?,?,?)', [nid('rr'), recordTypeId, repositoryId, 'document', '{}', 100]);
  return true;
}

async function context(repo, gid) {
  var g = await get('SELECT * FROM census_groupings WHERE id = ? AND repository_id = ?', [gid, repo.id]);
  if (!g) return null;
  g.signature = parseJson(g.signature, null); g.folders = parseJson(g.folders, []); g.example_ids = parseJson(g.example_ids, []);
  g.members = await all('SELECT id, filename, features, matched_record_type_id FROM document_fingerprints WHERE grouping_id = ?', [gid]);
  g.record_type = g.record_type_id ? await get('SELECT * FROM record_types WHERE id = ?', [g.record_type_id]) : null;
  g.parent = g.record_type && g.record_type.parent_record_type_id ? await get('SELECT * FROM record_types WHERE id = ?', [g.record_type.parent_record_type_id]) : null;
  return g;
}

function excerptOf(repo, filename) {
  var cfg = cfgOf(repo); if (!cfg.path) return '';
  var base = path.resolve(cfg.path), full = path.resolve(base, filename);
  if (full.indexOf(base + path.sep) !== 0 || !fs.existsSync(full)) return '';
  try { return execFileSync('pdftotext', ['-f', '1', '-l', '1', full, '-'], { encoding: 'utf8', timeout: 15000 }).trim().substring(0, 1100); } catch (e) { return ''; }
}

async function catalog() {
  var rows = await all("SELECT id, name, intent, status, parent_record_type_id, category_id FROM record_types WHERE status IN ('active','draft') ORDER BY name");
  var buckets = rows.filter(function (r) { return !r.parent_record_type_id; });
  var variants = rows.filter(function (r) { return r.parent_record_type_id; });
  return { buckets: buckets, variants: variants };
}

// ------------------------------------------------------------------ suggest (AI names/matches; writes nothing)
async function suggest(repo, gid) {
  var g = await context(repo, gid);
  if (!g) return { status: 404, error: 'Grouping not found' };
  if (g.record_type_id) return { status: 409, error: 'This grouping is already associated.' };
  var cat = await catalog();
  var byId = {}; cat.buckets.forEach(function (b) { byId[b.id] = b; });
  var examples = g.members.slice(0, 2).map(function (m) { return '--- example (' + m.filename + ') ---\n' + (excerptOf(repo, m.filename) || '(no text)'); }).join('\n');
  var labels = ((g.signature || {}).labels || []).join(', ');
  var catText = cat.buckets.filter(function (b) { return b.status === 'active'; }).map(function (b) { return b.id + ' | ' + b.name + (b.intent ? ' — ' + b.intent.slice(0, 120) : ''); }).join('\n');
  var varText = cat.variants.map(function (v) { return v.id + ' | ' + v.name + ' (variant of ' + ((byId[v.parent_record_type_id] || {}).name || '?') + ', ' + v.status + ')'; }).join('\n');
  var prompt = 'You are a records-management taxonomy expert for a local government public-records system.\n'
    + 'Deterministic layout analysis has grouped ' + g.member_count + ' documents from the source "' + repo.name + '" into ONE identical grouping'
    + (g.folders.length ? ' (folder' + (g.folders.length > 1 ? 's' : '') + ': ' + g.folders.map(function (f) { return f.folder; }).join(', ') + ')' : '') + '.\n'
    + 'Your only job is to say WHAT these documents are. Do not count, merge or split anything.\n\n'
    + 'Return ONLY a JSON object:\n'
    + '{"match": {"record_type_id": "<id from the lists below or null>", "confidence": 0, "reasoning": ""},\n'
    + ' "propose": {"parent_record_type_id": "<bucket id>", "name": "", "code": "", "intent": "", "expected_content": "", "synonyms": [], "keywords": [], "identifying_facets": [], "confidence": 0, "reasoning": ""}}\n\n'
    + 'Rules:\n- match.record_type_id: an EXISTING variant or bucket id ONLY if the documents clearly ARE that type; otherwise null.\n'
    + '- propose: always fill it — the best NEW VARIANT name under the bucket these documents belong to (parent_record_type_id must be a bucket id from the list).\n'
    + '- Do not reuse an existing variant\'s name. code: short kebab-case. Keep reasoning to one or two sentences.\n\n'
    + 'BUCKETS (id | name — intent):\n' + catText + '\n\nEXISTING VARIANTS (id | name):\n' + (varText || '(none)') + '\n\n'
    + 'Form field labels the layout owns: ' + (labels || '(none)') + '\n\nEXAMPLE DOCUMENTS:\n' + examples;
  var Anthropic = require('@anthropic-ai/sdk');
  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var message = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] });
  var raw = require('./aiText').textOf(message).replace(/```json|```/g, '').trim();
  var p = null; try { p = JSON.parse(raw); } catch (e) { return { status: 502, error: 'The AI answer could not be read — try again.' }; }
  var match = p && p.match && p.match.record_type_id ? (cat.buckets.concat(cat.variants).find(function (r) { return r.id === p.match.record_type_id; }) || null) : null;
  // Confidence arrives as 0–1 or 0–100 depending on the model's mood; normalise to percent.
  function pct(x) { x = Number(x); if (!isFinite(x)) return null; return x <= 1 ? Math.round(x * 100) : Math.round(x); }
  var prop = (p && p.propose) || {};
  if (!byId[prop.parent_record_type_id]) prop.parent_record_type_id = null;
  return {
    status: 200,
    match: match ? { record_type_id: match.id, name: match.name, parent_name: match.parent_record_type_id ? ((byId[match.parent_record_type_id] || {}).name || null) : null, confidence: pct(p.match.confidence), reasoning: p.match.reasoning || null } : null,
    propose: { parent_record_type_id: prop.parent_record_type_id, parent_name: prop.parent_record_type_id ? byId[prop.parent_record_type_id].name : null, name: prop.name || null, code: prop.code || null, intent: prop.intent || null, expected_content: prop.expected_content || null, synonyms: prop.synonyms || [], keywords: prop.keywords || [], identifying_facets: prop.identifying_facets || [], confidence: pct(prop.confidence), reasoning: prop.reasoning || null }
  };
}

// ------------------------------------------------------------------ associate (the approval writes everything)
async function associate(repo, gid, body, actor) {
  var g = await context(repo, gid);
  if (!g) return { status: 404, error: 'Grouping not found' };
  if (g.record_type_id) return { status: 409, error: 'This grouping is already associated — use "Associate differently" after undoing.' };
  if (!g.members.length) return { status: 422, error: 'This grouping has no documents.' };
  body = body || {};
  var feats = g.members.map(function (m) { return parseJson(m.features, null); }).filter(Boolean);
  var sig = g.signature || (feats.length ? docFingerprint.signature(feats) : null);
  var fpIds = g.members.map(function (m) { return m.id; });
  var ph = fpIds.map(function () { return '?'; }).join(',');
  var rt;
  if (body.mode === 'existing') {
    rt = body.record_type_id ? await get('SELECT * FROM record_types WHERE id = ?', [body.record_type_id]) : null;
    if (!rt) return { status: 422, error: 'Choose an existing record type or variant.' };
    await run('UPDATE document_fingerprints SET matched_record_type_id = ? WHERE id IN (' + ph + ')', [rt.id].concat(fpIds));
    await linkRepo(rt.id, repo.id);
    var meta = parseJson(rt.discovery_meta, {}) || {};
    if (!meta.signature && sig) {           // teach recognition this layout; never overwrite a signature that already works
      meta.signature = sig; if (meta.found_at == null) meta.found_at = new Date().toISOString().slice(0, 10);
      meta.signature_source = { grouping_id: gid, repository_id: repo.id };   // so an undo can forget what it taught
      await run('UPDATE record_types SET discovery_meta = ? WHERE id = ?', [JSON.stringify(meta), rt.id]);
    }
    await audit('record_type', rt.id, 'census_associate_existing', actor, { grouping_id: gid, repository_id: repo.id, documents: fpIds.length });
  } else if (body.mode === 'new_variant') {
    var parent = body.parent_record_type_id ? await get('SELECT * FROM record_types WHERE id = ?', [body.parent_record_type_id]) : null;
    if (!parent) return { status: 422, error: 'Choose the bucket the new variant belongs to.' };
    if (parent.parent_record_type_id) return { status: 422, error: 'A variant cannot have a variant — pick its bucket.' };
    if (!(body.name || '').trim()) return { status: 422, error: 'Give the variant a name.' };
    var layout = g.layout || 'uniform';
    try {
      rt = await SD.applyGroupingProposal(parent.id, {
        name: body.name, code: body.code || null, intent: body.intent || null, expected_content: body.expected_content || null,
        synonyms: body.synonyms || [], keywords: body.keywords || [], identifying_facets: body.identifying_facets || [], formats: ['document'],
        confidence: typeof body.confidence === 'number' ? body.confidence : null,
        counted: true, estimated_count: g.member_count, layout: layout,
        mass_redaction_candidate: layout === 'uniform' || layout === 'few_layouts',
        example_files: g.members.slice(0, 5).map(function (m) { return path.posix.basename(m.filename); }),
        repos: [repo.name], fingerprint_ids: fpIds, signature: sig
      });
    } catch (e) { return { status: 422, error: e.message }; }
    var vm = parseJson(rt.discovery_meta, {}) || {}; vm.signature_source = { grouping_id: gid, repository_id: repo.id };
    await run('UPDATE record_types SET discovery_meta = ? WHERE id = ?', [JSON.stringify(vm), rt.id]);
    await audit('record_type', rt.id, 'census_associate_new_variant', actor, { grouping_id: gid, repository_id: repo.id, documents: fpIds.length, parent: parent.id });
  } else return { status: 400, error: 'mode must be existing or new_variant' };
  await run('UPDATE census_groupings SET record_type_id = ? WHERE id = ?', [rt.id, gid]);
  return { status: 200, record_type: { id: rt.id, name: rt.name, status: rt.status, parent_record_type_id: rt.parent_record_type_id || null }, documents: fpIds.length };
}

// Undo an association: unstamp this grouping's documents, clear the link on the grouping. The record type itself
// stays (a draft variant may be deleted on the Taxonomy page); its source link stays only if other documents here
// still carry the type.
async function dissociate(repo, gid, actor) {
  var g = await context(repo, gid);
  if (!g) return { status: 404, error: 'Grouping not found' };
  if (!g.record_type_id) return { status: 409, error: 'This grouping is not associated.' };
  var fpIds = g.members.map(function (m) { return m.id; });
  if (fpIds.length) await run('UPDATE document_fingerprints SET matched_record_type_id = NULL WHERE id IN (' + fpIds.map(function () { return '?'; }).join(',') + ')', fpIds);
  var still = await get('SELECT count(*)::int AS n FROM document_fingerprints WHERE repository_id = ? AND matched_record_type_id = ?', [repo.id, g.record_type_id]);
  if (!Number(still.n)) await run('DELETE FROM record_type_repositories WHERE record_type_id = ? AND repository_id = ?', [g.record_type_id, repo.id]);
  // Forget the signature this association taught the type — otherwise the next census would quietly re-associate
  // the same documents by recognition, and the undo would not hold. A signature learned elsewhere is left alone.
  var dm = parseJson(g.record_type.discovery_meta, {}) || {};
  if (dm.signature_source && dm.signature_source.grouping_id === gid) {
    delete dm.signature; delete dm.signature_source;
    await run('UPDATE record_types SET discovery_meta = ? WHERE id = ?', [JSON.stringify(dm), g.record_type.id]);
  }
  await run('UPDATE census_groupings SET record_type_id = NULL WHERE id = ?', [gid]);
  await audit('record_type', g.record_type_id, 'census_dissociate', actor, { grouping_id: gid, repository_id: repo.id, documents: fpIds.length });
  return { status: 200 };
}

// ------------------------------------------------------------------ redact by hand (the honest dismiss)
async function redactByHand(repo, gid, on, actor) {
  var g = await context(repo, gid);
  if (!g) return { status: 404, error: 'Grouping not found' };
  if (!g.record_type) return { status: 422, error: 'Associate the grouping with a record type first.' };
  var meta = parseJson(g.record_type.discovery_meta, {}) || {};
  if (on) { meta.redact_by_hand = { by: (actor && actor.name) || null, at: now() }; }
  else delete meta.redact_by_hand;
  var candidate = on ? 0 : ((g.layout === 'uniform' || g.layout === 'few_layouts') ? 1 : 0);
  await run('UPDATE record_types SET discovery_meta = ?, mass_redaction_candidate = ? WHERE id = ?', [JSON.stringify(meta), candidate, g.record_type.id]);
  await audit('record_type', g.record_type.id, on ? 'redact_by_hand' : 'redact_by_hand_undone', actor, { grouping_id: gid, repository_id: repo.id });
  return { status: 200 };
}

// ------------------------------------------------------------------ no redaction needed (a guarded release decision)
async function noRedactionCheck(repo, gid) {
  var g = await context(repo, gid);
  if (!g) return { status: 404, error: 'Grouping not found' };
  if (!g.record_type) return { status: 200, allowed: false, checks: [{ key: 'associated', passes: false, text: 'Associate the grouping with a record type first.' }] };
  var rt = g.record_type, bucket = g.parent || rt;
  var meta = parseJson(rt.discovery_meta, {}) || {};
  var legalOn = !!(rt.legal_redaction_required || (g.parent && g.parent.legal_redaction_required));
  var av = bucket.public_availability || 'review_required';
  var closed = av === 'restricted' || av === 'confidential';
  var checks = [
    { key: 'legal_gate', passes: !legalOn, text: 'Legal-redaction gate on ' + (g.parent ? 'the parent bucket ' + bucket.name : rt.name) + ': ' + (legalOn ? 'ON — this door is closed; a legal gate never loosens at a more specific level. Senior Legal would change it on the bucket first.' : 'off.') },
    { key: 'availability', passes: !closed, text: 'Public availability of ' + (g.parent ? 'the bucket ' + bucket.name : rt.name) + ': ' + av.replace('_', ' ') + (closed ? ' — a Restricted or Confidential bucket closes this door.' : ' — the variant may be set more open than its bucket.') },
    { key: 'already', passes: !meta.no_redaction, text: meta.no_redaction ? 'Already marked "No redaction needed" by ' + (meta.no_redaction.by_name || 'staff') + ' on ' + String(meta.no_redaction.at || '').slice(0, 10) + '.' : 'Not yet decided.' }
  ];
  return { status: 200, allowed: checks.every(function (c) { return c.passes; }), checks: checks, record_type: { id: rt.id, name: rt.name, status: rt.status, public_availability: rt.public_availability, auto_release_eligible: !!rt.auto_release_eligible }, bucket: { id: bucket.id, name: bucket.name, public_availability: av }, current: meta.no_redaction || null };
}

async function noRedaction(repo, gid, reason, actor) {
  reason = String(reason || '').trim();
  if (reason.length < 10) return { status: 400, error: 'Say why no redaction is needed (a sentence, at least).' };
  var chk = await noRedactionCheck(repo, gid);
  if (chk.status !== 200) return chk;
  if (!chk.allowed) return { status: 422, error: chk.checks.filter(function (c) { return !c.passes; }).map(function (c) { return c.text; }).join(' '), checks: chk.checks };
  var rt = await get('SELECT * FROM record_types WHERE id = ?', [chk.record_type.id]);
  var meta = parseJson(rt.discovery_meta, {}) || {};
  meta.no_redaction = { by: (actor && actor.id) || null, by_name: (actor && actor.name) || null, at: now(), reason: reason, prev: { public_availability: rt.public_availability, auto_release_eligible: rt.auto_release_eligible ? 1 : 0 } };
  await run("UPDATE record_types SET public_availability = 'releasable', auto_release_eligible = 1, discovery_meta = ? WHERE id = ?", [JSON.stringify(meta), rt.id]);
  await audit('record_type', rt.id, 'no_redaction_needed', actor, { grouping_id: gid, repository_id: repo.id, reason: reason, prev: meta.no_redaction.prev });
  return { status: 200, record_type: { id: rt.id, name: rt.name }, decided: meta.no_redaction };
}

async function undoNoRedaction(repo, gid, actor) {
  var g = await context(repo, gid);
  if (!g) return { status: 404, error: 'Grouping not found' };
  if (!g.record_type) return { status: 422, error: 'Not associated.' };
  var meta = parseJson(g.record_type.discovery_meta, {}) || {};
  if (!meta.no_redaction) return { status: 409, error: 'This grouping is not marked "No redaction needed".' };
  var prev = meta.no_redaction.prev || { public_availability: 'review_required', auto_release_eligible: 0 };
  delete meta.no_redaction;
  await run('UPDATE record_types SET public_availability = ?, auto_release_eligible = ?, discovery_meta = ? WHERE id = ?', [prev.public_availability || 'review_required', prev.auto_release_eligible ? 1 : 0, JSON.stringify(meta), g.record_type.id]);
  await audit('record_type', g.record_type.id, 'no_redaction_needed_undone', actor, { grouping_id: gid, repository_id: repo.id });
  return { status: 200 };
}

module.exports = { suggest: suggest, associate: associate, dissociate: dissociate, redactByHand: redactByHand, noRedactionCheck: noRedactionCheck, noRedaction: noRedaction, undoNoRedaction: undoNoRedaction, catalog: catalog };
