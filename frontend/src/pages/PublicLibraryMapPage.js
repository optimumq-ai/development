import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../lib/api';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

export default function PublicLibraryMapPage() {
  var mapRef = useRef(null);
  var mapObj = useRef(null);
  var [data, setData] = useState(null);
  var [err, setErr] = useState('');

  useEffect(function () {
    api.get('/public/library/map')
      .then(function (r) { setData(r.data); })
      .catch(function () { setErr('Could not load the map.'); });
  }, []);

  useEffect(function () {
    if (!data || !mapRef.current || mapObj.current) return;
    var map = L.map(mapRef.current).setView([data.center.lat, data.center.lng], data.zoom);
    mapObj.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
    var pts = [];
    (data.records || []).forEach(function (rec) {
      if (rec.lat == null || rec.lng == null) return;
      var m = L.circleMarker([rec.lat, rec.lng], { radius: 7, color: '#B45309', weight: 2, fillColor: '#F59E0B', fillOpacity: 0.85 }).addTo(map);
      var html = '<div style="min-width:200px;max-width:260px">'
        + '<div style="font-weight:700;font-size:13px;color:#1F4E79;margin-bottom:3px">' + esc(rec.title) + '</div>'
        + (rec.recordType ? '<div style="font-size:11px;color:#6B7280">' + esc(rec.recordType) + (rec.date ? ' &middot; ' + esc(rec.date) : '') + '</div>' : '')
        + (rec.address ? '<div style="font-size:11px;color:#6B7280;margin-top:2px">' + esc(rec.address) + '</div>' : '')
        + (rec.summary ? '<div style="font-size:12px;color:#374151;margin-top:6px;line-height:1.4">' + esc(rec.summary) + '</div>' : '')
        + (rec.fileId ? '<a href="/api/public/file/' + esc(rec.fileId) + '" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:8px;font-size:12px;font-weight:700;color:#1F4E79">View record &rarr;</a>' : '')
        + '</div>';
      m.bindPopup(html);
      pts.push([rec.lat, rec.lng]);
    });
    if (pts.length) { try { map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 }); } catch (e) {} }
  }, [data]);

  useEffect(function () { return function () { if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; } }; }, []);

  return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 28px 12px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#111', margin: 0 }}>Public Records Map</h1>
        <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '4px' }}>
          Released public records with a known address, plotted as pins. Click a pin to read the record.
          {data ? ' \u00b7 ' + (data.records || []).length + ' record' + ((data.records || []).length === 1 ? '' : 's') : ''}
          {data && data.demo ? ' \u00b7 demo positions' : ''}
        </div>
      </div>
      {err ? <div style={{ padding: '24px', color: '#9B1C1C' }}>{err}</div> : null}
      <div ref={mapRef} style={{ flex: 1, minHeight: '420px', margin: '0 28px 24px', border: '1px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden' }} />
    </div>
  );
}
