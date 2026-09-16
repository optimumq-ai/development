// TEMPLATE SEEDING — item 7 slice S1 (2026-09-16). DESIGN_templates_from_samples.md §2 (classes), §4 (what
// Propose writes), §7 (the matching rule). This module owns everything a redaction template learns FROM THE
// CENSUS: the layout class the census proposes for a variant, the pile vocabulary that replaces a one-file
// fingerprint, the consensus signature the matcher gates on, and the content class of a zone set.
//
// The two measured findings this exists for (§7): a template fingerprinted from ONE sample keeps that sample's
// filled-in words and then HOLDS most same-form documents (58–92 < 80); and short forms are letterhead + a few
// labels, so vocabulary alone cannot tell Correction Notice (Standard) from (Extended) — only the census
// fingerprint (titleLines veto) can. So: pile vocabulary when a pile exists, and NO burn without a fingerprint match.
'use strict';
var fs = require('fs');
var path = require('path');
var { execFileSync } = require('child_process');
var { get, all, run } = require('../db');
var docFingerprint = require('./docFingerprint');
var { detectorForRule } = require('./redactionAudit');

var UPLOAD_DIR = path.join(__dirname, '../../../uploads');
var LAYOUT_CLASSES = ['static', 'floating', 'adhoc'];
var PILE_EXAMPLES = 5;      // members read for the pile vocabulary (the grouping keeps up to 5 example ids)
var MIN_PILE = 2;           // fewer readable members than this → one-file vocabulary, labelled provisional

function parseJson(s, dflt) { try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }
function cfgOf(repo) { try { return repo.config ? (typeof repo.config === 'string' ? JSON.parse(repo.config) : repo.config) : {}; } catch (e) { return {}; } }

// Same tokenizer the template routes have always used: the form's "structural" words, numbers dropped.
function tokenize(text) {
  var set = {};
  (text || '').toLowerCase().split(/[^a-z0-9]+/).forEach(function (w) {
    if (w.length >= 3 && w.length <= 24 && /[a-z]/.test(w)) set[w] = 1;
  });
  return set;
}
function pdfText(fullPath) {
  try { return execFileSync('pdftotext', ['-layout', fullPath, '-'], { encoding: 'utf8', timeout: 20000 }); } catch (e) { return ''; }
}

// The census grouping that stands for a record type (its documents, signature, layout). Newest first.
async function censusContext(recordTypeId) {
  if (!recordTypeId) return null;
  var g = await get('SELECT * FROM census_groupings WHERE record_type_id = ? ORDER BY member_count DESC, created_at DESC LIMIT 1', [recordTypeId]);
  if (!g) return null;
  var repo = await get('SELECT * FROM record_repositories WHERE id = ?', [g.repository_id]);
  var sig = parseJson(g.signature, null);
  return { grouping: g, repo: repo, signature: sig, layout: g.layout || null };
}

// §2a: what the census says about WHERE things sit on the page. uniform → static; few_layouts → floating;
// no grouping (singleton / ungrouped) → null, which the card renders as "unknown — you tell us".
async function proposedLayoutClass(recordTypeId) {
  var ctx = await censusContext(recordTypeId);
  if (!ctx) return { layout_class: null, evidence: null };
  var lc = ctx.layout === 'uniform' ? 'static' : (ctx.layout === 'few_layouts' ? 'floating' : null);
  return { layout_class: lc, evidence: { grouping_id: ctx.grouping.id, member_count: ctx.grouping.member_count, layout: ctx.layout, source_name: ctx.repo ? ctx.repo.name : null } };
}

// §7: the vocabulary common to the pile's example members — the data words fall out, the form's words stay.
// Returns null when fewer than MIN_PILE members could be read (the caller falls back to the one-file vocabulary).
async function pileVocabulary(recordTypeId) {
  var ctx = await censusContext(recordTypeId);
  if (!ctx || !ctx.repo) return null;
  var cfg = cfgOf(ctx.repo); if (!cfg.path) return null;
  var base = path.resolve(cfg.path);
  var exIds = parseJson(ctx.grouping.example_ids, []).slice(0, PILE_EXAMPLES);
  if (!exIds.length) return null;
  var rows = await all('SELECT id, filename FROM document_fingerprints WHERE id IN (' + exIds.map(function () { return '?'; }).join(',') + ') AND repository_id = ?', exIds.concat([ctx.repo.id]));
  var sets = [], pages = null;
  rows.forEach(function (r) {
    if (!r.filename || r.filename.split('/').indexOf('..') !== -1) return;
    var full = path.resolve(base, r.filename);
    if (full.indexOf(base + path.sep) !== 0 || !fs.existsSync(full)) return;
    var t = pdfText(full); if (!t.trim()) return;
    sets.push(tokenize(t));
  });
  if (sets.length < MIN_PILE) return null;
  var common = Object.keys(sets[0]).filter(function (k) { return sets.every(function (s) { return s[k]; }); }).sort();
  try { pages = Number(ctx.signature && ctx.signature.pageCount) || null; } catch (e) {}
  return { tokens: common.slice(0, 600), members: sets.length, pages: pages, grouping_id: ctx.grouping.id, signature: ctx.signature };
}

