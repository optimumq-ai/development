import React, { useState, useEffect } from 'react';
import api from '../lib/api';

var FIELDS = [
  ['searchHours', 'Search labor (hours)'],
  ['reviewHours', 'Review / redaction (hours)'],
  ['bwPages', 'B&W pages'],
  ['colorPages', 'Color pages'],
  ['oversizedPages', 'Oversized pages']
];

export default function EstimateProfilePanel(props) {
  var recordTypeId = props.recordTypeId;
  var [q, setQ] = useState({});
  var [prof, setProf] = useState(null);
  var [assess, setAssess] = useState(null);
  var [loading, setLoading] = useState(true);
  var [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      api.get('/estimate-profiles/' + recordTypeId),
      api.post('/estimate-profiles/assess', { recordTypeId: recordTypeId })
    ]).then(function (r) {
      setProf(r[0].data); setQ(r[0].data.quantities || {}); setAssess(r[1].data); setLoading(false);
    }).catch(function () { setLoading(false); });
  }
  useEffect(load, [recordTypeId]);

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  async function save() {
    setSaving(true);
    var quantities = {};
    FIELDS.forEach(function (f) { if (q[f[0]] != null && q[f[0]] !== '') quantities[f[0]] = num(q[f[0]]); });
    try { await api.put('/estimate-profiles/' + recordTypeId, { quantities: quantities }); } catch (e) {}
    setSaving(false); load();
  }

  if (loading) return <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '18px' }}>Loading estimate automation...</div>;

  var automated = assess && assess.decision === 'automated';
  var bannerBg = automated ? '#DEF7EC' : '#FEF3C7', bannerFg = automated ? '#03543F' : '#92400E';
  var reason = assess && assess.reasons && assess.reasons[assess.reasons.length - 1];

  return (
    <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid #E5E7EB' }}>
      <label style={{ fontSize: '13px', fontWeight: '700', color: '#374151' }}>Estimate automation</label>
      <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '8px' }}>Typical effort for one request of this type. Seed it once and matching requests auto-estimate; leave it blank and they go to a person.</div>

      <div style={{ background: bannerBg, color: bannerFg, borderRadius: '8px', padding: '8px 12px', fontSize: '12px', marginBottom: '10px' }}>
        <b>{automated ? 'Auto-estimates' : 'Needs a human estimate'}</b>
        {automated && assess.estimatedTotal != null ? ' \u00b7 ~$' + Number(assess.estimatedTotal).toFixed(2) + (assess.basis ? ' (' + assess.basis + ')' : '') : ''}
        {reason ? <div style={{ marginTop: '2px', opacity: 0.85 }}>{reason}</div> : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {FIELDS.map(function (f) {
          return (
            <div key={f[0]}>
              <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '2px' }}>{f[1]}</div>
              <input type="number" step="0.1" min="0" value={q[f[0]] == null ? '' : q[f[0]]} onChange={function (e) { var nq = Object.assign({}, q); nq[f[0]] = e.target.value; setQ(nq); }}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E5E7EB', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
            </div>
          );
        })}
      </div>

      {prof && prof.sampleSize > 0 ? <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '8px' }}>Learned from {prof.sampleSize} completed request(s){prof.source ? ' \u00b7 ' + prof.source : ''}.</div> : null}

      <button onClick={save} disabled={saving} style={{ marginTop: '10px', padding: '7px 14px', borderRadius: '7px', border: '1px solid #1F4E79', background: 'white', color: '#1F4E79', fontSize: '12px', fontWeight: '600', cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving...' : 'Save estimate profile'}</button>
    </div>
  );
}
