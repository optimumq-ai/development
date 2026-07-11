'use strict';
// Redaction automation — the disposition function (SPEC_redaction_automation.md, slice 1).
//
// Pure logic: given the signals produced when a responsive file is triaged (AI content
// read + template match + record-type attributes + intake legal flag), decide ONE
// disposition and record WHY. No I/O, no DB — the caller assembles `signals` and persists
// the result (redaction_jobs.disposition / disposition_basis). This keeps every routing
// rule unit-testable over synthetic signal sets.
//
// Dispositions (first-match-wins ladder):
//   bypass    — no redaction: published public copy, previously-released dedup, or
//               record-type-clean (auto_release_eligible + a successful zero-span read).
//   legal     — intake legal flag, or an exemption category in legalCategories.
//   elevated  — many spans, a sensitive category, a restricted/confidential type, or
//               spans present with no confident template. Mandatory 2nd-person review.
//   standard  — spans present, ordinary category, confident template. Author self-releases.
//   simple    — nothing to redact (or a trusted template / few spans). Author self-releases.
//
// simple and standard share the release path (Q2: mandatory review is elevated+legal only);
// the label is informational (e.g. a worklist badge).

// Default policy. TUNABLE — slice 6 will move these into system_config, seeded from the
// jurisdiction's redaction_rules catalog. Category names match the seeded `redaction_rules.category`
// vocabulary: privacy | personnel | law_enforcement | health | legal | commercial | security.
var DEFAULT_CONFIG = {
  elevatedSpanThreshold: 8,      // span count at/above which a file is Elevated regardless of category
  simpleSpanMax: 3,              // at/below this, a confident-template file stays Simple (else Standard)
  legalCategories: ['law_enforcement', 'legal'],
  sensitiveCategories: ['health', 'personnel', 'commercial', 'security'],
  restrictedAvailability: ['restricted', 'confidential']
};

var DISPOSITIONS = ['bypass', 'simple', 'standard', 'elevated', 'legal'];

function mergeConfig(config) {
  var c = config || {};
  return {
    elevatedSpanThreshold: numOr(c.elevatedSpanThreshold, DEFAULT_CONFIG.elevatedSpanThreshold),
    simpleSpanMax: numOr(c.simpleSpanMax, DEFAULT_CONFIG.simpleSpanMax),
    legalCategories: lowerList(c.legalCategories, DEFAULT_CONFIG.legalCategories),
    sensitiveCategories: lowerList(c.sensitiveCategories, DEFAULT_CONFIG.sensitiveCategories),
    restrictedAvailability: lowerList(c.restrictedAvailability, DEFAULT_CONFIG.restrictedAvailability)
  };
}