// §2b: simple when every zone's cited rule is detector-backed OR the layout is static (a fixed box needs no
// reading); complex when some zone's rule has no detector AND the position is not fixed. Zones with no rule
// count as judgment-shaped.
function contentClass(zones, ruleTitles, layoutClass) {
  if (layoutClass === 'static') return 'simple';
  var judgment = (zones || []).some(function (z) {
    var title = z.rule_id ? ruleTitles[z.rule_id] : null;
    return !title || !detectorForRule(title);
  });
  return judgment ? 'complex' : 'simple';
}
async function ruleTitlesFor(zones) {
  var ids = {}; (zones || []).forEach(function (z) { if (z.rule_id) ids[z.rule_id] = 1; });
  var list = Object.keys(ids); if (!list.length) return {};
  var rows = await all('SELECT id, title FROM redaction_rules WHERE id IN (' + list.map(function () { return '?'; }).join(',') + ')', list);
  var m = {}; rows.forEach(function (r) { m[r.id] = r.title; }); return m;
}

// The census fingerprint of a REQUEST file (uploads/), computed at match time (§7: "a target with no
// fingerprint yet is fingerprinted at match time, same extractor"). Text layer first, OCR second — the census's
// own order. Cached per process; null when nothing could be read (→ the gate cannot pass, the document holds).
var featureCache = new Map();
async function targetFeatures(fileId) {
  if (featureCache.has(fileId)) return featureCache.get(fileId);
  var file = await get('SELECT id, filename FROM request_files WHERE id = ?', [fileId]);
  var feats = null;
  if (file && file.filename) {
    var full = path.resolve(UPLOAD_DIR, file.filename);
    if (full.indexOf(path.resolve(UPLOAD_DIR) + path.sep) === 0 && fs.existsSync(full) && /\.pdf$/i.test(full)) {
      try { feats = docFingerprint.extractFeatures(full); } catch (e) { feats = null; }
      if (!feats) { try { feats = docFingerprint.extractFeaturesOcr(full); } catch (e) { feats = null; } }
    }
  }
  if (featureCache.size > 2000) featureCache.clear();
  featureCache.set(fileId, feats || null);
  return feats || null;
}

// §7 rule, the gate itself. { applies:false } for a legacy template with no signature (vocabulary alone,
// provisional); otherwise pass = the target's census fingerprint isMatch()es the template's signature.
async function signatureGate(template, fileId) {
  var sig = parseJson(template && template.census_signature, null);
  if (!sig) return { applies: false, pass: null };
  var feats = await targetFeatures(fileId);
  if (!feats) return { applies: true, pass: false, reason: 'no_fingerprint' };
  return { applies: true, pass: !!docFingerprint.isMatch(feats, sig), reason: docFingerprint.isMatch(feats, sig) ? null : 'fingerprint_veto' };
}

// D5, retroactive: a template whose record type has a census grouping adopts the grouping's signature and the
// pile vocabulary. Idempotent; a template with no grouping is left alone (it stays provisional).
async function adoptCensus(template) {
  if (!template || !template.record_type_id || template.kind !== 'pages') return template;
  var pile = await pileVocabulary(template.record_type_id);
  var ctx = pile ? null : await censusContext(template.record_type_id);
  var sig = pile ? pile.signature : (ctx ? ctx.signature : null);
  if (!sig) return template;
  var fp = template.layout_fingerprint;
  var vocab = template.vocabulary_source || 'file';
  if (pile) {
    var old = parseJson(fp, {}) || {};
    fp = JSON.stringify({ v: 2, name: old.name || 'pile', pages: pile.pages || old.pages || null, tokens: pile.tokens, pile_members: pile.members, grouping_id: pile.grouping_id });
    vocab = 'pile';
  }
  await run("UPDATE layout_profiles SET census_signature = ?, layout_fingerprint = ?, vocabulary_source = ?, updated_at = datetime('now') WHERE id = ?", [JSON.stringify(sig), fp, vocab, template.id]);
  return await get('SELECT * FROM layout_profiles WHERE id = ?', [template.id]);
}
async function backfillSignatures() {
  var rows = await all("SELECT * FROM layout_profiles WHERE kind = 'pages' AND status IN ('active','proposed') AND census_signature IS NULL AND record_type_id IS NOT NULL");
  var n = 0;
  for (var i = 0; i < rows.length; i++) { var t = await adoptCensus(rows[i]); if (t && t.census_signature) n++; }
  return { candidates: rows.length, adopted: n };
}

// The estimate side of the inventory row / taxonomy chip (§6): seeded (expert) · learned from N requests ·
// none yet. A variant with no row of its own reads its parent (inherited). Read-only; S3 does the learning.
async function estimatePosture(recordTypeId, parentId) {
  async function rowFor(id) { return id ? await get('SELECT sample_size, has_expert_seed, updated_at FROM record_type_estimate_profiles WHERE record_type_id = ?', [id]) : null; }
  var own = await rowFor(recordTypeId), inherited = false, row = own;
  if (!row || (!Number(row.has_expert_seed) && !Number(row.sample_size))) { var p = await rowFor(parentId); if (p && (Number(p.has_expert_seed) || Number(p.sample_size))) { row = p; inherited = true; } }
  if (!row) return { state: 'none', n: 0, inherited: false };
  var n = Number(row.sample_size) || 0, seeded = Number(row.has_expert_seed) === 1;
  if (!seeded && !n) return { state: 'none', n: 0, inherited: false };
  return { state: seeded && !n ? 'seeded' : 'learned', n: n, seeded: seeded, inherited: inherited, updated_at: row.updated_at || null };
}

module.exports = {
  LAYOUT_CLASSES: LAYOUT_CLASSES, tokenize: tokenize,
  censusContext: censusContext, proposedLayoutClass: proposedLayoutClass, pileVocabulary: pileVocabulary,
  contentClass: contentClass, ruleTitlesFor: ruleTitlesFor,
  targetFeatures: targetFeatures, signatureGate: signatureGate,
  adoptCensus: adoptCensus, backfillSignatures: backfillSignatures,
  estimatePosture: estimatePosture
};
