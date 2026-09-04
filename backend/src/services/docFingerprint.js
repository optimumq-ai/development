'use strict';
// Document layout fingerprinting (Kevin's design, 2026-08-14) — the deterministic replacement for
// the AI-digest variant scan. Code reads EVERY document once and stores ~10 cheap features; sorting
// and matching those features finds same-template piles with exact counts, and AI is demoted to
// naming and validating groups it never had to discover. Native-text PDFs only: features come from
// the pdftotext text layer (word coordinates included), so no rasterizing and no OpenCV. Documents
// with no text layer are honestly reported as unreadable — the OCR/vision path is a future
// enhancement (SPEC_taxonomy_classification.md).
//
// Tolerant matching: 8 of 10 features must agree, so a feature zone that happens to contain
// variable data (an applicant name, a permit number) cannot break a match on its own. Text
// features are normalized (digits -> '#') so "Permit No. 2024-0117" matches "Permit No. 2025-0093".
var execFileSync = require('child_process').execFileSync;
var docProcessing = require('./docProcessing');

var FEATURE_V = 3;       // bump when extractFeatures changes shape — census re-extracts stale rows
var Y_TOL = 0.03;        // vertical drift tolerance (print-driver drift absorbs here)
var LINE_TOL = 2;        // line-count tolerance
var MATCH_THRESHOLD = 8; // features (of 10) that must agree for two documents to match

