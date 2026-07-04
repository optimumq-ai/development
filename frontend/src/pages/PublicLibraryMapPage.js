import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../lib/api';

var BLUE = '#1F4E79';
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function popupHtml(rec) {
  return '<div style="min-width:200px;max-width:260px">'
    + '<div style="font-weight:700;font-size:13px;color:#1F4E79;margin-bottom:3px">' + esc(rec.title) + '</div>'
    + (rec.recordType ? '<div style="font-size:11px;color:#6B7280">' + esc(rec.recordType) + (rec.date ? ' &middot; ' + esc(rec.date) : '') + '</div>' : '')
    + (rec.address ? '<div style="font-size:11px;color:#6B7280;margin-top:2px">' + esc(rec.address) + '</div>' : '')
    + (rec.summary ? '<div style="font-size:12px;color:#374151;margin-top:6px;line-height:1.4">' + esc(rec.summary) + '</div>' : '')
    + (rec.fileId ? '<a href="/api/public/file/' + esc(rec.fileId) + '" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:8px;font-size:12px;font-weight:700;color:#1F4E79">View record &rarr;</a>' : '')
    + '</div>';
}

export default function PublicLibraryMapPage() {
  var mapRef = useRef(null);
  var mapObj = useRef(null);
  var markersRef = useRef(null);
  var [data, setData] = useState(null);
  var [err, setErr] = useState('');
  var [typeFilter, setTypeFilter] = useState('all');
  var [filterText, setFilterText] = useState('');

  useEffect(function () {
    api.get('/public/library/map').then(function (r) { setData(r.data); }).catch(function () { setErr('Could not load the map.'); });
  }, []);

  // record-type list + counts (for the chips)
  var typeCounts = {};
  (data && data.records ? data.records : []).forEach(function (r) { if (r.recordType) typeCounts[r.recordType] = (typeCounts[r.recordType] || 0) + 1; });
  var types = Object.keys(typeCounts).sort();

  function filtered() {
    if (!data || !data.records) return [];
    var q = filterText.trim().toLowerCase();
    return data.records.filter(function (r) {
      if (r.lat == null || r.lng == null) return false;
      if (typeFilter !== 'all' && r.recordType !== typeFilter) return false;
      if (q) {
        var hay = ((r.title || '') + ' ' + (r.recordType || '') + ' ' + (r.address || '') + ' ' + (r.summary || '') + ' ' + (r.department || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // create the map once
  useEffect(function () {
    if (!data || !mapRef.current || mapObj.current) return;
    var map = L.map(mapRef.current).setView([data.center.lat, data.center.lng], data.zoom);
    mapObj.current = map;
    markersRef.current = L.layerGroup().addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
  }, [data]);

  // (re)plot pins whenever the data or filters change
  useEffect(function () {
    var map = mapObj.current, layer = markersRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    var pts = [];
    filtered().forEach(function (rec) {
      var m = L.circleMarker([rec.lat, rec.lng], { radius: 7, color: '#B45309', weight: 2, fillColor: '#F59E0B', fillOpacity: 0.85 });
      m.bindPopup(popupHtml(rec));
      layer.addLayer(m);
      pts.push([rec.lat, rec.lng]);
    });
    if (pts.length) { try { map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 }); } catch (e) {} }
  }, [data, typeFilter, filterText]);

  useEffect(function () { return function () { if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; } }; }, []);

  var shown = filtered().length;
  var total = data && data.records ? data.records.filter(function (r) { return r.lat != null && r.lng != null; }).length : 0;

  function chip(active) { return { fontSize: '12px', padding: '5px 12px', borderRadius: '999px', cursor: 'pointer', border: '1px solid ' + (active ? BLUE : '#D1D5DB'), background: active ? '#EBF3FB' : 'white', color: active ? BLUE : '#374151', whiteSpace: 'nowrap' }; }

  return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 28px 10px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#111', margin: 0 }}>Public Records Map</h1>
        <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '4px' }}>
          Released public records with a known address, plotted as pins. Click a pin to read the record.
          {data ? ' \u00b7 showing ' + shown + ' of ' + total : ''}
          {data && data.demo ? ' \u00b7 demo positions' : ''}
        </div>
      </div>

      {data ? (
        <div style={{ padding: '0 28px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '8px', maxWidth: '460px' }}>
            <input value={filterText} onChange={function (e) { setFilterText(e.target.value); }} placeholder="Filter the map by keyword, address, or type&hellip;" style={{ flex: 1, padding: '9px 12px', borderRadius: '9px', border: '1px solid #D1D5DB', fontSize: '13px', outline: 'none' }} />
            {filterText ? <button onClick={function () { setFilterText(''); }} style={{ padding: '9px 14px', borderRadius: '9px', border: '1px solid #D1D5DB', background: 'white', color: '#374151', fontSize: '12.5px', cursor: 'pointer' }}>Clear</button> : null}
          </div>
          {types.length > 1 ? (
            <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={chip(typeFilter === 'all')} onClick={function () { setTypeFilter('all'); }}>All types ({total})</span>
              {types.map(function (t) { return <span key={t} style={chip(typeFilter === t)} onClick={function () { setTypeFilter(t); }}>{t} ({typeCounts[t]})</span>; })}
            </div>
          ) : null}
        </div>
      ) : null}

      {err ? <div style={{ padding: '24px', color: '#9B1C1C' }}>{err}</div> : null}
      <div ref={mapRef} style={{ flex: 1, minHeight: '380px', margin: '0 28px 24px', border: '1px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden' }} />
    </div>
  );
}
