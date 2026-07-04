'use strict';
// Demo email-system connector. Returns ONLY a COUNT of matching emails - never content, subject
// lines, or senders. Raw email is UNREVIEWED; even a subject or a sender address can itself contain
// exempt or personal information, so email mode discloses a number and a narrowing conversation, and
// nothing more. Mirrors real e-discovery count queries (terms + custodians + date range) as they
// work against Microsoft Graph/Purview or Google Vault, without exposing any content.
var db = require('../../db');

var STOP = { the:1,'a':1,an:1,of:1,and:1,or:1,to:1,for:1,in:1,on:1,at:1,by:1,from:1,with:1,about:1,all:1,any:1,me:1,'i':1,my:1,we:1,our:1,us:1,you:1,your:1,please:1,email:1,emails:1,'e-mail':1,'e-mails':1,mail:1,correspondence:1,records:1,record:1,copy:1,copies:1,between:1,regarding:1,'re':1,related:1,concerning:1,want:1,need:1,needs:1,looking:1,seeking:1,request:1,requests:1,requesting:1,messages:1,message:1,sent:1,received:1,that:1,this:1,them:1,they:1,were:1,was:1,are:1,is:1,been:1,have:1,has:1,had:1,would:1,like:1,get:1,also:1,city:1,gov:1,com:1,net:1,org:1,cityofautumnfalls:1 };
function terms(q) { return String(q || '').toLowerCase().replace(/[^a-z0-9@.\s-]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 3 && !STOP[w]; }); }
function extractDates(q) {
  var years = (String(q || '').match(/\b(20\d\d)\b/g) || []).map(Number);
  if (!years.length) return null;
  var lo = Math.min.apply(null, years), hi = Math.max.apply(null, years);
  return { from: lo + '-01-01', to: hi + '-12-31' };
}

// Count-only query. Returns { count, terms, dateRange } - no rows, no content.
async function count(query, config) {
  var ts = terms(query).filter(function (t) { return !/^20\d\d$/.test(t); });
  var cfg = config || {};
  var dr = extractDates(query);
  if (!ts.length) {
    var sql0 = "SELECT COUNT(*) AS c FROM demo_emails", p0 = [];
    if (dr) { sql0 += " WHERE sent_date >= ? AND sent_date <= ?"; p0.push(dr.from, dr.to); }
    var t0 = await db.get(sql0, p0);
    return { count: Number(t0 && t0.c) || 0, terms: [], dateRange: dr, broad: true };
  }
  var conds = ts.map(function () { return "(LOWER(subject) LIKE ? OR LOWER(body) LIKE ? OR LOWER(sender) LIKE ? OR LOWER(recipients) LIKE ?)"; });
  var params = [];
  ts.forEach(function (t) { var v = '%' + t + '%'; params.push(v, v, v, v); });
  var sql = "SELECT COUNT(*) AS c FROM demo_emails WHERE (" + conds.join(') AND (') + ")";
  if (dr) { sql += " AND sent_date >= ? AND sent_date <= ?"; params.push(dr.from, dr.to); }
  var r = await db.get(sql, params);
  return { count: Number(r && r.c) || 0, terms: ts, dateRange: dr };
}

// Never contributes cards to the document search.
function search() { return []; }

module.exports = { count: count, search: search, terms: terms, extractDates: extractDates };