function numOr(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
function lowerList(v, d) {
  if (!Array.isArray(v)) return d.slice();
  return v.filter(function (x) { return typeof x === 'string' && x; }).map(function (x) { return x.toLowerCase(); });
}

// signals (all optional; defensive defaults):
//   isPublishedPublicCopy   bool    — the selected file IS a published public-ready library record
//   priorReleasedOutputFileId string|null — a previously-released output for an identical source file (dedup hit)
//   autoReleaseEligible     bool    — record type flagged auto_release_eligible (all exemptions content-detectable)
//   publicAvailability      string  — record type: releasable | review_required | restricted | confidential
//   readOk                  bool    — the AI content read completed without error
//   spans                   array   — detected exempt spans, each { category }; [] when none / read not run
//   templateMatched         bool    — a layout template matched
//   templateScore           number  — match score
//   safetyThreshold         number  — the matched template's safety_threshold
//   legalFlag               bool    — requestNeedsLegalRedaction (intake SENSITIVE/LEGAL_HOLD/ONGOING_INVESTIGATION or legal_flag)
//
// returns { disposition, basis } where basis = { rule, ...evidence } (JSON-serializable for disposition_basis).
function computeDisposition(signals, config) {
  var s = signals || {};
  var cfg = mergeConfig(config);

  var spans = Array.isArray(s.spans) ? s.spans : [];
  var spanCount = spans.length;
  var categories = uniqueCategories(spans);
  var readOk = !!s.readOk;
  var readClean = readOk && spanCount === 0;
  var templateCoversForm = !!s.templateMatched &&
    typeof s.templateScore === 'number' &&
    typeof s.safetyThreshold === 'number' &&
    s.templateScore >= s.safetyThreshold;
  var availability = typeof s.publicAvailability === 'string' ? s.publicAvailability.toLowerCase() : null;

  // ---- 1. BYPASS (no redaction) ----
  if (s.isPublishedPublicCopy) {
    return out('bypass', { rule: 'published_public_copy' });
  }
  if (s.priorReleasedOutputFileId) {
    return out('bypass', { rule: 'previously_released_dedup', outputFileId: s.priorReleasedOutputFileId });
  }
  if (s.autoReleaseEligible && readClean) {
    return out('bypass', { rule: 'record_type_clean', autoReleaseEligible: true, spanCount: 0 });
  }
  // Guardrail: auto_release_eligible but the read did NOT complete cleanly never bypasses — it
  // falls through to a human path below (Simple), flagged read_incomplete.

  // ---- 2. LEGAL (mandatory legal review) ----
  if (s.legalFlag) {
    return out('legal', { rule: 'intake_legal_flag' });
  }
  var legalCat = firstIn(categories, cfg.legalCategories);
  if (legalCat) {
    return out('legal', { rule: 'legal_category', category: legalCat });
  }

  // ---- 3. ELEVATED (mandatory 2nd-person review) ----
  if (spanCount >= cfg.elevatedSpanThreshold) {
    return out('elevated', { rule: 'span_count', spanCount: spanCount, threshold: cfg.elevatedSpanThreshold });
  }
  var sensCat = firstIn(categories, cfg.sensitiveCategories);
  if (sensCat) {
    return out('elevated', { rule: 'sensitive_category', category: sensCat });
  }
  if (availability && cfg.restrictedAvailability.indexOf(availability) >= 0) {
    return out('elevated', { rule: 'restricted_record_type', publicAvailability: availability });
  }
  if (spanCount > 0 && !templateCoversForm) {
    return out('elevated', {
      rule: 'spans_without_confident_template',
      spanCount: spanCount,
      templateScore: (typeof s.templateScore === 'number' ? s.templateScore : null)
    });
  }

  // ---- 4/5. SELF-RELEASE BAND (Standard / Simple — same routing, informational split) ----
  if (spanCount === 0) {
    if (templateCoversForm) return out('simple', { rule: 'trusted_template', templateScore: s.templateScore });
    if (!readOk) return out('simple', { rule: 'read_incomplete', note: 'AI read did not complete — manual review' });
    if (availability === 'releasable') return out('simple', { rule: 'releasable_clean' });
    return out('simple', { rule: 'no_exempt_content' });
  }
  // spanCount > 0 here implies templateCoversForm (non-template spans were caught as Elevated above).
  if (templateCoversForm && spanCount <= cfg.simpleSpanMax) {
    return out('simple', { rule: 'trusted_template_few_spans', spanCount: spanCount });
  }
  return out('standard', { rule: 'spans_present', spanCount: spanCount });
}

function uniqueCategories(spans) {
  var seen = {};
  var list = [];
  for (var i = 0; i < spans.length; i++) {
    var c = spans[i] && typeof spans[i].category === 'string' ? spans[i].category.toLowerCase() : null;
    if (c && !seen[c]) { seen[c] = true; list.push(c); }
  }
  return list;
}

function firstIn(categories, set) {
  for (var i = 0; i < categories.length; i++) {
    if (set.indexOf(categories[i]) >= 0) return categories[i];
  }
  return null;
}

function out(disposition, basis) { return { disposition: disposition, basis: basis }; }

module.exports = { computeDisposition: computeDisposition, DISPOSITIONS: DISPOSITIONS, DEFAULT_CONFIG: DEFAULT_CONFIG };
