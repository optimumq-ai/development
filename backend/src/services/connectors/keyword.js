// Shared deterministic keyword matcher for native source search.
// No AI: plain term-overlap scoring so it catches records the semantic
// path misses (terminology the user recognizes but did not phrase well).
var STOP = {};
['the','a','an','of','for','to','and','or','in','on','at','by','my','me','i','we','our','you','your','want','need','needs','wanted','looking','look','get','got','all','any','some','from','with','about','please','show','find','records','record','document','documents','file','files','info','information','copy','copies','request','requesting','related','regarding','re','is','are','was','were','that','this','these','those','it','as','be'].forEach(function(w){ STOP[w] = 1; });

function tokenize(q) {
  return (q || '').toLowerCase().split(/[^a-z0-9]+/).filter(function(t){
    return t.length >= 2 && !STOP[t];
  }).filter(function(t, i, arr){ return arr.indexOf(t) === i; });
}

function match(terms, primary, secondary) {
  if (!terms || !terms.length) return null;
  var p = (primary || '').toLowerCase();
  var s = (secondary || '').toLowerCase();
  var matched = [];
  terms.forEach(function(t){ if (p.indexOf(t) !== -1 || s.indexOf(t) !== -1) matched.push(t); });
  if (!matched.length) return null;
  var titleHits = matched.filter(function(t){ return p.indexOf(t) !== -1; }).length;
  var base = Math.round(100 * matched.length / terms.length);
  var score = Math.min(100, base + Math.min(15, titleHits * 5));
  return { score: score, matched: matched };
}

module.exports = { tokenize: tokenize, match: match };
