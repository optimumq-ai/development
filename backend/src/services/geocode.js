'use strict';
// Geocoding for the public-ready library map. TWO paths, per the design (basemap and data are
// separate problems): a real geocoder (Nominatim / OpenStreetMap - free, no key) for production, and
// a deterministic DEMO geocoder that clusters believable pins around a configured anchor (the demo's
// addresses are fictional, so real geocoding can't place them). Prefer a city GIS geocoder later.
var db = require('../db');
var https = require('https');
function nowStr() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function hash01(str, salt) { var h = 2166136261, s = (salt || '') + (str || ''); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

async function mapConfig() {
  var rows = await db.all("SELECT key, value FROM system_config WHERE key IN ('map_center_lat','map_center_lng','map_zoom','map_demo_geocode')");
  var m = {}; rows.forEach(function (r) { m[r.key] = r.value; });
  return { lat: Number(m.map_center_lat) || 32.7767, lng: Number(m.map_center_lng) || -96.7970, zoom: Number(m.map_zoom) || 12, demo: m.map_demo_geocode !== '0' };
}

// Pull a US street address out of free text (title/summary). Null when there is none (e.g. a business
// license for a company with no premises address) - those records simply are not pinned.
function extractAddress(text) {
  if (!text) return null;
  var re = /\b(\d{1,6})\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\s+(Drive|Dr|Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Boulevard|Blvd|Parkway|Pkwy|Highway|Hwy|Way|Court|Ct|Circle|Cir|Place|Pl|Trail|Trl|Terrace|Ter)\b/;
  var m = String(text).match(re);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

// Real geocode via Nominatim. Returns {lat,lng,source} or null. Respects usage policy (UA; caller throttles).
function nominatim(address) {
  return new Promise(function (resolve) {
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
    var req = https.get(url, { headers: { 'User-Agent': 'OptimumQ-PublicRecords/1.0 (public records library map)' } }, function (res) {
      var data = ''; res.on('data', function (c) { data += c; }); res.on('end', function () {
        try { var j = JSON.parse(data); if (j && j[0]) return resolve({ lat: Number(j[0].lat), lng: Number(j[0].lon), source: 'nominatim' }); } catch (e) {}
        resolve(null);
      });
    });
    req.on('error', function () { resolve(null); });
    req.setTimeout(8000, function () { req.destroy(); resolve(null); });
  });
}

// Deterministic demo point clustered ~+/-3km around the anchor (stable per address).
function demoGeocode(address, cfg) {
  var dLat = (hash01(address, 'lat') - 0.5) * 0.06;
  var dLng = (hash01(address, 'lng') - 0.5) * 0.06;
  return { lat: Math.round((cfg.lat + dLat) * 1e6) / 1e6, lng: Math.round((cfg.lng + dLng) * 1e6) / 1e6, source: 'demo' };
}

async function geocodeRecord(fr, cfg) {
  cfg = cfg || await mapConfig();
  var addr = fr.geo_address || extractAddress(fr.title) || extractAddress(fr.summary);
  if (!addr) return null;
  var g = cfg.demo ? demoGeocode(addr, cfg) : await nominatim(addr);
  if (!g) return null;
  await db.run("UPDATE fulfilled_records SET geo_address = ?, latitude = ?, longitude = ?, geocode_source = ?, geocoded_at = ? WHERE id = ?", [addr, g.lat, g.lng, g.source, nowStr(), fr.id]);
  return Object.assign({ address: addr }, g);
}

async function backfill() {
  var cfg = await mapConfig();
  var rows = await db.all("SELECT id, title, summary, geo_address FROM fulfilled_records WHERE COALESCE(published,0) = 1 AND latitude IS NULL");
  var done = 0, skipped = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = await geocodeRecord(rows[i], cfg);
    if (r) done++; else skipped++;
    if (!cfg.demo) await new Promise(function (res) { setTimeout(res, 1100); }); // Nominatim 1 req/s
  }
  return { done: done, skipped: skipped };
}

module.exports = { mapConfig: mapConfig, extractAddress: extractAddress, nominatim: nominatim, demoGeocode: demoGeocode, geocodeRecord: geocodeRecord, backfill: backfill };
