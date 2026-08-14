'use strict';
// Redaction content audit (Kevin's idea, 2026-08-14): after zones are placed on a document, verify
// item by item that each box covers the KIND of thing its rule says it covers, and that nothing of
// that kind is left uncovered on the page. Deterministic — the words under every zone are already
// known from the text layer (document_pages.words), and each zone cites a redaction rule whose title
// names the datum. AI vision is NOT needed for native-text documents; the image-crop variant is a
// future enhancement for scanned pages (see SPEC_redaction.md).
//
// Flags are ADVISORY: they never block a release; they surface in the job report / batch results for
// a human. Flags must NEVER contain the covered text itself — that is the PII being redacted. They
// carry only shape facts (zone number, page, expected kind, character count).

// Recognizers for datum kinds a template commonly redacts. Deliberately conservative patterns —
// a missed flag is noise saved; a false "mismatch" flag costs reviewer trust.
var DETECTORS = {
  ssn: { label: 'Social Security number', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  phone: { label: 'phone number', re: /(\(\d{3}\)\s?|\b\d{3}[-. ])\d{3}[-. ]\d{4}\b/ },
  email: { label: 'email address', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  card: { label: 'card or account number', re: /\b(?:\d[ -]?){12}\d{1,4}\b/ },
  dob: { label: 'date of birth', re: /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/ }
};

// Rule title -> detector key. Titles are city-configurable, so this is a best-effort keyword map;
// rules with no match (attorney-client, deliberative, ...) get only the covers-no-text check.
function detectorForRule(title) {
  var t = String(title || '').toLowerCase();
  if (/social security/.test(t)) return 'ssn';
  if (/telephone|phone/.test(t)) return 'phone';
  if (/email/.test(t)) return 'email';
  if (/card|access device/.test(t)) return 'card';
  if (/dates? of birth|\bdob\b/.test(t)) return 'dob';
  return null;
}

function wordsInZone(words, z) {
  return words.filter(function (w) {
    var cx = w.x + (w.w || 0) / 2, cy = w.y + (w.h || 0) / 2;
    return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h;
  });
}

function joinWords(words) {
  return words
    .slice()
    .sort(function (a, b) { return Math.abs(a.y - b.y) > 0.008 ? a.y - b.y : a.x - b.x; })
    .map(function (w) { return w.t; })
    .join(' ');
}

// pages: document_pages rows (page_no, words JSON, has_text_layer)
// zones: redaction_zones rows with .idx assigned and rule_id set where a rule was cited
// ruleMap: rule_id -> { title, ... } (redactionApply already builds this)
// Returns an array of flags: { kind, zone, page, detail } — plain words, no covered content.
function auditZones(pages, zones, ruleMap) {
  var flags = [];
  var byPage = {};
  pages.forEach(function (pg) {
    if (!Number(pg.has_text_layer)) return; // image-only page: nothing to testify — future vision audit
    var words = [];
    try { words = JSON.parse(pg.words || '[]'); } catch (e) {}
    if (words.length) byPage[pg.page_no] = words;
  });

  var usedDetectors = {};
  zones.forEach(function (z) {
    var words = byPage[z.page_no];
    if (!words) return;
    var rule = z.rule_id && ruleMap[z.rule_id];
    var det = rule ? detectorForRule(rule.title) : null;
    if (det) usedDetectors[det] = 1;
    var covered = wordsInZone(words, z);
    if (!covered.length) {
      flags.push({ kind: 'no_text', zone: z.idx, page: z.page_no,
        detail: 'Box ' + z.idx + ' on page ' + z.page_no + ' covers no text at all — it may have drifted off its target.' });
      return;
    }
    if (det) {
      var text = joinWords(covered);
      if (!DETECTORS[det].re.test(text)) {
        flags.push({ kind: 'pattern_mismatch', zone: z.idx, page: z.page_no, expected: det,
          detail: 'Box ' + z.idx + ' on page ' + z.page_no + ' cites the rule "' + rule.title + '" but the ' + text.length + ' characters it covers do not contain a complete ' + DETECTORS[det].label + ' — it may cover only part of one, or the wrong text.' });
      }
    }
  });

  // Leak scan: for each datum kind this template redacts, is a full match still visible OUTSIDE
  // every zone? That is the dangerous direction — under-redaction on a citizen-facing document.
  var detKeys = Object.keys(usedDetectors);
  if (detKeys.length) {
    Object.keys(byPage).forEach(function (pageNo) {
      var pageZones = zones.filter(function (z) { return String(z.page_no) === String(pageNo); });
      var uncovered = byPage[pageNo].filter(function (w) {
        return !pageZones.some(function (z) {
          var cx = w.x + (w.w || 0) / 2, cy = w.y + (w.h || 0) / 2;
          return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h;
        });
      });
      var text = joinWords(uncovered);
      detKeys.forEach(function (det) {
        if (DETECTORS[det].re.test(text)) {
          flags.push({ kind: 'possible_leak', page: Number(pageNo), expected: det,
            detail: 'Page ' + pageNo + ': something shaped like a ' + DETECTORS[det].label + ' is visible OUTSIDE every redaction box — possible missed redaction.' });
        }
      });
    });
  }

  return flags;
}

module.exports = { auditZones: auditZones, detectorForRule: detectorForRule, DETECTORS: DETECTORS };