function normText(s, cap) {
  return String(s || '').toLowerCase().replace(/\d/g, '#').replace(/[^a-z#]+/g, ' ')
    .replace(/\s+/g, ' ').trim().substring(0, cap || 40);
}

// Group page-1 words into visual lines (words whose baselines sit within tolerance).
function toLines(words) {
  var sorted = words.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
  var lines = [], cur = null;
  sorted.forEach(function (w) {
    if (!cur || w.y - cur.y > 0.006) { cur = { y: w.y, words: [w] }; lines.push(cur); }
    else cur.words.push(w);
  });
  lines.forEach(function (l) { l.words.sort(function (a, b) { return a.x - b.x; }); });
  return lines;
}

// Extract the ~10-item feature vector from a PDF on disk. Returns null when the file has no
// readable text layer on page 1 (scanned/image PDF) or cannot be read at all.
function extractFeatures(pdfPath) {
  var pageCount = 0;
  try {
    var info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8', timeout: 15000 });
    pageCount = parseInt((info.match(/Pages:\s+(\d+)/) || [])[1]) || 0;
  } catch (e) { return null; }
  var bbox = '';
  try { bbox = execFileSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', pdfPath, '-'], { encoding: 'utf8', timeout: 15000 }); } catch (e) { return null; }
  var parsed = docProcessing.parseBboxPage(bbox);
  if (!parsed || !parsed.words.length) return null;
  var words = parsed.words;
  var lines = toLines(words);
  var first = lines[0], last = lines[lines.length - 1];
  var mid = words.filter(function (w) { return w.y >= 0.42 && w.y <= 0.58; });
  // Field labels — tokens ending with ':' — are the text a TEMPLATE owns while values vary.
  var labels = {};
  words.forEach(function (w) { if (/^[A-Za-z][A-Za-z ./()#-]{1,30}:$/.test(w.t)) labels[normText(w.t.slice(0, -1), 30)] = 1; });
  // The TITLE VETO feature (2026-09-04, Kevin's dev-services corpus): every city form shares the
  // letterhead, so firstLine/topLeft cannot tell a Correction Notice from an Inspection Report — the
  // 8/10 tolerance then chained five distinct field-table forms into one 100-document cluster. The
  // form's TITLE is template-owned text (only digits vary) printed LARGER than body text: take the two
  // tallest lines of the top half (letterhead + title), in reading order. Two documents whose titleLines
  // differ are DIFFERENT templates regardless of how alike their tables are — a hard veto in isMatch.
  // Only lines MEANINGFULLY taller than the document's median line qualify — a doc whose second-tallest
  // line is ordinary body text must not adopt it (it may carry a varying value, e.g. an applicant name,
  // and the veto would then split a same-template pile). One qualifying line is fine; none disables the
  // veto for this document (scored matching still applies).
  function lineMed(l) { var hs = l.words.map(function (w) { return w.h || 0; }).sort(function (a, b) { return a - b; }); return hs.length ? hs[Math.floor(hs.length / 2)] : 0; }
  var allMeds = lines.map(lineMed).filter(function (h) { return h > 0; }).sort(function (a, b) { return a - b; });
  var docMed = allMeds.length ? allMeds[Math.floor(allMeds.length / 2)] : 0;
  var scoredHead = lines.slice(0, 10).map(function (l, idx) {
    return { idx: idx, med: +lineMed(l).toFixed(3), text: normText(l.words.map(function (w) { return w.t; }).join(' ')) };
  }).filter(function (sh) { return sh.text && docMed > 0 && sh.med >= docMed * 1.15; });
  var tallest = scoredHead.slice().sort(function (a, b) { return b.med - a.med || a.idx - b.idx; }).slice(0, 2)
    .sort(function (a, b) { return a.idx - b.idx; });
  var titleLines = tallest.length ? tallest.map(function (sh) { return sh.text; }).join(' | ') : null;
  return {
    v: FEATURE_V,
    pageCount: pageCount,
    titleLines: titleLines,
    topLeft: normText((first.words[0] || {}).t, 12),
    firstLine: normText(first.words.map(function (w) { return w.t; }).join(' ')),
    lastLine: normText(last.words.map(function (w) { return w.t; }).join(' ')),
    midZone: normText(mid.slice(0, 12).map(function (w) { return w.t; }).join(' ')),
    firstY: +first.y.toFixed(4),
    lastY: +last.y.toFixed(4),
    lineCount: lines.length,
    wordCount: words.length,
    labels: Object.keys(labels).sort().slice(0, 40)
  };
}

function jaccard(a, b) {
  a = a || []; b = b || [];
  if (!a.length && !b.length) return 1;
  var setA = {}, inter = 0; a.forEach(function (x) { setA[x] = 1; });
  b.forEach(function (x) { if (setA[x]) inter++; });
  var union = a.length + b.length - inter;
  return union ? inter / union : 1;
}

// 10-feature comparison. Returns the number of agreeing features (0-10).
function matchScore(a, b) {
  if (!a || !b) return 0;
  var s = 0;
  if (a.pageCount === b.pageCount) s++;
  if (a.topLeft === b.topLeft) s++;
  if (a.firstLine === b.firstLine) s++;
  if (a.lastLine === b.lastLine) s++;
  if (a.midZone === b.midZone) s++;
  if (Math.abs(a.firstY - b.firstY) <= Y_TOL) s++;
  if (Math.abs(a.lastY - b.lastY) <= Y_TOL) s++;
  if (Math.abs(a.lineCount - b.lineCount) <= LINE_TOL) s++;
  var wc = Math.max(a.wordCount, b.wordCount, 1);
  if (Math.abs(a.wordCount - b.wordCount) / wc <= 0.15) s++;
  if (jaccard(a.labels, b.labels) >= 0.6) s++;
  if (a.titleLines && b.titleLines && a.titleLines === b.titleLines) s++; // 11th feature
  return s;
}

function isMatch(a, b) {
  // Title veto: template-owned title text disagreeing = different templates, no matter the score.
  // Old (v1) features/signatures carry no titleLines — the veto only fires when BOTH sides have one,
  // so previously approved variant signatures keep matching tolerantly.
  if (a && b && a.titleLines && b.titleLines && a.titleLines !== b.titleLines) return false;
  return matchScore(a, b) >= MATCH_THRESHOLD;
}

// Cluster feature vectors with union-find over pairwise matches. items: [{ features, ... }].
// Returns arrays of item indexes. O(n^2) cheap comparisons — fine for per-drive corpus sizes.
function cluster(items) {
  var parent = items.map(function (_, i) { return i; });
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  for (var i = 0; i < items.length; i++) {
    for (var j = i + 1; j < items.length; j++) {
      if (isMatch(items[i].features, items[j].features)) {
        var ri = find(i), rj = find(j);
        if (ri !== rj) parent[rj] = ri;
      }
    }
  }
  var groups = {};
  items.forEach(function (_, i) { var r = find(i); (groups[r] = groups[r] || []).push(i); });
  return Object.keys(groups).map(function (k) { return groups[k]; });
}

function median(nums) { var s = nums.slice().sort(function (a, b) { return a - b; }); return s[Math.floor(s.length / 2)]; }
function mode(vals) {
  var counts = {}, best = vals[0], n = 0;
  vals.forEach(function (v) { var k = String(v); counts[k] = (counts[k] || 0) + 1; if (counts[k] > n) { n = counts[k]; best = v; } });
  return best;
}

// Consensus signature for a cluster: the per-feature value the majority of members share. Stored
// on the approved variant (discovery_meta.signature) so FUTURE scans of OTHER locations recognize
// the same template instead of re-proposing it — one oddball member never drags the definition.
function signature(featureList) {
  var labelCounts = {};
  featureList.forEach(function (f) { (f.labels || []).forEach(function (l) { labelCounts[l] = (labelCounts[l] || 0) + 1; }); });
  var consensusLabels = Object.keys(labelCounts).filter(function (l) { return labelCounts[l] >= featureList.length * 0.6; }).sort();
  function pick(field) { return mode(featureList.map(function (f) { return f[field]; })); }
  return {
    v: 3,
    pageCount: pick('pageCount'),
    titleLines: pick('titleLines'),
    topLeft: pick('topLeft'),
    firstLine: pick('firstLine'),
    lastLine: pick('lastLine'),
    midZone: pick('midZone'),
    firstY: median(featureList.map(function (f) { return f.firstY; })),
    lastY: median(featureList.map(function (f) { return f.lastY; })),
    lineCount: Math.round(median(featureList.map(function (f) { return f.lineCount; }))),
    wordCount: Math.round(median(featureList.map(function (f) { return f.wordCount; }))),
    labels: consensusLabels
  };
}

function matchesSignature(features, sig) { return isMatch(features, sig); }

// Layout uniformity from within-cluster agreement (sampled pairs for big clusters): 'uniform'
// when nearly every feature agrees across members, 'few_layouts' when the 8/10 tolerance is doing
// real work. Feeds the existing mass-redaction-candidate concept with a measured value.
function layoutConsistency(featureList) {
  if (featureList.length < 2) return 'uniform';
  var total = 0, pairs = 0;
  var step = Math.max(1, Math.floor(featureList.length / 20));
  for (var i = 0; i < featureList.length; i += step) {
    for (var j = i + 1; j < featureList.length; j += step) {
      total += matchScore(featureList[i], featureList[j]); pairs++;
    }
  }
  var avg = pairs ? total / pairs : 10;
  return avg >= 9.5 ? 'uniform' : 'few_layouts';
}

module.exports = {
  FEATURE_V: FEATURE_V,
  extractFeatures: extractFeatures, matchScore: matchScore, isMatch: isMatch,
  cluster: cluster, signature: signature, matchesSignature: matchesSignature,
  layoutConsistency: layoutConsistency, MATCH_THRESHOLD: MATCH_THRESHOLD
};
